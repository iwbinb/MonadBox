# 文档导航

先读[总计划](planning/DEVELOPMENT_PLAN.md)，再按本次任务读取对应规格。进度、下一步和阻塞项只在总计划维护；历史报告不作为当前执行指令。

## 当前说明

| 文档 | 用途 |
| --- | --- |
| [Group](engineering/GROUP.md) | 本地草稿、云端登录、发布、恢复、实际 API 和 D1 配置 |
| [版本化支付工具](engineering/MODULES.md) | Split、Group V2、冻结发布、分账、旧版恢复和配置 |
| [交付托管](engineering/DELIVER.md) | Deliver双方资金操作、双签协议、私密附件及恢复 |
| [测试网实验室](engineering/TESTNET_LAB.md) | 独立探针、钱包操作和交易恢复 |
| [部署](engineering/DEPLOYMENT.md) | 单 Worker、生产/Preview、能力开关和验证 |
| [架构](engineering/ARCHITECTURE.md) | 当前模块、数据流和实现边界 |
| [合约目录](../contracts/README.md) | 合约职责、编译和本地验证 |

## 设计与约束

| 文档 | 用途 |
| --- | --- |
| [产品规格](product/PRODUCT_SPEC.md) | 六工具的用户、流程与产品范围 |
| [资金与状态](product/FUNDS_AND_STATES.md) | 本金守恒、角色、时间与退出权 |
| [合约规格](engineering/CONTRACT_SPEC.md) | 目标合约接口与权限 |
| [数据与 API 目标](engineering/DATA_AND_API.md) | 分阶段落地的总体模型；实际 Group API 以当前说明为准 |
| [UI 规格](design/UX_UI_SPEC.md) | 页面、双语、移动布局与错误提示 |
| [安全](engineering/SECURITY.md) | 威胁、签名、资金与恢复要求 |
| [决策与放行条件](planning/DECISIONS_AND_GATES.md) | 已决定的规则与尚未完成的外部验收 |
| [来源与复用](planning/SOURCES_AND_PROVENANCE.md) | 官方资料及历史研究、复用许可边界 |

## 历史证据

[验收归档](archive/README.md) 保存 M0-A 至 M1-B 的阶段记录和只读 RPC 证据。新的阶段记录在阶段完成时新增，不为日常进度重复创建文档。

术语：Box 是工具实例；Order 是参与者的经济关系；Intent 是待执行意图；credit 是合约内可领取款，withdrawal 才实际转出。网站部署、本地测试和真实网络验收分别记录。
