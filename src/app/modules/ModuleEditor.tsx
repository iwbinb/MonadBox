import { SplitAside } from './EditorAside';
import { RewardsEditor, RewardsRules } from './RewardsEditor';
import { MilestoneEditor, MilestoneRules } from './MilestoneEditor';
import { AttendanceEditor, AttendanceRules } from './AttendanceEditor';
import { DeliveryEditor, DeliveryRules } from './DeliveryEditor';
import { useState } from 'react';
import { formatUnits, isAddress } from 'viem';
import { useApp } from '../context';
import { parseAmount } from '../../shared/amount';
import { localDateInput, parseLocalDate } from '../../shared/group/draft';
import { moduleDataSchema } from '../../shared/modules/model';
import type { ModuleData } from '../../shared/modules/model';
import { allocateSplit } from '../../shared/modules/terms';
import { exportModule } from './drafts';
export function ModuleRules({ data }: { data: ModuleData }) {
  if (data.tool === 'rewards') return <RewardsRules data={data} />;
  if (data.tool === 'attend') return <AttendanceRules data={data} />;
  if (data.tool === 'milestones') return <MilestoneRules data={data} />;
  return data.tool === 'deliver' ? <DeliveryRules data={data} /> : <SplitGroupRules data={data} />;
}
function SplitGroupRules({ data }: { data: Extract<ModuleData, { tool: 'split' | 'group' }> }) {
  const { t } = useApp();
  let shares: bigint[] | null = null;
  if (data.tool === 'group')
    try {
      shares = allocateSplit(
        BigInt(data.unitPrice) * BigInt(data.minimum),
        data.recipients.map((r) => r.bps),
      );
    } catch {
      /* Invalid preview amount has no transaction effect. */
    }
  return (
    <section className="cloud-card" aria-label={t('Frozen rules preview', '固定规则预览')}>
      <h2>{data.title}</h2>
      <p>{data.description}</p>
      <p>Monad Testnet · 10143 · {t('Test MON (18 decimals)', '测试 MON（18位小数）')}</p>
      <p className="notice">
        {data.tool === 'split'
          ? t(
              'Final payment: the payer cannot force a refund after payment. Each recipient withdraws their own credit.',
              '最终付款：付款后不能强制追回。各收款人分别提取自己的可领取余额。',
            )
          : t(
              'The split is frozen at creation. A failed or cancelled group refunds participants. Success allows settlement at the agreed time; it does not prove delivery.',
              '创建时固定分账方案。未成团或取消时退给参与者；成功且到约定时间可结算，成团不代表已交付。',
            )}
      </p>
      {data.tool === 'group' ? (
        <dl className="module-facts">
          <dt>{t('Each participant', '每人付款')}</dt>
          <dd>{formatUnits(BigInt(data.unitPrice), 18)} MON</dd>
          <dt>{t('Target / capacity', '目标 / 上限')}</dt>
          <dd>
            {data.minimum} / {data.capacity}
          </dd>
          {(
            [
              ['startsAt', 'Starts', '开始'],
              ['fundingDeadline', 'Funding deadline', '募集截止'],
              ['settleNotBefore', 'Earliest settlement', '最早结算'],
            ] as const
          ).map(([key, en, zh]) => (
            <div key={key}>
              <dt>{t(en, zh)}</dt>
              <dd>
                {new Date(data[key] * 1000).toLocaleString()} ·{' '}
                {new Date(data[key] * 1000).toISOString()}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <h3>{t('Fixed recipients', '固定收款人')}</h3>
      <ol className="module-recipients">
        {data.recipients.map((row, index) => (
          <li key={row.address}>
            <code>{row.address}</code>
            <span>
              {(row.bps / 100).toFixed(2)}%
              {shares ? ` · ${formatUnits(shares[index]!, 18)} MON` : ''}
            </span>
          </li>
        ))}
      </ol>
      {data.tool === 'group' ? (
        <p>
          {t(
            'Whole token units use largest remainders; ties follow the listed order. Credit is not a wallet transfer.',
            '按最小单位与最大余数分配，并列时按名单顺序。可领取余额不等于钱包到账。',
          )}
        </p>
      ) : null}
    </section>
  );
}
interface EditorProps {
  tool: ModuleData['tool'];
  initial?: ModuleData | undefined;
  busy: boolean;
  onSave: (data: ModuleData) => void;
  continueToPublish?: boolean;
}
export function ModuleEditor(props: EditorProps) {
  if (props.tool === 'rewards')
    return (
      <RewardsEditor
        busy={props.busy}
        onSave={props.onSave}
        initial={props.initial?.tool === 'rewards' ? props.initial : undefined}
      />
    );
  if (props.tool === 'milestones')
    return (
      <MilestoneEditor
        busy={props.busy}
        onSave={props.onSave}
        initial={props.initial?.tool === 'milestones' ? props.initial : undefined}
      />
    );
  if (props.tool === 'attend')
    return (
      <AttendanceEditor
        busy={props.busy}
        onSave={props.onSave}
        initial={props.initial?.tool === 'attend' ? props.initial : undefined}
      />
    );
  return props.tool === 'deliver' ? (
    <DeliveryEditor
      busy={props.busy}
      onSave={props.onSave}
      initial={props.initial?.tool === 'deliver' ? props.initial : undefined}
    />
  ) : (
    <SplitGroupEditor
      {...props}
      initial={
        props.initial?.tool === 'group' || props.initial?.tool === 'split'
          ? props.initial
          : undefined
      }
    />
  );
}
function SplitGroupEditor({
  tool,
  initial,
  busy,
  onSave,
  continueToPublish,
}: {
  tool: ModuleData['tool'];
  initial?: Extract<ModuleData, { tool: 'split' | 'group' }> | undefined;
  busy: boolean;
  onSave: (data: ModuleData) => void;
  continueToPublish?: boolean;
}) {
  const { t } = useApp();
  const time = Math.floor(Date.now() / 60000) * 60;
  const g = initial?.tool === 'group' ? initial : undefined;
  const [title, setTitle] = useState(initial?.title ?? ''),
    [description, setDescription] = useState(initial?.description ?? '');
  const [recipients, setRecipients] = useState(
    initial?.recipients.map((r) => ({
      address: r.address as string,
      percent: (r.bps / 100).toFixed(2),
    })) ?? [
      { address: '', percent: '70' },
      { address: '', percent: '30' },
    ],
  );
  const [amount, setAmount] = useState(g ? formatUnits(BigInt(g.unitPrice), 18) : '1');
  const [minimum, setMinimum] = useState(String(g?.minimum ?? 2)),
    [capacity, setCapacity] = useState(String(g?.capacity ?? 20));
  const [startsAt, setStartsAt] = useState(localDateInput(g?.startsAt ?? time + 3600)),
    [deadline, setDeadline] = useState(localDateInput(g?.fundingDeadline ?? time + 86400)),
    [settle, setSettle] = useState(localDateInput(g?.settleNotBefore ?? time + 172800));
  const [preview, setPreview] = useState<ModuleData | null>(null),
    [error, setError] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  function review() {
    const issues: Record<string, string> = {};
    const seen = new Set<string>();
    let total = 0;
    recipients.forEach((r, index) => {
      if (
        !isAddress(r.address) ||
        /^0x0{40}$/i.test(r.address) ||
        seen.has(r.address.toLowerCase())
      )
        issues[`address-${index}`] = t(
          'Enter a unique, nonzero wallet address.',
          '请输入非零且不重复的钱包地址。',
        );
      seen.add(r.address.toLowerCase());
      try {
        const bps = parseAmount(r.percent, 2);
        if (bps === 0n || bps > 10000n) throw Error();
        total += Number(bps);
      } catch {
        issues[`share-${index}`] = t(
          'Use a positive percentage with at most two decimals.',
          '比例须大于0、不超过100，最多两位小数。',
        );
      }
    });
    if (total !== 10000)
      issues.recipients = t('Shares must add up to exactly 100%.', '比例合计必须恰好为100%。');
    if (tool === 'group') {
      try {
        if (parseAmount(amount, 18) === 0n) throw Error();
      } catch {
        issues.amount = t(
          'Use a positive MON amount with at most 18 decimals.',
          '请输入正数 MON 金额，最多18位小数。',
        );
      }
      const start = parseLocalDate(startsAt),
        end = parseLocalDate(deadline),
        release = parseLocalDate(settle);
      if (!start || !end || !release || start >= end || end > release)
        issues.times = t(
          'Start must precede the deadline; settlement cannot precede the deadline.',
          '开始时间须早于募集截止，结算不能早于募集截止。',
        );
      if (
        !/^\d+$/.test(minimum) ||
        !/^\d+$/.test(capacity) ||
        Number(minimum) < 2 ||
        Number(capacity) > 200 ||
        Number(minimum) > Number(capacity)
      )
        issues.capacity = t(
          'Use 2–200 places, with capacity at least the target.',
          '人数为2至200，上限不能小于目标。',
        );
    }
    setProblems(issues);
    if (Object.keys(issues).length) {
      setPreview(null);
      setError(t('Correct the marked fields before reviewing.', '请先修正标记的字段。'));
      return;
    }
    try {
      const data = {
        tool,
        title,
        description,
        recipients: recipients.map((r) => ({
          address: r.address,
          bps: Number(parseAmount(r.percent, 2)),
        })),
        ...(tool === 'group'
          ? {
              unitPrice: parseAmount(amount, 18).toString(),
              minimum: Number(minimum),
              capacity: Number(capacity),
              startsAt: parseLocalDate(startsAt),
              fundingDeadline: parseLocalDate(deadline),
              settleNotBefore: parseLocalDate(settle),
            }
          : {}),
      };
      setPreview(moduleDataSchema.parse(data));
      setError('');
    } catch {
      setPreview(null);
      setError(
        t(
          'Check the title, unique wallet addresses, positive shares totaling 100%, and valid amounts and times.',
          '请检查标题、不同的钱包地址、合计100%的正比例，以及金额和时间。',
        ),
      );
    }
  }
  return (
    <div className={`module-editor-layout ${tool}-editor`}>
      <form
        className="cloud-card"
        onChange={() => setPreview(null)}
        onSubmit={(e) => {
          e.preventDefault();
          review();
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
        <p>
          {t(
            'Addresses and rules become public when published. Do not include private contact details or delivery files.',
            '发布后地址和规则公开，请勿填写私人联系方式或交付文件。',
          )}
        </p>
        <fieldset>
          <legend>{t('Recipients and percentages', '收款地址与比例')}</legend>
          {recipients.map((r, index) => (
            <div className="module-recipient-row" key={index}>
              <label>
                {t('Recipient', '收款人')} {index + 1}
                <input
                  required
                  aria-invalid={!!problems[`address-${index}`]}
                  aria-describedby={
                    problems[`address-${index}`] ? `module-address-${index}` : undefined
                  }
                  value={r.address}
                  onChange={(e) =>
                    setRecipients(
                      recipients.map((v, n) =>
                        n === index ? { ...v, address: e.target.value } : v,
                      ),
                    )
                  }
                />
                {problems[`address-${index}`] ? (
                  <small id={`module-address-${index}`}>{problems[`address-${index}`]}</small>
                ) : null}
              </label>
              <label>
                {t('Share (%)', '比例（%）')} {index + 1}
                <input
                  required
                  inputMode="decimal"
                  aria-invalid={!!problems[`share-${index}`]}
                  aria-describedby={
                    problems[`share-${index}`] ? `module-share-${index}` : undefined
                  }
                  value={r.percent}
                  onChange={(e) =>
                    setRecipients(
                      recipients.map((v, n) =>
                        n === index ? { ...v, percent: e.target.value } : v,
                      ),
                    )
                  }
                />
                {problems[`share-${index}`] ? (
                  <small id={`module-share-${index}`}>{problems[`share-${index}`]}</small>
                ) : null}
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={recipients.length <= 2}
                onClick={() => {
                  setRecipients(recipients.filter((_, n) => n !== index));
                  setPreview(null);
                }}
                aria-label={t(`Remove recipient ${index + 1}`, `移除收款人${index + 1}`)}
              >
                {t('Remove', '移除')}
              </button>
            </div>
          ))}
          {problems.recipients ? <p>{problems.recipients}</p> : null}
          <button
            type="button"
            className="button secondary"
            disabled={recipients.length >= 20}
            onClick={() => {
              setRecipients([...recipients, { address: '', percent: '' }]);
              setPreview(null);
            }}
          >
            {t('Add recipient', '添加收款人')}
          </button>
        </fieldset>
        {tool === 'group' ? (
          <fieldset>
            <legend>{t('Collection rules', '成团规则')}</legend>
            <label>
              {t('Price per person (MON)', '每人金额（MON）')}
              <input
                value={amount}
                inputMode="decimal"
                aria-invalid={!!problems.amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {problems.amount ? <small>{problems.amount}</small> : null}
            </label>
            <label>
              {t('Target participants', '成团人数')}
              <input
                type="number"
                min={2}
                max={200}
                value={minimum}
                onChange={(e) => setMinimum(e.target.value)}
              />
            </label>
            <label>
              {t('Capacity', '人数上限')}
              <input
                type="number"
                min={2}
                max={200}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </label>
            <label>
              {t('Collection starts (local time)', '开始募集（本地时间）')}
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label>
              {t('Collection deadline (local time)', '募集截止（本地时间）')}
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
            <label>
              {t('Earliest settlement (local time)', '最早结算（本地时间）')}
              <input
                type="datetime-local"
                value={settle}
                onChange={(e) => setSettle(e.target.value)}
              />
            </label>
          </fieldset>
        ) : null}
        {problems.capacity ? <p>{problems.capacity}</p> : null}
        {problems.times ? <p>{problems.times}</p> : null}
        <button className="button secondary" disabled={busy}>
          {t('Review rules', '预览规则')}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
      {!preview ? <SplitAside tool={tool} amount={amount} recipients={recipients} /> : null}
      {preview ? (
        <>
          <ModuleRules data={preview} />
          <details className="cloud-card">
            <summary>
              {t('Export reviewed rules without saving', '导出已预览规则，无需保存')}
            </summary>
            <textarea
              aria-label={t('Reviewed rules JSON', '已预览规则 JSON')}
              rows={6}
              readOnly
              value={exportModule(preview)}
            />
          </details>
          <button className="button primary" disabled={busy} onClick={() => onSave(preview)}>
            {continueToPublish
              ? t('Save and continue to publish', '保存并继续发布')
              : t('Save reviewed draft', '保存已预览草稿')}
          </button>
        </>
      ) : null}
    </div>
  );
}
