# 发布清单

这份清单把「一个写完的插件」变成「一个别人能装、能看见、能给你带来回报的项目」。

**核心逻辑**：开源插件本身不直接产生收入。它产生的是**声誉**——而声誉是这个生态里唯一能换成钱的东西。所以清单的目标不是「发布」，而是**发布后让人能联系到你**。

---

## 第 0 步：先想清楚为什么发

一个只有两个数字的插件，star 数不会爆炸。这没关系。它的真实价值是三件事：

1. **证明你会写 DSH 插件**——这是眼下稀缺的技能，`.dsh` 生态刚起步，会写的人很少。
2. **留下一个公开的代码样本**——比任何简历描述都有说服力。
3. **成为接单入口**——有人想要定制插件时，得先能找到你。

如果你期待它本身能卖钱，那会失望。如果你把它当**作品集 + 引流物**，那它的投入产出比很高。

---

## 第 1 步：占位符 —— ✅ 已完成

全部 13 处占位符已替换为 `du460138504`（`package.json` 三处、`CHANGELOG.md`、`CONTRIBUTING.md`、两份 README，各一处）。

两份 README 的「关于作者」一节也已写好：署名 `du460138504`，联系方式走 [GitHub Issues](https://github.com/du460138504/dsh-dual-balance/issues)，**未放赞助链接**——两个数字的插件打赏收入几乎为零，接了单入口就够，写着反而稀释专业感。

发布前复核一次：

```sh
grep -rn "your-username\|<你的" . --include=*.md --include=*.json
```

只应剩下 `RELEASE.md` 本身（它是流程文档，含示例文本），其余文件必须零输出。

`package.json` 的 `version` 与 `CHANGELOG.md` 最新条目已确认一致，均为 `0.1.0`。

> **以后想改联系方式**：直接编辑两份 README 的「关于作者」一节。若之后开通了邮箱或爱发电，在那里加一行即可，不必改动其他文件。

---

## 第 2 步：建仓库并推送

```sh
cd dsh-dual-balance
git init
git add .
git commit -m "feat: 首个版本 — 侧栏同时显示 DeepSeek 余额与 WorkBuddy 积分"

# 在 GitHub 上建一个空仓库（不要勾选 README / .gitignore）
git remote add origin https://github.com/du460138504/dsh-dual-balance.git
git branch -M main
git push -u origin main
```

**建议加 topics**（仓库右上角 ⚙ → Topics），这是陌生人发现你的主要途径：

```
dsh-plugin  deepseek-harness  deepseek  workbuddy  sidebar
```

---

## 第 3 步：发布到 npm —— ✅ 已完成

**已发布**：https://www.npmjs.com/package/dsh-dual-balance （`dsh-dual-balance@0.1.0`，tag 为 `latest`，MIT）

打包内容经 `--dry-run` 核对：9 个文件、57.3 kB —— `lib/`、`cordis.patch.yml`、`assets/1.png` 和四份文档，无多余内容。

已做**真实端到端安装测试**：

- 干净目录 `npm install dsh-dual-balance` → 9 个文件完整，入口齐全，`ModuleLoader` 协议保留
- 隔离 profile `dsh plugin --profile web add dsh-dual-balance` → 以 `^0.1.0` 真实版本依赖装入，登记进 `bundles`，退出码 0

### 踩到的坑：npm 强制 2FA 才能发布

首次 `npm publish` 报 **403**：

```
Two-factor authentication or granular access token with bypass 2fa
enabled is required to publish packages.
```

**登录成功不代表能发布。** npm 现在的策略是：发布必须通过账号 2FA 或勾选了 bypass 2FA 的 Granular Access Token 之一。只做普通密码/浏览器登录会被拒。

解决办法（已采用）：在 npm 账号设置里开启 2FA（Authorization and Publishing），发布时用验证器或指纹确认。

> **这条值得记住**：以后任何 npm 账号要先开 2FA 再发第一个包，否则会在最后一步撞墙。

### 版本升级时

```sh
npm version patch   # 或 minor / major，会自动改 package.json 并打 git tag
git push --follow-tags
npm publish
```

**同时更新 `CHANGELOG.md`。** `package.json` 的 `version` 与 CHANGELOG 最新条目必须一致。

> 如果日后要改用别的包名，记得同步更新两份 README 的安装命令。

---

## 第 4 步：截图 —— ✅ 已完成

截图已就位：`assets/1.png`（873×144，从侧栏原生分辨率放大 3 倍）。

**裁图时特意去掉了底部的用户名行**——那是个人信息，不该出现在公开 README 里。留下的只有两行余额：`DeepSeek ¥0.14 +¥0.52` 与 `WorkBuddy 2,299.00`，正好展示了赠金拆分和千分位格式这两个最有说服力的细节。

两份 README 的功能列表下方已各插入一行引用，`package.json` 的 `files` 也已加入 `assets`（否则 npm 包里图会 404）。

### 以后要换图

重新截一张侧栏底部的图，替换 `assets/1.png` 即可，README 无需改动。注意：

- 保留金额格式（`¥8.91`、`12,340.00` 这种形态才是卖点），需要的话可以打码具体数字
- **裁掉用户名和其他会话/工作区信息**——那些不该公开

---

## 第 5 步：让人能联系到你 ⭐ —— ✅ 已完成

**这一步是整份清单里唯一直接跟「挣钱」相关的。** 前面所有步骤都是为了让人找到这个仓库，这一步是为了让人找到**你**。

两份 README 结尾已加入「关于作者 / About the author」一节，内容为：

- 署名 `du460138504`
- **接单入口走 GitHub Issues**：`https://github.com/du460138504/dsh-dual-balance/issues`
- 作品集链接指向 `github.com/du460138504`
- **未放赞助链接**（按你的选择）

### 关于联系方式的一个提醒

Issues 是零成本、不暴露隐私的选择，起步阶段完全够用。但它有个真实缺点：**Issues 是公开的**，潜在客户不会在公开场合谈预算和需求细节，转化率天然低于私密渠道。

所以建议：**等第一个 issue 进来、确认有人真的愿意为定制付费时，再把邮箱加上去。** 那时你已经验证了需求存在，再公开联系方式就不亏。在那之前不用急。

如果后面要加，改这两处即可（中英各一份）：

- `README.md` → 「关于作者」一节
- `README.en.md` → 「About the author」一节

### 可选的赞助入口

爱发电、面包多国内可用；GitHub Sponsors 需要额外开通条件。**我的建议是暂时不要加**——两个数字的插件收到的打赏会非常有限，而一个没有赞助者的赞助按钮反而显得项目冷清。

---

## 第 6 步：发出去（决定成败的一步）

仓库建好不会自动有人来。至少做这三件事：

1. **给 `dsh-workbuddy-connect` 提一个 PR 或 issue**，提议在它的 README「相关插件」一节里互相链接。你有天然理由：本插件依赖它的状态路由。这也是最精准的流量来源——看那个仓库的人正好就是你的目标用户。
2. **在 DSH 用户社区发一帖**（Discord / 论坛 / 相关群组），标题写清楚痛点和效果，附截图。
3. **在小红书 / 掘金等平台写一篇短文**：《我给 DSH 写了个插件，侧栏一眼看到两边余额》。技术选型、`roundDown` 截断这种细节是很好的内容素材。

---

## 第 3.5 步：真实安装测试 —— ✅ 已完成，并发现一个坑

在隔离的 `DSH_HOME` 里做过一次端到端测试（不碰你正在用的 desktop profile）。结果：

**通过的项目**：clone 内容完整（13 文件含图片）、`package.json` 可解析、`main`/`bundle.patch`/`exports` 指向的文件都存在、`files` 数组全部存在、`lib/client.js` 保留 `__ModuleLoader__` 协议、`lib/index.js` 导出 `name`/`inject`/`apply`、`dsh plugin add` 安装成功并登记进 `bundles`。

**发现的坑（已修复）**：`dsh plugin add github:user/repo` 会被 pnpm 解析成 **SSH 地址**（`git+ssh://git@github.com/...`），**没配 SSH 密钥的用户会直接失败**。而 README 原本把这条当作主推安装方式。

已改为推荐 `git+https://` 前缀写法，并保留 SSH 简写作为「已配置密钥」的备选。两份 README 均已同步。

> **这条经验值得记住**：DSH 插件的 `github:` 简写默认走 SSH。分享任何插件安装命令时，先确认对方有没有配 SSH 密钥——否则第一条命令就会报错。

**未能验证**：npm 发布流程（本机未装 npm）、`github:` 协议的完整安装（测试沙箱禁止创建管道且拿不到 TLS 凭据，连 `git ls-remote` 都跑不了）。这两项需要你在真实环境确认。

---

## 关于「挣钱」的现实预期

诚实地说：

| 路径 | 现实性 | 说明 |
|---|---|---|
| 插件本身收费 | ❌ 低 | DSH 生态没有插件付费市场，且同类插件都是免费的 |
| 靠捐赠 | ⚠️ 很低 | 会有零星打赏，不足以算收入 |
| **定制插件接单** | ✅ **现实** | 有人需要内部工具时会找有公开作品的人，单价可以很高 |
| **作为求职/接单作品集** | ✅ **现实** | 直接提升你的议价能力 |

**结论**：把这份清单执行完，你得到的不是「一个赚钱的插件」，而是**一个能被搜到的技术身份**。真正的收入来自这个身份之后的对话，不来自这个仓库本身。

先做完第 1、2、4、5 步——这四步加起来大约两小时，做完你就有了一个像样的公开项目。第 3 步（npm）和第 6 步（推广）可以随后补。
