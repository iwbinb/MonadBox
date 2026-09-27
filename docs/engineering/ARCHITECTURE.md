# 技术架构

M0-C更新 · 2026-09-27。当前能力与未来业务目标分开。证据见 [M0-C验收](../planning/M0-C_ACCEPTANCE.md)。

## 1. 运行结构

React/TypeScript/Vite构建浏览器应用，Hono由同一Cloudflare Worker提供API，静态资源由Workers Static Assets提供。一个`monadbox`项目：main正式站、dev Worker Previews。部署命令保持不变，不需要第二个完整网站Worker。

```text
浏览器 UI ─ 同源配置/健康 API ─ Worker + Static Assets
    │                            ├─ D1：未来账户/草稿/查询投影（关闭）
    │                            ├─ R2：未来附件（关闭）
    │                            └─ Queues/Cron：未来后台（关闭）
    └─ /lab：用户钱包显式签名 ─ Monad Testnet RPC ─ 测试探针
```

M0-B基础页面/运行时原语继续保留；M0-C新增浏览器侧钱包实验室。六工具没有业务合约、订单、账户会话或可领取余额，不能把实验室当业务产品。

## 2. 已实现模块

| 模块 | 当前责任 |
| --- | --- |
| src/app | 基础页面、双语、导航、状态、lazy加载lab |
| src/app/lab | 钱包选择、网络检查、签名前摘要、探针/授权/入金/退款、记录恢复 |
| src/shared/lab | 固定network/token、运行时代码验证、钱包适配、交易/事件/最终性核验、localStorage恢复schema、重放模型 |
| src/worker | 只读config/health、headers、内部D1/R2/queue原语；无公开诊断写入口或签名 |
| contracts | M0CProbe与本地测试；不是Group或其他业务合约 |
| scripts | 源码编译、前端/Worker构建、分支部署校验、固定本地链测试 |
| migrations | 业务基础表结构，未迁移到真实Cloudflare资源 |

网络SDK使用viem2.56.9。当前小型EOA探针采用薄EIP-1193/EIP-6963适配，不引入未使用的wagmi/WalletConnect/邮箱SDK。原设计中的SIWE、TanStack Query、持久化索引和钱包供应商是后续工作，不是已集成能力。

## 3. 配置与签名边界

`TESTNET_LAB_ENABLED`缺省false，在当前发布配置中显式true；只用于独立实验室。`NETWORK_WRITES_ENABLED=false`、`MAINNET_ENABLED=false`以及空业务资产/合约登记继续关闭六工具业务写入。health的payments字段仍指业务付款，另有testnetLab字段说明显式钱包签名能力。

Worker只返回白名单配置、health和业务未开放状态；不生成私钥、不保存助记词、不签名、不调用钱包、不提供任意RPC代理。CSP只允许同源及固定官方测试网RPC连接。构建/CI/Cloudflare发布只编译测试和发布网站，永不broadcast公开链。

`/lab`每次写入先重新核对钱包账号/10143、RPCchain、tokenmetadata、探针代码，估Gas和余额，显示摘要；用户确认后才请求钱包签名。不自动请求approve或发出交易。智能/委托账户代码非空即拒绝写入，EOA验证不代表EIP-1271/7702兼容。

## 4. 探针版本与资金

Solidity0.8.28、paris、optimizer200、OpenZeppelin5.7.0、Foundry1.8.3；构建生成ABI/creation bytecode/runtime/immutable references，前端把固定token填入immutable位置后与实际部署runtime的keccak核对。构建不需要链连接，没拿到真实部署地址不创建假登记。

探针只支持10143，6位token，单钱包每探针最多1测试AUSD保留款，无admin/upgrade/fee。入金nonce不重复；refund只能给原payer，转账失败回滚权益，并检查真实余额变化。允许其他地址代付Gas触发退款但不能换收款人。它采用原子直接退款，不替代未来业务pull-credit/争议/分账规则。

官方测试AUSD固定为`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`。官方文档和实际RPC读取证明当前代码/metadata存在，尚无真实approve/transfer/部署验收；代币发行方权限和冻结是额外信任条件。主网资产不允许进入流程。

## 5. 交易一致性与恢复

保存意图（账户、chain、目标、金额、nonce、calldata等）→用户签名→hash（非成功）→查询交易和receipt→核对原账户/nonce/to/input/value、准确事件→核对区块hash仍canonical与finalized高度→最终状态。

localStorage是恢复提示，不是账务数据库。写入不可用时阻止新签名；发出后持久化失败尽量保留已知hash提示。拒签、revert、替换、未确定分开；unknown不自动重发。最多回看41个区块按账户nonce恢复；旧交易需要用户从钱包提供hash。无历史退款使用已验证探针+Funded Payment ID，读取真实原付款权益。

重放模型按chain/contract/blockHash/transactionHash/logIndex去重，只保留给定canonical分支，排序并校验本金守恒。它是本地完整历史fixture重建，不是已部署的链上索引器。后续D1投影/outbox/游标仍按DATA_AND_API实施。

## 6. 测试类型

Foundry验证合约行为/模糊序列；Anvil验证实际本地EVM部署与四笔操作，RPC固定127.0.0.1；Playwright模拟注入钱包并把公共RPC请求拦截到该本地节点，证明UI连通和错误处理。**相同chainId/token地址不代表真实Monad。**

真实公共网络当前只有只读链/区块/metadata结果；完整签名流程、用户钱包品牌兼容、公开源码验证待完成。Remote Cloudflare资源与Preview后台限制另外验收，不能由本地Miniflare代替。

## 7. 后续按需启用

D1用于账户、草稿、业务元数据和可重建事件投影；R2用于私密附件；Queues用于幂等重试/通知。当前storage/background关闭，不为了测试探针提前创建资源。后续业务按阶段增加，资源按生产/Preview独立绑定。

SIWE校验domain/nonce/chain/时效，业务权限由服务端会话和链上角色分别验证；对象级附件授权、整数金额、唯一键/幂等、outbox、可追溯日志、旧版退出路径和不可变规则等M0-A设计保持不变。主网仍必须通过独立G-07审阅和用户授权。

## 8. 参考

[实验室说明与官方来源](M0-C_LAB.md) · [实际RPC记录](../planning/M0-C_RPC_EVIDENCE.json) · [业务数据/API](DATA_AND_API.md) · [业务资金规格](../product/FUNDS_AND_STATES.md) · [Cloudflare部署](DEPLOYMENT.md)。不声称M0-C已经审计、上主网或完成六工具。
