import { useState } from 'react';
import type { Hex } from 'viem';
import { hashSchema } from '../../shared/cloud/model';
import { explorerTransaction } from '../../shared/network';
import { useApp } from '../context';
import { statusLabel } from '../shared/status';
import type { PendingTransaction } from '../shared/transaction-storage';
import './modules.css';

export interface PendingCheck {
  entry: PendingTransaction;
  hash?: Hex;
}
function key(entry: PendingTransaction) {
  return `${entry.prefix}:${entry.id}:${entry.index}`;
}
export function PendingRecovery({
  entries,
  busy,
  onCheck,
}: {
  entries: PendingTransaction[];
  busy: boolean;
  onCheck: (checks: PendingCheck[]) => void;
}) {
  const { t } = useApp();
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  if (!entries.length) return null;
  function check() {
    const checks: PendingCheck[] = [];
    for (const entry of entries) {
      const raw = hashes[key(entry)]?.trim();
      if (raw) {
        const parsed = hashSchema.safeParse(raw);
        if (!parsed.success) {
          setError(t('Enter a complete transaction hash.', '请输入完整交易哈希。'));
          return;
        }
        checks.push({ entry, hash: parsed.data });
      } else checks.push({ entry });
    }
    setError('');
    onCheck(checks);
  }
  return (
    <section className="pending-recovery" aria-label={t('Pending transaction', '待核验交易')}>
      <div className="pending-recovery-head">
        <h3>{t('Check the earlier transaction', '先核验上一笔交易')}</h3>
        {entries.length > 1 ? <span>{entries.length}</span> : null}
      </div>
      <p>
        {t(
          'A new payment stays paused until this wallet’s earlier transaction is checked.',
          '核验完成前，这个钱包不会再次付款。',
        )}
      </p>
      <ul>
        {entries.map((entry) => (
          <li key={key(entry)}>
            <div>
              <strong>
                {entry.prefix === 'monadbox.setup.mon-v2'
                  ? t('Contract deployment', '合约部署')
                  : entry.prefix.endsWith('.v1')
                    ? t('Earlier version', '旧版交易')
                    : entry.prefix.includes('module-actions')
                      ? t('Payment Box', '付款 Box')
                      : t('Group Box', '成团 Box')}
                {entry.title ? ` · ${entry.title}` : ''}
              </strong>
              <small>{statusLabel(entry.state, t)}</small>
            </div>
            {entry.hash && hashSchema.safeParse(entry.hash).success ? (
              <a href={explorerTransaction(entry.hash as Hex)} target="_blank" rel="noreferrer">
                {t('View transaction', '查看交易')}
              </a>
            ) : null}
            <details>
              <summary>
                {entry.hash
                  ? t('Use another hash', '使用其他哈希')
                  : t('Enter transaction hash', '输入交易哈希')}
              </summary>
              <input
                aria-label={t('Transaction hash', '交易哈希')}
                value={hashes[key(entry)] ?? ''}
                onChange={(e) =>
                  setHashes((current) => ({ ...current, [key(entry)]: e.target.value }))
                }
                placeholder="0x…"
              />
            </details>
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
      <button className="button primary" disabled={busy} onClick={check}>
        {busy
          ? t('Checking transactions…', '正在核验…')
          : entries.length === 1
            ? t('Check and continue', '核验并继续')
            : t('Check all and continue', '全部核验并继续')}
      </button>
    </section>
  );
}
