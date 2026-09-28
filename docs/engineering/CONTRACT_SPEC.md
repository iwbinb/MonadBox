# 合约接口与账务规格

M0-A v1.0 · 仅设计，不包含可部署 Solidity 实现或审计结论。

## 1. 模块与版本

| 模块 | 责任 | 首次实现 |
| --- | --- | --- |
| GroupEscrowV1 | 募集、退出、到期、取消、单受益人结算 | M1 |
| SplitPaymentsV1 | 不可变方案、独立最终付款、受益人账务 | M2 |
| GroupEscrowV2 | 同 GroupV1，支持冻结的多方结算计划 | M2 |
| DeliveryEscrowV1 | 单订单交付/验收/争议/退款 | M3 |
| AttendanceBondV1 | 报名、签到、申诉、到期押金分配 | M4 |
| MilestoneEscrowV1 | 分阶段释放、剩余款终止 | M5 |
| RewardsDistributorV1 | 有上限名单、全额预存、领取与过期回收 | M6 |
| 公共库 | 安全 token 操作、SplitMath、哈希、签名、PullCredit | 随首次需求 |

首版用不可升级合约，不用代理委托调用，不构造一个可调用任意外部地址的通用支付引擎。版本更新部署新地址；旧地址及 ABI 保留提款/退款访问。地址登记只是发现机制，不得让登记变更改变既有订单资金规则。

合约资产列表在部署时确定；暂停权仅作用于新增 Box/入金，不能暂停已经可执行的退款、领取和时间到期退出。生产管理员地址及权限审阅需 G-07 放行，不在规格中编造。

## 2. 抽象类型

金额 uint256；时间 uint64（入参转换前验证范围）；bps uint16；chainId uint256；boxId/orderId/paymentId/termsHash bytes32；地址 address；动作 nonce uint256。

`BoxKey` 包含 chainId、contractAddress、boxId；链下不能只用 boxId 查账。金额上限、参与人数、列表长度、所有时长都在创建时检查。参数通过 ABI 编码定义稳定的 termsHash；精确编码和事件 ABI 在对应合约实现 PR 同步生成。

每模块至少维护 `locked[orderKey]`、`credit[beneficiary]` 及按订单的分配/领取可追溯记录；可以优化存储但必须可证明 F-01~F-12。共享 credit 不代表不同币种可以混账，键中必须包含 asset。

## 3. 公共方法语义

以下是语义接口，不是承诺最终 ABI 已冻结的 Solidity 签名；实现可以更名，但权限、输入与事件语义不能改变。

| 方法 | 输入 | 权限与效果 |
| --- | --- | --- |
| getBox | boxId | 查询参数、版本、stored/effective state、termsHash |
| getPosition | boxId, participant | 查询原始本金、状态、已归属、已领取 |
| creditOf | asset, beneficiary | 查询可提余额，不读 D1 |
| withdrawFor | asset, beneficiary | nonReentrant；只转固定 beneficiary，零可领直接拒绝 |
| pauseIntake / unpauseIntake | 无 | 限定管理员；仅影响新业务，不影响旧业务退出 |

任何 convenience 的 credit-and-withdraw 路径都需有可独立执行的 credit 和 withdraw。第三方代触发不会改变资金所有者。重入保护不能因为复用公共函数而嵌套失效；用 internal helper 保持效果顺序。

## 4. 各模块业务方法

### Group

`createGroup(params, creatorSalt)`；`contribute(boxId)`（准确固定金额，msg.sender 原地址）；`leave(boxId)`；`cancel(boxId)`；`finalize(boxId)`；`creditRefund(boxId, participant)`；`settle(boxId)`。

create 时禁止计划受益人或 token 为零/重复、参数不合法。contribute 使用 SafeERC20 transferFrom 后校验 balance delta。finalize/settle/creditRefund 均需依据当前链上时钟和状态，而非 caller 提供的成功标记。退出后不得重进，同一 Box 原地址的 refundCredited 只能从 false→true。

V2 把 split 收款人及 bps 完整复制到 Group 创建参数。settle 对最多20方归属 credit；不对所有参加者做无界循环。分账库不可通过 delegatecall 更换。

### Split

`createSplit(asset, recipients[], bps[], salt)`；`pay(splitId, amount, paymentNonce)`；`getReceipt(paymentId)`。paymentId 绑定 payer 与 nonce，不接受单一服务器 UUID 防重作为链上保障。每笔付款把 T 全部归属，预留退款模式明确不支持。

