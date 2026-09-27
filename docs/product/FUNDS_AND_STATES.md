# 资金与状态规则

M0-A v1.0 · 本文件是资金行为的规格，不是已审计合约。

## 1. 全局不变量

| ID | 必须成立的规则 |
| --- | --- |
| F-01 | 每个合约、每种允许资产：实际余额 >= 所有订单保留款 locked + 所有受益人未领取款 credit。意外直接转入的余额只记 surplus，不增加任何订单余额。 |
| F-02 | 每笔已记账入金 = 当前 locked + 当前 credit + 累计已转出；工具内部变更不得创造资金。平台费在本版为 0。 |
| F-03 | 同一份本金只能处于保留、已归属待领取、已转出之一；一次结算只能走退款或受益人分配路径，不能同时执行。 |
| F-04 | 发布后的资产、金额规则、受益人、比例、截止时间、退出规则不可单方改动；变更须另建 Box。 |
| F-05 | 无法从数据库、队列、客户端成功提示或交易哈希字符串授予链上提款权。 |
| F-06 | 所有金额是 uint256 最小单位；精度单独校验。零金额、溢出、超精度输入被拒绝。 |
| F-07 | 不得在存在本版规则约定的退款义务时分配款项；Group 达标不代表现实交付完成。 |
| F-08 | 退款/分账先归属 credit，提款成功才算钱包到账；失败的代币转账不得清零用户权益。 |
| F-09 | 一切资金操作由交易提交时的链上权限、状态和时间再次校验；界面倒计时仅提示。 |
| F-10 | 领取只能发给已绑定受益人。第三方可代触发无权限的结算/领取，但不能更换收款地址。 |
| F-11 | 后台管理员没有提款、修改规则、代客户验收或裁决争议的权力。 |
| F-12 | 已产生的合法退款/credit 不因平台停服、Box 隐藏或入口暂停而失效；代币发行方冻结等外部风险例外必须披露。 |

网络 Gas 不属于上述代币本金等式。直接转入的 surplus 首版不提供管理员清扫，不得用它掩盖订单账务错误。不支持 fee-on-transfer、rebase、回调型未知资产；入金必须验证余额增量与请求额一致。

## 2. 公共数据、时间与操作语义

- Box ID 由 chainId、模块地址、creator、creatorSalt 域隔离推导；相同 salt 不得在同一域重用。客户端 UUID 不是链上身份。
- termsHash = 对版本化关键参数做明确的 ABI 编码后取 keccak256；规则元数据的原始 UTF-8 字节另存 metadataHash。不得重新序列化后误称原哈希。
- 时间以 UTC epoch seconds 和 block.timestamp 为准。允许操作统一使用 `t < deadline`；到期动作统一使用 `t >= deadline`，避免边界重叠。创建时校验所有窗口顺序。
- DRAFT 仅在链下。发布交易未达到网络确认策略时显示 PUBLISHING，不显示已生效。
- 通用资金展示状态：UNFUNDED、LOCKED、CREDITED、PARTIALLY_WITHDRAWN、WITHDRAWN；工具状态独立保存，不用一个万能枚举授权所有操作。
- `credit` 是会计归属而非代币转账；`withdraw` 采用先扣权益再转账、失败全回滚。可提供组合操作，但必须保留分步退出入口。
- 核心操作无后台定时任务依赖。需要链上交易才会改变状态；到期自动显示可操作，不等于后台已经自动转账。

## 3. Group 状态机

### 3.1 发布参数

`asset, unitPrice, minParticipants, capacity, startsAt, fundingDeadline, settleNotBefore, settlementPlan, termsHash`。

满足：unitPrice > 0；2 <= minParticipants <= capacity；capacity 初始上限 200；startsAt < fundingDeadline <= settleNotBefore。结算计划 v1 是单受益人，v2 支持冻结分账方案。地址最多一个生命周期内席位；退出后本版不能再次加入同一 Box，避免历史退款混用。

| 前置状态/时间 | 操作与角色 | 新状态/资金变化 |
| --- | --- | --- |
| OPEN 且 startsAt <= t < fundingDeadline | 参与者 contribute | 转入准确 unitPrice，activeCount +1，增加 locked；满额或曾参加过则拒绝 |
| OPEN 且 t < fundingDeadline | 原参与者 leave | 该份 locked → 参与者 credit，activeCount -1，席位标记 LEFT |
| OPEN 且 t >= fundingDeadline | 任何人 finalize | activeCount < min → REFUNDABLE；否则 READY；不转钱 |
| OPEN/READY 且尚未 SETTLED | creator cancel | CANCELLED，所有仍在保留的参与份额可退；已退出份额不重复入账 |
| REFUNDABLE/CANCELLED | 任何人 creditRefund(participant) | 该参与者尚未处理本金 locked → 原地址 credit，仅一次 |
| READY 且 t >= settleNotBefore | 任何人 settle | 剩余 locked 按固定计划 → 受益人 credit，Box SETTLED |
| 已有 credit | 任何人 withdrawFor(beneficiary) | 转给固定 beneficiary；不能由调用者指定替代地址 |

