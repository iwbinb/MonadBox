# 技术架构

M0-A v1.0 · 架构选择已形成基线；运行、供应商和网络验证按G-xx放行。

## 1. 总体选择

React + TypeScript + Vite SPA；同一Cloudflare Worker提供静态资源、同源API、队列处理和定时任务；D1存元数据及链事件投影，R2存私密文件，Queues处理可重试索引/通知；链上合约管理资金。开发/生产部署为两个隔离Worker。

这是项目选择，不是“Cloudflare只能这样做”。Workers官方有React SPA/API及Git构建路径。[S04-S06](../planning/SOURCES_AND_PROVENANCE.md) 不引入需要常驻Node服务器的实现，不同时维护Pages与Workers，不为本阶段引入容器或微服务集群。

```text
浏览器
  ├─ 静态UI / 同源API → Cloudflare Worker
  │                       ├─ D1：账户、草稿、索引投影、outbox
  │                       ├─ 私有R2：规则快照、交付附件
  │                       └─ Queues / Cron：重试、索引、通知
  └─ 用户钱包 → Monad RPC → 版本化资金合约
                           └─ 确认事件 → 索引器 → D1只读投影
```

## 2. 边界

| 组件 | 可以做 | 不可以做 |
| --- | --- | --- |
| React UI | 输入、展示、签名前验证、钱包交互 | 用localStorage余额证明付款 |
| Worker API | 认证、草稿、意图构造、对象级访问授权 | 保管用户私钥、代替用户接受交付 |
| D1 | 元数据、nonce、幂等记录、可重建事件投影 | 作为提款余额/退款权的最终依据 |
| R2 | 原始规则快照和私密附件 | 对外公开可枚举的交付桶 |
| Queues/Cron | 读取、投影、重试、通知 | 自动签名放款或修改链上事实 |
| 合约 | 固定资金规则、账务、签名验证 | 判断现实活动质量或文件价值 |

## 3. 工具链与目录

基线依赖：React、TypeScript strict、Vite、Hono、Zod、viem、wagmi、TanStack Query；样式使用CSS变量和组件级CSS；钱包与日期/金额能力使用薄适配层。测试：Vitest、Cloudflare运行时测试工具、Playwright、Foundry。

M0-B 根据当前兼容性锁定具体版本、pnpm版本、Node工具版本、Solidity/Foundry和lockfile；不在M0-A捏造已通过的组合。EVM target需在M0-C按当前Monad文档与实际部署确认，不依赖未经验证的瞬态存储或新opcode。

```text
src/app/                 路由、页面、组件、钱包适配
src/worker/              Hono API、scheduled、queue handlers
src/shared/              DTO、金额/时间、规则schema、状态映射
contracts/               Foundry工程、测试、手动部署脚本
contracts/deployments/   按网络/版本登记的已验证部署清单
migrations/              按顺序的D1迁移
scripts/                 环境检查、ABI生成、验证与发布辅助
public/                  非敏感静态资源
tests/                   API、E2E、fixtures
docs/                    本规格及阶段证据
```

以上目录在M0-B创建；当前不要声称已经存在工程。ABI从构建产物生成，前端不得手抄一份长期漂移的ABI。

## 4. 网络与资产

已核对官方资料：Monad Mainnet chainId=143、Testnet=10143，原生Gas资产为MON。默认测试RPC为官方文档所列地址，生产需根据速率限制另选并实测备用端点。[S02-S03](../planning/SOURCES_AND_PROVENANCE.md)

AUSD是首选待验证ERC-20。官方列示主网地址 `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`、测试网地址 `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`；此处只是来源核对，未执行eth_call或交易验证。[S07](../planning/SOURCES_AND_PROVENANCE.md)

M0-C需逐链确认代码存在、symbol/decimals、transfer/approve行为、账户获得测试资产的路径、事件/回执与explorer。不得把主网地址配置到测试网，不能假设同地址代表同资产。失败时可用明确标记的Mock token继续单元测试，但官方资产集成仍标未通过，不对外声称已支持。

`production`网站初期仍为chainId=10143。mainnetEnabled=false与写入kill switch缺省拒绝；配置缺失或chainId不一致时禁用付款，不回退任意网络。

## 5. 钱包与认证

用wagmi/viem实现外部钱包连接、只读查询、模拟、签名和交易跟踪。SIWE用于站点会话，不替代合约权限。[S09](../planning/SOURCES_AND_PROVENANCE.md)

钱包适配接口分离connect/signMessage/signTypedData/sendTransaction/getCapabilities；优先测试EOA，智能钱包/EIP-1271单独列兼容矩阵。邮箱登录、Passkey、Gas赞助是可替换适配，不让供应商掌握链上规则。未验证的能力不开放按钮；供应商选择在M2-B阶段门禁记录，不影响M1的正确付款路径。

## 6. 数据一致性

写入顺序：用户授权并发送→获得hash（仍未成功）→固定RPC验证receipt/status/目标合约/日志/参数→符合最终确认策略→D1投影与outbox→查询展示。服务器不能仅信任浏览器上传的“成功”状态。

链上日志按 `(chainId, blockHash, txHash, logIndex)` 唯一；再以事件语义操作键防同nonce重复。区块包含关系和最终性策略在M0-C测试；不得把等待固定毫秒当最终确认。

保留OBSERVED/FINALIZED/ORPHANED标记、原始日志、区块父哈希和投影版本。游标只能在整个区间持久化后推进；提供有上限的回溯和重建。通知仅由达到确认策略的事件发出。reorg使投影回滚时，不能重复增加credit统计或删除审计记录。

D1使用prepared statements及原子批处理；必须在M0-B实测nonce消费、唯一索引、事务回滚，不在任意异步调用之间假装有长事务。[S08](../planning/SOURCES_AND_PROVENANCE.md)

## 7. 索引、队列与计划任务

初版不依赖第三方托管索引器。用有上限的eth_getLogs扫描、游标、租约和幂等投影；页面等待交易时可发起受限刷新提示，不能让用户任意提供RPC URL或无限区间。

Cron周期初设1分钟扫描已登记合约和outbox；活跃付款页可短轮询，达到确认后停止。真实间隔根据M0-C限流与延迟测量调整。不要试图在普通Worker内常驻一个无限循环。

Queues按至少一次投递设计：唯一jobKey、指数退避、最大重试、死信队列、人工重放；消息乱序/重复不应改变本金。[S11](../planning/SOURCES_AND_PROVENANCE.md) 数据库投影与outbox写入一个原子边界；发送失败仅影响通知，不回滚链上资金。

## 8. 非功能目标

失败优先可恢复：保留意图与hash、允许直接链上退出、展示索引延迟；没有RPC时只读缓存要明确标过期。针对列表采用游标分页和索引，拒绝无界全表查询。

外部调用有超时与并发限制，先核实两个RPC提供者的chainId，不串链回退。链的理论吞吐不是本网站TPS；本阶段不承诺吞吐、费用、可用性或最终确认耗时。

可观测字段：requestId、buildSha、environment、chainId、boxId、jobKey、确认区块、索引延迟、revert类别；不得记录签名或用户附件。监控配置和告警渠道属于后续交付，不在M0-A声称已生效。

## 9. 明确不引入

不引入服务端用户钱包、无限授权、托管余额充值账户、跨链结算、后台AI裁决、任意token支持、可变分账方案、会自动broadcast的CI、Redis或额外服务器。KV/Durable Objects仅在后续证明必要时通过ADR引入，当前不是核心依赖。
