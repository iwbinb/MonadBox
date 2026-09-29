import { CheckInPanel } from './CheckInPanel';
import { attendanceDates } from '../../shared/modules/attendance-fields';
import { addressSchema } from '../../shared/cloud/model';
import { AgreementPanel } from './AgreementPanel';
import { PendingRecovery } from './PendingRecovery';
import type { PendingCheck } from './PendingRecovery';
import { recheckPendingTransaction } from './pending-recovery';
import { RecoveryHistory } from '../shared/RecoveryHistory';
import { statusLabel } from '../shared/status';
import { pendingTransactions } from '../shared/transaction-storage';
import type { PendingTransaction } from '../shared/transaction-storage';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatUnits, keccak256, stringToHex } from 'viem';
import type { Address, Hex } from 'viem';
import { useApp } from '../context';
import { useFundsWallet, WalletChoice } from '../shared/FundsWallet';
import { userError } from '../../shared/wallet';
import { makeClient } from '../../shared/network';
import { parseAmount } from '../../shared/amount';
import type { ModuleAction, ModuleIntent, ModulePublication } from '../../shared/modules/model';
import { moduleActions, moduleSnapshot, prepareModuleAction } from '../../shared/modules/chain';
import type { ModuleActionOptions, ModuleSnapshot } from '../../shared/modules/chain';
import { journalKey, readRecords, recheckModule, sendModuleAction } from './journal';
import type { TransactionRecord } from './journal';
export const actionLabels: Record<ModuleAction, [string, string]> = {
  claimFor: ['Claim my reward credit', '领取我的奖励权益'],
  reclaimExpired: ['Reclaim unclaimed rewards', '回收未领取奖励'],
  register: ['Register with deposit', '支付押金报名'],
  checkIn: ['Submit check-in proof', '提交签到证明'],
  cancelEvent: ['Cancel event', '取消活动'],
  challengeNoShow: ['Appeal missing check-in', '申诉未签到'],
  finalizeNoShow: ['Finalize no-show deduction', '结算缺席扣款'],
  refundDispute: ['Refund disputed participant', '退还申诉人押金'],
  create: ['Publish fixed rules', '发布固定规则'],
  fund: ['Pay full escrow', '全额付款至托管'],
  cancelOffer: ['Cancel unfunded offer', '取消未付款订单'],
  submitDelivery: ['Submit delivery proof', '提交交付证明'],
  accept: ['Accept and release payment', '验收并放款'],
  dispute: ['Open formal dispute', '发起正式争议'],
  refundBySeller: ['Refund all remaining funds', '退还全部剩余款'],
  settleAfterReview: ['Settle after review deadline', '验收期结束结算'],
  refundAfterMissingDelivery: ['Refund missing delivery', '未交付到期退款'],
  resolveByAgreement: ['Submit bilateral agreement', '提交双方结算协议'],
  refundAfterDisputeTimeout: ['Refund after dispute timeout', '争议到期退款'],
  approve: ['Approve exact amount', '授权准确额度'],
  pay: ['Make final payment', '完成最终付款'],
  contribute: ['Pay and join', '付款参与'],
  leave: ['Exit to refundable credit', '退出并记入可退款余额'],
  finalize: ['Finalize group result', '确认成团结果'],
  cancel: ['Cancel group', '取消成团'],
  creditRefund: ['Claim refund credit', '领取退款权益'],
  settle: ['Settle frozen split', '按固定方案结算'],
  withdrawFor: ['Withdraw to my wallet', '提款到我的钱包'],
};
export function moduleActionLabels(
  action: ModuleAction,
  tool: ModulePublication['data']['tool'],
): [string, string] {
  return action === 'create' && tool === 'rewards'
    ? ['Publish and fund full reward list', '发布并全额入金奖励名单']
    : actionLabels[action];
}
export function moduleError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    RECHECK_REQUIRED:
      'Recheck the earlier transaction before sending another. / 请先核验上一笔交易。',
    JOURNAL_UNAVAILABLE:
      'Recovery records are damaged and have been retained. Do not resend. / 恢复记录损坏，原数据已保留，请勿重发。',
    JOURNAL_FULL:
      'Export the 200 saved records. Use the original public link in a fresh browser to read your funds. / 请导出200条已存记录，新浏览器可凭原公开链接读取资金。',
    ACTION_CHANGED:
      'Time or nonce changed. Review a fresh action before signing. / 时间或交易序号变化，请重新准备并核对。',
    ACTION_UNAVAILABLE:
      'This action is not allowed by the current contract state. Refresh your rights. / 当前合约状态不允许，请刷新权益。',
    EOA_REQUIRED:
      'This version supports ordinary external wallets only. / 当前版本仅支持普通外部钱包。',
    UNVERIFIED_CONTRACT:
      'Contract identity could not be verified. Signing is blocked. / 合约身份无法核验，已禁止签名。',
    INTEGRITY_ERROR:
      'Rules do not match their original hash. Signing is blocked. / 规则与原哈希不符，已禁止签名。',
    FINALITY_UNAVAILABLE:
      'The RPC has not confirmed a stable state. Recheck later. / 节点尚未确认稳定状态，请稍后核验。',
    TRANSACTION_MISMATCH:
      'This hash does not match the earlier transaction. Check it and try again. / 交易哈希与上一笔操作不符，请核对后重试。',
  };
  return messages[code] ?? userError(error);
}
export function TransactionHistory({
  rows,
  busy,
  onRecheck,
}: {
  rows: TransactionRecord[];
  busy: boolean;
  onRecheck: (row: TransactionRecord, hash?: Hex) => void;
}) {
  const { t } = useApp();
  return (
    <RecoveryHistory
      rows={rows}
      busy={busy}
      recheck={onRecheck}
      describe={(r) => ({
        id: r.intent.id,
        label: t(...moduleActionLabels(r.intent.action, r.intent.publication.data.tool)),
        title: r.intent.publication.data.title,
        href: '/box/' + r.intent.publication.publicId,
        state: r.state,
        ...(r.hash ? { hash: r.hash } : {}),
      })}
    />
  );
}
export function ModuleFunds({
  publication,
  creation,
  paymentsEnabled,
  onCreationChecked,
  onSnapshot,
}: {
  publication: ModulePublication;
  creation?: ModuleIntent;
  paymentsEnabled: boolean;
  onCreationChecked?: (hash?: Hex) => Promise<void>;
  onSnapshot?: (snapshot: ModuleSnapshot) => void;
}) {
  const { state, t } = useApp(),
    wallet = useFundsWallet(),
    epoch = useRef(0);
  const environment = state.status === 'ready' ? state.config.environment : '';
  const [snapshot, setSnapshot] = useState<ModuleSnapshot | null>(null),
    [prepared, setPrepared] = useState<ModuleIntent | null>(null),
    [ack, setAck] = useState(false);
  const [amount, setAmount] = useState(publication.data.tool === 'split' ? '' : '1'),
    [rows, setRows] = useState<TransactionRecord[]>([]),
    [pending, setPending] = useState<PendingTransaction[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [evidence, setEvidence] = useState(''),
    [options, setOptions] = useState<ModuleActionOptions>({});
  const [participant, setParticipant] = useState<Address | undefined>(),
    [participantInput, setParticipantInput] = useState('');
  const renderEpoch = epoch.current;
  useEffect(() => {
    setAmount(publication.data.tool === 'split' ? '' : '1');
  }, [publication.id, publication.data.tool]);
  useEffect(() => {
    if (snapshot) onSnapshot?.(snapshot);
  }, [snapshot, onSnapshot]);
  useEffect(() => {
    setParticipant(undefined);
    setParticipantInput('');
  }, [wallet.actor, publication]);
  useEffect(() => {
    const version = ++epoch.current;
    setSnapshot(null);
    setEvidence('');
    setOptions({});
    setPrepared(null);
    setAck(false);
    setRows([]);
    setPending([]);
    setNotice('');
    setError('');
    if (!wallet.actor) return;
    try {
      setRows(readRecords(localStorage, journalKey(environment, wallet.actor)));
      setPending(pendingTransactions(localStorage, environment, wallet.actor));
    } catch (e) {
      setError(moduleError(e));
    }
    if (!creation)
      void moduleSnapshot(makeClient(), publication, wallet.actor, participant)
        .then((s) => {
          if (epoch.current === version) setSnapshot(s);
        })
        .catch((e) => {
          if (epoch.current === version) setError(moduleError(e));
        });
    return () => {
      epoch.current = version + 1;
    };
  }, [wallet.actor, environment, publication, creation, participant]);
  useEffect(() => {
    if (!wallet.actor) return;
    const actor = wallet.actor;
    const update = () => {
      try {
        const next = pendingTransactions(localStorage, environment, actor);
        setPending(next);
        if (next.length) {
          setPrepared(null);
          setAck(false);
        }
      } catch (e) {
        setError(moduleError(e));
      }
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, [wallet.actor, environment]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(moduleError(e));
    } finally {
      if (wallet.actor)
        try {
          setPending(pendingTransactions(localStorage, environment, wallet.actor));
        } catch (e) {
          setError(moduleError(e));
        }
      setBusy(false);
    }
  }
  async function refresh() {
    const actor = wallet.actor,
      version = epoch.current;
    if (!actor) return;
    const s = await moduleSnapshot(makeClient(), publication, actor, participant);
    if (epoch.current !== version) return;
    setSnapshot(s);
    setOptions({});
    setPrepared(null);
    setAck(false);
    setRows(readRecords(localStorage, journalKey(environment, actor)));
    setPending(pendingTransactions(localStorage, environment, actor));
  }
  let value: string | undefined;
  try {
    value = parseAmount(amount, 18).toString();
  } catch {
    /* Keep amount invalid until corrected. */
  }
  const actions: ModuleAction[] =
    creation && wallet.actor?.toLowerCase() === creation.actor.toLowerCase()
      ? [creation.action]
      : snapshot && wallet.actor
        ? moduleActions(publication, wallet.actor, snapshot, value)
        : [];
  const unresolved = pending.length > 0;
  const isSplitPayment = publication.data.tool === 'split' && !creation;
  const requiresPayment = (action: ModuleAction) =>
    ['approve', 'pay', 'contribute', 'fund', 'register'].includes(action) ||
    (action === 'create' && publication.data.tool === 'rewards');
  async function check(row: TransactionRecord, hash?: Hex) {
    const version = epoch.current,
      result = await recheckModule(environment, row, hash);
    if (creation?.id === row.intent.id && onCreationChecked)
      await onCreationChecked(result.result.hash);
    if (epoch.current !== version) return;
    setRows(result.records);
    if (wallet.actor) setPending(pendingTransactions(localStorage, environment, wallet.actor));
    setNotice(
      t(
        `Latest lookup: ${result.result.state}. Previous evidence is retained when unknown.`,
        `本次核验：${result.result.state}。未知响应保留此前证据。`,
      ),
    );
    if (!creation) await refresh();
  }
  async function recoverPending(checks: PendingCheck[]) {
    const actor = wallet.actor;
    if (!actor) return;
    await run(async () => {
      const version = epoch.current;
      let firstError: unknown;
      for (const { entry, hash } of checks) {
        try {
          const result = await recheckPendingTransaction(environment, actor, entry, hash);
          if (creation?.id === entry.id && onCreationChecked) await onCreationChecked(result.hash);
        } catch (e) {
          firstError ??= e;
        }
      }
      if (epoch.current !== version) return;
      if (!creation) await refresh();
      else {
        setRows(readRecords(localStorage, journalKey(environment, actor)));
        setPending(pendingTransactions(localStorage, environment, actor));
      }
      const remaining = pendingTransactions(localStorage, environment, actor);
      setNotice(
        remaining.length
          ? t(
              'Still pending. Check again after the network confirms it.',
              '交易尚未确认，请稍后在这里再核验。',
            )
          : t('Checked. You can continue here.', '已核验，可以在这里继续。'),
      );
      if (firstError) throw firstError;
    });
  }
  return (
    <>
      <section
        className={'cloud-card funds-panel' + (isSplitPayment ? ' split-payment-panel' : '')}
      >
        <h2>
          {isSplitPayment
            ? t('Pay with MON', '支付 MON')
            : creation && publication.data.tool === 'split'
              ? t('Publish with wallet', '钱包发布')
              : t('My funds and actions', '我的资金与操作')}
        </h2>
        <WalletChoice
          value={wallet}
          busy={busy}
          connect={() =>
            void run(async () => {
              await wallet.connect();
            })
          }
        />
        {!creation && !unresolved && publication.data.tool === 'attend' ? (
          <div>
            <label>
              {t('Participant wallet to inspect', '要查询的参加者钱包')}
              <input
                value={participantInput}
                placeholder={wallet.actor ?? '0x…'}
                onChange={(e) => {
                  setParticipantInput(e.target.value);
                  setPrepared(null);
                  setAck(false);
                }}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || !wallet.actor}
              onClick={() => {
                const parsed = addressSchema.safeParse(participantInput || wallet.actor);
                if (!parsed.success) {
                  setError(t('Enter a valid participant wallet.', '请输入有效的参加者地址。'));
                  return;
                }
                setParticipant(parsed.data);
                setPrepared(null);
                setAck(false);
              }}
            >
              {t('Inspect participant', '查询此参加者')}
            </button>
            <p>
              {t(
                'Credit and withdrawals always belong to your connected wallet. Participant state below may refer to the address you selected.',
                '可领取及已提款金额始终属于当前连接钱包。下方报名状态对应你选择的参加者地址。',
              )}
            </p>
          </div>
        ) : null}
        {snapshot && !isSplitPayment && !unresolved ? (
          <>
            <p>
              {t('Contract state', '合约状态')}：{statusLabel(snapshot.state, t)}
            </p>
            <p>
              {t('Withdrawable credit', '可领取余额')}：{formatUnits(BigInt(snapshot.credit), 18)}{' '}
              MON
            </p>
            <p>
              {t('Already transferred to wallet', '已转入钱包')}：
              {formatUnits(BigInt(snapshot.withdrawn), 18)} MON
            </p>
            <details className="verification-note">
              <summary>{t('Chain verification', '链上核验')}</summary>
              <p>
                {t('Snapshot block', '快照区块')}：{snapshot.block}
              </p>
            </details>
            <button className="button secondary" disabled={busy} onClick={() => void run(refresh)}>
              {t('Read my rights', '读取我的权益')}
            </button>
          </>
        ) : null}
        {snapshot &&
        !unresolved &&
        isSplitPayment &&
        (BigInt(snapshot.credit) > 0n || BigInt(snapshot.withdrawn) > 0n) ? (
          <details className="split-balance-details">
            <summary>
              {t('My withdrawable credit', '我的可领取余额')}：
              {formatUnits(BigInt(snapshot.credit), 18)} MON
            </summary>
            <p>
              {t('Contract state', '合约状态')}：{statusLabel(snapshot.state, t)}
            </p>
            <p>
              {t('Already transferred to wallet', '已转入钱包')}：
              {formatUnits(BigInt(snapshot.withdrawn), 18)} MON
            </p>
            <button className="button secondary" disabled={busy} onClick={() => void run(refresh)}>
              {t('Refresh balance', '刷新余额')}
            </button>
          </details>
        ) : null}
        {snapshot &&
        !unresolved &&
        (publication.data.tool === 'deliver' || publication.data.tool === 'milestones') ? (
          <>
            <p>
              {t('Remaining escrow', '剩余托管款')}：{formatUnits(BigInt(snapshot.locked), 18)} MON
            </p>
            {publication.data.tool === 'milestones' ? (
              <>
                <p>
                  {t('Current stage', '当前阶段')}：{(snapshot.currentStage ?? 0) + 1} /{' '}
                  {publication.data.stages.length}
                </p>
                <p>
                  {t('Released stages total', '已释放阶段总额')}：
                  {formatUnits(BigInt(snapshot.released ?? '0'), 18)} MON
                </p>
                <ol className="cloud-list">
                  {publication.data.stages.map((stage, index) => (
                    <li key={index}>
                      {index + 1}. {stage.title} · {formatUnits(BigInt(stage.amount), 18)} MON ·{' '}
                      {index < (snapshot.currentStage ?? 0) || snapshot.state === 'COMPLETED'
                        ? t('Released', '已释放')
                        : index === snapshot.currentStage
                          ? statusLabel(snapshot.state, t)
                          : ['TERMINATED', 'RESOLVED', 'CANCELLED', 'EXPIRED'].includes(
                                snapshot.state,
                              )
                            ? t('Ended with remaining plan', '随剩余计划终止')
                            : t('Waiting for earlier stages', '等待前序阶段')}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            {(['submitDue', 'reviewDue', 'disputeDue'] as const)
              .filter((key) => snapshot[key])
              .map((key) => (
                <p key={key}>
                  {key === 'submitDue'
                    ? t('Delivery deadline', '交付截止')
                    : key === 'reviewDue'
                      ? t('Review deadline', '验收截止')
                      : t('Dispute deadline', '争议截止')}
                  ：{new Date(snapshot[key]! * 1000).toLocaleString()} ·{' '}
                  {Math.max(0, Math.ceil((snapshot[key]! - snapshot.timestamp) / 60))}{' '}
                  {t('minutes at snapshot', '分钟（快照时）')}
                </p>
              ))}
            {snapshot.evidenceHash && !/^0x0+$/.test(snapshot.evidenceHash) ? (
              <details className="verification-note">
                <summary>{t('Delivery digest', '交付摘要')}</summary>
                <code>{snapshot.evidenceHash}</code>
              </details>
            ) : null}
            {snapshot.reasonHash && !/^0x0+$/.test(snapshot.reasonHash) ? (
              <details className="verification-note">
                <summary>{t('Dispute digest', '争议摘要')}</summary>
                <code>{snapshot.reasonHash}</code>
              </details>
            ) : null}
            {actions.some((a) => ['submitDelivery', 'dispute', 'challengeNoShow'].includes(a)) ? (
              <label>
                {t('Delivery or dispute evidence (temporary text)', '交付或争议证据（临时文本）')}
                <textarea
                  aria-label={t(
                    'Delivery or dispute evidence (temporary text)',
                    '交付或争议证据（临时文本）',
                  )}
                  maxLength={16000}
                  value={evidence}
                  onChange={(e) => {
                    setEvidence(e.target.value);
                    setPrepared(null);
                    setAck(false);
                  }}
                />
                <small>
                  {t(
                    'Only its digest is put on-chain. Share and retain the original evidence privately; this text is not saved. A digest does not prove quality.',
                    '仅摘要上链。请私下共享并保存原始证据，此文本不会保存。摘要不证明交付质量。',
                  )}
                </small>
              </label>
            ) : null}
            {snapshot.state === 'DISPUTED' &&
            snapshot.timestamp < snapshot.disputeDue! &&
            wallet.actor &&
            wallet.wallet ? (
              <AgreementPanel
                key={`${wallet.actor}:${snapshot.block}`}
                publication={publication}
                snapshot={snapshot}
                actor={wallet.actor}
                provider={wallet.wallet.provider}
                onChange={(o) => {
                  if (epoch.current !== renderEpoch) return;
                  setOptions(o);
                  setPrepared(null);
                  setAck(false);
                }}
              />
            ) : null}
          </>
        ) : null}
        {snapshot && !unresolved && publication.data.tool === 'rewards' ? (
          <>
            <p>
              {t('My listed reward', '名单中我的奖励')}：
              {formatUnits(BigInt(snapshot.allocation ?? '0'), 18)} MON ·{' '}
              {snapshot.position === 2
                ? t('Already claimed', '已领取权益')
                : snapshot.position === 1
                  ? t('Not claimed', '尚未领取')
                  : t('Not on this list', '不在此名单')}
            </p>
            <p>
              {t('Unclaimed total', '尚未领取总额')}：{formatUnits(BigInt(snapshot.locked), 18)} MON
              · {t('Claims completed', '已领取人数')}：{snapshot.claimedCount}/
              {publication.data.recipients.length}
            </p>
            <p>
              {t('Claim deadline', '领取截止')}：
              {new Date(publication.data.claimDeadline * 1000).toLocaleString()}
            </p>
            <p>
              {t(
                'Expired reclaim excludes all credit already assigned to recipients. Withdraw credit separately.',
                '到期回收不包含已归入受益人可领取余额的钱。领取权益后仍须单独提款。',
              )}
            </p>
          </>
        ) : null}
        {snapshot && !unresolved && publication.data.tool === 'attend' ? (
          <>
            <p>
              {t('Selected participant', '已选择参加者')}：<code>{snapshot.participant}</code> ·{' '}
              {statusLabel(snapshot.positionState ?? 'NONE', t)}
            </p>
            <p>
              {t('This participant’s pending deposit', '此参加者尚未结算押金')}：
              {formatUnits(BigInt(snapshot.positionLocked ?? '0'), 18)} MON ·{' '}
              {t('Registered / capacity', '已报名 / 上限')}：{snapshot.activeCount}/
              {publication.data.capacity}
            </p>
            {attendanceDates
              .filter(([key]) =>
                ['registrationDeadline', 'checkinDeadline', 'challengeDeadline'].includes(key),
              )
              .map(([key, en, zh]) => (
                <p key={key}>
                  {t(en, zh)}：
                  {new Date(
                    publication.data.tool === 'attend' ? publication.data[key] * 1000 : 0,
                  ).toLocaleString()}
                </p>
              ))}
            {snapshot.disputeDue ? (
              <p>
                {t('Individual dispute deadline', '个人争议截止')}：
                {new Date(snapshot.disputeDue * 1000).toLocaleString()}
              </p>
            ) : null}
            {actions.includes('challengeNoShow') ? (
              <label>
                {t('Appeal evidence (temporary text)', '申诉证据（临时文本）')}
                <textarea
                  aria-label={t('Appeal evidence (temporary text)', '申诉证据（临时文本）')}
                  maxLength={16000}
                  value={evidence}
                  onChange={(e) => {
                    setEvidence(e.target.value);
                    setPrepared(null);
                    setAck(false);
                  }}
                />
                <small>
                  {t(
                    'Only its digest is public on-chain. Keep the original evidence privately.',
                    '仅摘要在链上公开，请私下保留原始证据。',
                  )}
                </small>
              </label>
            ) : null}
            {actions.includes('checkIn') && wallet.actor && wallet.wallet ? (
              <CheckInPanel
                key={`${wallet.actor}:${snapshot.participant}:${snapshot.block}`}
                publication={publication}
                snapshot={snapshot}
                actor={wallet.actor}
                provider={wallet.wallet.provider}
                onChange={(o) => {
                  if (epoch.current !== renderEpoch) return;
                  setOptions(o);
                  setPrepared(null);
                  setAck(false);
                }}
              />
            ) : null}
            {actions.includes('resolveByAgreement') && wallet.actor && wallet.wallet ? (
              <AgreementPanel
                key={`${wallet.actor}:${snapshot.participant}:${snapshot.block}`}
                publication={publication}
                snapshot={snapshot}
                actor={wallet.actor}
                provider={wallet.wallet.provider}
                onChange={(o) => {
                  if (epoch.current !== renderEpoch) return;
                  setOptions(o);
                  setPrepared(null);
                  setAck(false);
                }}
              />
            ) : null}
          </>
        ) : null}
        {!creation && publication.data.tool === 'split' && !unresolved ? (
          <div className="split-amount-field">
            <label>
              {t('Final payment (MON)', '最终付款金额（MON）')}
              <input
                inputMode="decimal"
                placeholder={t('Enter the amount to pay', '输入本次实际付款金额')}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setPrepared(null);
                  setAck(false);
                }}
              />
            </label>
          </div>
        ) : null}
        {!isSplitPayment && !creation && !unresolved ? (
          <p>
            {t(
              'Pay directly in MON. Claimable credit needs a withdrawal to your wallet. Review each transaction before confirming.',
              '直接使用 MON 付款，可领取款需单独提到钱包。确认前请核对每笔交易。',
            )}
          </p>
        ) : null}
        {!paymentsEnabled && !unresolved ? (
          <p className="notice">
            {t(
              'New payments are disabled; verified exits remain available.',
              '新付款未开放，已核验的退出权益仍可操作。',
            )}
          </p>
        ) : null}
        {unresolved ? (
          <PendingRecovery
            entries={pending}
            busy={busy}
            onCheck={(checks) => void recoverPending(checks)}
          />
        ) : null}
        {!unresolved
          ? actions.map((action) => {
              const button = (
                <button
                  key={action}
                  className={
                    'button action-button ' +
                    ([
                      'pay',
                      'fund',
                      'contribute',
                      'register',
                      'accept',
                      'withdrawFor',
                      'claimFor',
                      'submitDelivery',
                      'create',
                    ].includes(action)
                      ? 'primary'
                      : 'secondary')
                  }
                  disabled={
                    busy ||
                    unresolved ||
                    (!paymentsEnabled && requiresPayment(action)) ||
                    (['submitDelivery', 'dispute', 'challengeNoShow'].includes(action) &&
                      !evidence.trim()) ||
                    (action === 'resolveByAgreement' &&
                      (!options.signatures?.first || !options.signatures.second)) ||
                    (action === 'checkIn' && !options.signatures?.checkIn)
                  }
                  onClick={() =>
                    void run(async () => {
                      setPrepared(null);
                      setAck(false);
                      const version = epoch.current;
                      const intent =
                        creation && action === creation.action
                          ? creation!
                          : await prepareModuleAction(
                              makeClient(),
                              publication,
                              wallet.actor!,
                              action,
                              value,
                              {
                                ...options,
                                ...(publication.data.tool === 'milestones' &&
                                snapshot?.currentStage !== undefined
                                  ? { stageIndex: snapshot.currentStage }
                                  : {}),
                                ...(publication.data.tool === 'attend'
                                  ? { participant: snapshot?.participant ?? wallet.actor! }
                                  : {}),
                                ...(evidence.trim()
                                  ? { evidenceHash: keccak256(stringToHex(evidence)) }
                                  : {}),
                              },
                            );
                      if (epoch.current === version) setPrepared(intent);
                    })
                  }
                >
                  {isSplitPayment && action === 'pay' ? (
                    t('Review payment', '核对付款')
                  ) : creation && publication.data.tool === 'split' && action === 'create' ? (
                    t('Review publication', '核对发布')
                  ) : (
                    <>
                      {t('Prepare: ', '准备：')}
                      {t(...moduleActionLabels(action, publication.data.tool))}
                    </>
                  )}
                </button>
              );
              return isSplitPayment && action === 'withdrawFor' ? (
                <details className="split-withdraw" key={action}>
                  <summary>{t('Withdraw my credit', '提取我的可领取余额')}</summary>
                  {button}
                </details>
              ) : (
                button
              );
            })
          : null}
        {prepared && !unresolved ? (
          <div className="checkout-review">
            <h3>{t(...moduleActionLabels(prepared.action, publication.data.tool))}</h3>
            {publication.data.tool === 'split' ? (
              <details className="verification-note">
                <summary>{t('Contract and transaction details', '合约与交易详情')}</summary>
                <p>
                  Monad Testnet · MON · <code>{prepared.publication.deployment.address}</code>
                </p>
                <p>nonce {prepared.nonce}</p>
              </details>
            ) : (
              <p>
                Monad Testnet · MON · <code>{prepared.publication.deployment.address}</code>
              </p>
            )}
            <p>
              {t('Signing wallet', '签名钱包')}：<code>{prepared.actor}</code>
              {publication.data.tool !== 'split' ? ` · nonce ${prepared.nonce}` : null}
            </p>
            {publication.data.tool === 'milestones' && prepared.stageIndex !== undefined ? (
              <p>
                {t('Stage for this action', '本次操作阶段')}：{prepared.stageIndex + 1}
              </p>
            ) : null}
            {prepared.participant ? (
              <p>
                {t('Participant for this action', '本次操作的参加者')}：
                <code>{prepared.participant}</code>
              </p>
            ) : null}
            {prepared.amount ? (
              <p>
                {t('Amount', '金额')}：{formatUnits(BigInt(prepared.amount), 18)} MON
              </p>
            ) : null}
            {publication.data.tool !== 'split' ? (
              <p>
                {t(
                  'Recipients and rules are shown above and cannot be changed by this action.',
                  '本次操作遵循上方固定收款人和规则。',
                )}
              </p>
            ) : null}
            {isSplitPayment && prepared.action === 'pay' ? (
              <p className="notice public-payment-rule">
                {t(
                  'This is a final payment. You cannot force a refund after signing.',
                  '这是最终付款；签署后不能强制追回。',
                )}
              </p>
            ) : null}
            <label className="cloud-check">
              <input
                type="checkbox"
                disabled={busy}
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              {t(
                'I have reviewed this action and its fixed recipients.',
                '我已核对本次动作及固定收款地址。',
              )}
            </label>
            <button
              className="button primary"
              disabled={
                busy ||
                !ack ||
                !wallet.wallet ||
                !wallet.actor ||
                (!paymentsEnabled && requiresPayment(prepared.action))
              }
              onClick={() =>
                void run(async () => {
                  const current = epoch.current;
                  const intent = prepared;
                  if (!paymentsEnabled && requiresPayment(intent.action))
                    throw Error('ACTION_UNAVAILABLE');
                  let hash: Hex;
                  try {
                    hash = await sendModuleAction(
                      wallet.wallet!.provider,
                      environment,
                      intent,
                      options.signatures,
                    );
                  } finally {
                    if (current === epoch.current) {
                      setPrepared(null);
                      setAck(false);
                      setOptions({});
                      setRows(readRecords(localStorage, journalKey(environment, intent.actor)));
                    }
                  }
                  if (current !== epoch.current) return;
                  setPrepared(null);
                  setAck(false);
                  const next = readRecords(localStorage, journalKey(environment, intent.actor));
                  setRows(next);
                  const row = next.find((r) => r.intent.id === intent.id);
                  if (row) await check(row, hash);
                })
              }
            >
              {isSplitPayment && prepared.action === 'pay'
                ? t('Confirm in wallet', '在钱包中确认付款')
                : creation && publication.data.tool === 'split'
                  ? t('Confirm publication in wallet', '在钱包中确认发布')
                  : t('Sign this action', '签署本次操作')}
            </button>
          </div>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </section>
      {!unresolved && rows.some((r) => r.intent.publication.publicId === publication.publicId) ? (
        isSplitPayment && !unresolved ? (
          <details className="cloud-card split-history">
            <summary>{t('Transaction history', '交易记录')}</summary>
            <TransactionHistory
              rows={rows.filter((r) => r.intent.publication.publicId === publication.publicId)}
              busy={busy}
              onRecheck={(row, hash) => void run(() => check(row, hash))}
            />
          </details>
        ) : (
          <TransactionHistory
            rows={rows.filter((r) => r.intent.publication.publicId === publication.publicId)}
            busy={busy}
            onRecheck={(row, hash) => void run(() => check(row, hash))}
          />
        )
      ) : null}
    </>
  );
}
export function ModuleActivityPage() {
  const { state, t } = useApp(),
    wallet = useFundsWallet();
  const environment = state.status === 'ready' ? state.config.environment : '';
  const [rows, setRows] = useState<TransactionRecord[]>([]),
    [pending, setPending] = useState<PendingTransaction[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    try {
      setRows(wallet.actor ? readRecords(localStorage, journalKey(environment, wallet.actor)) : []);
      setPending(wallet.actor ? pendingTransactions(localStorage, environment, wallet.actor) : []);
    } catch (e) {
      setError(moduleError(e));
    }
  }, [wallet.actor, environment]);
  async function checkPending(checks: PendingCheck[]) {
    if (!wallet.actor) return;
    const actor = wallet.actor;
    setBusy(true);
    setError('');
    setNotice('');
    let firstError: unknown;
    try {
      for (const { entry, hash } of checks)
        try {
          await recheckPendingTransaction(environment, actor, entry, hash);
        } catch (e) {
          firstError ??= e;
        }
      setRows(readRecords(localStorage, journalKey(environment, actor)));
      const next = pendingTransactions(localStorage, environment, actor);
      setPending(next);
      setNotice(
        next.length
          ? t(
              'Still pending. Check again after the network confirms it.',
              '交易尚未确认，请稍后再核验。',
            )
          : t('Checked. You can continue with your Box.', '已核验，可以返回 Box 继续。'),
      );
      if (firstError) throw firstError;
    } catch (e) {
      setError(moduleError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="container cloud-page">
      <h1>{t('Funds workbench', '资金工作台')}</h1>
      <div className="cloud-card">
        <WalletChoice
          value={wallet}
          busy={busy}
          connect={() => {
            setBusy(true);
            void wallet
              .connect()
              .catch((e) => setError(moduleError(e)))
              .finally(() => setBusy(false));
          }}
        />
        <Link to="/app/modules">{t('My cloud boxes', '我的云端 Box')}</Link>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <PendingRecovery
        entries={pending}
        busy={busy}
        onCheck={(checks) => void checkPending(checks)}
      />
      {notice ? <p role="status">{notice}</p> : null}
      {rows.length && !pending.length ? (
        <details className="cloud-card split-history">
          <summary>{t('Transaction history', '交易记录')}</summary>
          <TransactionHistory
            rows={rows}
            busy={busy}
            onRecheck={(row, hash) => {
              setBusy(true);
              setError('');
              void recheckModule(environment, row, hash)
                .then((r) => {
                  setRows(r.records);
                  if (wallet.actor)
                    setPending(pendingTransactions(localStorage, environment, wallet.actor));
                })
                .catch((e) => setError(moduleError(e)))
                .finally(() => setBusy(false));
            }}
          />
        </details>
      ) : null}
    </section>
  );
}
