# MonadBox 文档索引

M1-B 更新：PR #5已合并，云端登录、草稿、发布和分享已实现代码；本批补交易类型核验与原hash恢复保护，见[M1-B验收第9节](planning/M1-B_ACCEPTANCE.md#9-pr-5审查修复)。远端D1与真实交易验收后置。M1-C资金交互尚未开始，主网与业务收款保持关闭。

## 当前入口

| 文档 | 内容 |
| --- | --- |
| [全阶段开发计划](planning/DEVELOPMENT_PLAN.md) | M0至M7，M1分批任务与当前状态 |
| [M1-B操作/部署/API](engineering/M1-B_GROUP.md) | SIWE、D1-only配置、不可变发布、匿名页面与恢复 |
| [M1-B验收](planning/M1-B_ACCEPTANCE.md) | 本次实际测试、证据、未执行事项 |
| [M1-A草稿说明](engineering/M1-A_GROUP.md) | 原有本地草稿和导入/导出 |
| [M0-C实验室](engineering/M0-C_LAB.md) | 独立测试探针、钱包和恢复 |
| [Cloudflare发布](engineering/DEPLOYMENT.md) | 一个Worker、Git分支与发布命令；云端新增设置以M1-B说明为准 |

[产品规格](product/PRODUCT_SPEC.md) · [资金规则](product/FUNDS_AND_STATES.md) · [UI规格](design/UX_UI_SPEC.md) · [架构](engineering/ARCHITECTURE.md) · [数据/API目标](engineering/DATA_AND_API.md) · [合约规格](engineering/CONTRACT_SPEC.md) · [安全](engineering/SECURITY.md) · [决策与门禁](planning/DECISIONS_AND_GATES.md) · [来源与复用](planning/SOURCES_AND_PROVENANCE.md)

历史验收：[M0-A](planning/M0-A_ACCEPTANCE.md) · [M0-B](planning/M0-B_ACCEPTANCE.md) · [M0-C](planning/M0-C_ACCEPTANCE.md) · [M1-A](planning/M1-A_ACCEPTANCE.md)。历史报告记录当时状态，不倒写当时未执行的测试；最新状态见全阶段表和本批记录。

Box是工具实例；Order是参与者经济关系；Intent不是交易成功证明；Credit是合约内可领取款，Withdrawal才实际转出。Production是网站发布环境，不等于Mainnet。SIWE仅建立网站会话，不能代替资金签名。Anvil/Mock和截图不证明真实测试网交易。
