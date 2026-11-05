/**
 * Host half of dsh-dual-balance.
 *
 * The balance widget itself is browser-side: it reads the DeepSeek account
 * balance through the account remote, and each WorkBuddy row through one of the
 * credit routes this host half serves. Nothing that produces a number reaches
 * the browser except those two things.
 *
 * The WorkBuddy credit is read without dsh-workbuddy-connect: on request the
 * host looks up the desktop app's sign-in document, opens its AES-256-GCM
 * access token with the app's at-rest key, and calls the same billing endpoint
 * the desktop client calls. Two consequences:
 *
 *   - The plugin no longer depends on that (unmaintained) package, and the row
 *     survives when it is absent or its status route reports a billing error.
 *   - The number is the billing backend's precise value (`…Precise`), not a
 *     whole-credit integer rounded down, which is what the labelled row shows.
 *
 * What needs a host beside that: the browser cannot reach the npm registry
 * (CORS) and cannot install a plugin, so the self-update notice lives here too.
 *
 * Routes mounted (all loopback-only):
 *
 *   GET  /plugins/dsh-dual-balance/update-check         → is a newer release published?
 *   POST /plugins/dsh-dual-balance/update               → run `dsh plugin add` for it
 *   GET  /plugins/dsh-dual-balance/workbuddy-apps       → which WorkBuddy desktop apps are installed
 *   GET  /plugins/dsh-dual-balance/workbuddy-credits    → CN WorkBuddy variant's remaining credit
 *   GET  /plugins/dsh-dual-balance/workbuddy-credits/ai → international variant's remaining credit
 *
 * @module dsh-dual-balance
 */

import { spawn, execFileSync } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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

/** Route serving the CN WorkBuddy variant's remaining credit. */
const CREDITS_PATH = "/plugins/dsh-dual-balance/workbuddy-credits";

/** Route serving the international variant's remaining credit. */
const CREDITS_PATH_AI = "/plugins/dsh-dual-balance/workbuddy-credits/ai";

/** Billing endpoint base, one per region. */
const CN_BILLING_BASE = "https://www.codebuddy.cn";
const GLOBAL_BILLING_BASE = "https://www.workbuddy.ai";

/** Budget for one billing request. */
const BILLING_TIMEOUT_MS = 3e4;

/**
 * The two WorkBuddy desktop apps and every directory name each may use.
 *
 * Two independent things can make a naive check wrong:
 *
 * - **The folder name is not the product name.** The international build
 *   installs into `WorkBuddyAI` on Windows — no space — while calling itself
 *   "WorkBuddy AI" everywhere in its UI. A different build may pick either
 *   spelling, so both are probed rather than one being assumed.
 * - **The install root is not the system drive.** Windows has no rule that a
 *   program-files directory lives on `C:`; this machine alone has the
 *   international build under `D:\Program Files`. Only enumerating every
 *   fixed drive can see that.
 *
 * `authFile` names the per-variant sign-in document under the user-data root;
 * it is what a credit request reads.
 */
const WORKBUDDY_APPS = [
	{
		id: "workbuddy",
		appNames: ["WorkBuddy"],
		executableNames: ["WorkBuddy.exe"],
		authFile: "workbuddy-desktop.info"
	},
	{
		id: "workbuddyAi",
		appNames: ["WorkBuddyAI", "WorkBuddy AI", "workbuddy-ai"],
		executableNames: ["WorkBuddyAI.exe"],
		authFile: "workbuddy-desktop-ai.info"
	}
];

/** How long one drive scan is reused, in milliseconds. */
const APP_ROOTS_TTL_MS = 30 * 1000;

/** Cached roots with the time they were scanned; undefined until the first scan. */
let appRootsCache;

/**
 * Every directory a WorkBuddy install or its user data can live in.
 *
 * Each entry is tagged with whether the directory holds *user data* directly
 * (`%APPDATA%\<App>`) or holds *installs* one level down
 * (`…\Program Files\<App>`). The distinction matters because a data folder is
 * itself the trace — the app creates it on first launch — while a leftover
 * empty program-files folder must not count as an install.
 *
 * Scanning is cached: the drive list changes far less often than the widget
 * polls, and probing absent drive letters on every request is wasted work.
 *
 * @returns the roots to probe, in a stable order.
 */
