# DSH Dual Balance

English | [中文](./README.md)

Show your **DeepSeek account balance** and your **WorkBuddy credits** side by side at the bottom of the DeepSeek Harness sidebar, so you can see what is left on both accounts at a glance.

```
┌─────────────────────┐
│ DeepSeek      ¥8.91 │
│ WorkBuddy  12,340.00│
└─────────────────────┘
```

When you run tasks on WorkBuddy credits but still want to know how much is left on your DeepSeek account, you no longer have to switch between two settings pages.

## Why

A DSH install usually has two accounts behind it: the DeepSeek account DSH itself uses (billed by DeepSeek), and the WorkBuddy account brought in through [dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) (billed in app credits). The two balances live on different settings pages, so it is easy to run one of them dry mid-task.

This plugin pins both numbers to the sidebar foot and refreshes them every 60 seconds.

## Features

![Both balances in the sidebar foot](assets/1.png)

- **Two numbers, one glance**: `DeepSeek` shows the account balance (shown as `¥8.91 +¥2.00` when a bonus is present); `WorkBuddy` shows total remaining credits.
- **Bilingual**: follows the DSH language setting automatically.
- **Hover for detail**: the tooltip breaks down top-up versus granted balance, explains where the WorkBuddy figure comes from, and reports a signed-out state.
- **Degrades gracefully**: if the WorkBuddy plugin is missing, signed out, or its billing call fails, that row shows `signed out` or `—`. The other row keeps working, and **DSH will not fail to start**.
- **Amounts formatted the way the platforms do**: see below.

## Formatting details

Neither number is a careless `toFixed(2)`. Each deliberately mimics its own source:

**DeepSeek balance** renders with the platform's two-decimal truncation (`roundDown`), not rounding. A balance of `0.148` shows as `0.14` on the official page and as `¥0.14` here — never `0.15`. A sub-cent balance collapses to `<¥0.01`, because an on-screen `¥0.00` reads as "empty" when a little is in fact left.

**WorkBuddy credits** are truncated the same way. Upstream already reports two decimals, so anything beyond that is binary floating-point noise; this truncates rather than rounds, and **never shows credit that has not been granted**.

Both paths work on decimal strings, avoiding binary rounding error.

## Install

Requires DeepSeek Harness. **`dsh-workbuddy-connect` is optional** — without it you still get the DeepSeek balance, with `—` on the WorkBuddy row.

```sh
# Web profile
dsh plugin --profile web add dsh-dual-balance

# Desktop profile
dsh plugin --profile desktop add dsh-dual-balance
```

From GitHub source:

```sh
dsh plugin --profile desktop add github:du460138504/dsh-dual-balance
```

Restart DSH after installing; the two rows appear at the bottom of the sidebar.

## Compatibility

| Plugin version | Required DSH core | Optional dependency |
|---|---|---|
| `0.1.0` (current) | `0.2.0-rc.2` | `dsh-workbuddy-connect` (optional; falls back when absent) |

The plugin uses only two DSH client capabilities — the account balance remote and a sidebar slot — both public, stable interfaces. It reads no private files and patches no internals.

## How it works

The whole feature is browser-side. The host half, `lib/index.js`, has a **deliberately empty** `apply()`: it exists only because a profile bundle is mounted through a patch entry, which needs a mount point.

- **DeepSeek balance** comes from DSH's own account remote (`remote.account.getBalance`), reusing the session you are already signed into. The plugin never touches credentials.
- **WorkBuddy credits** come from one same-origin `fetch` to `/plugins/dsh-workbuddy-connect/status`, reading `credits.total`. That route is served by the `dsh-workbuddy-connect` host half; this plugin never calls WorkBuddy directly.

It renders into the `sidebar.footer.action` slot at `order: 30`.

**Privacy**: no telemetry, no files written, no network traffic beyond the two same-origin endpoints above. The two numbers move only between your machine and DSH itself.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-dual-balance
```

## Development

This plugin is buildless, pure ESM: `lib/index.js` (host) and `lib/client.js` (browser) are the shipped artifacts. No TypeScript, no bundler, no test framework — edit the source and reload DSH.

To develop against a working copy, link it into your profile:

```sh
dsh plugin --profile desktop add link:/absolute/path/to/dsh-dual-balance
```

`lib/client.js` must keep its outer `window.__ModuleLoader__.load({ id, factory })` protocol. That is the DSH client module contract; converting it to standard ESM exports breaks sidebar rendering.

## About the author

I'm **du460138504**, building DSH plugins and automation tooling.

- **Need a custom DSH plugin or internal tool?** Open an [issue](https://github.com/du460138504/dsh-dual-balance/issues) describing what you need and I'll get back to you.
- More work: [github.com/du460138504](https://github.com/du460138504)

If this plugin helped you, a star is the best way to say thanks.

## License

[MIT](./LICENSE)
