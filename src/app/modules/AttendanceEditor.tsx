import { useState } from 'react';
import { formatUnits } from 'viem';
import { useApp } from '../context';
import { parseAmount } from '../../shared/amount';
import { localDateInput, parseLocalDate } from '../../shared/group/draft';
import { attendanceSchema } from '../../shared/modules/model';
import type { ModuleData } from '../../shared/modules/model';
import { exportModule } from './drafts';
type Attendance = Extract<ModuleData, { tool: 'attend' }>;
export const attendanceDates = [
  ['registrationDeadline', 'Registration / exit deadline', '报名 / 退出截止'],
  ['eventStart', 'Event starts', '活动开始'],
  ['eventEnd', 'Event ends', '活动结束'],
  ['checkinStart', 'Check-in opens', '签到开始'],
  ['checkinDeadline', 'Check-in deadline', '签到截止'],
  ['challengeDeadline', 'Appeal deadline', '申诉截止'],
] as const;
export function AttendanceRules({ data: d }: { data: Attendance }) {
  const { t } = useApp(),
    penalty = (BigInt(d.deposit) * BigInt(d.noShowPenaltyBps)) / 10000n;
  return (
    <section className="cloud-card" aria-label={t('Frozen rules preview', '固定规则预览')}>
      <h2>{d.title}</h2>
      <p>{d.description}</p>
      <p>Monad Testnet · 10143 · AUSD</p>
      <p>
        {t('Deposit per person', '每人押金')}：{formatUnits(BigInt(d.deposit), 6)} AUSD ·{' '}
        {t('Capacity', '人数上限')}：{d.capacity}
      </p>
      <p className="notice">
        {t('Worst no-show deduction', '缺席最坏扣款')}：{formatUnits(penalty, 6)} AUSD（
        {(d.noShowPenaltyBps / 100).toFixed(2)}%）。
        {t(
          'Check-in relies on the fixed signer’s statement. Submit the signed proof on-chain before the check-in deadline, or appeal within the stated appeal window. Silence can result in the fixed deduction.',
          '签到依赖固定签到方的声明。必须在签到截止前将证明提交上链，否则应在申诉窗口内提出申诉。未及时处理可能按固定比例扣款。',
        )}
      </p>
      <dl className="module-facts">
        <dt>{t('Fixed check-in signer', '固定签到方')}</dt>
        <dd>
          <code>{d.checkinSigner}</code>
        </dd>
        <dt>{t('Penalty beneficiary', '罚款受益人')}</dt>
        <dd>
          <code>{d.penaltyBeneficiary}</code>
        </dd>
        {attendanceDates.map(([key, en, zh]) => (
          <div key={key}>
            <dt>{t(en, zh)}</dt>
            <dd>
              {new Date(d[key] * 1000).toLocaleString()} · {new Date(d[key] * 1000).toISOString()}
            </dd>
          </div>
        ))}
        <dt>{t('Dispute duration (hours)', '争议期限（小时）')}</dt>
        <dd>{d.disputeDuration / 3600}</dd>
      </dl>
      <p>
        {t(
          'Exit before registration closes; an address cannot rejoin. Check-in returns the full deposit as credit. An individual appeal blocks only that deposit: organizer refund, bilateral settlement, or full refund after dispute timeout. Cancellation refunds only unprocessed deposits. Withdraw credit separately.',
          '报名截止前可退出，同一地址退出后不能重进。签到后全额押金记入可领取余额。个人申诉只冻结本人押金：组织者可全退、双方可协商，争议超时则全退。取消活动仅退尚未处理的押金。可领取余额须单独提款。',
        )}
      </p>
    </section>
  );
}
export function AttendanceEditor({
  initial,
  busy,
  onSave,
}: {
  initial?: Attendance | undefined;
  busy: boolean;
  onSave: (data: ModuleData) => void;
}) {
  const { t } = useApp(),
    start = Math.floor(Date.now() / 60000) * 60 + 86400;
  const [title, setTitle] = useState(initial?.title ?? ''),
    [description, setDescription] = useState(initial?.description ?? ''),
    [deposit, setDeposit] = useState(initial ? formatUnits(BigInt(initial.deposit), 6) : '1'),
    [capacity, setCapacity] = useState(String(initial?.capacity ?? 20)),
    [penalty, setPenalty] = useState(String((initial?.noShowPenaltyBps ?? 2500) / 100)),
    [signer, setSigner] = useState(initial?.checkinSigner ?? ''),
    [beneficiary, setBeneficiary] = useState(initial?.penaltyBeneficiary ?? ''),
    [dispute, setDispute] = useState(String((initial?.disputeDuration ?? 604800) / 3600));
  const defaults = {
    registrationDeadline: start - 3600,
    eventStart: start,
    eventEnd: start + 7200,
    checkinStart: start - 900,
    checkinDeadline: start + 8100,
    challengeDeadline: start + 94500,
  };
  const [times, setTimes] = useState(
      Object.fromEntries(
        attendanceDates.map(([key]) => [key, localDateInput(initial?.[key] ?? defaults[key])]),
      ) as Record<(typeof attendanceDates)[number][0], string>,
    ),
    [preview, setPreview] = useState<Attendance | null>(null),
    [error, setError] = useState('');
  return (
    <>
      <form
        className="cloud-card"
        onChange={() => setPreview(null)}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const d = attendanceSchema.parse({
              tool: 'attend',
              title,
              description,
              deposit: parseAmount(deposit, 6).toString(),
              capacity: Number(capacity),
              noShowPenaltyBps: Number(parseAmount(penalty, 2)),
              checkinSigner: signer,
              penaltyBeneficiary: beneficiary,
              disputeDuration: Number(dispute) * 3600,
              ...Object.fromEntries(
                attendanceDates.map(([key]) => [key, parseLocalDate(times[key])]),
              ),
            });
            if (d.registrationDeadline <= Date.now() / 1000) throw Error();
            setPreview(d);
            setError('');
          } catch {
            setPreview(null);
            setError(
              t(
                'Check valid nonzero addresses, a positive deposit, 1–200 places, penalty 0–100%, and ordered future event times.',
                '请检查非零地址、正数押金、1–200名额、0–100%扣款比例和正确顺序的未来活动时间。',
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
          {t('Deposit per person (AUSD)', '每人押金（AUSD）')}
          <input
            inputMode="decimal"
            required
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
          />
        </label>
        <label>
          {t('Capacity', '人数上限')}
          <input
            type="number"
            min={1}
            max={200}
            required
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
        <label>
          {t('No-show penalty (%)', '缺席扣款（%）')}
          <input
            inputMode="decimal"
            required
            value={penalty}
            onChange={(e) => setPenalty(e.target.value)}
          />
        </label>
        <label>
          {t('Fixed check-in signer', '固定签到方')}
          <input required value={signer} onChange={(e) => setSigner(e.target.value)} />
        </label>
        <label>
          {t('Penalty beneficiary', '罚款受益人')}
          <input required value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} />
        </label>
        <p>
          {t(
            'The publishing wallet is the organizer. All rules and addresses become public and cannot be changed after publication. Sign-in does not issue check-in proofs.',
            '发布钱包是组织者。所有规则和地址发布后公开且不可更改。登录签名不签发到场证明。',
          )}
        </p>
        {attendanceDates.map(([key, en, zh]) => (
          <label key={key}>
            {t(en, zh)}
            {t(' (local time)', '（本地时间）')}
            <input
              required
              type="datetime-local"
              value={times[key]}
              onChange={(e) => setTimes({ ...times, [key]: e.target.value })}
            />
          </label>
        ))}
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
          <AttendanceRules data={preview} />
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