金额/人数均取截止时有效未退出份额，不是历史累计入金。是否已调用 finalize 不应改变判断，退款/结算入口可先执行内部确定性 finalize。截止前即使达标或满额也保留退出权；截止后不得任意退款。取消与结算竞态以链上先成功交易为准，不能承诺已广播取消必然抢先。

**对外必须说明：**成团成功且到约定时间后即可按规则结算，不等待服务质量判定。付款人若需要验收保护，应使用 Deliver/Milestones；M2 不静默加入未经设计的交付裁决。

## 4. Split 分配规则

方案：2–20 个非零、不重复受益人；每个 bps > 0；总和为 10000；发布后顺序和权重不可变。独立 Split 的付款是最终付款，合约不提供付款人事后强制撤回。

对每笔最小单位总额 T：

1. `base[i] = floor(T * bps[i] / 10000)`，使用安全的全精度乘除。
2. `fraction[i] = (T * bps[i]) mod 10000`。
3. `remainder = T - sum(base)`，满足 0 <= remainder < n。
4. 对余数从高到低、相同余数按发布索引从小到大，向前 remainder 个受益人各分配 1 个最小单位。

保证总和恰等于 T，每方偏离理想份额小于一个最小单位。算法复杂度受 n<=20 限制，不能让任意长收款人列表阻塞结算。UI 预览使用同一整数算法。

独立付款用 `(payer, paymentNonce)` 防重复记账，转账与归属 credit 原子完成。直接 ERC-20 transfer 到合约不算通过工具付款。

Group → Split：在 Group 发布时复制受益人/比例并纳入 termsHash，在 Group settle 中用共享库原子计算和记入 credit。不先把钱打给组织者、不依赖后续服务端调用、不调用用户提供的任意合约、不读取可变分账配置。旧单受益人版本继续可退出。

## 5. Deliver 状态机

角色为固定 buyer/seller，双方不同地址。创建后 AWAITING_FUNDS；仅 buyer 可在 fundBy 前全额存款，开始工作时钟。工作默认 7 天、review 默认 72 小时、dispute 默认 7 天；允许范围为工作 1小时–30天、review 1小时–7天、dispute 1天–30天，测试缩短窗口必须属于明显独立测试部署。

| 状态 | 操作及条件 | 结果 |
| --- | --- | --- |
| AWAITING_FUNDS | buyer fund，t < fundBy | FUNDED；锁定全款；submitDue=t+workDuration |
| AWAITING_FUNDS | 任一方取消或 t>=fundBy | CANCELLED/EXPIRED；无资金 |
| FUNDED | seller submit，t<submitDue，一次 | SUBMITTED；固定证据哈希，reviewDue=t+reviewDuration |
| FUNDED | t>=submitDue 且未提交，任何人 | REFUNDED；locked→buyer credit |
| FUNDED/SUBMITTED/DISPUTED | seller 自愿全额退款，未分配前 | REFUNDED；剩余款→buyer credit |
| SUBMITTED | buyer accept，未异议 | RELEASED；locked→seller credit |
| SUBMITTED | buyer dispute，t<reviewDue | DISPUTED；disputeDue=t+disputeDuration；禁止常规结算 |
| SUBMITTED | 任何人 settle，t>=reviewDue 且未异议 | RELEASED；locked→seller credit |
| DISPUTED | 双方有效签名，t<disputeDue | RESOLVED；全部剩余本金按签名协议分配 |
| DISPUTED | 任何人 timeout，t>=disputeDue | REFUNDED；剩余款→buyer credit |

**强提示：**验收期内不提出异议将允许服务者结算；不是收到任何文件即可立即扣款。买方“请求退款”按钮本身不产生退款权限；进入异议必须实际上链并在期限内确认。不得因后台邮件失败延长/缩短链上窗口。提交后改附件不重置 reviewDue。

## 6. Milestones 状态机

2–10 阶段，所有金额正数；全款一次预存。每阶段使用 Deliver 的 FUNDED→SUBMITTED→ACCEPTED 或 DISPUTED 规则，只允许 currentStage 操作。

- 首阶段工作截止从 funding 确认的链上时间计算；下一阶段从前一阶段实际完成 creditRelease 时启动。
- 任一阶段接受或验收期届满未异议：仅该阶段金额 locked→seller credit，进入下一阶段或 COMPLETED。
- 未交付到期：订单 TERMINATED，全部尚未释放款→buyer credit；已释放款不回滚。
- seller 可退还全部尚未释放款终止；buyer 不得无条件提前取消。
- 任一阶段正式 dispute：整个剩余订单 DISPUTED，停止后续阶段时钟/提交；只支持就全部剩余本金一次性双签分配，或争议超时全部退款。解决后不恢复阶段流程。
- 每阶段的计时参数发布后不改；延时需求首版不支持，应在工作期限内主动协商终止或另建订单。

## 7. Attend 状态机

