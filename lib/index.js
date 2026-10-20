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

/** Route reporting which WorkBuddy desktop apps exist on this machine. */
const APPS_PATH = "/plugins/dsh-dual-balance/workbuddy-apps";

/**
 * The two WorkBuddy desktop apps and how to spot them on disk.
 *
 * Windows installs land under a program-files root — `C:\Program Files`,
 * `C:\Program Files (x86)`, or `%LOCALAPPDATA%\Programs` — and, failing that,
 * leave the Electron user-data directory (`%APPDATA%\<App>`) created on first
 * launch. Checking every one of those keeps an install at a non-default root
 * from reading as "not installed".
 */
const WORKBUDDY_APPS = [
	{ id: "workbuddy", appName: "WorkBuddy" },
	{ id: "workbuddyAi", appName: "WorkBuddy AI" }
];

/**
 * Whether one WorkBuddy desktop app is installed on this machine.
 *
 * @param app - the app name as it appears in install and data directories.
 * @returns true when any trace of that app is present.
 */
function isAppInstalled(app) {
	const roaming = process.env.APPDATA;
	if (roaming !== undefined && roaming !== "" && existsSync(join(roaming, app.appName))) return true;
	if (process.platform === "win32") {
		const local = process.env.LOCALAPPDATA;
		const roots = [
			process.env.ProgramFiles,
			process.env["ProgramFiles(x86)"],
			local !== undefined && local !== "" ? join(local, "Programs") : undefined
		];
		for (const root of roots) {
			if (root !== undefined && root !== "" && existsSync(join(root, app.appName))) return true;
		}
	}
	if (process.platform === "darwin") {
		const home = process.env.HOME ?? "";
		if (existsSync(`/Applications/${app.appName}.app`)) return true;
		if (home !== "" && existsSync(join(home, "Applications", `${app.appName}.app`))) return true;
	}
	return false;
}

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
 * Path to the desktop CLI entry inside this installation.
 *
 * `resources/runtime/cli/bin/dsh.cmd` looks like the natural target, but a batch
 * file has to run through cmd.exe, and `cmd /s /c` strips the outermost quotes —
 * which turns an install path containing spaces (`D:\Program Files\…`) into a
 * command that cannot be found. Spawning the app's own runtime as Node, exactly
 * as that launcher does, sidesteps the shell altogether.
 *
 * @returns the CLI module path, or undefined when this is not a desktop install.
 */
function cliEntry() {
	const cliJs = join(
		dirname(process.execPath),
		"resources",
		"app.asar",
		"dsh",
		"node_modules",
		"@deepseek-ai",
		"dsh-desktop-host",
		"lib",
		"cli.js",
	);
	return existsSync(cliJs) ? cliJs : undefined;
}

/**
 * Run `dsh plugin --profile <profile> add <name>@<version>`.
 *
 * @param version - version to install.
 * @returns whether it succeeded, with a short message and the output tail.
 */
function runInstall(version) {
	return new Promise((resolve) => {
		const specifier = `${SELF_PACKAGE_NAME}@${version}`;
		const cliJs = cliEntry();
		if (cliJs === undefined) {
			resolve({
				ok: false,
				message: `cannot find the dsh CLI inside this installation; update manually with: dsh plugin add ${specifier}`,
			});
			return;
		}
		const profile = process.env.DSH_PROFILE ?? "desktop";
		const child = spawn(
			process.execPath,
			["--expose-internals", cliJs, "plugin", "--profile", profile, "add", specifier],
			{
				windowsHide: true,
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DSH_PROFILE: profile },
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
			const disposeApps = webCtx.webServer.register({
				kind: "exact",
				path: APPS_PATH,
				handler: (req, res) => {
					if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
					if (!loopbackRequest(req)) return writeJson(res, 403, { error: "request-not-trusted" });
					const apps = {};
					for (const app of WORKBUDDY_APPS) apps[app.id] = isAppInstalled(app);
					writeJson(res, 200, { apps });
				},
			});
			return () => {
				disposeCheck();
				disposeApply();
				disposeApps();
			};
		}, "dsh-dual-balance: update routes");
	});
}