function appRoots() {
	if (appRootsCache !== undefined && Date.now() - appRootsCache.at < APP_ROOTS_TTL_MS) {
		return appRootsCache.roots;
	}
	const roots = [];
	const roaming = process.env.APPDATA;
	if (roaming !== undefined && roaming !== "") roots.push({ path: roaming, userData: true });
	const local = process.env.LOCALAPPDATA;
	if (local !== undefined && local !== "") {
		roots.push({ path: local, userData: true });
		roots.push({ path: join(local, "Programs"), userData: false });
	}
	if (process.platform === "win32") {
		// A: and B: are skipped on purpose: probing a floppy drive blocks on the
		// physical device for seconds at a time when one is present.
		for (const drive of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
			const base = `${drive}:\\`;
			if (!existsSync(base)) continue;
			for (const folder of ["Program Files", "Program Files (x86)", "Programs"]) {
				const path = join(base, folder);
				if (existsSync(path)) roots.push({ path, userData: false });
			}
		}
	}
	if (process.platform === "darwin") {
		roots.push({ path: "/Applications", userData: false });
		const home = process.env.HOME ?? "";
		if (home !== "") roots.push({ path: join(home, "Applications"), userData: false });
	}
	appRootsCache = { at: Date.now(), roots };
	return roots;
}

/**
 * Whether one directory holds a real install rather than an empty leftover.
 *
 * The launcher is the strongest signal; failing that, the packed application
 * (`resources/app.asar`) or the installer's manifest. An updater staging tree
 * or a half-removed profile carries none of the three and stays "not
 * installed", so an empty `Program Files\<App>` cannot fake one.
 *
 * @param dir - candidate install directory.
 * @param executableNames - launcher names this app may ship.
 * @returns true when the directory looks like an install.
 */
function holdsInstall(dir, executableNames) {
	for (const executable of executableNames) {
		if (existsSync(join(dir, executable))) return true;
	}
	return existsSync(join(dir, "resources", "app.asar")) || existsSync(join(dir, "install-manifest.json"));
}

/**
 * Whether one WorkBuddy desktop app is installed on this machine.
 *
 * @param app - the app entry naming every spelling and launcher to try.
 * @returns true when any trace of that app is present.
 */
