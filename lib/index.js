/**
 * Host half of dsh-dual-balance.
 *
 * The balance widget itself is browser-side: it reads the DeepSeek account
 * balance through the account remote and the WorkBuddy credit through the
 * route dsh-workbuddy-connect already serves.
 *
 * What needs a host is the self-update notice. The browser cannot reach the
 * npm registry (CORS) and cannot install a plugin, so both abilities live
 * here behind loopback-only routes:
 *
 *   GET  /plugins/dsh-dual-balance/update-check  → is a newer release published?
 *   POST /plugins/dsh-dual-balance/update        → run `dsh plugin add` for it
 *
 * @module dsh-dual-balance
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Stable plugin name; the bundle patch entry refers to the package, not this. */
export const name = "dsh-dual-balance";

/** No mandatory host services; `webServer` is injected optionally in `apply`. */
export const inject = [];

/** Route the browser asks for the newest published version. */
const UPDATE_CHECK_PATH = "/plugins/dsh-dual-balance/update-check";

/** Route that installs a published version on the user's behalf. */
const UPDATE_APPLY_PATH = "/plugins/dsh-dual-balance/update";

/** Package this plugin keeps an eye on. */
const SELF_PACKAGE_NAME = "dsh-dual-balance";

/** Public registry the profile installs from. */
const NPM_BASE = "https://registry.npmjs.org";

/** How long one registry answer is reused, in milliseconds. */
const UPDATE_CACHE_MS = 5 * 60 * 1000;

/** Budget for one registry request. */
const UPDATE_FETCH_TIMEOUT_MS = 10_000;

/** Budget for one `dsh plugin add`, which runs a full pnpm install. */
const UPDATE_APPLY_TIMEOUT_MS = 180_000;

/** A metadata body above this is a surprise, not a package document. */
const UPDATE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Parse a semantic version, tolerating a leading `v`.
 *
 * @param raw - candidate version text.
 * @returns the parts, or undefined when the string is not a version.
 */
function parseSemver(raw) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
		String(raw ?? "").trim(),
	);
	if (match === null) return undefined;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		pre: match[4] ?? "",
	};
}

/**
 * Compare two semantic versions.
 *
 * @param a - left version.
 * @param b - right version.
 * @returns 1 when `a` is newer, -1 when older, 0 when equal or unparseable.
 */
function compareSemver(a, b) {
	const left = parseSemver(a);
	const right = parseSemver(b);
	if (left === undefined || right === undefined) return 0;
	for (const key of ["major", "minor", "patch"]) {
		if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
	}
	if (left.pre === right.pre) return 0;
	// A release outranks any prerelease of the same version.
	if (left.pre === "") return 1;
	if (right.pre === "") return -1;
	return left.pre < right.pre ? -1 : 1;
}

/** Version this copy was installed at, read from its own manifest. */
function installedVersion() {
	const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
	try {
		const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
		return typeof parsed.version === "string" ? parsed.version : undefined;
	} catch {
		return undefined;
	}
}

/** Write a JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

/**
 * Whether the request was addressed to the loopback interface.
 *
 * A browser-attached Origin must be loopback too: this drops DNS-rebinding
 * pages, whose requests arrive addressed to the attacker's domain. Same-origin
 * fetches from the plugin's own page carry no Origin and pass on Host alone.
 *
 * @param req - incoming request.
 * @returns true when the request may be trusted.
 */
function loopbackRequest(req) {
	const host = String(req.headers.host ?? "").toLowerCase();
	const loopbackHost =
		host === "127.0.0.1" ||
		host.startsWith("127.0.0.1:") ||
		host === "localhost" ||
		host.startsWith("localhost:") ||
		host === "[::1]" ||
		host.startsWith("[::1]:");
	if (!loopbackHost) return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		const parsed = new URL(String(origin));
		return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
	} catch {
		return false;
	}
}

