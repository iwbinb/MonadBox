# MonadBox 文档索引

M1-A更新 · 2026-09-27。PR #1–#3已合并；当前批次为成团草稿与Group合约基础，等待本批PR审阅。真实钱包测试按用户决定后置，不阻塞功能编码，仍保留为资金启用与最终验收条件。

## 当前最常用

| 文档 | 内容 |
| --- | --- |
| [全阶段开发与验收计划](planning/DEVELOPMENT_PLAN.md) | M0-A至M7，M1拆分为小批次，任务/证据/停止点 |
| [M1-A验收记录](planning/M1-A_ACCEPTANCE.md) | 当前草稿/合约代码、本地测试与未开放能力 |
| [M1-A成团草稿说明](engineering/M1-A_GROUP.md) | 创建、保存、导出、恢复、常见限制与下一批接口 |
| [决策与放行条件](planning/DECISIONS_AND_GATES.md) | ADR-19：真实钱包验收后置，编码与资金放行分开 |
| [M0-C实验室说明](engineering/M0-C_LAB.md) | 后续补做真实钱包交易时使用，不要求现在签名 |
| [Cloudflare发布](engineering/DEPLOYMENT.md) | 一个Worker、dev Preview和不变的发布命令 |

## 产品与工程

[产品规格](product/PRODUCT_SPEC.md) · [资金与状态规则](product/FUNDS_AND_STATES.md) · [页面与交互](design/UX_UI_SPEC.md) · [技术架构](engineering/ARCHITECTURE.md) · [数据/API](engineering/DATA_AND_API.md) · [业务合约规格](engineering/CONTRACT_SPEC.md) · [安全要求](engineering/SECURITY.md) · [官方来源与复用](planning/SOURCES_AND_PROVENANCE.md)

历史验收：[M0-A](planning/M0-A_ACCEPTANCE.md) · [M0-B](planning/M0-B_ACCEPTANCE.md) · [M0-C](planning/M0-C_ACCEPTANCE.md)。历史记录中的“未实现”和旧编码前置条件描述的是当时状态；最新计划、ADR-19与M1-A验收优先，不倒写历史测试结果。

## 术语与边界

Box是工具实例；Order是单个参与者的经济关系；Intent是签名意图而非付款凭证；Credit是合约内可领取款，Withdrawal才是转出。Production是网站环境，Mainnet是链网络，二者不等价。

M1-A Draft是本浏览器的未发布草稿，不是云端订单或可付款链接。导出/导入不发布合约；页面上的目标金额、最大收款额都不是余额。M0-C的`/lab`与M0CProbe也不是已经完成的业务Box。模拟钱包/Anvil/手机尺寸Chromium不等于真实Monad、MetaMask或Safari验收。
