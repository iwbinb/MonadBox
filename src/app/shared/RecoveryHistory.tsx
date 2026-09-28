import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Hex } from 'viem';
import { useApp } from '../context';
import { hashSchema } from '../../shared/cloud/model';
import { explorerTransaction } from '../../shared/lab/network';
import { statusLabel } from './status';
export function RecoveryHistory<Row>({
  rows,
  busy,
  describe,
  recheck,
}: {
  rows: Row[];
  busy: boolean;
  describe: (row: Row) => {
    id: string;
    label: string;
    state: string;
    title: string;
    href: string;
    hash?: Hex;
  };
  recheck: (row: Row, hash?: Hex) => void;
}) {
  const { t } = useApp(),
    [hash, setHash] = useState(''),
    [error, setError] = useState('');
  return (
    <section className="cloud-card">
      <h2>{t('Transactions and recovery', '交易与恢复')}</h2>
      <p>
        {t(
          'Unknown does not mean failed. Recheck before another send. Each record confirms only the named action.',
          '未知不等于失败，下一笔发送前先核验。每条记录仅确认所列动作。',
        )}
      </p>
      <label>
        {t('Original or replacement hash (optional)', '原交易或替代交易哈希（选填）')}
        <input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x…" />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <ul className="cloud-list">
        {rows
          .slice()
          .reverse()
          .map((row) => {
            const d = describe(row);
            return (
              <li key={d.id}>
                <p>
                  {d.label} · <strong>{statusLabel(d.state, t)}</strong>
                </p>
                <Link to={d.href}>{d.title}</Link>
                {d.hash ? (
                  <a href={explorerTransaction(d.hash)} target="_blank" rel="noreferrer">
                    <code>{d.hash}</code>
                  </a>
                ) : null}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    try {
                      setError('');
                      recheck(row, hash.trim() ? hashSchema.parse(hash.trim()) : undefined);
                    } catch {
                      setError(t('Enter a complete transaction hash.', '请输入完整交易哈希。'));
                    }
                  }}
                >
                  {t('Recheck transaction', '重新核验交易')}
                </button>
              </li>
            );
          })}
      </ul>
      {rows.length ? (
        <details>
          <summary>{t('Export recovery records', '导出恢复记录')}</summary>
          <textarea
            aria-label={t('Recovery records JSON', '恢复记录 JSON')}
            readOnly
            rows={5}
            value={JSON.stringify(rows, null, 2)}
          />
        </details>
      ) : (
        <p>
          {t(
            'No records in this browser. The original public link still reads your contract rights.',
            '本浏览器暂无记录，原公开链接仍可读取合约权益。',
          )}
        </p>
      )}
    </section>
  );
}
