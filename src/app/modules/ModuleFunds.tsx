import { CheckInPanel } from './CheckInPanel';
import { attendanceDates } from './AttendanceEditor';
import { addressSchema } from '../../shared/cloud/model';
import { AgreementPanel } from './AgreementPanel';
import { RecoveryHistory } from '../shared/RecoveryHistory';
import { statusLabel } from '../shared/status';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatUnits, keccak256, stringToHex } from 'viem';
import type { Address, Hex } from 'viem';
import { useApp } from '../context';
import { useFundsWallet, WalletChoice } from '../shared/FundsWallet';
import { userError } from '../../shared/lab/wallet';
import { makeClient } from '../../shared/lab/network';
import { parseAmount } from '../../shared/amount';
import type { ModuleAction, ModuleIntent, ModulePublication } from '../../shared/modules/model';
import { moduleActions, moduleSnapshot, prepareModuleAction } from '../../shared/modules/chain';
import type { ModuleActionOptions, ModuleSnapshot } from '../../shared/modules/chain';
import { journalKey, readRecords, recheckModule, sendModuleAction, terminal } from './journal';
import type { TransactionRecord } from './journal';
export const actionLabels: Record<ModuleAction, [string, string]> = {
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
        label: t(...actionLabels[r.intent.action]),
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
}: {
  publication: ModulePublication;
  creation?: ModuleIntent;
  paymentsEnabled: boolean;
  onCreationChecked?: (hash?: Hex) => Promise<void>;
}) {
  const { state, t } = useApp(),
    wallet = useFundsWallet(),
    epoch = useRef(0);
  const environment = state.status === 'ready' ? state.config.environment : '';
  const [snapshot, setSnapshot] = useState<ModuleSnapshot | null>(null),
    [prepared, setPrepared] = useState<ModuleIntent | null>(null),
    [ack, setAck] = useState(false);
  const [amount, setAmount] = useState('1'),
    [rows, setRows] = useState<TransactionRecord[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [evidence, setEvidence] = useState(''),
    [options, setOptions] = useState<ModuleActionOptions>({});
  const [participant, setParticipant] = useState<Address | undefined>(),
    [participantInput, setParticipantInput] = useState('');
  const renderEpoch = epoch.current;
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
    setNotice('');
    setError('');
    if (!wallet.actor) return;
    try {
      setRows(readRecords(localStorage, journalKey(environment, wallet.actor)));
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
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(moduleError(e));
    } finally {
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
  }
  let value: string | undefined;
  try {
    value = parseAmount(amount, 6).toString();
  } catch {
    /* Keep amount invalid until corrected. */
  }
  const actions: ModuleAction[] =
    creation && wallet.actor?.toLowerCase() === creation.actor.toLowerCase()
      ? ['create']
      : snapshot && wallet.actor
        ? moduleActions(publication, wallet.actor, snapshot, value)
        : [];
  const unresolved = rows.some((r) => !terminal(r));
  async function check(row: TransactionRecord, hash?: Hex) {
    const version = epoch.current,
      result = await recheckModule(environment, row, hash);
    if (row.intent.action === 'create' && onCreationChecked)
      await onCreationChecked(result.result.hash);
    if (epoch.current !== version) return;
    setRows(result.records);
    setNotice(
      t(
        `Latest lookup: ${result.result.state}. Previous evidence is retained when unknown.`,
        `本次核验：${result.result.state}。未知响应保留此前证据。`,
      ),
    );
    if (!creation) await refresh();
  }
  return (
    <>
      <section className="cloud-card">
        <h2>{t('My funds and actions', '我的资金与操作')}</h2>
        <WalletChoice
          value={wallet}
          busy={busy}
          connect={() =>
            void run(async () => {
              await wallet.connect();
            })
          }
        />
        {!creation && publication.data.tool === 'attend' ? (
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
        {snapshot ? (
          <>
            <p>
              {t('Contract state', '合约状态')}：{statusLabel(snapshot.state, t)}
            </p>
            <p>
              {t('Withdrawable credit', '可领取余额')}：{formatUnits(BigInt(snapshot.credit), 6)}{' '}
              AUSD
            </p>
            <p>
              {t('Already transferred to wallet', '已转入钱包')}：
              {formatUnits(BigInt(snapshot.withdrawn), 6)} AUSD
            </p>
            <p>
              {t('Snapshot block', '快照区块')}：{snapshot.block}
            </p>
            <button className="button secondary" disabled={busy} onClick={() => void run(refresh)}>
              {t('Read my rights', '读取我的权益')}
            </button>
          </>
        ) : null}
        {snapshot &&
        (publication.data.tool === 'deliver' || publication.data.tool === 'milestones') ? (
          <>
            <p>
              {t('Remaining escrow', '剩余托管款')}：{formatUnits(BigInt(snapshot.locked), 6)} AUSD
            </p>
            {publication.data.tool === 'milestones' ? (
              <>
                <p>
                  {t('Current stage', '当前阶段')}：{(snapshot.currentStage ?? 0) + 1} /{' '}
                  {publication.data.stages.length}
                </p>
                <p>
                  {t('Released stages total', '已释放阶段总额')}：
                  {formatUnits(BigInt(snapshot.released ?? '0'), 6)} AUSD
                </p>
                <ol className="cloud-list">
                  {publication.data.stages.map((stage, index) => (
                    <li key={index}>
                      {index + 1}. {stage.title} · {formatUnits(BigInt(stage.amount), 6)} AUSD ·{' '}
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
              <p>
                {t('Delivery digest', '交付摘要')}：<code>{snapshot.evidenceHash}</code>
              </p>
            ) : null}
            {snapshot.reasonHash && !/^0x0+$/.test(snapshot.reasonHash) ? (
              <p>
                {t('Dispute digest', '争议摘要')}：<code>{snapshot.reasonHash}</code>
              </p>
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
        {snapshot && publication.data.tool === 'attend' ? (
          <>
            <p>
              {t('Selected participant', '已选择参加者')}：<code>{snapshot.participant}</code> ·{' '}
              {statusLabel(snapshot.positionState ?? 'NONE', t)}
            </p>
            <p>
              {t('This participant’s pending deposit', '此参加者尚未结算押金')}：
              {formatUnits(BigInt(snapshot.positionLocked ?? '0'), 6)} AUSD ·{' '}
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
        {!creation && publication.data.tool === 'split' ? (
          <label>
            {t('Final payment (AUSD)', '最终付款金额（AUSD）')}
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setPrepared(null);
                setAck(false);
              }}
            />
          </label>
        ) : null}
        <p>
          {t(
            'Approval is separate from payment. Claimable credit needs a separate withdrawal. Every transaction requires your explicit review.',
            '授权与付款分开，可领取余额需要单独提款。每笔交易都需要明确核对。',
          )}
        </p>
        {!paymentsEnabled ? (
          <p className="notice">
            {t(
              'New payments are disabled; verified exits remain available.',
              '新付款未开放，已核验的退出权益仍可操作。',
            )}
          </p>
        ) : null}
        {unresolved ? (
          <p role="status">
            {t(
              'Recheck the unresolved transaction in this wallet before another send.',
              '发送前请先核验该钱包未确认的交易。',
            )}{' '}
            <Link to="/app/module-activity">{t('Open workbench', '打开工作台')}</Link>
          </p>
        ) : null}
        {actions.map((action) => (
          <button
            key={action}
            className="button secondary"
            disabled={
              busy ||
              unresolved ||
              (!paymentsEnabled &&
                ['approve', 'pay', 'contribute', 'fund', 'register'].includes(action)) ||
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
                  action === 'create'
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
            {t('Prepare: ', '准备：')}
            {t(...actionLabels[action])}
          </button>
        ))}
        {prepared ? (
          <div className="notice">
            <h3>{t(...actionLabels[prepared.action])}</h3>
            <p>
              Monad Testnet · AUSD · <code>{prepared.publication.deployment.address}</code>
            </p>
            <p>
              {t('Signing wallet', '签名钱包')}：<code>{prepared.actor}</code> · nonce{' '}
              {prepared.nonce}
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
                {t('Amount', '金额')}：{formatUnits(BigInt(prepared.amount), 6)} AUSD
              </p>
            ) : null}
            <p>
              {t(
                'Recipients and rules are shown above and cannot be changed by this action.',
                '本次操作遵循上方固定收款人和规则。',
              )}
            </p>
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
              disabled={busy || !ack || !wallet.wallet || !wallet.actor}
              onClick={() =>
                void run(async () => {
                  const current = epoch.current;
                  const intent = prepared;
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
              {t('Sign this action', '签署本次操作')}
            </button>
          </div>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </section>
      <TransactionHistory
        rows={rows.filter((r) => r.intent.publication.publicId === publication.publicId)}
        busy={busy}
        onRecheck={(row, hash) => void run(() => check(row, hash))}
      />
    </>
  );
}
export function ModuleActivityPage() {
  const { state, t } = useApp(),
    wallet = useFundsWallet();
  const environment = state.status === 'ready' ? state.config.environment : '';
  const [rows, setRows] = useState<TransactionRecord[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    try {
      setRows(wallet.actor ? readRecords(localStorage, journalKey(environment, wallet.actor)) : []);
    } catch (e) {
      setError(moduleError(e));
    }
  }, [wallet.actor, environment]);
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
      <TransactionHistory
        rows={rows}
        busy={busy}
        onRecheck={(row, hash) => {
          setBusy(true);
          setError('');
          void recheckModule(environment, row, hash)
            .then((r) => {
              setRows(r.records);
              if (r.result.state === 'unknown')
                setError(
                  t(
                    'Lookup is unknown; earlier evidence is retained.',
                    '本次查询未知，已保留此前证据。',
                  ),
                );
            })
            .catch((e) => setError(moduleError(e)))
            .finally(() => setBusy(false));
        }}
      />
    </section>
  );
}
