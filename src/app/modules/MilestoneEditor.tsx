import { useState } from 'react';
import { formatUnits } from 'viem';
import { useApp } from '../context';
import { parseAmount } from '../../shared/amount';
import { localDateInput, parseLocalDate } from '../../shared/group/draft';
import { milestonesSchema } from '../../shared/modules/model';
import type { ModuleData } from '../../shared/modules/model';
import { exportModule } from './drafts';
type Milestones = Extract<ModuleData, { tool: 'milestones' }>;
export function MilestoneRules({ data: d }: { data: Milestones }) {
  const { t } = useApp(),
    total = d.stages.reduce((sum, s) => sum + BigInt(s.amount), 0n);
  return (
    <section className="cloud-card" aria-label={t('Frozen rules preview', '固定规则预览')}>
      <h2>{d.title}</h2>
      <p>{d.description}</p>
      <p>Monad Testnet · 10143 · AUSD</p>
      <p>
        {t('Buyer', '客户')}：<code>{d.buyer}</code>
      </p>
      <p>
        {t('Seller', '服务者')}：<code>{d.seller}</code>
      </p>
      <p>
        {t('Full prepayment', '全额预付')}：{formatUnits(total, 6)} AUSD
      </p>
      <p>
        {t('Fund before', '付款截止')}：{new Date(d.fundBy * 1000).toLocaleString()} ·{' '}
        {new Date(d.fundBy * 1000).toISOString()}
      </p>
      <p>
        {t('Dispute duration (hours)', '争议期限（小时）')}：{d.disputeDuration / 3600}
      </p>
      <ol className="cloud-list">
        {d.stages.map((s, n) => (
          <li key={n}>
            <h3>
              {n + 1}. {s.title}
            </h3>
            <p>{s.description}</p>
            <p>
              {formatUnits(BigInt(s.amount), 6)} AUSD ·{' '}
              {t('Work / review hours', '工作 / 验收小时')}：{s.workDuration / 3600} /{' '}
              {s.reviewDuration / 3600}
            </p>
          </li>
        ))}
      </ol>
      <p className="notice">
        {t(
          'Fund the whole plan once. Only the current stage can be submitted or released. The next work clock starts at the actual release of the previous stage. Silence until the review deadline releases that stage to the seller.',
          '整个计划一次全额预存。只有当前阶段可提交和释放。下一阶段从上一阶段实际结算时开始计时。验收截止仍未异议，该阶段款可结算给服务者。',
        )}
      </p>
      <p>
        {t(
          'Released stages cannot be clawed back. Missing delivery, seller refund or dispute timeout terminates the entire remaining plan and refunds all unreleased funds. A formal dispute stops future stages; any agreement must allocate all remaining funds and does not restart the plan. Credit needs a separate withdrawal.',
          '已释放阶段不可强制追回。未按时交付、服务者主动退款或争议超时会终止剩余计划，退还全部未释放款。正式争议停止后续阶段，协议须一次分配全部剩余款，结算后不恢复计划。可领取余额须单独提款。',
        )}
      </p>
    </section>
  );
}
export function MilestoneEditor({
  initial,
  busy,
  onSave,
}: {
  initial?: Milestones | undefined;
  busy: boolean;
  onSave: (data: ModuleData) => void;
}) {
  const { t } = useApp();
  const [title, setTitle] = useState(initial?.title ?? ''),
    [description, setDescription] = useState(initial?.description ?? ''),
    [buyer, setBuyer] = useState(initial?.buyer ?? ''),
    [seller, setSeller] = useState(initial?.seller ?? ''),
    [fundBy, setFundBy] = useState(
      localDateInput(initial?.fundBy ?? Math.floor(Date.now() / 60000) * 60 + 86400),
    ),
    [dispute, setDispute] = useState(String((initial?.disputeDuration ?? 604800) / 3600));
  const blank = () => ({ title: '', description: '', amount: '1', work: '168', review: '72' });
  const [stages, setStages] = useState(
      initial?.stages.map((s) => ({
        title: s.title,
        description: s.description,
        amount: formatUnits(BigInt(s.amount), 6),
        work: String(s.workDuration / 3600),
        review: String(s.reviewDuration / 3600),
      })) ?? [blank(), blank()],
    ),
    [preview, setPreview] = useState<Milestones | null>(null),
    [error, setError] = useState('');
  function change(index: number, key: keyof ReturnType<typeof blank>, value: string) {
    setStages((rows) => rows.map((r, n) => (n === index ? { ...r, [key]: value } : r)));
  }
  let total = '—';
  try {
    total = formatUnits(
      stages.reduce((sum, s) => sum + parseAmount(s.amount, 6), 0n),
      6,
    );
  } catch {
    /* Keep invalid totals visibly unavailable. */
  }
  return (
    <>
      <form
        className="cloud-card"
        onChange={() => setPreview(null)}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const data = milestonesSchema.parse({
              tool: 'milestones',
              title,
              description,
              buyer,
              seller,
              fundBy: parseLocalDate(fundBy),
              disputeDuration: Number(dispute) * 3600,
              stages: stages.map((s) => ({
                title: s.title,
                description: s.description,
                amount: parseAmount(s.amount, 6).toString(),
                workDuration: Number(s.work) * 3600,
                reviewDuration: Number(s.review) * 3600,
              })),
            });
            if (data.fundBy <= Date.now() / 1000) throw Error();
            setPreview(data);
            setError('');
          } catch {
            setPreview(null);
            setError(
              t(
                'Check different valid parties, 2–10 named positive stages, allowed durations and a future funding deadline.',
                '请检查不同双方地址、2–10个有名称且金额为正的阶段、合法时长和未来付款截止。',
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
        <label>
          {t('Buyer wallet', '客户钱包')}
          <input required value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        </label>
        <label>
          {t('Seller wallet', '服务者钱包')}
          <input required value={seller} onChange={(e) => setSeller(e.target.value)} />
        </label>
        <label>
          {t('Fund before (local time)', '付款截止（本地时间）')}
          <input
            type="datetime-local"
            required
            value={fundBy}
            onChange={(e) => setFundBy(e.target.value)}
          />
        </label>
        <label>
          {t('Dispute hours (24–720)', '争议小时数（24–720）')}
          <input
            type="number"
            min={24}
            max={720}
            required
            value={dispute}
            onChange={(e) => setDispute(e.target.value)}
          />
        </label>
        {stages.map((s, n) => (
          <fieldset key={n}>
            <legend>
              {t('Stage', '阶段')} {n + 1}
            </legend>
            <label>
              {t('Stage title', '阶段名称')}
              <input
                required
                maxLength={80}
                value={s.title}
                onChange={(e) => change(n, 'title', e.target.value)}
              />
            </label>
            <label>
              {t('Acceptance criteria (public)', '验收标准（公开）')}
              <textarea
                maxLength={500}
                value={s.description}
                onChange={(e) => change(n, 'description', e.target.value)}
              />
            </label>
            <label>
              {t('Stage amount (AUSD)', '阶段金额（AUSD）')}
              <input
                inputMode="decimal"
                required
                value={s.amount}
                onChange={(e) => change(n, 'amount', e.target.value)}
              />
            </label>
            <label>
              {t('Delivery hours (1–720)', '交付小时数（1–720）')}
              <input
                type="number"
                min={1}
                max={720}
                required
                value={s.work}
                onChange={(e) => change(n, 'work', e.target.value)}
              />
            </label>
            <label>
              {t('Review hours (1–168)', '验收小时数（1–168）')}
              <input
                type="number"
                min={1}
                max={168}
                required
                value={s.review}
                onChange={(e) => change(n, 'review', e.target.value)}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={busy || stages.length <= 2}
              onClick={() => {
                setStages((rows) => rows.filter((_, index) => index !== n));
                setPreview(null);
              }}
            >
              {t('Remove stage', '移除此阶段')} {n + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={busy || stages.length >= 10}
          onClick={() => {
            setStages((rows) => [...rows, blank()]);
            setPreview(null);
          }}
        >
          {t('Add stage', '增加阶段')}
        </button>
        <p>
          {t('Total prepayment', '预付总额')}：{total} AUSD
        </p>
        <p>
          {t(
            'All stages, addresses and criteria become public and immutable after publication. Do not include private files or contact details.',
            '所有阶段、地址和验收标准发布后公开且不可变，请勿填写私密文件或联系方式。',
          )}
        </p>
        <button className="button secondary" disabled={busy}>
          {t('Review rules', '预览规则')}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
      {preview ? (
        <>
          <MilestoneRules data={preview} />
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
    </>
  );
}