function isAppInstalled(app) {
	const roots = appRoots();
	for (const name of app.appNames) {
		// macOS ships a bundle, so the directory carries the extension there.
		const directoryNames = process.platform === "darwin" ? [`${name}.app`] : [name];
		for (const root of roots) {
			for (const directoryName of directoryNames) {
				const dir = join(root.path, directoryName);
				if (!existsSync(dir)) continue;
				// The user-data roots are the trace themselves; anywhere else the
				// directory has to prove it holds an install.
				if (root.userData || holdsInstall(dir, app.executableNames)) return true;
			}
		}
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

/**
 * The WorkBuddy desktop apps' local sign-in files, one per variant.
 *
 * The desktop app writes its session under
 * `<user-data>/CodeBuddyExtension/Data/Public/auth/<file>`, where the
 * user-data root is platform-specific. Windows keeps it under
 * `%LOCALAPPDATA%` (older copies may remain under `%APPDATA%`, so both are
 * tried).
 */
function authFileCandidates(authFile) {
	const rel = join("CodeBuddyExtension", "Data", "Public", "auth", authFile);
	const home = homedir();
	if (process.platform === "darwin") {
		return [join(home, "Library", "Application Support", rel)];
	}
	if (process.platform === "win32") {
		const local = process.env.LOCALAPPDATA ?? "";
		const roaming = process.env.APPDATA ?? "";
		return [join(local, rel), join(roaming, rel)].filter((candidate) => candidate !== rel);
	}
	const xdg = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
	return [join(xdg, rel)];
}

/** Read one variant's sign-in document, or undefined when no file is usable. */
function readCredentialDocument(authFile) {
	for (const file of authFileCandidates(authFile)) {
		if (!existsSync(file)) continue;
		try {
			const document = JSON.parse(readFileSync(file, "utf8"));
			if (document !== null && typeof document === "object" && !Array.isArray(document)) return document;
		} catch {
			// A half-written file is not a sign-in; try the next candidate.
		}
	}
	return undefined;
}

/**
 * WorkBuddy desktop binaries that can serve as the at-rest key helper.
 *
 * The 5.6+ sign-in file stores `accessToken` as an AES-256-GCM envelope whose
 * key comes from the desktop app's own private storage binding. That binding
 * only exists in WorkBuddy's custom Electron, so the app's own executable is run
 * once as plain Node to read it. Candidates come from the same enumerated
 * roots the install probe uses, so an install outside the system drive is seen
 * here too.
 */
function workBuddyBinaryCandidates() {
	const home = homedir();
	const candidates = [];
	if (process.env.WB_CHECKIN_WORKBUDDY_BIN) candidates.push(process.env.WB_CHECKIN_WORKBUDDY_BIN);
	if (process.env.WORKBUDDY_ELECTRON_BIN) candidates.push(process.env.WORKBUDDY_ELECTRON_BIN);
	for (const app of WORKBUDDY_APPS) {
		for (const name of app.appNames) {
			if (process.platform === "win32") {
				for (const root of appRoots()) {
					if (root.userData) continue;
					candidates.push(join(root.path, name, `${name}.exe`));
				}
			} else if (process.platform === "darwin") {
				candidates.push(`/Applications/${name}.app/Contents/MacOS/Electron`);
				if (home !== "") candidates.push(join(home, "Applications", `${name}.app`, "Contents", "MacOS", "Electron"));
			} else {
				candidates.push(`/opt/${name}/${name.toLowerCase()}`);
				if (home !== "") candidates.push(join(home, ".local", "bin", name.toLowerCase()));
			}
		}
	}
	return [...new Set(candidates)].filter((candidate) => candidate !== "");
}

/** The one-line program that prints the at-rest key payload. */
const AT_REST_HELPER =
	'process.stdout.write(String(process._linkedBinding("electron_browser_workbuddy_storage").loggerGet()))';

/** The at-rest key payload, read once and reused; null when unavailable. */
let atRestSecretKey;

/** Read the desktop app's at-rest key, or null when no binary can supply it. */
function readAtRestSecretKey() {
	if (atRestSecretKey !== undefined) return atRestSecretKey;
	for (const binary of workBuddyBinaryCandidates()) {
		if (!existsSync(binary)) continue;
		try {
			const output = execFileSync(binary, ["-e", AT_REST_HELPER], {
				encoding: "utf8",
				timeout: 20_000,
				maxBuffer: 1024 * 1024,
				windowsHide: true,
				stdio: ["ignore", "pipe", "ignore"],
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
			});
			const payload = JSON.parse(String(output ?? "").trim());
			const secret = payload?.atRestSecretKey;
			if (typeof secret !== "string" || secret === "") continue;
			const decoded = Buffer.from(secret, "base64");
			if (decoded.length !== 32) continue;
			if (decoded.toString("base64") !== secret) continue;
			if (decoded.every((byte) => byte === 0)) continue;
			atRestSecretKey = secret;
			return secret;
		} catch {
			// This binary cannot serve; try the next candidate.
		}
	}
	atRestSecretKey = null;
	return null;
}

/** Decrypted keys by envelope keyId; memory only, never written anywhere. */
const protectorKeyCache = new Map();

/** Derive the AES key for one envelope, verifying it against the envelope's keyId. */
function protectorKeyFor(keyId) {
	if (protectorKeyCache.has(keyId)) return protectorKeyCache.get(keyId);
	const secret = readAtRestSecretKey();
	if (secret === null) return null;
	const key = createHash("sha256").update(secret, "utf8").digest();
	if (createHash("sha256").update(key).digest("hex").slice(0, 16) !== keyId) return null;
	protectorKeyCache.set(keyId, key);
	return key;
}

/** Parse a canonical base64 string of a fixed length, or undefined. */
function parseBase64Exact(value, length) {
	if (typeof value !== "string" || value === "") return undefined;
	let decoded;
	try {
		decoded = Buffer.from(value, "base64");
	} catch {
		return undefined;
	}
	if (decoded.length === 0) return undefined;
	if (decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) return undefined;
	if (length !== undefined && decoded.length !== length) return undefined;
	return decoded;
}

/** Parse a `{$wbEncrypted:1, envelope}` field, or undefined when it is not one. */
function parseWrappedField(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	if (value.$wbEncrypted !== 1 || typeof value.envelope !== "string") return undefined;
	let inner;
	try {
		inner = JSON.parse(Buffer.from(value.envelope, "base64").toString("utf8"));
	} catch {
		return undefined;
	}
	if (inner === null || typeof inner !== "object" || Array.isArray(inner)) return undefined;
	if (inner.suite !== 1) return undefined;
	if (typeof inner.keyId !== "string" || !/^[0-9a-f]{16}$/.test(inner.keyId)) return undefined;
	const nonce = parseBase64Exact(inner.nonce, 12);
	const authTag = parseBase64Exact(inner.authTag, 16);
	const ciphertext = parseBase64Exact(inner.ciphertext);
	if (nonce === undefined || authTag === undefined || ciphertext === undefined) return undefined;
	return { keyId: inner.keyId, suite: inner.suite, nonce, authTag, ciphertext };
}

/** The AAD the desktop app binds to a credential field (suite 1, WBEV1). */
function buildAuthenticatedContextAad(keyId, suite) {
	const prefix = Buffer.from("WB-AAD\0", "ascii");
	const lengthPrefixed = (value) => {
		const bytes = Buffer.from(value, "utf8");
		const header = Buffer.allocUnsafe(4);
		header.writeUInt32BE(bytes.length);
		return Buffer.concat([header, bytes]);
	};
	const suiteBytes = Buffer.allocUnsafe(4);
	suiteBytes.writeUInt32BE(suite);
	return Buffer.concat([
		prefix,
		Buffer.from([1]),
		lengthPrefixed("WBEV1"),
		lengthPrefixed("sym-v1"),
		suiteBytes,
		lengthPrefixed(keyId),
		Buffer.from([2]),
		Buffer.from([0]),
		Buffer.from([0])
	]);
}

/**
 * Open one envelope field.
 * @returns `{ok:true, value}` or `{ok:false, reason}`.
 */
function decryptWrappedField(value) {
	const envelope = parseWrappedField(value);
	if (envelope === undefined) return { ok: false, reason: "not-wrapped" };
	const key = protectorKeyFor(envelope.keyId);
	if (key === null) return { ok: false, reason: "no-key" };
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce, { authTagLength: 16 });
		decipher.setAAD(buildAuthenticatedContextAad(envelope.keyId, envelope.suite));
		decipher.setAuthTag(envelope.authTag);
		const text = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString("utf8");
		return text === "" ? { ok: false, reason: "empty" } : { ok: true, value: text };
	} catch {
		return { ok: false, reason: "gcm-fail" };
	}
}

