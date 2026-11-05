# DSH Dual Balance

[English](./README.en.md) | 中文

在 DeepSeek Harness 侧栏底部同时显示 **DeepSeek 官方余额** 与 **WorkBuddy 剩余积分**，一眼看清两边的钱还剩多少。

```
┌─────────────────────┐
│ DeepSeek      ¥8.91 │
│ WorkBuddy  12,340.00│
└─────────────────────┘
```

用完 WorkBuddy 积分跑任务、又想知道自己的 DeepSeek 官方余额还剩多少时，不用再在两个界面之间来回切。

## 为什么需要它

DSH 里通常同时挂着两套账号：DSH 自己的 DeepSeek 官方账号（走官方计费），以及磁盘上 WorkBuddy 桌面端的账号（走 App 的积分）。两边余额分散在不同设置页里，日常使用中很容易跑到一半才发现某一边见底。

本插件把这两个数字固定放在侧栏底部，每 60 秒刷新一次。

## 功能

![侧栏底部的双余额显示](assets/1.png)

- **两个数字并排**：`DeepSeek` 显示官方余额（含赠金时显示为 `¥8.91 +¥2.00`），`WorkBuddy` 显示剩余积分合计。
- **中英双语**：跟随 DSH 的语言设置自动切换。
- **悬停看详情**：鼠标停在区块上，tooltip 给出完整说明——充值余额与赠金的拆分、WorkBuddy 积分来源、未登录状态等。
- **优雅降级**：WorkBuddy 桌面 App 没装时该行不出现；装了但没登录显示 `未登录`；登录了但计费接口报错则显示 `—`。任何情况都不影响 DeepSeek 一行，也**不会让 DSH 启动失败**。
- **金额格式对齐官方**：见下方「格式细节」。

## 格式细节

这两个数字的格式不是随手 `toFixed(2)`，而是刻意模仿各自的真实规则：

**DeepSeek 余额**按官方的两位小数截断（`roundDown`）显示，不是四舍五入。余额 `0.148` 在官方页面显示 `0.14`，本插件也显示 `¥0.14`，不会显示成 `0.15`。不足一分的余额收敛显示为 `<¥0.01`——因为屏幕上的 `¥0.00` 会被误读成「已用尽」，而实际还差一点点。

**WorkBuddy 积分**同样按两位小数截断。计费接口对每份套餐同时给出整数字段和 `…Precise` 全精度字段；本插件汇总的是精确值，再截断到两位——截断而非四舍五入，**绝不显示尚未发放的积分**。

两处都基于十进制字符串运算，避开二进制浮点的舍入偏差。

## 安装

前置：已安装 DeepSeek Harness。**不再需要 `dsh-workbuddy-connect`**——插件自己直读 WorkBuddy 桌面端的登录凭据与计费接口。

```sh
# Desktop profile
dsh plugin --profile desktop add dsh-dual-balance

# Web profile
dsh plugin --profile web add dsh-dual-balance
```

也可以直接从 GitHub 源码安装：

```sh
dsh plugin --profile desktop add git+https://github.com/du460138504/dsh-dual-balance.git
```

**注意带上 `git+https://` 前缀。** 写成 `github:du460138504/dsh-dual-balance` 会被解析成 SSH 地址（`git+ssh://git@github.com/...`），没配置 SSH 密钥的话会直接报错。已配置 SSH 密钥时，该简写同样可用。

安装后重启 DSH，侧栏底部即出现两行余额。

> **首次安装若报错提到 `allowBuilds`**：按它给出的路径编辑 profile 下的 `pnpm-workspace.yaml`，然后重跑安装命令。

## 兼容性

| 插件版本 | 要求的 DSH 核心 | 可选依赖 |
|---|---|---|
| `0.1.7`（当前） | `0.2.0-rc.2` | 无（自取凭据与计费，不依赖 `dsh-workbuddy-connect`） |

浏览器侧只使用两个 DSH 客户端能力——账户余额 remote 与侧栏 slot，都是 DSH 的稳定公开接口。宿主侧为取积分会读取 WorkBuddy 桌面端的登录文档并调用其计费接口，这是该行数据的唯一来源。

## 工作原理

渲染在侧栏的 `sidebar.footer.action` slot，`order: 30`。两件事需要宿主，都在 `lib/index.js` 的 `apply()` 里注册：

- **DeepSeek 余额**：通过 DSH 自己的账户 remote（`remote.account.getBalance`）读取，复用你已登录的账号，插件本身不接触任何凭据。
- **WorkBuddy 积分**：插件自己直读 WorkBuddy 桌面端，不经过 `dsh-workbuddy-connect`。浏览器向本插件的 loopback 路由 `/plugins/dsh-dual-balance/workbuddy-credits`（国际版为 `…/ai`）发起一次 `fetch`；host 侧定位登录文档，若 `accessToken` 是 AES-256-GCM 信封就用 WorkBuddy 自带二进制暴露的 at-rest 密钥解密，再以 `Bearer` 调 WorkBuddy 计费接口，汇总各套餐 `…Precise` 的剩余值。

**隐私**：插件不发送任何遥测。解密密钥与 access token 只留在 host 进程内存，不落盘；插件发起的唯一网络请求是 WorkBuddy 自己的计费接口。两个数字只在你的机器与 DSH / WorkBuddy 之间流动。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-dual-balance
```

## 开发

本插件是无构建步骤的纯 ESM：`lib/index.js`（宿主）与 `lib/client.js`（浏览器）直接作为产物使用，没有 TypeScript、没有打包器、没有测试框架。改完源码重载 DSH 即可生效。

开发时把工作副本链进 profile：

```sh
dsh plugin --profile desktop add link:/绝对路径/dsh-dual-balance
```

`lib/client.js` 必须保持 `window.__ModuleLoader__.load({ id, factory })` 这一外层协议——它是 DSH 客户端模块的加载契约，改成标准 ESM 导出会导致侧栏渲染失败。

## 关于作者

我是 **du460138504**，专注 DSH 插件与自动化工具开发。

- **需要定制 DSH 插件或内部工具？** 开一个 [issue](https://github.com/du460138504/dsh-dual-balance/issues) 说明你的需求，我会回复。
- 更多作品：[github.com/du460138504](https://github.com/du460138504)

如果这个插件帮到了你，给个 star 就是最好的支持。

## 许可

[MIT](./LICENSE)
