import { useEffect, useState, useRef } from 'react';
import { formatUnits } from 'viem';
import { useApp } from './context';
import { useFundsWallet, WalletChoice } from './shared/FundsWallet';
import { errorText } from './shared/Session';
import {
  checkSetup,
  prepareSetup,
  readSetup,
  recoverSetup,
  sendSetup,
  setupKey,
  setupKinds,
  setupRegistry,
} from './shared/deployment';
import type { SetupIntent, SetupRow } from './shared/deployment';
import { explorerTransaction } from '../shared/network';
import './cloud/cloud.css';
const names = {
  'group-v1': 'Group V1',
  split: 'Split',
  group: 'Group V2',
  deliver: 'Deliver',
  attend: 'Attend',
  milestones: 'Milestones',
  rewards: 'Rewards',
};
export default function SetupPage() {
  const { state, t } = useApp(),
    wallet = useFundsWallet();
  const environment = state.status === 'ready' ? state.config.environment : null;
  const [rows, setRows] = useState<SetupRow[]>([]),
    [prepared, setPrepared] = useState<SetupIntent | null>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [registry, setRegistry] = useState('');
  const owner = `${environment}:${wallet.actor}`;
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  function refresh() {
    if (environment && wallet.actor)
      setRows(readSetup(localStorage, setupKey(environment, wallet.actor)));
  }
  useEffect(() => {
    setPrepared(null);
    setRows([]);
    setAck(false);
    setRegistry('');
    setError('');
    if (!environment || !wallet.actor) return;
    try {
      setRows(readSetup(localStorage, setupKey(environment, wallet.actor)));
    } catch (e) {
      setError(errorText(e));
    }
  }, [environment, wallet.actor]);
  async function run(action: () => Promise<unknown>) {
    const startedFor = owner;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (activeOwner.current === startedFor) setError(errorText(e));
    } finally {
      setBusy(false);
      if (activeOwner.current === startedFor) {
        try {
          refresh();
        } catch (e) {
          setError(errorText(e));
        }
      }
    }
  }
  const unresolved = rows.some((r) => ['signing', 'unknown', 'broadcast'].includes(r.state));
  return (
    <section className="container cloud-page setup-page">
      <h1>{t('Prepare the testnet deployment', '准备测试网部署')}</h1>
      <p>
        {t(
          'Operator setup: deploy the seven MON contracts, then export their verified registration. Each deployment is a separate wallet transaction.',
          '项目部署入口：依次部署七个 MON 合约，核验后导出登记配置。每次部署都需在钱包中单独确认。',
        )}
      </p>
      <WalletChoice value={wallet} busy={busy} connect={() => void run(() => wallet.connect())} />
      <p className="notice">
        {t(
          'Monad Testnet · 10143 · native MON. The connected wallet becomes the fixed intake administrator. Deployment transfers 0 MON and costs a network fee.',
          'Monad 测试网 · 10143 · 原生 MON。当前钱包将成为固定的收款开关管理员。部署转账金额为 0 MON，需支付网络手续费。',
        )}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="setup-grid">
        {setupKinds.map((kind) => {
          const done = [...rows]
            .reverse()
            .find((r) => r.intent.kind === kind && r.state === 'finalized');
          return (
            <article className="cloud-card" key={kind}>
              <h2>{names[kind]}</h2>
              <p>
                {done ? t('Verified deployment', '已核验部署') : t('Ready to prepare', '待部署')}
              </p>
              {done ? (
                <code>{done.address}</code>
              ) : (
                <button
                  className="button secondary"
                  disabled={busy || !wallet.actor || unresolved}
                  onClick={() =>
                    void run(async () => {
                      setAck(false);
                      const next = await prepareSetup(kind, wallet.actor!);
                      if (activeOwner.current === owner) setPrepared(next);
                    })
                  }
                >
                  {t('Prepare deployment', '准备部署')}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {prepared && wallet.actor === prepared.actor ? (
        <section className="cloud-card checkout-review">
          <h2>
            {t('Review deployment', '核对部署')} · {names[prepared.kind]}
          </h2>
          <p>
            {t('Administrator', '管理员')} <code>{prepared.actor}</code>
          </p>
          <p>{t('Transfer amount', '转账金额')}：0 MON</p>
          <p>
            {t('Estimated network fee', '预计网络手续费')}：
            {formatUnits(BigInt(prepared.estimatedFee), 18)} MON
          </p>
          <p>
            {t(
              'The wallet shows the final network fee. Monad charges the specified gas limit.',
              '最终网络手续费以钱包确认为准，Monad 按设置的 Gas 上限计费。',
            )}
          </p>
          <label className="cloud-check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            {t(
              'I reviewed the network, administrator and fee.',
              '我已核对测试网、管理员地址和手续费。',
            )}
          </label>
          <button
            className="button primary"
            disabled={busy || !ack || unresolved}
            onClick={() =>
              void run(async () => {
                if (!wallet.wallet || !environment) throw Error('Connect your wallet / 请连接钱包');
                await sendSetup(environment, prepared, wallet.wallet.provider);
                setPrepared(null);
                setAck(false);
              })
            }
          >
            {t('Confirm deployment in wallet', '在钱包中确认部署')}
          </button>
        </section>
      ) : null}
      <h2>{t('Deployment history', '部署记录')}</h2>
      <p>
        {t(
          'If a response is lost, recheck the original transaction. Never resend an unknown deployment.',
          '返回结果丢失时，请核验原交易。结果未知的部署不能重新发送。',
        )}
      </p>
      <ul className="setup-history">
        {rows.map((row) => (
          <li className="cloud-card" key={row.intent.id}>
            <strong>
              {names[row.intent.kind]} · {row.state}
            </strong>
            {row.hash ? (
              <p>
                <a href={explorerTransaction(row.hash)} target="_blank" rel="noreferrer">
                  {t('View transaction', '查看交易')}
                </a>
              </p>
            ) : null}
            {row.address ? (
              <p>
                <code>{row.address}</code>
              </p>
            ) : null}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run(() => recoverSetup(environment!, row))}
            >
              {t('Recheck deployment', '核验部署')}
            </button>
          </li>
        ))}
      </ul>
      <button
        className="button primary"
        disabled={
          busy ||
          !setupKinds.every((k) => rows.some((r) => r.intent.kind === k && r.state === 'finalized'))
        }
        onClick={() =>
          void run(async () => {
            const verified = await Promise.all(
              rows.filter((r) => r.state === 'finalized').map((r) => checkSetup(r)),
            );
            if (activeOwner.current === owner)
              setRegistry(JSON.stringify(setupRegistry(verified), null, 2));
          })
        }
      >
        {t('Verify and export registration', '核验并导出登记配置')}
      </button>
      {registry ? (
        <section className="cloud-card">
          <h2>{t('Verified MON registration', '已核验 MON 配置')}</h2>
          <textarea
            rows={14}
            readOnly
            aria-label={t('Verified registration JSON', '已核验配置 JSON')}
            value={registry}
          />
          <p>
            {t(
              'Register these values in the Production configuration after the database migration is ready.',
              '数据库迁移就绪后，将这些地址和哈希登记到 Production 配置。',
            )}
          </p>
        </section>
      ) : null}
    </section>
  );
}
