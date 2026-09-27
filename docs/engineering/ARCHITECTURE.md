# 技术架构

M0-B更新 · 2026-09-27。区分已实现工程基础和未来业务目标；运行证据见[M0-B验收记录](../planning/M0-B_ACCEPTANCE.md)。

## 1. 总体选择

React + TypeScript + Vite SPA；同一Cloudflare Worker提供静态资源、同源API及可选后台处理。目标使用D1存元数据及链事件投影，私有R2存附件，Queues处理可重试任务，合约管理资金。

按用户最新决定使用**一个monadbox Worker：main正式发布，dev Worker Previews**，不再建立两个完整网站Worker。M0-B初始远端只读，无真实存储绑定、队列或Cron；Preview不能消费队列或运行Cron，相关验收分开。

```text
浏览器
  ├─ 静态UI / 同源API → Cloudflare Worker
  │                       ├─ D1：账户、草稿、索引投影、outbox（未来业务）
  │                       ├─ 私有R2：交付附件（未来业务）
  │                       └─ Queues / Cron：重试、索引、通知（未来业务）
  └─ 用户钱包 → Monad RPC → 版本化资金合约（M0-C起验证）
```

Workers官方支持静态应用和Worker API；本工程采用Vite构建客户端、esbuild构建Worker的显式两产物路径，不假设必须使用Cloudflare Vite插件。一个项目发布两部分，不引入常驻Node服务器、Pages双重发布或微服务集群。[S04-S06](../planning/SOURCES_AND_PROVENANCE.md)

## 2. 信任边界

| 组件 | 可以做 | 不可以做 |
| --- | --- | --- |
| React UI | 输入、展示、签名前验证、钱包交互（后续） | 用localStorage余额证明付款 |
| Worker API | 认证、草稿、意图构造、对象级授权（后续） | 保管用户私钥、代替用户接受交付 |
| D1 | 元数据、nonce、幂等记录、可重建事件投影 | 作为提款余额/退款权的最终依据 |
| R2 | 原始规则快照和私密附件 | 对外公开可枚举的交付桶 |
| Queues/Cron | 读取、投影、重试、通知 | 自动签名放款或修改链上事实 |
| 合约 | 固定资金规则、账务、签名验证 | 判断现实活动质量或文件价值 |

## 3. 工程与工具链

已实现：React、TypeScript strict、Vite、Hono、Zod；系统字体/CSS令牌；Vitest、Miniflare/workerd运行时测试、Playwright Chromium、ESLint、Prettier。具体精确版本见package.json和pnpm-lock.yaml，Node22.16.0、pnpm10.11.1、Wrangler4.135.0。

资金与网络层以后再引入viem/wagmi等依赖，不提前安装未用的供应商SDK。邮箱钱包、Gas代付、TanStack Query等按实际需要增加并锁版本，不把设计候选当已集成。

```text
src/app/                 页面、组件、路由、语言与配置状态
src/worker/              Hono只读API、内部存储原语、queue/scheduled handlers
src/shared/              DTO/config schema、整数金额、六工具目录
contracts/               待实现Foundry目录与配置，不含业务合约
contracts/deployments/   目前无真实部署
migrations/              D1基础迁移
scripts/                 构建、配置校验、分支限制部署
 tests/                  unit、runtime、e2e（实际路径无前导空格）
docs/                    规格、操作说明与阶段证据
```

当前按需建立目录；public等静态资源目录在有内容时再增加。Foundry版本与Solidity/EVM target仍需M0-C实测；foundry.toml中的0.8.28/paris只是保守候选，没有forge执行记录。ABI以后从已编译产物生成，不手抄长期漂移的版本。

## 4. 当前接口与能力

`GET /api/v1/config`发布白名单配置、环境和revision；`GET /api/v1/health`返回本构建状态。未知API返回JSON404而非SPA，Box创建明确503未开放；无登录、上传或诊断HTTP写入口。

所有钱包、付款、草稿、主网能力均禁用，asset/contract allowlist为空。前端展示未来六工具说明，不创建假订单或模拟余额。环境配置不合法时fail closed；签名/业务逻辑没有借只读工程顺便开放。

