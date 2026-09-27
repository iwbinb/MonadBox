# MonadBox

Stablecoin payment tools for individuals, creators, communities and small teams.

**一个链接，按约定完成收款、退款与分账。**

## 当前阶段

M0-A：产品与技术规格交付。仓库目前是**规格文档**，不是已上线产品；没有业务代码、已部署合约或已经验证的 Cloudflare 环境。具体交付边界见 [M0-A 验收记录](docs/planning/M0-A_ACCEPTANCE.md)。

## 六个工具

| 工具 | 用途 | 实施顺序 |
| --- | --- | --- |
| Group / 成团收款 | 固定金额集体付款，未成团退款，成团后按约定结算 | M1 |
| Split / 合伙分账 | 按预先固定比例分配已解除退款义务的款项 | M2 |
| Deliver / 交付收款 | 单次交付、验收窗口、异议与退出规则 | M3 |
| Attend / 报名保证金 | 报名押金、签到、未到场处理及申诉 | M4 |
| Milestones / 分阶段付款 | 逐阶段交付、确认和释放款项 | M5 |
| Rewards / 奖励领取 | 全额预存、指定地址领取、过期余额处理 | M6 |

所有工具共享账户、订单、活动记录和收付款视图。首条演示主线为 Group → Split；六工具定位不变。不绑定 NodeStake 品牌，不把 ArcBox 换链等同于本赛事新增成果。

## 文档入口

从 [文档索引](docs/README.md) 开始。开发前必读 [AGENTS.md](AGENTS.md)、[资金规则](docs/product/FUNDS_AND_STATES.md) 和 [分阶段计划](docs/planning/DEVELOPMENT_PLAN.md)。

## 分支与发布

`dev` 开发、测试及预览 → `dev → main` PR → Bill 确认合并 → Cloudflare 自动构建正式网站。

只保留 `dev`、`main` 两条长期分支。不自行合并 PR，不强推，不自动删除 `dev`。网站更新不自动部署或升级链上合约，也不执行资金操作。Cloudflare 绑定与实际部署验证属于 M0-B。

## 技术基线

React + TypeScript + Vite；Cloudflare Workers Static Assets + API、D1、私有 R2、Queues；Solidity + Foundry；viem / wagmi。见 [架构](docs/engineering/ARCHITECTURE.md)。所有版本在 M0-B 锁定，真实 Monad 兼容性在 M0-C 验证。

默认仅 Monad Testnet。AUSD 为待实测的首选资产；正式网站环境不代表已启用主网或真实资金。MVP 平台费为 0；网络费用仍需承担。

## 风险边界

合约管理的托管款不是平台数据库余额；链上规则不能自行判定现实交付质量。测试网交易、模拟数据与真实主网交易必须明确区分。不存在获奖、法币兑付、无风险或已经审计的承诺。
