# 数据模型与 API 约定

M0-A v1.0 · 逻辑规格；M0-B起逐步生成可执行migration、类型和OpenAPI，不伪称本文件可直接启动服务。

## 1. 统一标识与类型

- 环境单独数据库；网络仍必须入键。Box链键为chainId+contractAddress+boxId，Order链键追加orderId。
- 地址存规范化小写并在展示时校验checksum；签名验证按地址值，不依赖字符串大小写。
- 原始代币金额、nonce、链上大整数用十进制TEXT/JSON string；应用用bigint计算。不得用SQLite浮点SUM计算财务总额。
- createdAt/updatedAt记录UTC；链上时间同时保留epoch seconds；UI按用户时区显示。
- 版本化DTO和terms schema，发布日期后关键资金参数不可PATCH。

## 2. D1逻辑表

| 表 | 关键字段 | 约束/索引 |
| --- | --- | --- |
| users | id, primary_wallet, locale, timezone, created_at | primary_wallet唯一；不支持后台迁移链上权益 |
| sessions | id_hash, user_id, expires_at, revoked_at | 不存明文cookie；expires_at索引 |
| auth_nonces | nonce_hash, domain, chain_id, expires_at, consumed_at | 单次消费；原子UPDATE校验未消费 |
| boxes | id, public_id, owner_user_id, tool, draft_version, chain_id, module, chain_box_id, terms_hash, metadata_hash, status, schema_version | public_id高熵唯一；链键唯一；owner+时间索引 |
| tool_terms | box_id, schema_version, immutable_payload, content_hash | 六工具判别联合；仅草稿版本可改 |
| orders | id, box_id, chain_order_id, participant, original_amount, locked_projection, credit_projection, tool_state | chain键唯一；participant+状态索引 |
| split_recipients | box_id, recipient_index, address, bps | 索引和地址均唯一；发布后冻结 |
| milestones | box_id, stage_index, amount, work_duration, review_duration, projected_state | stage唯一；金额之和校验 |
| reward_allocations | box_id, index, recipient, amount, claimed_projection | 每Box recipient唯一；公开属性 |
| intents | id, user_id, action, chain_id, target, business_nonce, payload_hash, state, expires_at | 同一业务nonce唯一；不能充当receipt |
| transactions | chain_id, hash, from_address, nonce, intent_id, status, replacement_hash, block_hash | chain+hash唯一；from+nonce查询替换交易 |
| chain_events | chain_id, module, block_number, block_hash, tx_hash, log_index, event_type, raw_data, canonical_status, projection_version | chain+blockHash+txHash+logIndex唯一 |
| credit_movements | event_key, box_id, order_id, asset, beneficiary, amount, reason, direction | event_key唯一；来源链上事件 |
| indexer_cursors | chain_id, module, last_block, last_hash, lease_owner, lease_until, revision | chain+module唯一；推进带版本检查 |
| attachments | id, box_id, uploader, object_key, content_hash, content_type, size, visibility | 私密objectKey不公开；所属关系索引 |
| idempotency_keys | user_id, route_scope, key, request_hash, response_ref, expires_at | 组合唯一；冲突payload返回409 |
| outbox | job_key, type, entity_ref, payload_version, status, attempt, next_attempt_at | job_key唯一；按status/time扫描 |
| notifications | id, user_id, event_key, channel, delivery_state, read_at | user+event+channel唯一 |
| audit_log | request_id, actor, action, entity_ref, timestamp, result | 追加，不写秘密；不删除原失败记录 |

原始日志与投影分离以便重建。订单投影的金额字段必须注明asOfBlock/finalizedAt；余额卡查询链上或带过期标志，不能仅凭历史日志求和当授权。

## 3. ToolTerms判别字段

| tool | 必须的结构化字段 |
| --- | --- |
| group | asset, unitPrice, minParticipants, capacity, startsAt, fundingDeadline, settleNotBefore, settlementPlan |
| split | asset, fixedAmount或可输入模式, recipients[{address,bps}], paymentTerms |
| deliver | asset, buyer, seller, amount, fundBy, workDuration, reviewDuration, disputeDuration |
| attend | asset, deposit, capacity, registrationDeadline, eventStart, eventEnd, checkinStart, checkinDeadline, challengeDeadline, disputeDuration, noShowPenaltyBps, beneficiary, signer |
| milestones | asset, buyer, seller, fundBy, disputeDuration, stages[{title,amount,workDuration,reviewDuration}] |
| rewards | asset, claimStart, claimDeadline, allocations[{recipient,amount}] |

publicContent含标题、简介、规则摘要；privateContent不纳入公开API。链上存关键参数和哈希，D1不能与链上产生另一份可变“实际规则”。读取时不一致即显示警告并禁用新入金。

## 4. API 公共约定

前缀 `/api/v1`；JSON UTF-8；请求体schema校验；游标分页默认20、最大100。成功返回data及requestId；失败返回error.code、用户可理解message、retryable及requestId，不泄露堆栈。认证会话cookie不作为链上签名。

