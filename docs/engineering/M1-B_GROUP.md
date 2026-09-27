# M1-B：云端成团、登录与发布

本批实现代码与隔离本地测试；真实钱包签名和 Cloudflare D1 资源验收按用户要求后置。它不是完整 Group 收付款阶段。当前正式/Preview 配置均未开启云端或发布，不需要现在提交密钥或创建 R2/Queues。

## 1. 页面

| 路径 | 内容 |
| --- | --- |
| `/create/group`、`/app/group-drafts` | 原有本地草稿，不自动登录或上传 |
| `/app/groups` | 显式签名登录、将本地草稿或 JSON 复制到云端、查看本账号记录 |
| `/app/groups/:id` | 编辑/删除未冻结草稿、查看规则、准备发布、签名创建、核验和恢复 |
| `/b/:id` | 无需登录查看已经核实发布的规则与最终确认区块状态 |

导航中的 Cloud / 云端进入云端记录。功能未配置时明确提示并保留本地草稿入口，不生成假记录。一个浏览器的本地草稿不是云端账号数据，上传需要用户选择并确认；不删除本地原稿。

## 2. 登录与账号

普通外部账户 EOA 路径，使用现有注入钱包发现，不新增 WalletConnect/邮箱钱包。先点击连接并准备登录，查看 SIWE 文本，再点击签名登录。登录不批准代币、不执行付款，也不创建 Group。

服务端固定 domain、URI、chainId=10143、nonce、statement、签发及到期时间；客户端独立核对。登录挑战有效 10 分钟，并由独立 HttpOnly cookie 绑定同一浏览器。签名验证后以 D1 原子批次和唯一键消费一次，不能重放；智能/委托账户代码非空时拒绝该路径。

会话为随机 256 位不透明 token，D1 仅保存摘要；HTTPS 使用 `__Host-`、Secure、HttpOnly、SameSite=Strict、Path=/、无 Domain。会话有效 24 小时且绑定精确 origin；退出时服务端撤销。写入还要求正确 Origin、JSON、客户端头及 CSRF token。不得记录私钥、签名原文或会话 cookie。

## 3. 草稿与数据

D1 保存标题、说明、结构化规则、原始 UTF-8 metadata、metadataHash、revision 和发布记录；不管理用户资金余额。创建请求带 Idempotency-Key，同键同输入返回原记录，不同输入返回409。每账号最多40条未删除记录，列表显示本账号；修改与删除均校验 owner 和 revision。

草稿阶段可编辑或软删除；开始准备发布后即冻结。公开页只读取发布已最终确认的记录：草稿、尚待确认或未知ID统一返回404，避免向非本人暴露私密草稿。正文以文本渲染，不执行用户输入HTML或脚本。

## 4. 发布流程

1. 保存云端草稿，核对完整规则与收款地址。
2. 准备发布：服务器验证注册的测试网 Group 合约、固定官方测试 AUSD、实际 runtime hash、当前链时间/nonce及开始时间，冻结元数据和规则，保存唯一 salt/Box ID/intent。
3. 页面显示固定合约、Box ID、条款、签名期限。用户勾选确认，再显式让同一登录钱包发送 `createGroup`；value=0，不调用approve或contribute。仍会消耗测试 MON Gas。
4. 服务端重新读链，核对发起人、nonce、to、calldata、value、BoxCreated事件、规则哈希、原区块canonical及finalized高度，并读回Group状态。仅提供交易hash不算发布成功。
5. 核验通过后产生公开页面。另一浏览器无需登录即可读取；公开页仍显示“付款尚未开放”。

服务器和用户浏览器均核验编译生成的合约运行时代码；不可变字段位置由编译产物确定，另核验固定token/admin getters及已登记runtime hash。匹配代码不等于已经安全审计。Group合约部署本身是单独的用户授权操作，本页面只发布实例，CI不代部署。

## 5. 冻结与恢复规则

一次记录只能有一个发布意图；重试准备不更换salt或nonce。发送前保存恢复日志并以Web Locks串行同账号签名。拒签不算成功；广播、未知、reverted、replaced、finalized分别记录。不因超时或刷新自动重发。

重新查链支持已知hash，也可在最近最多41块中按原账号+nonce定位。更久的交易从钱包补入原/替代hash。刷新后云端保留原意图和已核验hash，本地日志只是恢复提示，不作为链上证据。

冻结后的时间或规则不能原地修改。过期/拒绝/替换记录可导出后复制成新草稿；先核实旧交易再新建，避免重复创建。签名期限是客户端安全限制，不会神奇撤销已经发出的链上交易；因此即使期限已过，也不能把旧规则解冻或丢弃，晚到回执仍需处理。

