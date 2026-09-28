# M1-B 开发与验收记录

记录更新：2026-09-28。自动测试执行：2026-09-27 UTC。

PR #5现已合并为`04dbcb6`，main/dev已同步。第1–8节保留原批次交付时的记录；合并后的审查修复与本次验证见第9节。

**状态：功能代码与本地自动验证完成；真实 Cloudflare D1 绑定、公开 Group 部署和真实钱包验收后置。** 本批不是可接收公众资金的完整 Group，也不把后置测试记为通过。

## 1. Git 和交付范围

基线 main：`4ee923ba9a7d994a3f5efc3a0898474858f5036b`，PR #4 已合并。本批仅在 dev 开发。实现提交：`da4d5cdd39783c36877b3e25b6148c014e178288`，tree `c133a1a5e7786b49bea0244bbd4ee57c37fd3d97`。后续文档整理提交不改变已测业务代码；最终提交的 CI 和 Preview 结果在本批 PR 评论补充，不用旧提交绿色状态冒充新提交通过。

实现：SIWE 浏览器绑定挑战/会话/退出、D1 云端草稿/元数据、权限与 revision、幂等创建、冻结发布意图、用户签名 createGroup、回执/最终性/规则核验、匿名分享页、未知交易恢复。新增 `0002_cloud_groups.sql`，保持已存在本地草稿能力。

本批未修改 GroupEscrowV1 资金状态机，未新增第三方依赖或改变依赖锁文件。构建增加 Group ABI/runtime 自动生成；永久 CI 仍只有 contents:read。一次性 source snapshot workflow 已删除，源码归档改为常驻只读 CI 的产物，不会自动改仓库。

## 2. 实际 CI 结果