/** Read a request body with a small cap. */
async function readRequestBody(req, limit = 4096) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("body too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Last successful registry answer, so a page reload is not a second request. */
let updateCache;

/**
 * Ask npm for the newest published version of this package.
 *
 * @returns the version, or undefined when the registry could not be reached.
 */
async function npmLatestVersion() {
	if (updateCache !== undefined && Date.now() - updateCache.at < UPDATE_CACHE_MS) {
		return updateCache.version;
	}
	try {
		const response = await fetch(`${NPM_BASE}/${SELF_PACKAGE_NAME}`, {
			headers: { accept: "application/json", "user-agent": SELF_PACKAGE_NAME },
			signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
		});
		if (!response.ok) return undefined;
		const text = await response.text();
		if (text.length > UPDATE_MAX_BYTES) return undefined;
		const document = JSON.parse(text);
		const latest = document?.["dist-tags"]?.latest;
		if (typeof latest !== "string" || parseSemver(latest) === undefined) return undefined;
		updateCache = { at: Date.now(), version: latest };
		return latest;
	} catch {
		return undefined;
	}
}

/**
 * Locate the dsh CLI that owns this installation.
 *
 * The desktop app ships it beside its executable; a bare `dsh` on PATH is the
 * fallback for a normal install.
 *
 * @returns the command to run, or undefined when neither exists.
 */
function dshCommand() {
	const exeDir = dirname(process.execPath);
	for (const candidate of [
		join(exeDir, "resources", "runtime", "cli", "bin", "dsh.cmd"),
		join(exeDir, "resources", "runtime", "cli", "bin", "dsh"),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Run `<dsh> plugin --profile <profile> add <name>@<version>`.
 *
 * @param version - version to install.
 * @returns whether it succeeded, with a short message and the output tail.
 */
function runInstall(version) {
	return new Promise((resolve) => {
		const cli = dshCommand();
		if (cli === undefined) {
			resolve({ ok: false, message: "cannot find the dsh CLI next to the running app" });
			return;
		}
		const profile = process.env.DSH_PROFILE ?? "desktop";
		const args = [cli, "plugin", "--profile", profile, "add", `${SELF_PACKAGE_NAME}@${version}`];
		const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : cli;
		const argv = process.platform === "win32" ? ["/d", "/s", "/c", ...args] : args.slice(1);
		const child = spawn(command, argv, {
			windowsHide: true,
			env: { ...process.env, DSH_PROFILE: profile },
		});
		let output = "";
		const collect = (chunk) => {
			output += String(chunk);
			if (output.length > 100_000) output = output.slice(-50_000);
		};
		child.stdout?.on("data", collect);
		child.stderr?.on("data", collect);
		const timer = setTimeout(() => {
			child.kill();
			resolve({
				ok: false,
				message: `timed out after ${UPDATE_APPLY_TIMEOUT_MS / 1000}s`,
				output: output.slice(-4000),
			});
		}, UPDATE_APPLY_TIMEOUT_MS);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ ok: false, message: String(error?.message ?? error) });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve(
				code === 0
					? { ok: true, message: "installed" }
					: { ok: false, message: `dsh exited with code ${code}`, output: output.slice(-4000) },
			);
		});
	});
}

/** Mount the update routes on the optional host web server. */
export function apply(ctx) {
	ctx.inject(["webServer"], (webCtx) => {
		webCtx.effect(() => {
			const disposeCheck = webCtx.webServer.register({
				kind: "exact",
				path: UPDATE_CHECK_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
					if (!loopbackRequest(req)) return writeJson(res, 403, { error: "request-not-trusted" });
					const current = installedVersion();
					const latest = await npmLatestVersion();
					writeJson(res, 200, {
						current,
						latest,
						status:
							current === undefined || latest === undefined
								? "unknown"
								: compareSemver(latest, current) > 0
									? "update-available"
									: "up-to-date",
					});
				},
			});
			const disposeApply = webCtx.webServer.register({
				kind: "exact",
				path: UPDATE_APPLY_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return writeJson(res, 405, { error: "method not allowed" });
					if (!loopbackRequest(req)) return writeJson(res, 403, { error: "request-not-trusted" });
					let request;
					try {
						request = JSON.parse(await readRequestBody(req));
					} catch {
						return writeJson(res, 400, { error: "invalid body" });
					}
					const version = typeof request?.version === "string" ? request.version : undefined;
					if (version === undefined || parseSemver(version) === undefined) {
						return writeJson(res, 400, { error: "invalid version" });
					}
					// Only ever install a version the registry actually offers.
					const latest = await npmLatestVersion();
					if (latest === undefined || latest !== version) {
						return writeJson(res, 409, { error: "version is not the published latest", latest });
					}
					const result = await runInstall(version);
					if (result.ok) updateCache = undefined;
					writeJson(res, result.ok ? 200 : 500, result);
				},
			});
			return () => {
				disposeCheck();
				disposeApply();
			};
		}, "dsh-dual-balance: update routes");
	});
}
