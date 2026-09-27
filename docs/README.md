# MonadBox 文档索引

更新：2026-09-27 · M0-C 开发及本地验证已交付；真实测试网签名交易待验收，详见当前验收记录。

## 当前最常用

| 文档 | 内容 |
| --- | --- |
| [全阶段开发与验收计划](planning/DEVELOPMENT_PLAN.md) | M0-A 至 M7、依赖、任务和当前状态 |
| [M0-C 验收记录](planning/M0-C_ACCEPTANCE.md) | 已实现/已测试/待签名的清晰界线 |
| [M0-C 实验室操作说明](engineering/M0-C_LAB.md) | 钱包、测试资产、部署、授权、入金、退款、恢复 |
| [Cloudflare 发布](engineering/DEPLOYMENT.md) | 一个 Worker、dev Preview、正式分支和发布命令 |

## 产品与工程

[产品规格](product/PRODUCT_SPEC.md) · [资金与状态规则](product/FUNDS_AND_STATES.md) · [页面与交互](design/UX_UI_SPEC.md) · [技术架构](engineering/ARCHITECTURE.md) · [数据/API](engineering/DATA_AND_API.md) · [业务合约规格](engineering/CONTRACT_SPEC.md) · [安全要求](engineering/SECURITY.md) · [决策与放行条件](planning/DECISIONS_AND_GATES.md) · [官方来源与复用](planning/SOURCES_AND_PROVENANCE.md)

历史：[M0-A 验收](planning/M0-A_ACCEPTANCE.md) · [M0-B 验收](planning/M0-B_ACCEPTANCE.md)。其中历史阶段的未验证描述不等于当前阶段仍未实现；当前状态以全阶段表和 M0-C 验收为准。

## 术语与边界

Box 是工具实例；Order 是单个参与者的经济关系；Intent 是签名意图不是付款凭证；Credit 是合约内可领取款，Withdrawal 才是实际转出。Production 指网站环境，Mainnet 指区块链网络，二者不等价。

M0-C 的 `/lab` 和 M0CProbe 只验证单钱包、限额测试入金/退款，不是一个业务 Box。钱包连接不等于 SIWE 登录。浏览器模拟注入钱包不等于实测 MetaMask/Safari。所有计划指标与假设不得写成既有实测结果。