完整功能 CI：[36333993466](https://github.com/iwbinb/MonadBox/actions/runs/36333993466)，job `108661219227`，运行于实现提交 da4d5cd，最终结论 **success**。已读取各步骤和原始日志。

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| frozen-lockfile 安装 | 通过 | 固定 Node22.16.0、pnpm10.11.1，无临时依赖解析 |
| format:check、lint、typecheck、build | 全部通过 | 准确 ABI/runtime 生成、前端和 Worker 编译 |
| Vitest | **229/229，8个文件** | 原有测试、25个云端/D1测试、34个链核验/配置测试及关闭态回归 |
| Foundry | **55/55** | 原 Group37 + Probe18；不是独立安全审计 |
| 原本地 Anvil 集成 | 通过 | Probe4操作/5检查；Group3场景/25操作、条款哈希与本金规则 |
| test:cloud-local | **通过** | 实际本地 workerd + D1 + Anvil 的 HTTP 完整发布流程，输出10项检查摘要 |
| Playwright Chromium | **48/48** | 桌面/手机尺寸；新增关闭态和云端全流程共4项，未出现重试后才通过的项目 |
| Wrangler dry-run | 通过 | 配置和产物可预检，不产生实际部署、迁移或链上广播 |

命令按 CI 顺序：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`、固定工具安装、`pnpm test:contracts`、`pnpm test:chain-local`、`pnpm test:cloud-local`、`pnpm deploy:dry-run`、Chromium 安装、`pnpm test:e2e`。成功步骤退出码为0。

## 3. 浏览器完整交互证据

环境：GitHub Actions Ubuntu24.04，Playwright1.63.0/Chromium153；桌面1280×720，手机为390×664 CSS像素、DPR3的 Chromium 模拟。**不是实际 iPhone、Safari、MetaMask 扩展或真实 Monad 交易。**

本地地址为 `http://127.0.0.1:8789`，底层链固定 `http://127.0.0.1:18745` Anvil。生产入口不使用这个测试 Worker 或 localhost 链适配器。

实际路径：打开云端记录（无自动签名）→准备 SIWE→拒签一次→显式签名登录→导入并保存 D1 草稿→编辑与刷新恢复→新匿名浏览器访问未发布链接得到未发布提示→准备冻结→模拟钱包签署真实本地 EVM createGroup→finalized 后显示公开链接→刷新不重发→匿名浏览器读取已核验公开页→刷新链状态→退出后私有接口401。

| 检查 | 结果 |
| --- | --- |
| 页面身份与非空渲染 | 云端管理和公开标题均按预期出现 |
| 框架错误覆盖层/应用异常 | 交互断言通过，主签名页面收集的未捕获 pageerror 为0；不等于所有页面所有日志无警告 |
| 资金状态 | 登录无代币授权，发布只创建实例；付款按钮保持 disabled |
| 匿名访问与未发布保密 | 未发布记录不可公开；最终核验后另一独立浏览器可读 |
| 内容转义 | `<script>evil()</script>` 仅作为文字显示，不执行 |
| 恢复与会话 | 刷新后记录可读、交易次数未增加；退出撤销会话 |
| 布局 | 已查看4张桌面/手机截图，手机无水平溢出断言通过 |

已检查产物中的 `cloud-publication-desktop.png`、`cloud-publication-mobile.png`、`cloud-public-local-desktop.png`、`cloud-public-local-mobile.png`。公开页桌面截图只有首屏，不将其称为整页视觉证据；手机公开页为长截图。所有带 LOCAL 的地址/余额/交易标识均是测试数据。

## 4. 数据与异常覆盖

实际本地 D1：并发登录nonce只消费一次；挑战消息/domain/URI/chain/nonce/期限/声明篡改拒绝；挑战cookie缺失、错误签名、过期会话、非EOA拒绝；Origin/CSRF检查；数据库缺失/namespace错误关闭；幂等创建重复不新增、冲突payload409；非owner404；旧revision不能覆盖新稿；准备发布并发只产生一个intent；冻结后不能修改或删除；原metadata校验。

链核验 fixtures：错误网络、runtime或资产；calldata/termsHash/metadataHash/Box ID错配；缺回执、未finalized、孤块保持unknown；revert和同nonce替换不公开；错误actor/nonce/event拒绝；最多41块的恢复扫描；公开状态从已确认的链时钟和Group状态计算。

HTTP 集成使用真实本地 Worker/D1/Anvil，而不是全部替换为模拟HTTP成功响应；unit中的RPC fixtures仍明确属于模拟边界测试。上述测试不证明远端D1延迟、真实钱包品牌兼容或真实Monad最终性表现。

## 5. 产物完整性

CI artifact：`10935959815`，名称 `foundation-36333993466-1`，大小6,677,393字节。下载后重新计算 SHA-256：

`b2305e20aa0a4661fa5ae7bccadec2463786ba82f247804cb977ae87abef19ed`

与GitHub提供的digest一致。已将其中 `artifacts/source.tar` 的110个文件逐一与本地提交内容比较，差异0。源码归档只含仓库文件，不含node_modules、工具二进制或用户密钥。产物按CI保留7天，过期后可用固定commit重跑；不将临时下载URL写为永久证据。

## 6. 已遇问题和未验证边界

本地 Chromium 访问 localhost 被环境策略拒绝（ERR_BLOCKED_BY_ADMINISTRATOR），未绕过，使用仓库现有的 GitHub Actions Playwright 完成浏览器验证。Browser 插件未在当前工具环境列出。

初期本地集成发现登录请求误带challenge的额外字段导致严格schema拒绝，已修正为仅发送id/message/signature，之后完整CI通过。第三方构建包含 React Router 指令/Zod注释等非致命警告；Actions发出Node运行时弃用警告；测试故意失败的队列有重试日志。CI退出清理了一个本地Anvil子进程，因此不宣称进程清理和日志零警告。

当前单环境只有一个已登记Group版本的查询路径；后续变更注册合约前必须补旧版兼容。冻结记录不能解冻重用nonce，过期需要导出复制且先核实旧交易。真实网络表现和滥用压力仍需上线前测试，不能以本地通过代替独立安全审阅。

## 7. 明确没有执行

没有修改main或自动合并；没有创建或连接实际Cloudflare D1/R2/Queues、应用远端迁移或改账户设置；没有公开部署Group合约、发起真实测试网或主网交易；没有接触用户私钥/助记词；没有接入付款/退款/提款UI、WalletConnect、智能钱包、邮件或后台索引；没有宣称已审计、已获真实用户采用或已参赛提交。

配置中的CLOUD_ENABLED和GROUP_PUBLISH_ENABLED仍false，业务支付和MAINNET仍false。原/lab独立显式测试签名功能保留。合并本批只更新网站代码，不会自动把云端和公开资金功能放行。

## 8. 后续

Bill审阅并合并本批PR、保留dev。后续功能编码为 **M1-C：付款/退出/退款/结算/提款界面与恢复**，须用户明确继续，本批不自动开始。真实D1/部署/钱包验收按用户安排在M1-D补齐，并保留M0-C后置项。启用云端只需D1，不必同时增加R2或Queues。

[操作、API与配置](../engineering/M1-B_GROUP.md) · [全阶段计划](DEVELOPMENT_PLAN.md) · [决策与门禁](DECISIONS_AND_GATES.md)

## 9. PR #5审查修复

2026-09-28，用户要求修复PR #5的两条审查意见并同步进度。基线为`04dbcb60a71d0862947a0ef2ff510650adc3d9fb`；本批仅在dev修复，M1-C仍未开始。

### 改动

- P1：发布核验只接受legacy/EIP-2930/EIP-1559且不携带authorizationList的交易。EIP-7702、未知或缺失类型，即使from/nonce/to/value/calldata与事件匹配，也不能成为已核验发布。按nonce找回的交易同样执行此检查。
- P2：已有交易hash时，另一个unknown结果不能覆盖原hash、状态或核验区块。首次unknown仍可保留恢复线索；经链核验的finalized/reverted/replaced结果可以更新替代交易。D1的UPDATE条件在实际写入时判断，覆盖并发请求交错返回的情况；finalized的不可替换保护保留。
- README与全阶段表更新为PR #5已合并，决策新增ADR-25/26，操作说明补充交易类型与恢复规则。

### 本地实际验证

环境：macOS arm64、Node22.16.0、pnpm10.11.1、锁定依赖与真实本地Miniflare/D1；链核验使用可控RPC fixture。现有Node发行包SHA-256与对应版本校验清单一致。没有修改package.json、lockfile、合约或迁移。

| 检查 | 结果与证据 |
| --- | --- |
| frozen-lockfile安装 | 退出0；固定版本安装成功 |
| 原实现复现 | 将两处业务源码临时替换为基线内容，运行新增用例后恢复修复源码；退出1，79项中14项失败、65项通过。失败均对应交易类型或hash覆盖问题；日志`artifacts/review-fix/baseline.log` |
| format:check、lint、typecheck、build | 退出0；日志位于`artifacts/review-fix/` |
| 全量Vitest | 退出0；8个文件、249/249通过。原229项基础上增加20项；日志`artifacts/review-fix/test.log` |
| D1最终补充断言 | 增加直接读取数据库验证核验区块未被覆盖的断言后，重跑受影响文件，34/34通过、退出0；日志`artifacts/review-fix/cloud-final.log` |
| deploy:dry-run | 退出0；仅本地预检，未部署；日志`artifacts/review-fix/deploy-dry-run.log` |

新增覆盖：三种支持的交易类型、EIP-7702有/无/空授权列表、普通交易携带授权列表、未知/缺失类型、nonce恢复核验；unknown/reverted/replaced已有记录保护、合法替代交易、刷新读取、使用原hash重新核验、两类并发交错返回。测试的链上响应是fixture，不属于真实Monad签名验收。

本机没有运行Foundry、Anvil端到端或Playwright；仓库安装脚本针对Linux，完整流程由本批修复PR的只读CI执行。CI及Preview结果以本批实际提交的PR检查为准，不用PR #5的旧结果替代。

### 交付边界

dev→main修复PR由Bill审阅合并；无自动合并。远端D1、Group测试网部署、真实钱包和主网验收继续后置。CLOUD/GROUP_PUBLISH、业务付款和主网开关保持关闭，未更改Cloudflare资源、远端schema或合约资金规则。