所有写操作带 `Idempotency-Key`；同用户/同route/key/同payload重复返回同一结果，不重建intent；同key不同payload=409。服务端缓存期限默认24小时，链上nonce防重不受缓存过期影响。

| 方法与路径 | 权限 | 输入/输出要点 |
| --- | --- | --- |
| GET `/config` | 公开 | 环境、chainId、已验证资产/部署清单、feature flags；无秘密 |
| GET `/health` | 公开 | buildSha、基本运行状态；外部依赖健康仅汇总 |
| POST `/auth/nonce` | 限流 | 返回待签SIWE字段；绑定预期domain/chain |
| POST `/auth/verify` | nonce+签名 | 验证后建立cookie会话；拒绝过期/重放 |
| POST `/auth/logout` | 会话+CSRF | 撤销当前会话 |
| GET `/me` | 会话 | 本账户资料与原钱包，不返回敏感签名 |
| POST `/boxes` | 会话 | 创建草稿，tool+schema校验 |
| PATCH `/boxes/:id` | 原创建者 | If-Match草稿revision；发布后资金字段返回409 |
| GET `/boxes/:id` | 公开/按角色裁剪 | 发布状态、规则及可公开活动；draft仅本人 |
| GET `/me/boxes` | 会话 | created/participating/beneficiary过滤 |
| GET `/me/orders` | 会话 | 当前钱包相关订单及投影时间 |
| GET `/boxes/:id/orders` | 创建者/参与者裁剪 | 不泄露他人私密附件；公开链数据也不拼接真实身份 |
| POST `/boxes/:id/intents` | 会话+角色 | action+参数；返回待验证的交易意图，不执行签名 |
| POST `/intents/:id/transactions` | 原intent用户 | hash提示；校验链/发送者/目标；仍返回PENDING |
| GET `/transactions/:hash?chainId=` | 会话/公开裁剪 | 回执状态、替代hash、已确认区块；不推测成功 |
| GET `/me/credits` | 会话 | 按asset/network展示，标来源和asOfBlock |
| POST `/attachments/upload-intent` | Box授权角色 | 文件meta→短时上传权限；限制大小/类型/object key |
| POST `/attachments/:id/complete` | 上传者 | 验证对象存在/大小/hash，之后才关联订单 |
| GET `/attachments/:id/download` | 对象级授权 | 短时下载URL或Worker流式传输；强制非执行类型 |
| GET `/me/activity` | 会话 | 分页活动；导出需防CSV公式注入 |
| GET `/me/notifications` | 会话 | 站内通知与状态，不谎报邮件已送达 |
| POST `/me/notifications/:id/read` | 所属用户 | 幂等已读 |

没有 `PUT /balance`、`POST /admin/force-release` 或客户端回调“直接置成功”接口。异议、验收、取消、退款、提款通过intent+用户签名链上调用，而不是POST接口直接产生资金权利。

## 5. Intent 与交易绑定

intent包含chainId、已登记module/版本、action、boxKey/orderKey、asset、amount最小单位、termsHash、actor、nonce、expiry、预期事件；返回to、data、value作为待核验草案。客户端用固定ABI与本地allowlist验证目标/selector/参数，不能盲签服务器任意calldata。

服务端收到hash后读取真实交易及receipt：链、sender/钱包执行语义、目标、状态、相关event和金额全部匹配才绑定。智能钱包内部调用不能只比外层to；仅启用已测试的钱包路径。收录失败、替换、用户取消和长时间未知分别保留状态。

网络切换、规则版本变化、nonce已用或意图过期时创建新意图；不能复用旧签名。仅看到ERC20 Approval事件不算Funded。

## 6. 事件投影、并发与恢复

索引任务领取有期限租约、读取有上限区间、校验区块关系；D1原子批处理原始事件、投影幂等键与outbox。游标在该区间完整写入后更新；崩溃重跑必须得到相同结果。多个worker抢同游标时使用revision/lease防重入，但正确性仍需唯一键与幂等，不只靠锁。

同一事件重复/乱序时不能重复累计；同order状态按区块和logIndex重算。若旧观察区块不再canonical，标ORPHANED并从安全检查点重建，保留审计历史。

通知采用事件键+用户+渠道去重。Queues可能重复投递；发送系统支持幂等键则传递，否则不得宣称绝无重复邮件。邮件渠道未配置时只有站内通知，不显示邮件成功。

## 7. 安全与保留

严格白名单CORS/Origin、参数化SQL、分页/大小/频率限制、上传授权、不可公开的R2桶；不提供任意URL抓取接口。会话与登录nonce按到期清理，投影/资金审计保留便于重建；私密附件默认订单终结后90天可清理，需在上传前披露并允许双方保存，具体上线保留政策仍需隐私审查。不得宣称删除网页资料能删除链上记录。
