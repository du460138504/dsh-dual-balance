# Changelog

本项目所有值得注意的变更都记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[0.1.1]: https://github.com/du460138504/dsh-dual-balance/releases/tag/v0.1.1
[0.1.0]: https://github.com/du460138504/dsh-dual-balance/releases/tag/v0.1.0
