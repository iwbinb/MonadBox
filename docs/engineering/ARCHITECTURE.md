# 技术架构

M1-B 当前实现，六工具终态规格另见产品、资金及API目标文档。

## 1. 结构与运行边界

```text
浏览器React/Vite UI
  ├─ Worker/Hono同源API
  │    ├─ config/health：始终可读，校验缺配置
  │    └─ 可选CLOUD：SIWE、云端草稿、发布记录 → 隔离D1
  ├─ 用户显式钱包签名 → Monad Testnet Group创建（需真实部署登记）
  └─ /lab → 原M0-C限额技术探针
```

一个monadbox Worker，main正式发布、dev Worker Previews；静态页面与API同项目。当前云端与发布flags为false；远端D1未绑定，R2/Queues/Cron未启用。网站部署成功不能当成这些功能已在线验收。

## 2. 模块

| 模块 | 实现 |
| --- | --- |
| src/app/group、src/shared/group | M1-A本地草稿、整数规则、元数据和条款哈希 |
| src/app/cloud | SIWE确认界面、账号草稿、发布管理、匿名分享页、浏览器发送日志 |
| src/shared/cloud/model.ts | 有版本的部署/发布意图schema，JSON大整数为字符串 |
| src/shared/cloud/chain.ts | 编译代码/固定资产/管理员验证、确切createGroup回执、finalized快照 |
| src/worker/cloud/router.ts | 浏览器绑定挑战、会话与CSRF、owner/revision授权、D1保存与发布核验 |
| src/worker/index.ts | 安全响应头、只读配置与健康、按路径挂载云端API |
| contracts | GroupEscrowV1及M0CProbe；本批不改变资金逻辑、不执行公开部署 |
| migrations/0002_cloud_groups.sql | D1会话、云端记录、不可变metadata、发布意图与schema2 |
| tests/fixtures/cloud-worker.ts | 仅本地测试entry，连接固定loopback Anvil；不进入正式构建入口 |

Node/pnpm和依赖lockfile沿用M1-A，本批未新增第三方依赖。Group编译产物由Solidity源码生成，运行时引用和实际哈希验证不靠手写ABI。Cloud页面按路由lazy加载。

## 3. 数据与权限

D1不是用户资金账户。账户由随机会话token摘要映射原钱包，SIWE挑战精确绑定origin、nonce、时间和浏览器cookie。D1批处理与唯一键防双重消费；同会话请求从first-primary开始，避免以旧副本授权已撤销会话。会话和签名不出现在日志或公开响应。

草稿owner由已认证会话决定，不信任请求里的任意钱包地址。修改/删除带revision，发布准备后不可改。原始metadata字节、metadataHash、结构化规则、termsHash和原发布意图相互核验。公开页不暴露未发布草稿，也不接受客户端paid/published标签。

## 4. 发布与恢复

准备请求读取已登记合约及链时间/nonce，复制冻结规则和唯一salt，不签名。浏览器重新校验EOA/链/目标代码/规则/nonce，显式调用createGroup；不授权token，不入金。发送前本地记录状态并锁定同账号；未知情况不重发。

确认接口只读RPC，核对交易、准确事件、canonical块和finalized覆盖高度，并读回Group。需要时以最多41块的账户+nonce搜索恢复hash，旧交易由用户补hash。数据库仅记录证据和展示状态。

公开GET每次核实原发布和finalized的Group状态；不是完整事件索引器。RPC不可用/代码变更/链证据不匹配时拒绝展示“已核实”。当前每环境一个登记版本，后续增加合约版本前必须保留旧版读取与退出路径。

## 5. 持久化与部署

新CLOUD开关只要求DB；不依赖原STORAGE开关的R2/Queue组合原语。CLOUD启用需exact origin、schema2、匹配environment_guard。生产/Preview数据库及origin均独立，配置验证拒绝相同ID；名称隔离不替代真实资源验证。

GROUP_PUBLISH独立于CLOUD，必须登记实际测试网部署并核验编译runtime/asset/intakeAdmin。NETWORK_WRITES和MAINNET继续false；M1-C前没有资金按钮。现有/lab显式签名开关不变。资源创建、远端迁移和公开合约部署不随main提交自动执行。

## 6. 测试与尚未实现

Vitest分别验证伪RPC边界和真实本地D1；HTTP集成在实际workerd+Miniflare D1+Anvil下执行SIWE/保存/冻结/创建/匿名读取。Playwright另行验证页面与独立浏览器会话；钱包提供者为注入fixture，不冒称真实MetaMask/Safari。

当前未实现：Group参与付款/退出退款等界面（M1-C）、真实资源/钱包综合验收（M1-D）、自动索引器、R2附件、队列通知、WalletConnect、智能账户/SIWE EIP-1271和法币渠道。用户已后置真实测试，保留待验收状态，不阻塞继续编码。安全测试不等于独立审计。

[M1-B操作与精确API](GROUP.md) · [M1-B验收](../archive/M1-B_ACCEPTANCE.md) · [资金规则](../product/FUNDS_AND_STATES.md) · [全阶段计划](../planning/DEVELOPMENT_PLAN.md)