当前单环境仅登记一个Group版本；替换注册地址前必须先实现旧版兼容查询，不能让旧发布记录失去读取路径。大规模索引和多版本迁移不在本批。

## 6. D1 按需配置，暂不执行

本次仓库默认：`CLOUD_ENABLED=false`、`GROUP_PUBLISH_ENABLED=false`、`GROUP_DEPLOYMENT=null`。本地模拟不构成真实D1资源授权。以后启用云端只需要D1，不必开R2/Queues。

先在用户控制台分别建立生产/Preview数据库，通过独立PR记录真实ID及精确origin；根配置与 `previews` 各自绑定 `DB`，不能复用同一ID。对每个新库依次应用 `0001_foundation.sql`、`0002_cloud_groups.sql`，再写入对应 `environment_guard`，分别为 `monadbox-production`、`monadbox-preview`。已应用0001的库只应用0002，不能重复执行ALTER TABLE。

| 参数 | 开启云端时的要求 |
| --- | --- |
| `CLOUD_ENABLED` | `true`，仅在该环境D1与schema2/marker验证后 |
| `APP_ORIGIN` | 该环境实际HTTPS origin，无路径/尾斜线；不接受通配符 |
| D1绑定 | 名称 `DB`、该环境实际database_id，migrations目录为migrations |
| `STORAGE_ENABLED` | 保持 `false`；这是历史通用R2/队列组合原语开关，不是新的D1-only云端开关 |
| `BACKGROUND_ENABLED` | 保持 `false` |
| `GROUP_PUBLISH_ENABLED` | 先保持 `false`；不因云端可保存就自动允许链上创建 |
| `NETWORK_WRITES_ENABLED`、`MAINNET_ENABLED` | 继续 `false`，M1-B不开放业务付款或主网 |

启用Group发布还需要经过核验的实际测试网部署：chainId、version、address、asset、intakeAdmin、runtimeHash。不能填写本地Anvil地址/哈希冒充公开部署。登记后才经PR显式启用 `GROUP_PUBLISH_ENABLED`。后台仍不持有钱包私钥；用户浏览器签名只调用已登记目标。

没有绑定时云端API返回503，不报数据库已保存；绑定错marker/schema也拒绝。健康响应新增 `cloudGroups`，旧 `storage: disabled` 与新 D1-only云端不矛盾。生产/Preview真实跨环境隔离仍待M1-D验收。

## 7. 实际 API

统一前缀 `/api/v1`，请求JSON，受限分页/数量，最大请求20KB。写请求带 `X-MonadBox-Client: web`；登录后还带 `X-CSRF-Token`。

| 接口 | 作用 |
| --- | --- |
| POST `/auth/nonce`、POST `/auth/verify` | 生成浏览器绑定的SIWE挑战、核验并建立会话 |
| GET `/auth/session`、POST `/auth/logout` | 当前账号和CSRF、撤销会话 |
| GET/POST `/groups` | 本人列表、幂等保存云端草稿 |
| GET/PATCH/DELETE `/groups/:id` | 本人读取、revision编辑、未冻结软删除 |
| POST `/groups/:id/prepare` | 固定规则、验证部署、保存唯一发布意图，不签名 |
| POST `/groups/:id/confirm` | 根据真实链上证据核实发布，不信任客户端成功标记 |
| GET `/public/groups/:id` | 已发布规则与新读取的finalized状态；无需账号 |

各状态和原始元数据均可复查；未知RPC或重组返回不可核验，不展示凭数据库推断的付款成功。

## 8. 本地验证

`pnpm build`生成ABI/runtime；先 `pnpm test:contracts` 生成MockToken产物，再运行 `pnpm test:cloud-local`。它仅启动固定loopback的Anvil和Worker/D1，完成SIWE、云端存储、Group创建和匿名HTTP读取。`pnpm test:e2e`另用真正Chromium验证页面点击和新浏览器会话。

测试fixture的密钥/账号仅用于本地，不接公开RPC；即使chainId和token地址与Monad相同，也不算真实测试网交易。公网写入、远端schema迁移、真实钱包和Safari留待用户安排。本批不开始M1-C。

## 9. 主要依据

- SIWE规范：https://eips.ethereum.org/EIPS/eip-4361
- viem SIWE消息验证：https://viem.sh/docs/siwe/utilities/validateSiweMessage
- D1 batch/会话接口：https://developers.cloudflare.com/d1/worker-api/d1-database/
- 实际结果见 [本批验收](../planning/M1-B_ACCEPTANCE.md)，技术规格不代替运行证据。
