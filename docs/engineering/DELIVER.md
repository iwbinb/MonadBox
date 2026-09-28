# Deliver 操作与验证

## 固定规则

`DeliveryEscrowV1` 使用普通外部钱包和固定测试 AUSD。客户或服务者创建订单，双方地址、全款、付款截止及交付/验收/争议时长全部进入不可变 termsHash。客户单独授权准确额度，再全额付款。交付期从实际付款开始；只允许一次交付提交，不能重置验收时钟。

- 服务者按时提交非零证据摘要，原文和文件私下共享。
- 客户验收后全款进入原服务者 credit；验收截止后任何人均可按同一规则结算。
- 客户必须在验收截止前发起正式争议。争议暂停放款。
- 未交付到期可全额退款；服务者可在付款、验收或争议期间主动全额退款。
- 争议期内可提交双方签署的分配协议；争议到期后全部剩余款退客户。
- 所有结算先记入固定地址 credit，随后单独提款；暂停新增业务不阻止这些退出。

入口 `/create/deliver` 可离线创建和导出草稿；明确复制到云端后冻结发布。原公开链接 `/box/:publicId` 用于双方操作、附件及换浏览器恢复。工作台仅显示已知链接；可粘贴原链接恢复权益查询。

## 双方协议

采用 [EIP-712](https://eips.ethereum.org/EIPS/eip-712)：域固定为模块名、版本 1、chainId 10143 和原部署地址。消息绑定 schemaVersion、boxId、orderId、termsHash、asset、全部剩余款、双方地址、双方分配额、settlementNonce、deadline、stageIndex。

在争议页面核对提案，双方交换相同 JSON 并各自明确签署，再交换临时签名。任意人可在期限内提交双方签名，不能单方撤销。提交前签名只保留在页面内存，刷新或换账户清掉；客户端与 API 不持久化原始协议签名，提交交易后签名作为交易参数在链上公开。

交易恢复记录只含公开协议与 calldataHash。回执核验从已公开的原交易临时解码签名，重建精确参数，核对原 nonce、事件、canonical/finalized 和合约读回，不因 unknown 自动重发。

编译继续固定 Solidity 0.8.28、optimizer 200、Paris。当前锁定 OpenZeppelin 的 EIP712 工具间接引用 Cancun MCOPY；本模块按 EIP-712 标准直接编码固定域和静态结构，ECDSA 恢复仍用锁定库。没有因此改变旧模块编译目标。浏览器流程将 viem typed-data 摘要与合约 `agreementDigest` 对照。

## 私密附件

`ATTACHMENTS_ENABLED=false` 为默认值。启用需要 CLOUD、MODULES、迁移 `0004_delivery_files.sql`、私有 FILES R2 绑定；不依赖旧 STORAGE/Queue。R2 桶中 `.monadbox-environment` 对象必须带匹配环境的 `customMetadata.namespace`，避免误绑环境。实际资源、迁移与标记由后续资源验收配置，构建不创建远端资源。

仅已发布、原链交易核验通过订单的固定双方可访问。会话、精确 origin、CSRF、固定对象归属和原部署登记均在每次请求检查。客户端下载经过 Worker，不发公开或预签名对象 URL。

| API | 作用 |
| --- | --- |
| GET `/api/v1/modules/:id/files` | 双方查看 ready 文件；各自可看自己的有效上传预留 |
| POST 同一路径 | JSON 文件元数据、Idempotency-Key；在付款/交付/争议状态预留10分钟 |
| PUT `.../files/:fileId` | 原上传者上传原始 bytes；验证长度、MIME、内容特征及 SHA-256 |
| GET `.../files/:fileId` | 双方下载；再次验证存储内容哈希，强制 attachment/octet-stream/nosniff/no-store |

每次交付最多5件（含有效预留），每件最多10 MiB。支持 UTF-8 TXT、PNG、JPEG，扩展名和类型必须一致，禁用 HTML、SVG、可执行文件及压缩包。格式检查不代表恶意软件扫描，上传和下载页明确披露。并发预留受数据库原子计数约束；同一幂等键不能替换内容。同一对象重试只允许相同已承诺字节。

默认保留窗口为链上终结后90天，超过窗口接口拒绝访问。没有开启 Cron 或远端自动删除，物理清理和上线保留政策需资源及隐私验收；双方应在窗口内自行保存原件。过期预留的孤立对象亦纳入后续受控清理。

R2 实现依照 [Workers R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。本地测试使用独立 Miniflare D1/R2，浏览器测试 Worker 固定端口18889/18890，Anvil仍固定18745/18746；不接受公开广播目标参数。

## 恢复与限制

保存原公开链接和交易记录。交易未知时先核验原 hash 或原账户 nonce，不能重新准备另一笔付款。附件服务不可用时仍可私下交换文件及提交摘要；附件权限不授予合约资金权利。

真实双钱包、手机品牌、官方测试资产、R2/D1隔离和独立安全复核均另行验收。没有主网登记或公众资金开关放行。
