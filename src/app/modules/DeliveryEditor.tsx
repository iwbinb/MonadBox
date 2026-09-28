import { useState } from 'react';
import { formatUnits } from 'viem';
import { useApp } from '../context';
import { parseAmount } from '../../shared/amount';
import { localDateInput, parseLocalDate } from '../../shared/group/draft';
import { deliverySchema } from '../../shared/modules/model';
import type { ModuleData } from '../../shared/modules/model';
import { exportModule } from './drafts';
type Delivery = Extract<ModuleData, { tool: 'deliver' }>;
export function DeliveryRules({ data: d }: { data: Delivery }) {
  const { t } = useApp();
  return (
    <section className="cloud-card" aria-label={t('Frozen rules preview', '固定规则预览')}>
      <h2>{d.title}</h2>
      <p>{d.description}</p>
      <p>Monad Testnet · 10143 · AUSD</p>
      <dl className="module-facts">
        <dt>{t('Buyer', '客户')}</dt>
        <dd>
          <code>{d.buyer}</code>
        </dd>
        <dt>{t('Seller', '服务者')}</dt>
        <dd>
          <code>{d.seller}</code>
        </dd>
        <dt>{t('Full prepayment', '全额预付')}</dt>
        <dd>{formatUnits(BigInt(d.amount), 6)} AUSD</dd>
        <dt>{t('Fund before', '付款截止')}</dt>
        <dd>
          {new Date(d.fundBy * 1000).toLocaleString()} · {new Date(d.fundBy * 1000).toISOString()}
        </dd>
        <dt>{t('Delivery / review / dispute (hours)', '交付 / 验收 / 争议期限（小时）')}</dt>
        <dd>
          {d.workDuration / 3600} / {d.reviewDuration / 3600} / {d.disputeDuration / 3600}
        </dd>
      </dl>
      <p className="notice">
        {t(
          'The delivery clock starts when funded. After submission, silence until the review deadline lets anyone release the full payment to the seller. The buyer must dispute before that deadline.',
          '交付计时从实际付款开始。提交交付后，验收期结束仍未提出异议，任何人均可将全款结算给服务者。客户须在验收截止前发起争议。',
        )}
      </p>
      <p>
        {t(
          'A dispute stops release. Both parties may sign a fixed allocation of all remaining funds; otherwise, dispute timeout refunds all remaining funds to the buyer. No platform arbitrator. Missing delivery also permits a full refund. Credits require separate withdrawal.',
          '争议会暂停放款。双方可签署全部剩余款的固定分配协议；未达成协议时，争议到期后全部剩余款退客户。平台不裁决。未按时交付也可全额退款。入账后须单独提款。',
        )}
      </p>
    </section>
  );
}
export function DeliveryEditor({
  initial,
  busy,
  onSave,
}: {
  initial?: Delivery | undefined;
  busy: boolean;
  onSave: (data: ModuleData) => void;
}) {
  const { t } = useApp();
  const [title, setTitle] = useState(initial?.title ?? ''),
    [description, setDescription] = useState(initial?.description ?? ''),
    [buyer, setBuyer] = useState(initial?.buyer ?? ''),
    [seller, setSeller] = useState(initial?.seller ?? ''),
    [amount, setAmount] = useState(initial ? formatUnits(BigInt(initial.amount), 6) : '1'),
    [fundBy, setFundBy] = useState(
      localDateInput(initial?.fundBy ?? Math.floor(Date.now() / 60000) * 60 + 86400),
    ),
    [work, setWork] = useState(String((initial?.workDuration ?? 604800) / 3600)),
    [review, setReview] = useState(String((initial?.reviewDuration ?? 259200) / 3600)),
    [dispute, setDispute] = useState(String((initial?.disputeDuration ?? 604800) / 3600)),
    [preview, setPreview] = useState<Delivery | null>(null),
    [error, setError] = useState('');
  return (
    <>
      <form
        className="cloud-card"
        onChange={() => setPreview(null)}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const d = deliverySchema.parse({
              tool: 'deliver',
              title,
              description,
              buyer,
              seller,
              amount: parseAmount(amount, 6).toString(),
              fundBy: parseLocalDate(fundBy),
              workDuration: Number(work) * 3600,
              reviewDuration: Number(review) * 3600,
              disputeDuration: Number(dispute) * 3600,
            });
            if (d.fundBy <= Date.now() / 1000) throw Error();
            setPreview(d);
            setError('');
          } catch {
            setPreview(null);
            setError(
              t(
                'Check different nonzero addresses, a positive amount, a future funding deadline and the duration limits.',
                '请检查双方非零且不同的地址、正金额、未来付款截止及期限范围。',
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
        <p>
          {t(
            'Published rules and addresses are public. Keep private delivery content out of this description. Only the buyer or seller can publish.',
            '发布的规则与地址公开，请勿在说明中填写私密交付内容。只有客户或服务者可以发布。',
          )}
        </p>
        <label>
          {t('Buyer wallet', '客户钱包')}
          <input required value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        </label>
        <label>
          {t('Seller wallet', '服务者钱包')}
          <input required value={seller} onChange={(e) => setSeller(e.target.value)} />
        </label>
        <label>
          {t('Full prepayment (AUSD)', '全额预付（AUSD）')}
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          {t('Fund before (local time)', '付款截止（本地时间）')}
          <input
            required
            type="datetime-local"
            value={fundBy}
            onChange={(e) => setFundBy(e.target.value)}
          />
        </label>
        <label>
          {t('Delivery hours (1–720)', '交付小时数（1–720）')}
          <input
            type="number"
            min={1}
            max={720}
            step={1}
            required
            value={work}
            onChange={(e) => setWork(e.target.value)}
          />
        </label>
        <label>
          {t('Review hours (1–168)', '验收小时数（1–168）')}
          <input
            type="number"
            min={1}
            max={168}
            step={1}
            required
            value={review}
            onChange={(e) => setReview(e.target.value)}
          />
        </label>
        <label>
          {t('Dispute hours (24–720)', '争议小时数（24–720）')}
          <input
            type="number"
            min={24}
            max={720}
            step={1}
            required
            value={dispute}
            onChange={(e) => setDispute(e.target.value)}
          />
        </label>
        <button className="button secondary" disabled={busy}>
          {t('Review rules', '预览规则')}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
      {preview ? (
        <>
          <DeliveryRules data={preview} />
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
            {t('Save reviewed draft', '保存已预览草稿')}
          </button>
        </>
      ) : null}
    </>
  );
}