参数：deposit、capacity<=200、registrationDeadline<=eventStart<eventEnd、checkinStart、checkinDeadline、challengeDeadline、disputeDuration、noShowPenaltyBps、penaltyBeneficiary、checkinSigner。默认 checkinDeadline=eventEnd+15分钟、challengeDeadline=checkinDeadline+24小时；checkinStart 不晚于 eventStart，发布时固定。扣款比例可选 0–10000，付款前显示最坏损失，不隐藏默认值。

每位参加者独立状态 REGISTERED / LEFT / CHECKED_IN / DISPUTED / SETTLED；一地址一份，退出不重进。

| 条件 | 操作 | 资金规则 |
| --- | --- | --- |
| t<registrationDeadline | 参与者报名/退出 | 入金 locked；退出 locked→本人 credit |
| checkinStart<=t<checkinDeadline | 提交固定签到方对本人签发的有效证明 | 本人本金 locked→本人 credit，CHECKED_IN；一次性 nonce 防重放 |
| t<challengeDeadline，尚未取消 | 组织者 cancelEvent | 所有尚未结算押金可退；已有退款不得再次获得 |
| checkinDeadline<=t<challengeDeadline | 未签到本人 challenge | 仅该人的款 DISPUTED，disputeDue=t+disputeDuration |
| t>=challengeDeadline，无签到/申诉且未取消 | 任何人 finalizeNoShow | penalty=floor(deposit*bps/10000)；罚款受益人 credit+=penalty，参与者 credit+=余款 |
| DISPUTED | 组织者同意全退，或双方签名协商 | 剩余本金按协议归属，不影响其他参与者 |
| DISPUTED 且 t>=disputeDue | 任何人 timeout | 全部该人剩余押金→本人 credit |
| CANCELLED | 任何人 creditRefund(participant) | 尚未处理本金全部→本人 credit |

首版不支持离线签到保证；必须提示证明提交成功时间。签到签名证明是组织者陈述，不是客观物理定位。组织者虚假签到/未办活动须由参与者及时申诉；平台不裁决现实事实。未申诉并到期后可能按规则罚没，必须在付款页显著告知。

## 8. Rewards 状态机

- 创建并入金原子执行：地址严格唯一、金额>0、名单长度1–100、链上累加总额与实际入金一致。名单及金额公开，未确定总额的奖励不允许发布。
- ACTIVE：claimStart<=t<claimDeadline，任何人可 claimFor(recipient)，只给名单中的原地址创建 credit；每个地址一次。
- claimDeadline 到达后拒绝新 claim；原创建者可回收全部尚未领取资格对应的 locked，回收也是先进入 creator credit。
- 已经 claim 成 credit 的款不算过期余额，即使受益人还没 withdraw，也不能被创建者回收。
- 生效后不允许取消、编辑名单或提前回收。首版不使用普通 Merkle root 宣称已证明总额充足；大名单扩展需单独规格和 Gas 评估。

## 9. 双方协商协议

用于 Deliver、Milestones、Attend 的争议：EIP-712 消息至少包含 chainId、verifyingContract、schemaVersion、boxId、orderId、termsHash、asset、当前剩余金额、两个原受益地址及分配金额、settlementNonce、deadline。两个金额之和必须恰等于当前剩余本金，签名期限不得超过 disputeDue。

仅在仍 DISPUTED 且 t<deadline、t<disputeDue 时可执行。双方签名各自验证、nonce 消费一次；任何状态改变或已结算使旧协议失效。协议不能将钱导向未约定第三方。EIP-1271 支持需 M0-C 验证，不支持的钱包在界面禁止此功能，而非错误接受。[S12](../planning/SOURCES_AND_PROVENANCE.md)

## 10. 权限矩阵

| 操作 | 创建者 | 付款者/参加者 | 受益人 | 后台/任意人 |
| --- | --- | --- | --- | --- |
| 草稿编辑 | 自己 | 否 | 否 | 后台仅按认证请求 |
| 已发布关键参数修改 | 否 | 否 | 否 | 否 |
| 入金 | 依工具角色 | 本人 | 依工具角色 | 不代扣 |
| Group 取消/Attend取消 | 限定窗口内 | 否 | 否 | 否 |
| 交付确认/异议 | 非固定买方则否 | 固定买方 | 非固定买方则否 | 否 |
| 到期 finalize | 是 | 是 | 是 | 任何人可触发，规则固定 |
| 双签争议分配 | 需双方签名 | 需双方签名 | 需双方签名 | 可代提交有效双签 |
| withdrawFor | 可代触发 | 可代触发 | 可自领 | 只能付给已绑定地址 |
| 扫走未领取款 | 否 | 否 | 否 | 否；Rewards仅有已披露的到期剩余款回收 |

## 11. 失败、停服与人工处理

钱包拒签：无入金；approve 成功但 pay 失败：保留授权状态提示，不显示已付款；超时查不到回执：保持待确认，不盲目再次付款；revert：显示明确原因和重试条件。网络重组按事件投影规范回滚展示，不倒改已确认权限。账号冻结只能隐藏平台内容，不能阻止合约允许的退出。

救助入口须提供 chainId、合约、原 orderId、原规则快照和只作用于本人/固定受益人的调用说明。私钥丢失、代币冻结、合约漏洞并无后台万能恢复能力。