私密R2与nonce/队列函数仅用于本地运行时验证。若后续启用存储，必须检查独立资源与environment_guard；现在远端不绑定资源，首次只读部署不需要先创建D1/R2/Queues。

## 5. 网络与资产候选

官方基线：Mainnet chainId=143、Testnet=10143，Gas为MON。[S02-S03](../planning/SOURCES_AND_PROVENANCE.md) 本阶段只使用10143标签和配置校验，**未连接RPC、验证最终性或广播交易**。

AUSD官方列示主网 `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`、测试网 `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`，仅为待验证候选，不写入可付款allowlist。[S07](../planning/SOURCES_AND_PROVENANCE.md)

M0-C需逐链确认代码、symbol/decimals、transfer/approve、测试资产来源、回执/事件/explorer。不得仅凭ticker或同地址认定资产；Mock必须明示，不能替代官方资产验证。

production网站也保持Testnet。配置缺失或错链禁止写入，不回退任意网络。主网开放必须通过G-07。

## 6. 钱包、认证与一致性目标

以下是后续实现要求，M0-B未实现：钱包适配分离connect、signMessage、signTypedData、sendTransaction、capabilities；SIWE只登录不授权资金，验证domain、nonce、chainId和时效；EOA和EIP-1271分别列支持矩阵。[S09/S12](../planning/SOURCES_AND_PROVENANCE.md)

写入链路：用户签署→hash（仍未成功）→真实receipt/status/合约/日志/金额核验→达到网络确认策略→D1投影/outbox。不得凭客户端成功字符串授予权益。批准代币不是入金，credit不是钱包到账。

链日志键 `(chainId, blockHash, txHash, logIndex)`，语义nonce再次防重。保留OBSERVED/FINALIZED/ORPHANED、区块父哈希、原始日志及投影版本；游标在区间完整落库后推进。M0-C实测确认策略，不把等若干毫秒当最终性。重组回滚展示但保留审计记录。

D1使用prepared statements和原子batch；M0-B已验证nonce并发单次消费和批处理中冲突整体回滚，未实现链上账务投影。详细模型见[数据与API](DATA_AND_API.md)。

## 7. 队列与计划任务

M0-B实现的队列是foundation.probe诊断：jobKey唯一、payload指纹一致、重复无额外副作用、冲突拒绝、失败重试并由队列送死信。scheduled只做nonce过期清理且默认关闭，不是链上索引器。

后续索引采用有上限eth_getLogs、游标/租约/重试；页面可提示受限刷新，不接受任意RPC URL或无界区间。Cron初始候选1分钟，实测后再定，不在Worker内常驻无限循环。

至少一次投递必须按幂等实现；outbox与投影同事务，通知发送失败不回滚链上资金。用户/事件/渠道去重，不承诺端到端exactly-once。[S11](../planning/SOURCES_AND_PROVENANCE.md)

Preview不能消费队列或自动运行Cron。M0-B在隔离本地Miniflare验证这些代码；用户账户内的后台触发验收另行设计，不把预览网页可访问当后台已经正常运行。

## 8. 发布、恢复与观察

根wrangler.jsonc配置一个Worker及完整previews.vars；wrangler.local.jsonc仅本地资源模拟。生产/预览部署脚本核验main/dev分支，构建不迁移数据库、不广播合约。具体控制台填写及首次部署见[部署文档](DEPLOYMENT.md)。

每个请求生成requestId，API禁缓存、设置CSP等安全响应头；buildSha用于核对版本。敏感签名、cookie、key、私密附件不写日志。尚未启用外部告警。

后续目标：RPC超时/并发限制、过期缓存提示、意图与原hash恢复、直接链上退出、列表分页；两个RPC核验chainId后才可故障回退。链理论吞吐不是本网站TPS，不承诺未测量的费用、可用性或确认耗时。

## 9. 禁止扩大范围

本阶段不加入服务端用户钱包、无限授权、托管充值余额、多链结算、AI资金裁决、任意token、可变分账、自动broadcast CI、Redis或额外服务器。KV/Durable Objects需后续ADR证明必要性。
