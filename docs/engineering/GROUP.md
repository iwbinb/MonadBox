# Group：本地草稿、云端发布与恢复

本文维护已实现的 Group 操作、配置和 API。M1-C 接入资金交互与恢复，真实资源和钱包验收仍后置。真实钱包签名与远端资源验收后置，当前云端和发布开关均关闭。最新进度只在[总计划](../planning/DEVELOPMENT_PLAN.md)维护。

## 1. 页面

| 路径 | 内容 |
| --- | --- |
| `/create/group`、`/app/group-drafts` | 原有本地草稿，不自动登录或上传 |
| `/app/groups` | 显式签名登录、将本地草稿或 JSON 复制到云端、查看本账号记录 |
| `/app/groups/:id` | 编辑/删除未冻结草稿、查看规则、准备发布、签名创建、核验和恢复 |
| `/b/:id` | 无需登录查看已经核实发布的规则与最终确认区块状态 |

导航中的 Cloud / 云端进入云端记录。功能未配置时明确提示并保留本地草稿入口，不生成假记录。一个浏览器的本地草稿不是云端账号数据，上传需要用户选择并确认；不删除本地原稿。

## 2. 本地草稿

### 四步向导

打开`/create/group`。依次填写基本信息、募集规则、收款人并核对预览，点击“保存草稿”。在`/app/group-drafts`查看、编辑或删除草稿。

默认每份30测试AUSD、最低3份、上限20份只是可编辑的示例输入，**不是已收款或推荐价格**。人数计算按钱包份额，不验证独立自然人。

规则摘要必须保持可读：截止前可退出且同地址不能重进；未成团可退；成功组到指定时间归属固定收款人；成团不等于交付证明；credit不等于钱包已到账。这里只预览规则，尚不发送对应链上操作。

### 保存与导入导出

保存在当前浏览器localStorage，按网站origin、environment与10143隔离；最多40份。不同设备、浏览器、Preview和正式域名不自动共享。未保存的输入离开页面会丢失，当前不是自动保存服务。

JSON导出备份包含标题、说明、地址、时间和金额等明文；不要填写私钥、个人敏感信息或机密交付材料。导入需匹配format/version/chain/token并通过schema，最多16KB；每次成功导入创建新ID，不覆盖现有草稿。

保存不要求登录/连接钱包；草稿中填写的收款地址不证明填写者拥有该钱包。草稿URL只能在有该本地记录的浏览器读取，不是可分享给别人付款的链接。

### 本地异常与恢复

| 情况 | 当前行为 |
| --- | --- |
| 标题/金额/人数/地址/时间不合法 | 对应字段提示，不保存；金额只允许6位小数以内，不接受负数或科学记数法 |
| localStorage不可写或安全锁不可用 | 不显示保存成功；保留表单并允许导出备份 |
| 原草稿数据损坏 | 显示错误，不清空/覆盖原记录 |
| 另一个标签已保存新版 | revision冲突，拒绝旧编辑覆盖；可导出本次内容后重新读取 |
| 草稿上限40份 | 要求导出/清理旧记录后再新增 |
| 无效JSON/主网JSON/超大文件 | 拒绝导入，原列表不变 |
| 新设备打开本地草稿URL | 明确显示本浏览器不存在该草稿，而不是展示可付款订单 |

不要用清除浏览器数据解决损坏草稿或未确定交易；清除会丢掉本地记录。草稿与/lab交易恢复存储独立。

## 3. 登录与账号

普通外部账户 EOA 路径，使用现有注入钱包发现，不新增 WalletConnect/邮箱钱包。先点击连接并准备登录，查看 SIWE 文本，再点击签名登录。登录不批准代币、不执行付款，也不创建 Group。

服务端固定 domain、URI、chainId=10143、nonce、statement、签发及到期时间；客户端独立核对。登录挑战有效 10 分钟，并由独立 HttpOnly cookie 绑定同一浏览器。签名验证后以 D1 原子批次和唯一键消费一次，不能重放；智能/委托账户代码非空时拒绝该路径。

会话为随机 256 位不透明 token，D1 仅保存摘要；HTTPS 使用 `__Host-`、Secure、HttpOnly、SameSite=Strict、Path=/、无 Domain。会话有效 24 小时且绑定精确 origin；退出时服务端撤销。写入还要求正确 Origin、JSON、客户端头及 CSRF token。不得记录私钥、签名原文或会话 cookie。

## 4. 云端草稿与数据

