import { RecoveryHistory } from '../shared/RecoveryHistory';
import { statusLabel } from '../shared/status';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatUnits } from 'viem';
import type { Hex } from 'viem';
import { useApp } from '../context';
import { useFundsWallet, WalletChoice } from '../shared/FundsWallet';
import { userError } from '../../shared/lab/wallet';
import { makeClient } from '../../shared/lab/network';
import { parseAmount } from '../../shared/amount';
import type { ModuleAction, ModuleIntent, ModulePublication } from '../../shared/modules/model';
import { moduleActions, moduleSnapshot, prepareModuleAction } from '../../shared/modules/chain';
import type { ModuleSnapshot } from '../../shared/modules/chain';
import { journalKey, readRecords, recheckModule, sendModuleAction, terminal } from './journal';
import type { TransactionRecord } from './journal';
export const actionLabels: Record<ModuleAction, [string, string]> = {
  create: ['Publish fixed rules', '发布固定规则'],
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
  useEffect(() => {
    const version = ++epoch.current;
    setSnapshot(null);
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
      void moduleSnapshot(makeClient(), publication, wallet.actor)
        .then((s) => {
          if (epoch.current === version) setSnapshot(s);
        })
        .catch((e) => {
          if (epoch.current === version) setError(moduleError(e));
        });
    return () => {
      epoch.current = version + 1;
    };
  }, [wallet.actor, environment, publication, creation]);
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
    const s = await moduleSnapshot(makeClient(), publication, actor);
    if (epoch.current !== version) return;
    setSnapshot(s);
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
              (!paymentsEnabled && ['approve', 'pay', 'contribute'].includes(action))
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
                  const intent = prepared,
                    hash = await sendModuleAction(wallet.wallet!.provider, environment, intent);
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
