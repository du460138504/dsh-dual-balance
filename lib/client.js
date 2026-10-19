/**
 * Browser half of dsh-dual-balance.
 *
 * Renders one compact block in the sidebar foot (`sidebar.footer.action`)
 * with two rows:
 *
 *   DeepSeek   ¥8.91
 *   WorkBuddy  12,340
 *
 * DeepSeek balance comes from the account remote the Harness already owns.
 * WorkBuddy credit is read from the status route the dsh-workbuddy-connect
 * host half serves (`credits.total`); the widget degrades to a dash when
 * that plugin is absent, signed out, or reporting a billing error.
 */
window.__ModuleLoader__.load({
	id: "dsh-dual-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const react = require("react");
		const jsxRuntime = require("react/jsx-runtime");
		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;

		const name = "dsh-dual-balance";
		/** Locale namespace for the two labels and the placeholder copy. */
		const NS = "dual-balance";

		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.account"
		];

		/** Status route owned by dsh-workbuddy-connect; same origin, so plain fetch applies. */
		const WORKBUDDY_STATUS_PATH = "/plugins/dsh-workbuddy-connect/status";
		/** How often both numbers are re-read, in milliseconds. */
		const POLL_MS = 60 * 1000;
		/** Used when the boot payload carries no client version. */
		const FALLBACK_CLIENT_VERSION = "0.2.0-rc.2";

		const en = {
			deepseek: "DeepSeek",
			workbuddy: "WorkBuddy",
			loading: "…",
			unavailable: "—",
			signedOut: "signed out",
			titleDeepseek: "DeepSeek balance: {main} topped up{bonus}",
			bonusPart: ", {bonus} granted",
			titleWorkbuddy: "WorkBuddy credits remaining: {total}",
			titleWorkbuddyOut: "WorkBuddy is not signed in",
			titlePending: "Reading balances…",
			updateTitle: "A newer version of this plugin is available",
			updateNow: "Update",
			updateLater: "Later",
			updating: "Updating…",
			updateCurrent: "installed {version} · latest {latest}",
			updateDone: "Updated to {version} — quit DSH completely and reopen it to apply.",
			updateFailed: "Update failed: {message}",
			updateFailedHint: "You can run it yourself: dsh plugin add {name}@{version}"
		};
		const zh = {
			deepseek: "DeepSeek",
			workbuddy: "WorkBuddy",
			loading: "…",
			unavailable: "—",
			signedOut: "未登录",
			titleDeepseek: "DeepSeek 余额：充值 {main}{bonus}",
			bonusPart: "，赠金 {bonus}",
			titleWorkbuddy: "WorkBuddy 剩余积分：{total}",
			titleWorkbuddyOut: "WorkBuddy 未登录",
			titlePending: "正在读取余额…",
			updateTitle: "这个插件有新版本",
			updateNow: "更新",
			updateLater: "以后更新",
			updating: "正在更新…",
			updateCurrent: "已安装 {version} · 最新 {latest}",
			updateDone: "已更新到 {version}——请完全退出 DSH 后重新打开以生效。",
			updateFailed: "更新失败：{message}",
			updateFailedHint: "也可以手动执行：dsh plugin add {name}@{version}"
		};

		/**
		 * Format one currency amount the way the Harness formats balances.
		 *
		 * Deliberately not `toFixed(2)`: the Platform truncates to two decimals
		 * (`roundDown`), so a balance of 0.148 renders as 0.14 there and must not
		 * render as 0.15 here. Sub-cent balances collapse to `<symbol>0.01`.
		 * Arithmetic stays on the decimal string to avoid binary rounding.
		 */
		function formatBalance(amount, currency) {
			const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
			const source = typeof amount === "string" ? amount.trim() : String(amount ?? "");
			const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(source);
			if (match === null) return symbol + source;
			const negative = match[1] === "-";
			const integer = match[2];
			const fraction = match[3] ?? "";
			if (!/[1-9]/.test(integer + fraction)) return `${symbol}0.00`;
			if (negative) {
				// The Harness collapses sub-cent debts to one cent, then rounds half-up.
				const magnitude = Number(`${integer}.${fraction}`);
				return `-${symbol}${magnitude < 0.01 ? "0.01" : addCommas(magnitude.toFixed(2))}`;
			}
			const cents = fraction.padEnd(2, "0").slice(0, 2);
			// Only a balance whose whole part is zero can be below one cent.
			if (!/[1-9]/.test(integer) && !/[1-9]/.test(cents)) return `<${symbol}0.01`;
			return symbol + addCommas(`${integer.replace(/^0+(?=\d)/, "")}.${cents}`);
		}

		/** Group the integer digits of an already-fixed decimal string. */
		function addCommas(value) {
			const [integer, fraction] = value.split(".");
			const grouped = Number(integer).toLocaleString("en-US");
			return fraction === undefined ? grouped : `${grouped}.${fraction}`;
		}

		/**
		 * Format a credit count with two decimals and thousands separators.
		 *
		 * Upstream already reports credits at two-decimal precision, so anything
		 * beyond that is binary noise: this truncates rather than rounding, and
		 * never shows credit that has not been granted. Digits come from the
		 * number's shortest round-trip form, keeping the work off binary floats.
		 */
		function formatCredits(total) {
			const value = Number(total);
			if (!Number.isFinite(value)) return String(total ?? "");
			const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(String(value));
			if (match === null) return String(value);
			const cents = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
			return addCommas(`${match[1]}${match[2]}.${cents}`);
		}

		const containerStyle = {
			display: "flex",
			flexDirection: "column",
			gap: "1px",
			width: "100%",
			boxSizing: "border-box",
			padding: "2px 0 4px",
			fontSize: "11px",
			lineHeight: "15px",
			color: "var(--dsw-alias-label-primary, inherit)",
			userSelect: "none",
			cursor: "default"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "baseline",
			justifyContent: "space-between",
			gap: "8px",
			whiteSpace: "nowrap"
		};
		const labelStyle = { opacity: 0.55 };
		const valueStyle = { fontVariantNumeric: "tabular-nums" };

		/**
		 * Read the DeepSeek account balance once.
		 * @returns a row state: the rendered text plus the tooltip fragments.
		 */
		async function readDeepseek(account, clientMeta, t) {
			try {
				const result = await account.getBalance(clientMeta());
				if (!result || result.ok !== true) return { text: t("unavailable"), title: t("titlePending") };
				const value = result.value ?? {};
				const wallets = Array.isArray(value.value) ? value.value : [];
				const bonuses = Array.isArray(value.bonusWallets) ? value.bonusWallets.filter((wallet) => Number(wallet?.balance) > 0) : [];
				if (wallets.length === 0) return { text: t("unavailable"), title: t("titlePending") };
				const main = wallets.map((wallet) => formatBalance(wallet.balance, wallet.currency)).join(" ");
				const bonus = bonuses.length === 0 ? "" : bonuses.map((wallet) => formatBalance(wallet.balance, wallet.currency)).join(" ");
				return {
					text: bonus === "" ? main : `${main} +${bonus}`,
					title: bonus === "" ? t("titleDeepseek", { main, bonus: "" }) : t("titleDeepseek", { main, bonus: t("bonusPart", { bonus }) })
				};
			} catch {
				return { text: t("unavailable"), title: t("titlePending") };
			}
		}

		/**
		 * Read the WorkBuddy credit once.
		 *
		 * The host half reports `credits` on success, `creditsError` when the
		 * billing call failed, and no credit field at all when signed out.
		 */
		async function readWorkbuddy(t) {
			try {
				const response = await fetch(WORKBUDDY_STATUS_PATH, { headers: { accept: "application/json" }, credentials: "same-origin" });
				if (!response.ok) return { text: t("unavailable"), title: t("titlePending") };
				const value = await response.json().catch(() => void 0);
				if (value === null || typeof value !== "object" || Array.isArray(value)) return { text: t("unavailable"), title: t("titlePending") };
				if (value.status === "signed-out") return { text: t("signedOut"), title: t("titleWorkbuddyOut") };
				const total = value.credits?.total;
				if (typeof total !== "number") return { text: t("unavailable"), title: t("titlePending") };
				const text = formatCredits(total);
				return { text, title: t("titleWorkbuddy", { total: text }) };
			} catch {
				return { text: t("unavailable"), title: t("titlePending") };
			}
		}

		function Row(props) {
			return jsxs("div", {
				style: rowStyle,
				children: [
					jsx("span", { style: labelStyle, children: props.label }),
					jsx("span", { style: valueStyle, children: props.value })
				]
			});
		}

		/** The two-row balance block rendered in the sidebar foot. */
		function DualBalance(props) {
			const { t, account, clientMeta } = props;
			const [deepseek, setDeepseek] = react.useState(null);
			const [workbuddy, setWorkbuddy] = react.useState(null);

			react.useEffect(() => {
				let alive = true;
				const load = async () => {
					const next = await readDeepseek(account, clientMeta, t);
					if (alive) setDeepseek(next);
				};
				load();
				const timer = window.setInterval(load, POLL_MS);
				return () => {
					alive = false;
					window.clearInterval(timer);
				};
			}, [account, clientMeta, t]);

			react.useEffect(() => {
				let alive = true;
				const load = async () => {
					const next = await readWorkbuddy(t);
					if (alive) setWorkbuddy(next);
				};
				load();
				const timer = window.setInterval(load, POLL_MS);
				return () => {
					alive = false;
					window.clearInterval(timer);
				};
			}, [t]);

			const tooltip = [deepseek?.title, workbuddy?.title].filter((part) => typeof part === "string" && part !== "").join("\n");
			return jsxs("div", {
				style: containerStyle,
				title: tooltip,
				children: [
					jsx(Row, { label: t("deepseek"), value: deepseek === null ? t("loading") : deepseek.text }, "deepseek"),
					jsx(Row, { label: t("workbuddy"), value: workbuddy === null ? t("loading") : workbuddy.text }, "workbuddy")
				]
			});
		}

		/** Routes served by this plugin's host half for the self-update notice. */
		const UPDATE_CHECK_PATH = "/plugins/dsh-dual-balance/update-check";
		const UPDATE_APPLY_PATH = "/plugins/dsh-dual-balance/update";

		const noticeCardStyle = {
			position: "fixed",
			right: "20px",
			bottom: "20px",
			width: "340px",
			maxWidth: "calc(100vw - 40px)",
			boxSizing: "border-box",
			padding: "14px 16px",
			borderRadius: "12px",
			border: "1px solid var(--dsw-alias-border-default, rgba(0,0,0,.12))",
			background: "var(--dsw-alias-bg-elevated, #fff)",
			boxShadow: "0 12px 32px rgba(0,0,0,.18)",
			fontSize: "13px",
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary, #111)",
			zIndex: 2147483000
		};
		const noticeHeaderStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: "8px"
		};
		const noticeTitleStyle = { fontWeight: 600, paddingRight: "8px" };
		const noticeLinkStyle = {
			border: "none",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary, #666)",
			cursor: "pointer",
			fontSize: "12px",
			padding: "2px 4px",
			whiteSpace: "nowrap"
		};
		const noticeMetaStyle = { fontSize: "11px", opacity: 0.65, marginTop: "4px" };
		const noticeActionRowStyle = { display: "flex", justifyContent: "flex-end", marginTop: "10px" };
		const noticeButtonStyle = {
			border: "1px solid #111",
			background: "#111",
			color: "#fff",
			borderRadius: "7px",
			padding: "4px 14px",
			cursor: "pointer",
			fontSize: "12px"
		};
		const noticeNoteStyle = { fontSize: "11px", opacity: 0.75, marginTop: "8px", wordBreak: "break-word" };

		/** Ask the host whether a newer release of this plugin exists. */
		async function checkForUpdate() {
			const response = await fetch(UPDATE_CHECK_PATH, {
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			if (!response.ok) return undefined;
			const document = await response.json().catch(() => undefined);
			return document !== null && typeof document === "object" ? document : undefined;
		}

		/** Ask the host to install the published version. */
		async function applyUpdate(version) {
			const response = await fetch(UPDATE_APPLY_PATH, {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ version })
			});
			const document = await response.json().catch(() => undefined);
			if (response.ok && document?.ok === true) return { ok: true };
			return { ok: false, message: String(document?.message ?? document?.error ?? `HTTP ${response.status}`) };
		}

		/** Self-update notice. Dismissal is page state: a restart asks again. */
		function UpdateNotice(props) {
			const { t } = props;
			const [report, setReport] = react.useState(undefined);
			const [dismissed, setDismissed] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [result, setResult] = react.useState(undefined);

			react.useEffect(() => {
				let alive = true;
				checkForUpdate()
					.then((value) => {
						if (alive) setReport(value);
					})
					.catch(() => {});
				return () => {
					alive = false;
				};
			}, []);

			if (dismissed) return null;
			if (report === undefined || report.status !== "update-available") return null;

			const run = async () => {
				setBusy(true);
				const outcome = await applyUpdate(report.latest).catch((error) => ({
					ok: false,
					message: String(error?.message ?? error)
				}));
				setBusy(false);
				setResult(
					outcome.ok
						? { kind: "done", text: t("updateDone", { version: report.latest }) }
						: {
								kind: "failed",
								text: t("updateFailed", { message: outcome.message }),
								hint: t("updateFailedHint", { name: name, version: report.latest })
							}
				);
			};

			return jsxs("div", {
				style: noticeCardStyle,
				role: "status",
				children: [
					jsxs("div", {
						style: noticeHeaderStyle,
						children: [
							jsx("span", { style: noticeTitleStyle, children: t("updateTitle") }),
							jsx("button", {
								type: "button",
								style: noticeLinkStyle,
								onClick: () => setDismissed(true),
								children: t("updateLater")
							})
						]
					}),
					jsx("div", {
						style: noticeMetaStyle,
						children: `${name} · ${t("updateCurrent", { version: report.current ?? "?", latest: report.latest ?? "?" })}`
					}),
					result === undefined
						? jsx("div", {
								style: noticeActionRowStyle,
								children: jsx("button", {
									type: "button",
									style: busy ? { ...noticeButtonStyle, opacity: 0.6, cursor: "default" } : noticeButtonStyle,
									disabled: busy,
									onClick: run,
									children: busy ? t("updating") : t("updateNow")
								})
							})
						: jsxs("div", {
								style: noticeNoteStyle,
								children: [jsx("div", { children: result.text }), result.hint === undefined ? null : jsx("div", { style: { opacity: 0.8 }, children: result.hint })]
							})
				]
			});
		}

		/** Current DSH client build version, used for the account request identity. */
		function clientVersion() {
			try {
				const boot = globalThis.__DSH_BOOT__;
				if (boot !== null && typeof boot === "object" && typeof boot.version === "string" && boot.version !== "") return boot.version;
			} catch {}
			return FALLBACK_CLIENT_VERSION;
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, zh }), "dual-balance: dictionaries");
			const t = ctx.locale.bind(NS);
			const clientMeta = () => ({
				version: clientVersion(),
				locale: ctx.locale.getSnapshot().active === "zh" ? "zh-CN" : "en",
				timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
			});
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dual-balance",
				order: 30,
				locale: NS,
				inject: () => ({
					t,
					account: ctx.remote.account,
					clientMeta
				})
			}, DualBalance));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dual-balance-update",
				order: 65,
				locale: NS,
				inject: () => ({ t })
			}, UpdateNotice));
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