D1 保存标题、说明、结构化规则、原始 UTF-8 metadata、metadataHash、revision 和发布记录；不管理用户资金余额。创建请求带 Idempotency-Key，同键同输入返回原记录，不同输入返回409。每账号最多40条未删除记录，列表显示本账号；修改与删除均校验 owner 和 revision。

草稿阶段可编辑或软删除；开始准备发布后即冻结。公开页只读取发布已最终确认的记录：草稿、尚待确认或未知ID统一返回404，避免向非本人暴露私密草稿。正文以文本渲染，不执行用户输入HTML或脚本。

## 5. 发布流程

1. 保存云端草稿，核对完整规则与收款地址。
2. 准备发布：服务器验证注册的测试网 Group 合约、固定官方测试 AUSD、实际 runtime hash、当前链时间/nonce及开始时间，冻结元数据和规则，保存唯一 salt/Box ID/intent。
3. 页面显示固定合约、Box ID、条款、签名期限。用户勾选确认，再显式让同一登录钱包发送 `createGroup`；value=0，不调用approve或contribute。仍会消耗测试 MON Gas。
4. 服务端重新读链，核对发起人、nonce、交易类型/授权字段、to、calldata、value、BoxCreated事件、规则哈希、原区块canonical及finalized高度，并读回Group状态。仅接受legacy、EIP-2930、EIP-1559且不携带authorizationList的交易；EIP-7702、未知或缺失类型拒绝，即使调用参数和事件都匹配也不能发布。仅提供交易hash不算发布成功。
5. 核验通过后产生公开页面。另一浏览器无需登录即可读取；默认环境仍显示“付款尚未开放”；完成配置放行后展示独立授权和付款操作。

服务器和用户浏览器均核验编译生成的合约运行时代码；不可变字段位置由编译产物确定，另核验固定token/admin getters及已登记runtime hash。匹配代码不等于已经安全审计。Group合约部署本身是单独的用户授权操作，本页面只发布实例，CI不代部署。

## 6. 冻结与恢复规则

一次记录只能有一个发布意图；重试准备不更换salt或nonce。发送前保存恢复日志并以Web Locks串行同账号签名。拒签不算成功；广播、未知、reverted、replaced、finalized分别记录。不因超时或刷新自动重发。

重新查链支持已知hash，也可按原账号+nonce对历史交易计数做有界二分定位（最多66次历史计数读取，再核验原交易与最终性），避免快速出块使近期扫描窗口遗漏原交易。节点不支持历史状态或查询失败时保持unknown，可从钱包补入原/替代hash。刷新后云端保留原意图和已核验hash，本地日志只是恢复提示，不作为链上证据。

首次查不到回执时可保存hash作为恢复线索；已有hash时，任何unknown结果都不能覆盖原hash、状态或核验区块，包括重新查询同一hash时RPC暂时失败的情况。只有服务端核验到同发起人、同nonce、canonical/finalized的交易结果（finalized/reverted/replaced）才允许更新已保存的记录。保护条件在D1写入时原子判断，因此较晚返回的unknown请求也不能覆盖并发保存的新记录。已finalized发布保留原有不可替换保护；历史核验结果不表示本次RPC查询成功。

冻结后的时间或规则不能原地修改。过期/拒绝/替换记录可导出后复制成新草稿；先核实旧交易再新建，避免重复创建。签名期限是客户端安全限制，不会神奇撤销已经发出的链上交易；因此即使期限已过，也不能把旧规则解冻或丢弃，晚到回执仍需处理。

已实现按chain/address/version读取原部署，保留退休版本的恢复和退出；GroupV1与V2独立登记。当前部署清单和能力开关以运行配置为准，完整自动索引尚未实现。

## 7. D1 配置

仓库当前默认：`CLOUD_ENABLED=false`、`GROUP_PUBLISH_ENABLED=false`、`GROUP_DEPLOYMENT=null`。本地模拟不构成真实D1资源授权。以后启用云端只需要D1，不必开R2/Queues。

先在用户控制台分别建立生产/Preview数据库，通过独立PR记录真实ID及精确origin；根配置与 `previews` 各自绑定 `DB`，不能复用同一ID。对每个新库依次应用 `0001_foundation.sql`、`0002_cloud_groups.sql`，再写入对应 `environment_guard`，分别为 `monadbox-production`、`monadbox-preview`。已应用0001的库只应用0002，不能重复执行ALTER TABLE。

