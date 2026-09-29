import { EditorAside } from './EditorAside';
import { useId, useState } from 'react';
import { formatUnits } from 'viem';
import { useApp } from '../context';
import { localDateInput, parseLocalDate } from '../../shared/group/draft';
import { rewardsSchema } from '../../shared/modules/model';
import type { ModuleData } from '../../shared/modules/model';
import { parseRewardList } from '../../shared/modules/rewards';
import { exportModule } from './drafts';
type Rewards = Extract<ModuleData, { tool: 'rewards' }>;
export function RewardsRules({ data: d }: { data: Rewards }) {
  const { t } = useApp(),
    total = d.recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  return (
    <section className="cloud-card" aria-label={t('Frozen rules preview', '固定规则预览')}>
      <h2>{d.title}</h2>
      <p>{d.description}</p>
      <p>Monad Testnet · 10143 · MON</p>
      <p>
        {t('Funded total', '入金总额')}：{formatUnits(total, 18)} MON ·{' '}
        {t('Recipients', '收款人数')}：{d.recipients.length}
      </p>
      <p>
        {t('Claims open', '领取开始')}：{new Date(d.claimStart * 1000).toLocaleString()} ·{' '}
        {new Date(d.claimStart * 1000).toISOString()}
      </p>
      <p>
        {t('Claim deadline', '领取截止')}：{new Date(d.claimDeadline * 1000).toLocaleString()} ·{' '}
        {new Date(d.claimDeadline * 1000).toISOString()}
      </p>
      <p className="notice">
        {t(
          'The full address list and each amount become public. Review this sorted list before signing. Publication transfers the entire MON total in the same transaction.',
          '完整地址名单和每笔金额都会公开，请在签名前核对已排序名单。发布交易会同时转入全部 MON 总额。',
        )}
      </p>
      <ol className="cloud-list">
        {d.recipients.map((r) => (
          <li key={r.address}>
            <code>{r.address}</code> · {formatUnits(BigInt(r.amount), 18)} MON
          </li>
        ))}
      </ol>
      <p>
        {t(
          'Each listed wallet can claim once within the window, then withdraw separately. Anyone may trigger a claim for its original recipient. After expiry, only the original creator can reclaim unclaimed funds. Already claimed credit remains with its recipient, including before withdrawal. No early cancellation or list editing.',
          '名单内钱包在窗口内只能领取一次，然后单独提款。任何人可为原收款地址触发领取。到期后只有原创建者可以回收未领取款，已经归入受益人可领取余额的钱不会被收回，即使尚未提款。不能提前取消或修改名单。',
        )}
      </p>
    </section>
  );
}
export function RewardsEditor({
  initial,
  busy,
  onSave,
}: {
  initial?: Rewards | undefined;
  busy: boolean;
  onSave: (data: ModuleData) => void;
}) {
  const { t } = useApp(),
    start = Math.floor(Date.now() / 60000) * 60 + 86400;
  const formId = useId();
  const [title, setTitle] = useState(initial?.title ?? ''),
    [description, setDescription] = useState(initial?.description ?? ''),
    [raw, setRaw] = useState(
      initial
        ? initial.recipients
            .map((r) => `${r.address},${formatUnits(BigInt(r.amount), 18)}`)
            .join('\n')
        : '',
    ),
    [claimStart, setClaimStart] = useState(localDateInput(initial?.claimStart ?? start)),
    [deadline, setDeadline] = useState(localDateInput(initial?.claimDeadline ?? start + 604800)),
    [preview, setPreview] = useState<Rewards | null>(null),
    [error, setError] = useState(''),
    [listOpen, setListOpen] = useState(true);
  let liveRows: Rewards['recipients'] = [];
  let liveTotal = '—',
    liveCount = '—';
  try {
    const list = parseRewardList(raw);
    liveRows = list;
    liveTotal = formatUnits(
      list.reduce((s, r) => s + BigInt(r.amount), 0n),
      18,
    );
    liveCount = String(list.length);
  } catch {
    /* Incomplete list stays uncalculated. */
  }
  return (
    <div className="module-editor-layout rewards-editor">
      <form
        id={formId}
        className="cloud-card"
        onChange={() => setPreview(null)}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const data = rewardsSchema.parse({
              tool: 'rewards',
              title,
              description,
              recipients: parseRewardList(raw),
              claimStart: parseLocalDate(claimStart),
              claimDeadline: parseLocalDate(deadline),
            });
            if (data.claimDeadline <= Date.now() / 1000) throw Error();
            setPreview(data);
            setError('');
          } catch {
            setPreview(null);
            setError(
              t(
                'Check 1–100 unique wallets, positive MON amounts with at most 18 decimals, a title and ordered claim times. The claim deadline must be in the future.',
                '请检查1–100个不重复的钱包、最多18位小数的正数MON金额、标题及领取起止时间，截止须在未来。',
              ),
            );
          }
        }}
      >
        <label>
          {t('Title', '标题')}
          <input required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          {t('Public description', '公开说明')}
          <textarea
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <details
          className="reward-source"
          open={listOpen}
          onToggle={(e) => setListOpen(e.currentTarget.open)}
        >
          <summary>{t('Import CSV or edit the address list', '导入 CSV 或编辑地址名单')}</summary>
          <label>
            {t('Reward list: wallet, MON amount', '奖励名单：钱包，MON金额')}
            <textarea
              required
              rows={4}
              maxLength={20000}
              aria-label={t('Reward list: wallet, MON amount', '奖励名单：钱包，MON金额')}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <small>
              {t(
                'One address and decimal amount per line, separated by a comma or tab. Optional header: address,amount. Names and private contact data are not supported.',
                '每行一个地址和十进制金额，用英文逗号或制表符分隔。可选表头address,amount。不要包含姓名或私密联系方式。',
              )}
            </small>
          </label>
          <label>
            {t('Import a local reward CSV', '导入本地奖励CSV')}
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setPreview(null);
                void (async () => {
                  if (f.size > 20000) throw Error();
                  const text = new TextDecoder('utf-8', { fatal: true }).decode(
                    await f.arrayBuffer(),
                  );
                  parseRewardList(text);
                  setRaw(text);
                  setListOpen(false);
                  setError('');
                })().catch(() =>
                  setError(
                    t(
                      'Invalid CSV: check size, encoding, unique wallets and decimal amounts.',
                      'CSV无效，请检查大小、编码、不重复钱包和十进制金额。',
                    ),
                  ),
                );
              }}
            />
          </label>
        </details>
        {liveRows.length ? (
          <div className="reward-list-preview">
            <h2>{t('Validated recipients', '已核对领取名单')}</h2>
            <div className="reward-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('Wallet', '钱包地址')}</th>
                    <th>MON</th>
                    <th>{t('Check', '校验')}</th>
                  </tr>
                </thead>
                <tbody>
                  {liveRows.map((row, index) => (
                    <tr key={row.address}>
                      <td>{index + 1}</td>
                      <td>
                        <code title={row.address}>
                          {row.address.slice(0, 8)}…{row.address.slice(-6)}
                        </code>
                      </td>
                      <td>{formatUnits(BigInt(row.amount), 18)}</td>
                      <td>{t('Valid', '有效')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {liveCount} {t('unique wallets', '个唯一地址')} · {t('Total', '合计')}{' '}
              <strong>{liveTotal} MON</strong>
            </p>
          </div>
        ) : null}
        <label>
          {t('Claims open (local time)', '领取开始（本地时间）')}
          <input
            type="datetime-local"
            required
            value={claimStart}
            onChange={(e) => setClaimStart(e.target.value)}
          />
        </label>
        <label>
          {t('Claim deadline (local time)', '领取截止（本地时间）')}
          <input
            type="datetime-local"
            required
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
        <p>
          {t(
            'Import reads the file in this browser only. Nothing is uploaded until you explicitly copy the reviewed draft to cloud.',
            '导入只在本浏览器读取文件。只有明确将预览后的草稿复制到云端才会上传。',
          )}
        </p>
        <button className="button primary rewards-mobile-action" disabled={busy}>
          {t('Review rules', '预览规则')}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
      {!preview ? (
        <EditorAside
          tool="rewards"
          action={
            <button
              className="button primary rewards-desktop-action"
              type="submit"
              form={formId}
              disabled={busy}
            >
              {t('Review rules', '预览规则')}
            </button>
          }
          amount={liveTotal}
          label={t('Fund the full list', '一次预存全部奖励')}
          rows={[
            { label: t('Recipients', '领取人数'), value: liveCount },
            { label: t('Claim deadline', '领取截止'), value: deadline.replace('T', ' ') },
          ]}
        />
      ) : null}
      {preview ? (
        <>
          <RewardsRules data={preview} />
          <details className="cloud-card">
            <summary>
              {t('Export reviewed rules without saving', '导出已预览规则，无需保存')}
            </summary>
            <textarea
              aria-label={t('Reviewed rules JSON', '已预览规则 JSON')}
              readOnly
              rows={6}
              value={exportModule(preview)}
            />
          </details>
          <button className="button primary" disabled={busy} onClick={() => onSave(preview)}>
            {t('Save reviewed draft', '保存已预览草稿')}
          </button>
        </>
      ) : null}
    </div>
  );
}
