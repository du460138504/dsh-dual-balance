# awesome-dsh-plugin 收录素材

这里放着提交给 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的条目文件，**不是**插件本身的一部分。

## 目录内容

- `du460138504__dsh-dual-balance.yml` — 待提交的条目，提交时改名为 `data/plugins/du460138504__dsh-dual-balance.yml` 放进目标仓库的 PR。

## 提交前的硬性条件

1. **仓库创建满 1 天**（CI 自动检查，这是目前唯一的阻塞项）
2. `package.json` 声明 `dsh.bundle` — 已满足
3. 根目录有 `cordis.patch.yml` — 已满足
4. 仓库带 `dsh-plugin` topic — 已满足
5. 有真实可用的代码 — 已满足

## 提交步骤

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`
2. 把这里的 yml 复制到 `data/plugins/du460138504__dsh-dual-balance.yml`
3. 提 PR

**不要手工编辑那两个 README。** 它们由 `data/plugins/*.yml` 生成，PR 合并后会自动重建。一个 PR 只加一个文件，这样不会和别人冲突。

## 关于分类

选了 `usage`（用量与余额信息类）。规则里明确写了「没人会因为分类被打回」——如果维护者觉得有更贴切的，会直接改。所以不必纠结。

## 关于重复（重要）

余额类插件已有 80+ 个，其中 `zhouchengke2046/dsh-sidebar-balance`、`LL-cmyk-so/dsh-balance-widget` 也放在侧栏底部。

**本插件的差异点是「双余额」**：同时显示 DeepSeek 官方余额与 **WorkBuddy 积分**。查过现有 6 个 WorkBuddy 相关条目，全部是做模型接入或专家市场，没有做 WorkBuddy 余额显示的。描述里已写明这一点，避免被判定为重复条目。