| 参数 | 开启云端时的要求 |
| --- | --- |
| `CLOUD_ENABLED` | `true`，仅在该环境D1与schema2/marker验证后 |
| `APP_ORIGIN` | 该环境实际HTTPS origin，无路径/尾斜线；不接受通配符 |
| D1绑定 | 名称 `DB`、该环境实际database_id，migrations目录为migrations |
| `STORAGE_ENABLED` | 保持 `false`；这是历史通用R2/队列组合原语开关，不是新的D1-only云端开关 |
| `BACKGROUND_ENABLED` | 保持 `false` |
| `GROUP_PUBLISH_ENABLED` | 先保持 `false`；不因云端可保存就自动允许链上创建 |
| `NETWORK_WRITES_ENABLED`、`MAINNET_ENABLED` | 公开配置继续 `false`；本地资金功能已实现，真实验收前不开放公众付款或主网 |

启用Group发布还需要经过核验的实际测试网部署：chainId、version、address、asset、intakeAdmin、runtimeHash。不能填写本地Anvil地址/哈希冒充公开部署。登记后才经PR显式启用 `GROUP_PUBLISH_ENABLED`。后台仍不持有钱包私钥；用户浏览器签名只调用已登记目标。

没有绑定时云端API返回503，不报数据库已保存；绑定错marker/schema也拒绝。健康响应新增 `cloudGroups`，旧 `storage: disabled` 与新 D1-only云端不矛盾。生产/Preview真实跨环境隔离仍待M1-D验收。

## 8. 实际 API

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

## 9. 本地验证

`pnpm build`生成ABI/runtime；先 `pnpm test:contracts` 生成MockToken产物，再运行 `pnpm test:cloud-local`。它仅启动固定loopback的Anvil和Worker/D1，完成SIWE、云端存储、Group创建和匿名HTTP读取。`pnpm test:e2e`另用真正Chromium验证页面点击和新浏览器会话。

测试fixture的密钥/账号仅用于本地，不接公开RPC；即使chainId和token地址与Monad相同，也不算真实测试网交易。公网写入、远端schema迁移、真实钱包和Safari留待用户安排。后续资金交互按总计划推进。

## 10. 主要依据

- SIWE规范：https://eips.ethereum.org/EIPS/eip-4361
- viem SIWE消息验证：https://viem.sh/docs/siwe/utilities/validateSiweMessage
- D1 batch/会话接口：https://developers.cloudflare.com/d1/worker-api/d1-database/
- EIP-7702交易类型与授权列表：https://eips.ethereum.org/EIPS/eip-7702
- 实际结果见 [M1-B历史验收](../archive/M1-B_ACCEPTANCE.md)，技术规格不代替运行证据。

## 11. 源码入口

| 路径 | 职责 |
| --- | --- |
| `src/app/group/`、`src/shared/group/` | 本地向导、保存、条款与金额校验 |
| `src/app/cloud/` | 登录、云端草稿、发布与匿名页面 |
| `src/shared/cloud/` | 发布意图与链上核验 |
| `src/worker/cloud/router.ts` | 会话、权限、D1 与实际 API |
| `contracts/src/GroupEscrowV1.sol` | 固定受益人的成团资金状态机 |
| `tests/integration/`、`tests/e2e/` | 本地链/HTTP 与浏览器完整流程 |

## 12. 资金操作与恢复（M1-C）

公开页连接普通测试网钱包后，直接从已核验合约读取本人参与状态、credit、已提款金额和确认区块。入口按链上时间和角色显示：精确授权、参与、截止前退出、确定成团结果、创建者取消、退款权益、成功结算和提款。授权与付款分开确认，credit与实际钱包转账分开展示。

每次签名前准备固定目标/参数/账号/nonce/期限，重新校验链、资产、代码、当前权益和模拟结果。回执必须核对交易类型、原发送者和nonce、完整calldata、准确事件、canonical/finalized；委托交易和未知类型仍拒绝。

`/app/group-activity` 展示本浏览器/环境/钱包的操作记录（最多200条），可导出并凭原hash或原账号+nonce有界查链。unknown不自动重发、不覆盖已存hash和核验证据；多标签共用签名锁。连接钱包和查询均不自动签名。换浏览器后凭原公开链接读取链上参与和credit，即使没有本地记录也能退款/提款。

NETWORK_WRITES仅控制新的授权/参与入口；已存在的合法退款和提款保持可发现。默认远端开关仍关闭。本地资金浏览器测试使用独立固定端口8790/Anvil18746，不影响8789/18745的原发布测试；没有新增远端数据库或公开链交易。