/**
 * Turn a variant's sign-in document into the credential the billing endpoint
 * needs, or into the reason the balance cannot be read.
 *
 * @returns `{status:"signed-out"}`, `{status:"signed-in", creditsError}`, or
 *   `{status:"signed-in", credential}`.
 */
function credentialFromDocument(document) {
	if (document === undefined) return { status: "signed-out" };
	const auth = document.auth !== null && typeof document.auth === "object" ? document.auth : document;
	const raw = auth?.accessToken;
	let accessToken;
	if (raw === undefined || raw === null) return { status: "signed-out" };
	if (typeof raw === "string") {
		if (raw === "") return { status: "signed-out" };
		accessToken = raw;
	} else {
		const opened = decryptWrappedField(raw);
		if (!opened.ok) {
			return { status: "signed-in", creditsError: `could not read the WorkBuddy access token (${opened.reason})` };
		}
		accessToken = opened.value;
	}
	const account = document.account !== null && typeof document.account === "object" ? document.account : {};
	return {
		status: "signed-in",
		credential: {
			accessToken,
			uid: account.uid != null ? String(account.uid) : "",
			domain: auth.domain != null ? String(auth.domain) : "",
			enterpriseId: account.enterpriseId != null ? String(account.enterpriseId) : ""
		}
	};
}

/** Region for a sign-in domain; an empty domain means CN. */
function regionOf(domain) {
	const lowered = String(domain ?? "").trim().toLowerCase();
	if (lowered === "workbuddy.ai" || lowered.endsWith(".workbuddy.ai")) return "global";
	return "cn";
}

/** Billing base URL for a credential's region. */
function billingBase(credential) {
	return regionOf(credential.domain) === "global" ? GLOBAL_BILLING_BASE : CN_BILLING_BASE;
}

