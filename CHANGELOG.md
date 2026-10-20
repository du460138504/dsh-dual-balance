# Changelog

本项目所有值得注意的变更都记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.6] - 2026-10-21

修复国际版被误判为「未安装」。

### 修复

- **磁盘探测不再只看 C 盘**。上一版把「安装根目录」写死成 `%ProgramFiles%`、`%ProgramFiles(x86)%`、`%LOCALAPPDATA%\Programs`，等于假设程序只装在系统盘。把 WorkBuddy AI 装到 `D:\Program Files\WorkBuddyAI` 时，探测找不到就把这一行吞了。现在枚举所有固定驱动器（跳过 A:/B:，避免软驱阻塞）下的 `Program Files`、`Program Files (x86)`、`Programs`，结果缓存 30 秒。
- **目录名不再只认一种拼写**。国际版在 Windows 上装进 `WorkBuddyAI`（无空格），界面里却叫 `WorkBuddy AI`（有空格）；之前只探后者，于是永远匹配不上。现在 `WorkBuddyAI`、`WorkBuddy AI`、`workbuddy-ai` 都试。
- **空目录不再冒充安装**。程序目录里必须找到启动器（`WorkBuddy.exe` / `WorkBuddyAI.exe`）、`resources/app.asar` 或 `install-manifest.json` 才算数，升级暂存树或卸载残留不会被当成已安装；用户数据目录（`%APPDATA%\<App>`）仍按「跑过即装过」处理。

## [0.1.5] - 2026-10-20

修复「更新」按钮在 Windows 上安装失败。

### 修复

- **不再经由 cmd.exe 启动 CLI**。此前用 `cmd /d /s /c <dsh.cmd> …` 调用，而 `cmd /s /c` 会剥掉最外层引号——安装路径含空格时（例如 `D:\Program Files\deepseek harness\`）路径被截断，命令无从查找，结果是 `'dsh' is not recognized` 加退出码 1。现在直接以 Node 模式启动应用自带的运行时（`process.execPath --expose-internals <cli.js>`，环境变量 `ELECTRON_RUN_AS_NODE=1`），与 `dsh.cmd` 内部的做法一致，彻底绕开 shell 的引号规则。
- 找不到 CLI 时，错误信息里直接给出可手动执行的 `dsh plugin add <name>@<version>`。

## [0.1.4] - 2026-10-20

支持 WorkBuddy 国际版：装了哪个 App 就显示哪一行。

### 新增

- **`WorkBuddy AI` 行**。国内版与国际版是两套独立账号与积分，本插件此前只读国内版的 `/plugins/dsh-workbuddy-connect/status`。现在同时读取国际版的 `/plugins/dsh-workbuddy-connect/ai/status`，两个变体并行轮询。
- **App 安装探测路由** `/plugins/dsh-dual-balance/workbuddy-apps`。状态路由把「这个 App 没装」和「装了但没登录」都报成同一个 `no-credential`，光看它无法区分，所以改由 host 侧检查安装痕迹：Windows 下依次看 `C:\Program Files\<App>`、`C:\Program Files (x86)\<App>`、`%LOCALAPPDATA%\Programs\<App>`，再加上 Electron 的 userData 目录（`%APPDATA%\<App>`，App 跑过一次就会创建）；macOS 看 `/Applications` 与 `~/Applications`。

### 变更

- **行数按 App 安装情况决定**。装了国内版就有一行，再装国际版就多一行；只有 DeepSeek 一处账号时就只有一行。已安装但未登录的 App 显示「未登录」，而不是让整行消失；App 没装则整行不出现。
- WorkBuddy 变体的读取从「固定返回一行、失败时显示占位」改为「没有可用数据就不出现」，避免给未接入的 App 留一行 `—`。
- 首次渲染先假定国内版已安装（两行），等探测结果回来后再修正，避免每次启动都从一行跳到两行。

## [0.1.3] - 2026-10-19

自带更新提醒。

### 新增

- **自更新提醒**。启动时向本插件自己的 host 路由 `/plugins/dsh-dual-balance/update-check` 询问 npm 上是否有更新版本；有则通过 `shell.overlay` 插槽弹出提示，与侧栏余额块并存。
- **「更新」按钮**：host 侧执行 `dsh plugin --profile <当前 profile> add dsh-dual-balance@<版本>`，成功后提示完全退出并重启 DSH。
- **「以后更新」按钮**：只关闭本次会话的提示，不写入任何存储——**下次启动会再次提醒**。
- host 侧不再只是挂载点：`apply` 由空实现改为注册两条路由。

### 安全

- 两条路由都要求 loopback 的 Host（及浏览器附带的 Origin），拒绝 DNS rebinding 页面。
- 只允许安装 npm 上**确实是 latest** 的版本号；请求体同样做语义化版本校验。

## [0.1.2] - 2026-10-17

适配 DeepSeek Harness 0.2.1。

### 新增

- 声明 `peerDependencies`：`@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-renderer`，范围均为 `^0.2.0-rc.2`。此前完全不声明 peer，宿主因此不做任何兼容性检查——接口若真的变化，插件只会在浏览器里静默降级（余额显示 `—`），而不是由宿主提前明确报出不兼容。声明之后，跨次版本的变化会在启动时被拦下。
- 三项依赖与使用的 `sidebar.footer.action` 插槽、`remote.account.getBalance` 接口在 0.2.1-rc.2 中均已核对仍然存在。

## [0.1.1] - 2026-02-14

### 变更

- 添加 `author` 字段，尝试避免 npm 把账号邮箱写进包的 `maintainers` 元数据。

## [0.1.0] - 2026-02-14

首个版本。

### 新增

- 侧栏底部（`sidebar.footer.action`，`order: 30`）同时显示 DeepSeek 官方余额与 WorkBuddy 剩余积分。
- DeepSeek 余额经 DSH 账户 remote（`remote.account.getBalance`）读取，展示充值余额与赠金拆分。
- WorkBuddy 积分经同源路由 `/plugins/dsh-workbuddy-connect/status` 读取 `credits.total`。
- 中英双语词条，跟随 DSH 语言设置。
- 悬停 tooltip：展示余额构成、积分合计与登录状态。
- 降级处理：WorkBuddy 插件缺失 / 未登录 / 计费报错时显示 `—` 或 `未登录`，不影响 DeepSeek 一行。
- 金额格式化对齐平台规则：两位小数截断（`roundDown`）、不足一分显示 `<¥0.01`、千分位分隔、基于十进制字符串运算避免浮点误差。

[0.1.4]: https://github.com/du460138504/dsh-dual-balance/releases/tag/v0.1.4
[0.1.3]: https://github.com/du460138504/dsh-dual-balance/releases/tag/v0.1.3
[0.1.2]: https://github.com/du460138504/dsh-dual-balance/releases/tag/v0.1.2
[0.1.1]: https://github.com/du460138504/dsh-dual-balance/releases/tag/v0.1.1
[0.1.0]: https://github.com/du460138504/dsh-dual-balance/releases/tag/v0.1.0
