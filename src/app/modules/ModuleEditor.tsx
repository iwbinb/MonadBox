import { useState } from 'react';
import { formatUnits } from 'viem';
import { useApp } from '../context';
import { parseAmount } from '../../shared/amount';
import { localDateInput, parseLocalDate } from '../../shared/group/draft';
import { moduleDataSchema } from '../../shared/modules/model';
import type { ModuleData } from '../../shared/modules/model';
import { allocateSplit } from '../../shared/modules/terms';
export function ModuleRules({ data }: { data: ModuleData }) {
  const { t } = useApp();
  const [example, setExample] = useState('1');
  let shares: bigint[] | null = null;
  try {
    shares = allocateSplit(
      data.tool === 'group'
        ? BigInt(data.unitPrice) * BigInt(data.minimum)
        : parseAmount(example, 6),
      data.recipients.map((r) => r.bps),
    );
  } catch {
    /* Invalid preview amount has no transaction effect. */
  }
  return (
    <section className="cloud-card" aria-label={t('Frozen rules preview', '固定规则预览')}>
      <h2>{data.title}</h2>
      <p>{data.description}</p>
      <p>Monad Testnet · 10143 · {t('Test AUSD (6 decimals)', '测试 AUSD（6位小数）')}</p>
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
          <dd>{formatUnits(BigInt(data.unitPrice), 6)} AUSD</dd>
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
      ) : (
        <label>
          {t('Example payment (AUSD)', '模拟付款金额（AUSD）')}
          <input inputMode="decimal" value={example} onChange={(e) => setExample(e.target.value)} />
        </label>
      )}
      <h3>{t('Fixed recipients', '固定收款人')}</h3>
      <ol className="module-recipients">
        {data.recipients.map((row, index) => (
          <li key={row.address}>
            <code>{row.address}</code>
            <span>
              {(row.bps / 100).toFixed(2)}%
              {shares ? ` · ${formatUnits(shares[index]!, 6)} AUSD` : ''}
            </span>
          </li>
        ))}
      </ol>
      <p>
        {t(
          'Whole token units use largest remainders; ties follow the listed order. Credit is not a wallet transfer.',
          '按最小单位与最大余数分配，并列时按名单顺序。可领取余额不等于钱包到账。',
        )}
      </p>
    </section>
  );
}
export function ModuleEditor({
  tool,
  initial,
  busy,
  onSave,
}: {
  tool: ModuleData['tool'];
  initial?: ModuleData | undefined;
  busy: boolean;
  onSave: (data: ModuleData) => void;
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
  const [amount, setAmount] = useState(g ? formatUnits(BigInt(g.unitPrice), 6) : '1');
  const [minimum, setMinimum] = useState(String(g?.minimum ?? 2)),
    [capacity, setCapacity] = useState(String(g?.capacity ?? 20));
  const [startsAt, setStartsAt] = useState(localDateInput(g?.startsAt ?? time + 3600)),
    [deadline, setDeadline] = useState(localDateInput(g?.fundingDeadline ?? time + 86400)),
    [settle, setSettle] = useState(localDateInput(g?.settleNotBefore ?? time + 172800));
  const [preview, setPreview] = useState<ModuleData | null>(null),
    [error, setError] = useState('');
  function review() {
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
              unitPrice: parseAmount(amount, 6).toString(),
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
    <>
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
                  value={r.address}
                  onChange={(e) =>
                    setRecipients(
                      recipients.map((v, n) =>
                        n === index ? { ...v, address: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                {t('Share (%)', '比例（%）')} {index + 1}
                <input
                  required
                  inputMode="decimal"
                  value={r.percent}
                  onChange={(e) =>
                    setRecipients(
                      recipients.map((v, n) =>
                        n === index ? { ...v, percent: e.target.value } : v,
                      ),
                    )
                  }
                />
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
              {t('Price per person (AUSD)', '每人金额（AUSD）')}
              <input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
              />
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
        <button className="button secondary" disabled={busy}>
          {t('Review rules', '预览规则')}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
      {preview ? (
        <>
          <ModuleRules data={preview} />
          <button className="button primary" disabled={busy} onClick={() => onSave(preview)}>
            {t('Save reviewed draft', '保存已预览草稿')}
          </button>
        </>
      ) : null}
    </>
  );
}
