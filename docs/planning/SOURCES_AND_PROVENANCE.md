# 官方来源、核验边界与复用记录

M0-A 历史研究基线 · 公开技术资料检索日期：2026-09-27。

下表的“未实现/未验证”描述的是该次研究时点，保留作来源与复用追踪；当前实现进度见[总计划](DEVELOPMENT_PLAN.md)，运行证据见[验收归档](../archive/README.md)。外部资料在实际使用前重新核对。

本文将官方文档事实、项目设计选择和实际运行证据分开。下面的URL用于开发时复核，不代表所有集成都已成功运行。主办方规则、第三方产品及网络信息仍可能更新，临近提交/部署需要重新核对。

## 1. 官方来源

| ID | 官方资料 | 本次用于什么 | 不代表什么 |
| --- | --- | --- | --- |
| S01 | [Metropolis](https://monad.xyz/developers/hackathons/metropolis) | Consumer Products & Payments方向、可工作产品与评审材料、已有项目需有新增工作 | 未读取所有登录后细则；不确认多项目、跨赛事复用或奖项兼得；不保证获奖 |
| S02 | [Monad current facts](https://docs.monad.xyz/ai/current-facts) | Mainnet 143、Testnet 10143、MON、官方RPC等网络基线 | 网页信息不是当前端点的实时测试报告 |
| S03 | [Monad testnet](https://docs.monad.xyz/developer-essentials/testnet)、[network summary](https://docs.monad.xyz/developer-essentials/summary) | 测试网配置、网络与部署前核验入口 | 不假设所有EVM编译目标或钱包已兼容 |
| S04 | [Cloudflare Vite plugin tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)、[Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/) | React静态应用、Worker API的一体工程路径 | 本仓库尚未脚手架和实际构建 |
| S05 | [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/) | 分支选择、构建部署命令及配置；运行secret与构建配置的区分 | 授权GitHub不等于本项目已经部署 |
| S06 | [Pages迁移到Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) | Workers静态资源与Pages不同的发布/运行模型 | 不把生产版本预览URL视为独立数据库环境 |
| S07 | [Agora contract deployments](https://docs.agora.finance/developer/contract-deployments) | Monad主网/测试网AUSD候选地址 | 未执行eth_call、精度读取、approve或实际支付验证 |
| S08 | [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) | Worker中的数据库访问和批处理接口 | nonce消费、并发及回滚仍需M0-B实际测试 |
| S09 | [EIP-4361 / SIWE](https://eips.ethereum.org/EIPS/eip-4361) | 钱包登录消息、域、时间、nonce和验证规则 | 钱包登录不是token授权或转账授权 |
| S10 | [OpenZeppelin ERC-20 API](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20) | ERC-20接口和SafeERC20等可复用组件 | 采用库不等于业务合约已经审计 |
| S11 | [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) | 至少一次投递、需要处理重复消息 | 不保证业务端到端exactly-once |
| S12 | [EIP-712](https://eips.ethereum.org/EIPS/eip-712)、[EIP-1271](https://eips.ethereum.org/EIPS/eip-1271) | 域隔离结构化签名、合约钱包签名验证接口 | EIP-712本身不提供应用的nonce防重放逻辑；EIP-1271须实测 |
| S13 | [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) | 限时对象访问的技术路径 | URL本身不能替代业务对象授权与上传校验 |
| S14 | [OpenZeppelin utilities](https://docs.openzeppelin.com/contracts/5.x/api/utils) | 数学、签名与重入防护等可选基础组件 | 具体版本和使用组合未锁定、未测试 |

## 2. 具体网络记录

| 项目 | 官网列示值 | 本次证据层级 |
| --- | --- | --- |
| Monad Mainnet chainId | 143 | 官方文档核对，未实际连接 |
| Monad Testnet chainId | 10143 | 官方文档核对，未实际连接 |
| Gas资产 | MON | 官方文档核对 |
| 主网RPC候选 | `https://rpc.monad.xyz` | 未测试限流、可用性或最终确认 |
| 测试网RPC候选 | `https://testnet-rpc.monad.xyz` | 未测试限流、可用性或最终确认 |
| AUSD主网候选 | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | S07列示，未eth_call |
| AUSD测试网候选 | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | S07列示，未eth_call |

不会仅凭上述表格启用支付。M0-C要记录实际code、decimals、token行为、测试资产来源、交易hash、确认策略和钱包支持矩阵。

## 3. 赛事信息边界

本规格不依赖早前讨论中的“截至9月18日还有25天”等相对时间。当前文档日期为2026-09-27。正式提交前从赛事平台重新核实截止钟点、时区、提交要求、主网/测试网要求及资格，不用过期聊天估算作为排期依据。

官方公开页与登录后规则不能互相替代；“已有项目可参与”不等于换链即可、也不等于同一成果可以重复获取资助。本项目不在文档中虚构评审权重或获奖概率。

## 4. 仓库基线与新增工作

M0-A开始时main提交：`422bb2d5e765f73baed0e45d805611d979a188ca`；Git tree `ae45ff24ecd89ec1f0c0a29e529ab61ba35d2632`。当时只有初始化README，没有业务代码。本阶段从该提交创建dev，新增产品与技术规格，不修改用户已写的业务代码。

ArcBox关系：沿用本次对话已确定的六工具产品思路。**本阶段没有读取或复制ArcBox实现代码，也没有核验其许可证、历史提交或跨项目资助条件。** 不把“尚未复用代码”写成“已证明全部原创”。

后续若复用，必须在复制前核实来源、许可、历史范围和赛事要求，并逐项记录：

| 来源仓库/路径 | 固定commit/tag | 许可及保留要求 | MonadBox目标路径 | 原有能力 | 本赛期实质新增 | 核验者/证据 |
| --- | --- | --- | --- | --- | --- | --- |
| 尚无实现代码复用记录 | — | 未核验 | — | — | 本阶段规格文档 | 本阶段Git差异 |

不因为仓库公开就假设允许任意复制；MonadBox自己的开源许可证尚未由用户选择，本阶段不擅自添加MIT或其他许可声明。

## 5. 未来验证记录模板

测试日期及UTC时间；工具/版本；网络chainId；官方来源快照；实际端点；调用或测试命令；退出码/原始回执；部署/交易/日志；通过/失败/未执行；限制；复核者。敏感key、签名、个人信息和私密附件不得进入公开证据。