/** Headers the official desktop client sends on a billing request. */
function billingHeaders(credential) {
	const headers = {
		Authorization: `Bearer ${credential.accessToken}`,
		Accept: "application/json",
		"Content-Type": "application/json"
	};
	if (credential.uid !== "") headers["X-User-Id"] = credential.uid;
	if (credential.enterpriseId !== "") {
		headers["X-Enterprise-Id"] = credential.enterpriseId;
		headers["X-Tenant-Id"] = credential.enterpriseId;
	}
	if (credential.domain !== "") headers["X-Domain"] = credential.domain;
	return headers;
}

/** Read one billing envelope, or throw on a non-JSON or non-object body. */
async function readBillingEnvelope(response) {
	const text = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`workbuddy billing returned non-JSON (http ${response.status})`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`workbuddy billing returned an unexpected document (http ${response.status})`);
	}
	return {
		code: typeof parsed.code === "number" ? parsed.code : 0,
		msg: typeof parsed.msg === "string" ? parsed.msg : "",
		data: "data" in parsed ? parsed.data : undefined,
		document: parsed
	};
}

/** Fail a billing envelope whose business code is non-zero. */
function billingError(status, envelope) {
	return new Error(`workbuddy billing failed (http ${status}): ${envelope.msg.slice(0, 160)}`);
}

/**
 * The remaining credit on a personal account: the sum over its packages.
 *
 * Ported from dsh-workbuddy-connect's `fetchCredits` so this plugin no longer
 * depends on that (unmaintained) package for its WorkBuddy row.
 */
async function fetchPersonalCredits(credential) {
	const now = new Date();
	const format = (date) =>
		[
			date.getFullYear().toString().padStart(4, "0"),
			(date.getMonth() + 1).toString().padStart(2, "0"),
			date.getDate().toString().padStart(2, "0")
		].join("-") +
		" " +
		[
			date.getHours().toString().padStart(2, "0"),
			date.getMinutes().toString().padStart(2, "0"),
			date.getSeconds().toString().padStart(2, "0")
		].join(":");
	const response = await fetch(`${billingBase(credential)}/v2/billing/meter/get-user-resource`, {
		method: "POST",
		headers: billingHeaders(credential),
		body: JSON.stringify({
			PageNumber: 1,
			PageSize: 100,
			ProductCode: "p_tcaca",
			Status: [0, 3],
			PackageEndTimeRangeBegin: format(now),
			PackageEndTimeRangeEnd: format(new Date(now.getTime() + 3185136e6))
		}),
		signal: AbortSignal.timeout(BILLING_TIMEOUT_MS)
	});
	const envelope = await readBillingEnvelope(response);
	if (!response.ok || envelope.code !== 0) throw billingError(response.status, envelope);
	const wrapper = envelope.data !== null && typeof envelope.data === "object" ? envelope.data : {};
	const data = wrapper.Response !== null && typeof wrapper.Response === "object" ? wrapper.Response : {};
	const inner = data.Data !== null && typeof data.Data === "object" ? data.Data : {};
	const rawAccounts = Array.isArray(inner.Accounts) ? inner.Accounts : [];
	const accounts = [];
	let total = 0;
	for (const raw of rawAccounts) {
		if (raw === null || typeof raw !== "object") continue;
		// Upstream reports each amount twice: a truncated integer field
		// (`CapacityRemain`) and a full-precision string field
		// (`CapacityRemainPrecise`). The WorkBuddy desktop app shows the
		// precise value to two decimals, so sum those; the integer field is
		// only a fallback for older responses that lack the precise copy.
		const preciseField = (key) => {
			const precise = raw[`${key}Precise`];
			if (typeof precise === "string" && precise !== "" && !Number.isNaN(Number(precise))) return Number(precise);
			return typeof raw[key] === "number" ? raw[key] : 0;
		};
		const size = preciseField("CycleCapacitySize");
		const cycleRemain = preciseField("CycleCapacityRemain");
		const cycleUsed = preciseField("CycleCapacityUsed");
		const capacityRemain = preciseField("CapacityRemain");
		let remain;
		if (size > 0) remain = cycleRemain;
		else if (cycleRemain > 0 || cycleUsed > 0) remain = cycleRemain;
		else remain = capacityRemain;
		if (remain < 0) remain = 0;
		total += remain;
		accounts.push({
			packageName: typeof raw.PackageName === "string" ? raw.PackageName : "(unnamed)",
			remain,
			size: size > 0 ? size : preciseField("CapacitySize")
		});
	}
	return { total, accounts };
}