SplitMath 使用全精度 mulDiv 与相应余数计算，禁止乘法溢出。排序 tie-break 和 UI 必须一致；测试任意 T（包括1最小单位）、不同排列、10000bps边界、n=20、金额极限。

### Deliver / Milestones

`createOffer(terms, salt)`；`fund`；`submitDelivery(evidenceHash)`；`accept`；`dispute(reasonHash)`；`refundBySeller`；`settleAfterReview`；`refundAfterMissingDelivery`；`resolveByAgreement(allocations, nonce, deadline, signatures)`；`refundAfterDisputeTimeout`。

Milestones 除fund/cancelOffer外的阶段动作额外接收`stageIndex`并与currentStage核对；协议内亦绑定该字段，事件携带实际执行阶段。任何终止动作仅处理尚未释放总额。工作时钟按资金规则启动，不能通过重复submit延期。实现与文件说明见[Milestones](MILESTONES.md)。

### Attend

`createEvent(terms,salt)`；`register(boxId)`；`leave(boxId)`；`checkIn(proof,signature)`；`cancelEvent(boxId)`；`challengeNoShow(boxId,reasonHash)`；`finalizeNoShow(boxId,attendee)`；`refundDispute(boxId,attendee)`；`resolveByAgreement(agreement,participantSignature,organizerSignature)`；`refundAfterDisputeTimeout(boxId,attendee)`；`creditRefund(boxId,attendee)`。

checkIn 签名绑定固定 signer、chainId、contract、schemaVersion、boxId、termsHash、attendee、issuedAt、deadline、nonce；不使用静态二维码作为提款依据。退款归原参加者，双签需要参加者与组织者签署，扣款只归固定罚款受益人。每人的争议不阻塞其他人处理。具体操作见[Attend](ATTEND.md)。

### Rewards

`createAndFundBatch(asset, recipients[], amounts[], claimStart, claimDeadline, salt)`；`claimFor(batchId, recipient)`；`reclaimExpired(batchId)`。

创建时链上检查名单唯一性和总和，并验证实际收到总额；实现可要求地址预排序，重复即 revert。不可用 offchain total 替代链上总和。claim 归属的 credit 永不计入 reclaimExpired；expiry 前不得撤回。

## 5. 事件约定

所有事件携带足够的 boxId/orderId/actor 信息，链下补 chainId、contractAddress、blockNumber、blockHash、transactionHash、logIndex。避免在事件写私密附件URL、邮箱或真实姓名。

公共事件：BoxCreated（含asset、termsHash、metadataHash、版本）；Funded；CreditAssigned（含asset、beneficiary、amount、reason）；Withdrawal（含asset、beneficiary、amount）。工具事件：GroupFinalized、GroupCancelled、ParticipantLeft、SplitPaid、DeliverySubmitted、Accepted、Disputed、AgreementResolved、TimedOut、CheckInAccepted、NoShowFinalized、RewardClaimed、ExpiredReclaimed。

资金类事件不得把 pending intent 当 receipt；合约事件字段所用版本须有 ABI registry。一次交易有多个日志不能被当成多笔重复付款。

## 6. 错误语义

至少提供可识别 custom error：InvalidTerms、UnsupportedAsset、WrongAmount、InvalidState、NotAuthorized、WindowNotStarted、WindowClosed、CapacityReached、AlreadyParticipated、AlreadyProcessed、InvalidSignature、NonceUsed、NothingToWithdraw、TransferAmountMismatch、IntakePaused。

错误映射为用户下一步，不把 raw RPC 堆栈作为唯一提示。`call` simulation 成功也不保证稍后的竞态交易成功。

## 7. 安全实现原则与证据

使用固定版本 OpenZeppelin SafeERC20、ReentrancyGuard、签名工具和适当的全精度数学；这些库并不替代业务审计。[S10-S12](../planning/SOURCES_AND_PROVENANCE.md)

所有外部转账遵循 checks-effects-interactions，失败必须回滚权益扣除。测试恶意重入 token/受益合约、返回 false、不返回值、fee-on-transfer、资产被冻结、nonce 重放、跨链/跨合约签名重放、恶意元数据及链上时间边界。

不接受 `tx.origin` 权限、不允许 owner 任意 sweep escrow、不设置无限 token 授权给外部策略、不根据 API “付款成功”改变余额。

## 8. 发布前必须生成

ABI与合约源码、编译器/优化参数/EVM target、依赖锁定信息、部署交易、网络/地址/部署区块、源码验证结果、权限清单、测试与不变量报告、已知风险、旧版退出路径。M0-A 中无任何真实部署地址；官方 token 候选地址也不代表应用合约已部署。
