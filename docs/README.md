# MonadBox 文档索引

版本：M0-A v1.0 · 2026-09-27 · 状态：规格基线，待用户审阅 PR。

## 阅读顺序

| 文档 | 回答的问题 |
| --- | --- |
| [产品规格](product/PRODUCT_SPEC.md) | 为谁服务、六工具分别做什么、首版不做什么 |
| [资金与状态规则](product/FUNDS_AND_STATES.md) | 钱归谁、何时可退、何时可结算、谁有权限 |
| [UI / UX 规格](design/UX_UI_SPEC.md) | 页面、创建流程、付款体验、移动端和异常状态 |
| [技术架构](engineering/ARCHITECTURE.md) | 前端、Workers、存储、链各自承担什么 |
| [数据与 API](engineering/DATA_AND_API.md) | 账户、订单、事件、接口和幂等约定 |
| [合约规格](engineering/CONTRACT_SPEC.md) | 模块、方法、事件、安全不变量及组合结算 |
| [部署与环境](engineering/DEPLOYMENT.md) | dev/main、Cloudflare 自动部署、回滚与主网边界 |
| [安全要求](engineering/SECURITY.md) | 威胁、权限、私密资料、事故与上线门槛 |
| [开发计划](planning/DEVELOPMENT_PLAN.md) | 每阶段任务、验收、产物和停止点 |
| [决策与放行条件](planning/DECISIONS_AND_GATES.md) | 已定稿事项、待实测项和阻塞范围 |
| [来源与复用记录](planning/SOURCES_AND_PROVENANCE.md) | 官方依据、核验时间、ArcBox 复用边界 |
| [M0-A 验收记录](planning/M0-A_ACCEPTANCE.md) | 本次实际交付与未执行事项 |

## 术语

- **Box**：一个已发布的工具实例，例如一次成团活动或一份交付报价。
- **Order**：一名参与者的一次经济关系或一笔 Split 收据；不等于整个 Box。
- **Intent**：一次待签名操作的业务意图；它不是付款凭证。
- **Credit**：合约内归某受益人的可领取款；不是钱包已到账。
- **Withdrawal**：代币实际转出合约，并经过交易核验。
- **Finalized**：按已验证网络策略确认的链上状态，不是前端倒计时结束。
- **Production**：网站发布环境；**Mainnet**：区块链网络。两者互不等价。

## 使用说明

规格中的默认值和性能预算是拟实现要求，不是已经测试的能力。技术事实的来源集中于来源文档；凡标记 G-xx 的事项，必须在对应阶段取得证据后放行。没有真实网络访问、部署与签名授权时，不能用数据库或截图替代验证。