/**
 * The remaining credit on a CN enterprise account: one cycle quota.
 *
 * The personal endpoint answers these accounts with an empty package list,
 * which would render as "0 credit" — a plausible wrong number rather than a
 * visible failure. Ported from dsh-workbuddy-connect's `fetchEnterpriseCredits`.
 */
async function fetchEnterpriseCredits(credential) {
	const response = await fetch(`${CN_BILLING_BASE}/v2/billing/meter/get-enterprise-user-usage`, {
		method: "POST",
		headers: billingHeaders(credential),
		body: JSON.stringify({}),
		signal: AbortSignal.timeout(BILLING_TIMEOUT_MS)
	});
	const envelope = await readBillingEnvelope(response);
	if (!response.ok || envelope.code !== 0) throw billingError(response.status, envelope);
	const sources = [];
	for (const candidate of [envelope.data, envelope.document]) {
		if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) continue;
		if (candidate.data !== null && typeof candidate.data === "object" && !Array.isArray(candidate.data)) sources.push(candidate.data);
		sources.push(candidate);
	}
	const numberAt = (source, key) => (typeof source[key] === "number" ? source[key] : undefined);
	let limit;
	let used;
	for (const source of sources) {
		const candidate = numberAt(source, "limitNum") ?? numberAt(source, "limit_num");
		if (candidate === undefined) continue;
		limit = candidate;
		used = numberAt(source, "credit") ?? numberAt(source, "used_num");
		break;
	}
	if (limit === undefined) throw new Error("workbuddy enterprise billing response carried no recognised quota field");
	if (limit === -1) return { total: 0, accounts: [{ packageName: "enterprise", remain: 0, size: 0, unlimited: true }], unlimited: true };
	if (used === undefined) throw new Error("workbuddy enterprise billing response carried a quota limit but no recognised usage field");
	let remain = limit - used;
	if (remain < 0) remain = 0;
	return { total: remain, accounts: [{ packageName: "enterprise", remain, size: limit }] };
}

/** Read one credential's remaining credit, choosing the endpoint by account type. */
async function fetchCredits(credential) {
	if (regionOf(credential.domain) === "cn" && credential.enterpriseId !== "") return await fetchEnterpriseCredits(credential);
	return await fetchPersonalCredits(credential);
}

/**
 * Serve one variant's remaining credit in the shape the browser widget reads.
 *
 * The document mirrors what dsh-workbuddy-connect's status route reported
 * (`status`, `credits.total`, `creditsError`), so the widget's parsing is
 * unchanged — only the route it asks has moved, and the number behind it is
 * now the billing backend's precise value instead of a whole-credit integer.
 */
function workbuddyCreditsHandler(variant) {
	return async (req, res) => {
		if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
		if (!loopbackRequest(req)) return writeJson(res, 403, { error: "request-not-trusted" });
		const parsed = credentialFromDocument(readCredentialDocument(variant.authFile));
		if (parsed.status === "signed-out") return writeJson(res, 200, { status: "signed-out" });
		if (parsed.creditsError !== undefined) return writeJson(res, 200, { status: "signed-in", creditsError: parsed.creditsError });
		try {
			return writeJson(res, 200, { status: "signed-in", credits: await fetchCredits(parsed.credential) });
		} catch (error) {
			return writeJson(res, 200, { status: "signed-in", creditsError: String(error?.message ?? error) });
		}
	};
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
			const disposeCredits = webCtx.webServer.register({
				kind: "exact",
				path: CREDITS_PATH,
				handler: workbuddyCreditsHandler(WORKBUDDY_APPS[0])
			});
			const disposeCreditsAi = webCtx.webServer.register({
				kind: "exact",
				path: CREDITS_PATH_AI,
				handler: workbuddyCreditsHandler(WORKBUDDY_APPS[1])
			});
			return () => {
				disposeCheck();
				disposeApply();
				disposeApps();
				disposeCredits();
				disposeCreditsAi();
			};
		}, "dsh-dual-balance: update routes");
	});
}
