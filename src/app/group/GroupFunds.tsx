import { RecoveryHistory } from '../shared/RecoveryHistory';
import { statusLabel } from '../shared/status';
import { useEffect, useRef, useState } from 'react';
import '../cloud/cloud.css';
import { Link } from 'react-router-dom';
import type { Address, Hex } from 'viem';
import { formatUnits } from 'viem';
import { useApp } from '../context';
import { userError } from '../../shared/wallet';
import { useFundsWallet, WalletChoice } from '../shared/FundsWallet';
import { makeClient } from '../../shared/network';
import { availableActions, groupAccount, prepareAction } from '../../shared/group/actions';
import type { GroupAction, GroupAccount, GroupActionIntent } from '../../shared/group/actions';
import type { PublicGroup } from '../../shared/cloud/model';
import { actionKey, readActions, recheckAction, sendGroupAction } from './action-journal';
import type { ActionRecord } from './action-journal';

const labels: Record<GroupAction, [string, string]> = {
  approve: ['Approve exact amount', '授权准确额度'],
  contribute: ['Pay and join', '付款参与'],
  leave: ['Exit to refundable credit', '退出并记入可退款余额'],
  finalize: ['Finalize group result', '确认成团结果'],
  cancel: ['Cancel group', '取消成团'],
  creditRefund: ['Claim refund credit', '领取退款权益'],
  settle: ['Settle to beneficiary credit', '结算到收款人可领取余额'],
  withdrawFor: ['Withdraw to my wallet', '提款到我的钱包'],
};
const terminal = ['rejected', 'finalized', 'reverted', 'replaced'];
function message(e: unknown) {
  const text = e instanceof Error ? e.message : '';
  const errors: Record<string, string> = {
    ACTION_UNAVAILABLE:
      'This action is unavailable at the verified block. Refresh the chain state. / 当前链上条件不允许，请刷新。',
    ACTION_CHANGED:
      'Time, nonce or rights changed. Prepare and review again. / 时间、交易序号或权益已变化，请重新准备。',
    JOURNAL_FULL:
      'This browser has reached 200 records. Export them; use a fresh browser and the original public link for recovery. / 本地记录已满200条，请导出；可在新浏览器凭原链接读取链上权益。',
    UNSUPPORTED_TRANSACTION:
      'Delegated or unsupported transaction type. Do not resend. / 不支持此交易类型，请勿重发。',
  };
  return errors[text] ?? userError(e);
}
export function ActionHistory({
  rows,
  busy,
  recheck,
}: {
  rows: ActionRecord[];
  busy: boolean;
  recheck: (row: ActionRecord, hash?: Hex) => void;
}) {
  const { t } = useApp();
  return (
    <RecoveryHistory
      rows={rows}
      busy={busy}
      recheck={recheck}
      describe={(r) => ({
        id: r.intent.id,
        label: t(...labels[r.intent.action]),
        title: r.intent.group.data.title,
        href: '/b/' + r.intent.group.publicId,
        state: r.state,
        ...(r.hash ? { hash: r.hash } : {}),
      })}
    />
  );
}
export function GroupFunds({
  group,
  onSnapshot,
}: {
  group: PublicGroup;
  onSnapshot?: (snapshot: PublicGroup['snapshot']) => void;
}) {
  const { state, t, locale } = useApp(),
    wallet = useFundsWallet();
  const environment = state.status === 'ready' ? state.config.environment : '';
  const [account, setAccount] = useState<GroupAccount | null>(null),
    [prepared, setPrepared] = useState<GroupActionIntent | null>(null);
  const [rows, setRows] = useState<ActionRecord[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [ack, setAck] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    if (account) onSnapshot?.(account.snapshot);
  }, [account, onSnapshot]);
  useEffect(() => {
    epoch.current++;
    setAccount(null);
    setPrepared(null);
    setRows([]);
    setAck(false);
  }, [wallet.actor, group.publicId]);
  useEffect(() => {
    if (!wallet.actor) return;
    let active = true;
    const actor = wallet.actor;
    void groupAccount(makeClient(), group.intent, actor)
      .then((value) => {
        if (active) {
          setAccount(value);
          setRows(readActions(localStorage, actionKey(environment, actor)));
        }
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [wallet.actor, group.intent, environment]);
  async function refresh(actor: Address) {
    const current = epoch.current;
    const next = await groupAccount(makeClient(), group.intent, actor);
    if (current !== epoch.current) return;
    setAccount(next);
    setRows(readActions(localStorage, actionKey(environment, actor)));
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function check(row: ActionRecord, hash?: Hex) {
    const current = epoch.current;
    const result = await recheckAction(environment, row, hash);
    if (current !== epoch.current) return;
    setNotice(
      t(
        `Latest lookup: ${result.result.state}. Existing verified records are preserved on an unknown response.`,
        `本次核验：${result.result.state}。未知响应会保留此前已核验记录。`,
      ),
    );
    setRows(result.records);
    if (wallet.actor) await refresh(wallet.actor);
  }
  const actions =
    account && wallet.actor ? availableActions(group.intent, wallet.actor, account) : [];
  const unresolved = rows.some((r) => !terminal.includes(r.state));
  return (
    <div className="cloud-card funds-panel group-funds-panel">
      <h2>{t('My funds and actions', '我的资金与操作')}</h2>
      <WalletChoice
        value={wallet}
        busy={busy}
        connect={() =>
          void run(async () => {
            const actor = await wallet.connect();
            await refresh(actor);
          })
        }
      />
      {wallet.actor ? (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void run(() => refresh(wallet.actor!))}
        >
          {t('Read my rights', '读取我的权益')}
        </button>
      ) : null}
      {!group.paymentsEnabled ? (
        <p className="notice">
          {t(
            'New payments are disabled. Existing refunds and withdrawals remain available when verified.',
            '新付款未开放；已有退款和提款权益经核验后仍可操作。',
          )}
        </p>
      ) : null}
      {account ? (
        <>
          <p>
            {t('Position', '参与状态')}：{['NONE', 'ACTIVE', 'LEFT', 'REFUNDED'][account.position]}{' '}
            · {statusLabel(account.snapshot.state, t)}
          </p>
          <p>
            {t('Withdrawable credit', '可领取余额')}：{formatUnits(BigInt(account.credit), 18)} MON
          </p>
          <p>
            {t('Already transferred to wallet', '已转入钱包')}：
            {formatUnits(BigInt(account.withdrawn), 18)} MON
          </p>
          <p>
            {t('Snapshot block', '快照区块')}：{account.snapshot.blockNumber}
          </p>
        </>
      ) : null}
      <p>
        {t(
          'Pay directly in MON. Credit requires withdrawal. Before the deadline you may exit once; the same address cannot rejoin. A successful group is not proof of delivery.',
          '直接使用 MON 付款，可领取款需单独提款。截止前可退出，同地址不能重新加入。成团不代表服务已交付。',
        )}
      </p>
      <div className="button-row">
        {actions.map((action) => (
          <button
            key={action}
            className={
              'button action-button ' +
              (['contribute', 'withdrawFor', 'creditRefund'].includes(action)
                ? 'primary'
                : 'secondary')
            }
            disabled={
              busy ||
              unresolved ||
              (!group.paymentsEnabled && ['approve', 'contribute'].includes(action))
            }
            onClick={() =>
              void run(async () => {
                setPrepared(null);
                setAck(false);
                const actor = wallet.actor!;
                const current = epoch.current;
                const i = await prepareAction(makeClient(), group.intent, actor, action);
                if (current !== epoch.current) return;
                setPrepared(i);
                setAck(false);
              })
            }
          >
            {t('Prepare: ', '准备：')}
            {t(...labels[action])}
          </button>
        ))}
      </div>
      {unresolved ? (
        <p role="status">
          {t(
            'Resolve the earlier transaction in this wallet before another send. The workbench includes actions on other groups.',
            '请先核验该钱包的上一笔交易，工作台包含其他成团的记录。',
          )}{' '}
          <Link to="/app/group-activity">{t('Open workbench', '打开工作台')}</Link>
        </p>
      ) : null}
      {prepared ? (
        <div className="checkout-review">
          <h3>{t(...labels[prepared.action])}</h3>
          <details className="verification-note">
            <summary>{t('Signing details and fixed beneficiary', '签名详情与固定收款人')}</summary>
            <p>
              Monad Testnet · MON · {t('Contract', '合约')}{' '}
              <code>{prepared.group.deployment.address}</code>
            </p>
            <p>
              {t('Wallet', '钱包')} <code>{prepared.actor}</code> · nonce {prepared.nonce}
            </p>
            <p>
              {t('Unit price', '每份金额')} {formatUnits(BigInt(group.data.unitPrice), 18)} MON ·{' '}
              {t('Fixed beneficiary', '固定收款人')} <code>{group.data.beneficiary}</code>
            </p>
          </details>
          {prepared.action === 'contribute' ? (
            <div className="checkout-rules">
              <h3>{t('Rules for this payment', '本次参与规则')}</h3>
              <p>
                <strong>{t('Exit before the deadline', '募集截止前可退出')}</strong>
                <br />
                {new Date(group.data.fundingDeadline * 1000).toLocaleString(
                  locale === 'zh' ? 'zh-CN' : 'en-GB',
                )}
              </p>
              <p>
                <strong>{t('A failed group returns your principal', '未成团本金可退')}</strong>
                <br />
                {t(
                  'Refunds first become credit; withdraw to receive MON.',
                  '退款先记入可领取款，再提到钱包。',
                )}
              </p>
              <p>
                <strong>{t('Success settles at the agreed time', '成团后到约定时间结算')}</strong>
                <br />
                {new Date(group.data.settleNotBefore * 1000).toLocaleString(
                  locale === 'zh' ? 'zh-CN' : 'en-GB',
                )}
              </p>
            </div>
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
            disabled={busy || !ack || !wallet.actor || !wallet.wallet}
            onClick={() =>
              void run(async () => {
                const current = epoch.current;
                let hash: Hex;
                try {
                  hash = await sendGroupAction(wallet.wallet!.provider, environment, prepared);
                } catch (e) {
                  if (current === epoch.current) {
                    setPrepared(null);
                    setAck(false);
                    setRows(readActions(localStorage, actionKey(environment, prepared.actor)));
                  }
                  throw e;
                }
                if (current !== epoch.current) return;
                setNotice(
                  t(`Sent: ${hash}. Recheck; do not resend.`, `已发送：${hash}，请核验，勿重发。`),
                );
                const records = readActions(localStorage, actionKey(environment, prepared.actor));
                setRows(records);
                setPrepared(null);
                const record = records.find((r) => r.intent.id === prepared.id);
                if (record) await check(record, hash);
              })
            }
          >
            {t('Sign this action', '签署本次操作')}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setPrepared(null);
              setAck(false);
            }}
          >
            {t('Back to rules', '返回核对规则')}
          </button>
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <ActionHistory
        rows={rows.filter((r) => r.intent.group.publicId === group.publicId)}
        busy={busy}
        recheck={(r, h) => void run(() => check(r, h))}
      />
    </div>
  );
}
export function GroupActivityPage() {
  const { state, t } = useApp(),
    wallet = useFundsWallet();
  const environment = state.status === 'ready' ? state.config.environment : '';
  const [rows, setRows] = useState<ActionRecord[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [link, setLink] = useState('');
  useEffect(() => {
    try {
      setRows(wallet.actor ? readActions(localStorage, actionKey(environment, wallet.actor)) : []);
    } catch (e) {
      setRows([]);
      setError(message(e));
    }
  }, [wallet.actor, environment]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="container cloud-page">
      <h1>{t('Group funds workbench', '成团资金工作台')}</h1>
      <p>
        <Link to="/app/groups">{t('Groups I created', '我创建的成团')}</Link>
      </p>
      <div className="cloud-card">
        <WalletChoice
          value={wallet}
          busy={busy}
          connect={() =>
            void run(async () => {
              const a = await wallet.connect();
              setRows(readActions(localStorage, actionKey(environment, a)));
            })
          }
        />
        <p>
          {t(
            'History is local to this browser and wallet. Open the original public link on any browser to read current participation, refundable funds and credit directly from the contract.',
            '历史记录按浏览器和钱包保存。在任意浏览器打开原公开链接，均可直接读合约中的参与、退款和可领取权益。',
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const url = new URL(link, location.origin);
              if (url.origin !== location.origin || !/^\/b\/[a-f0-9-]{36}$/.test(url.pathname))
                throw Error();
              location.assign(url.pathname);
            } catch {
              setError(t('Use a Group public link from this site.', '请使用本站的成团公开链接。'));
            }
          }}
        >
          <label>
            {t('Original Group link', '原成团链接')}
            <input value={link} onChange={(e) => setLink(e.target.value)} />
          </label>
          <button className="button secondary">
            {t('Open group and recover', '打开成团并恢复')}
          </button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <ActionHistory
        rows={rows}
        busy={busy}
        recheck={(r, h) =>
          void run(async () => {
            const result = await recheckAction(environment, r, h);
            setRows(result.records);
            if (result.result.state === 'unknown')
              setError(
                t(
                  'RPC lookup is unknown; previous evidence is retained.',
                  '本次查询未知，已保留原记录。',
                ),
              );
          })
        }
      />
    </section>
  );
}
