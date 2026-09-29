import {
  IconCalendar,
  IconClock,
  IconShieldCheck,
  IconUsers,
  IconCheck,
  IconWallet,
} from '@tabler/icons-react';
import { formatUnits } from 'viem';
import type { ReactNode } from 'react';
import { useApp } from '../context';
import type { ModulePublication } from '../../shared/modules/model';
import type { ModuleSnapshot } from '../../shared/modules/chain';
import { statusLabel } from '../shared/status';

interface Props {
  publication: ModulePublication;
  snapshot: ModuleSnapshot;
  children?: ReactNode;
}
const mon = (value: string | bigint) => formatUnits(BigInt(value), 18);
const date = (value: number, locale: string) =>
  new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value * 1000));

export function PublicOverview({ publication: p, snapshot: s, children }: Props) {
  const { t, locale } = useApp(),
    d = p.data;
  if (d.tool === 'attend')
    return (
      <>
        <div className="event-banner">
          <div>
            <span>BUILD TOGETHER</span>
            <strong>{d.title}</strong>
            <p>MONAD TESTNET · ATTEND</p>
          </div>
          <img src="/images/cooperation-box.png" alt="" />
        </div>
        <p className="public-description">{d.description}</p>
        <p className="icon-line">
          <IconCalendar size={22} />
          {date(d.eventStart, locale)} – {date(d.eventEnd, locale)}
        </p>
        <section className="cloud-card public-rules">
          <h2>{t('Read before joining', '参加前先看清规则')}</h2>
          <ol className="rule-list">
            <li>
              <span>1</span>
              <div>
                <h3>{t('Exit before registration closes', '报名截止前可退出')}</h3>
                <p>
                  {date(d.registrationDeadline, locale)} ·{' '}
                  {t(
                    'Your full deposit becomes refundable credit. An address cannot rejoin after leaving.',
                    '全额押金转为可领取款，同地址退出后不能再次报名。',
                  )}
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>{t('Submit a valid check-in proof', '提交有效签到后，押金全额可领取')}</h3>
                <p>
                  {t(
                    'The fixed signer confirms attendance. Submit their proof before the check-in deadline, then withdraw your credit.',
                    '签到由固定签到方确认，请在截止前提交证明上链，再将可领取款提到钱包。',
                  )}
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>
                  {t('A missed check-in can incur a deduction', '未签到且未申诉，将按规则扣款')}
                </h3>
                <p>
                  {t('Maximum deduction', '最高扣款')}{' '}
                  {mon((BigInt(d.deposit) * BigInt(d.noShowPenaltyBps)) / 10000n)} MON ·{' '}
                  {d.noShowPenaltyBps / 100}%
                </p>
              </div>
            </li>
          </ol>
          <p className="notice icon-line">
            <IconClock size={22} />
            {t('Appeal before', '申诉截止')} {date(d.challengeDeadline, locale)}
          </p>
        </section>
      </>
    );
  if (d.tool === 'milestones') {
    const total = d.stages.reduce((n, stage) => n + BigInt(stage.amount), 0n);
    return (
      <>
        <p className="public-description">{d.description}</p>
        <div className="project-totals">
          <div>
            <span>{t('Project total', '项目总额')}</span>
            <strong>{mon(total)} MON</strong>
          </div>
          <div>
            <span>{t('Released to seller credit', '已释放')}</span>
            <strong>{mon(s.released ?? '0')} MON</strong>
          </div>
          <div>
            <span>{t('Still in escrow', '仍托管')}</span>
            <strong>{mon(s.locked)} MON</strong>
          </div>
        </div>
        <ol className="stage-timeline">
          {d.stages.map((stage, index) => {
            const done = index < (s.currentStage ?? 0) || s.state === 'COMPLETED';
            const current = index === s.currentStage;
            return (
              <li key={index} className={done ? 'complete' : current ? 'current' : ''}>
                <span className="stage-number">{done ? <IconCheck size={20} /> : index + 1}</span>
                <div>
                  <div className="stage-heading">
                    <h2>{stage.title}</h2>
                    <span className="status-label">
                      {done
                        ? t('Released', '已释放')
                        : current
                          ? statusLabel(s.state, t)
                          : ['TERMINATED', 'RESOLVED', 'CANCELLED', 'EXPIRED'].includes(s.state)
                            ? t('Ended', '已终止')
                            : t('Upcoming', '待开始')}
                    </span>
                  </div>
                  <strong>{mon(stage.amount)} MON</strong>
                  <p>{stage.description}</p>
                  <p className="muted">
                    {t('Delivery / review', '交付 / 验收')} · {stage.workDuration / 3600} /{' '}
                    {stage.reviewDuration / 3600} {t('hours', '小时')}
                  </p>
                  {current && s.reviewDue ? (
                    <p className="icon-line">
                      <IconClock size={18} />
                      {t('Review before', '验收截止')} {date(s.reviewDue, locale)}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {children}
        <p className="notice">
          {t(
            'Released funds cannot be forced back. A dispute covers all remaining escrow. Review the current stage before releasing it.',
            '已释放款项不可强制追回，争议处理全部剩余托管款。请先核对当前阶段，再确认放款。',
          )}
        </p>
      </>
    );
  }
  if (d.tool === 'deliver') {
    const step =
      s.state === 'AWAITING_FUNDS'
        ? 0
        : s.state === 'FUNDED'
          ? 1
          : s.state === 'SUBMITTED' || s.state === 'DISPUTED'
            ? 2
            : 3;
    return (
      <>
        <p className="public-description">{d.description}</p>
        <ol className="delivery-progress">
          {[
            [t('Prepay', '预存款项'), t('Held by the contract', '款项保留在合约中')],
            [t('Create', '制作交付'), t('Seller submits the work', '服务方提交成果')],
            [t('Review', '查看验收'), t('Accept or raise a dispute', '确认交付或提出异议')],
            [t('Withdraw', '按结果提款'), t('Credit follows the outcome', '按结算结果领取款项')],
          ].map(([title, desc], i) => (
            <li key={title} className={i < step ? 'complete' : i === step ? 'current' : ''}>
              <span>{i < step ? <IconCheck size={18} /> : i + 1}</span>
              <strong>{title}</strong>
              <small>{desc}</small>
            </li>
          ))}
        </ol>
        {children}
        <section className="cloud-card public-rules">
          <h2>{t('What you agreed to deliver', '约定交付内容')}</h2>
          <p>
            {d.description ||
              t(
                'Review the fixed rules and private files before accepting.',
                '请核对固定规则与私密文件后再验收。',
              )}
          </p>
          <p className="notice icon-line">
            <IconShieldCheck size={22} />
            {t(
              'After submission, the payment may be released when the review period ends. Raise a dispute before that deadline if needed.',
              '提交交付后，验收期结束可能允许结算。如有异议，请在验收截止前提出。',
            )}
          </p>
        </section>
        <section className="cloud-card">
          <h2>{t('People in this agreement', '相关方')}</h2>
          <dl className="summary-rows">
            <div>
              <dt>{t('Buyer', '客户')}</dt>
              <dd>
                <code>{d.buyer}</code>
              </dd>
            </div>
            <div>
              <dt>{t('Seller', '服务者')}</dt>
              <dd>
                <code>{d.seller}</code>
              </dd>
            </div>
          </dl>
        </section>
      </>
    );
  }
  return (
    <section className="cloud-card">
      <p className="public-description">{d.description}</p>
      {d.tool === 'split' ? (
        <p className="notice public-payment-rule">
          {t(
            'Final payment: the payer cannot force a refund after payment. Each recipient withdraws their own credit.',
            '最终付款：付款后不能强制追回。各收款人分别提取自己的可领取余额。',
          )}
        </p>
      ) : d.tool === 'group' ? (
        <p className="notice public-payment-rule">
          {t(
            'A failed or cancelled group refunds participants. A successful group settles to these fixed recipients at the agreed time; it does not prove delivery.',
            '未成团或取消时退款给参与者；成团后到约定时间按固定名单分账。成团不代表已交付。',
          )}
        </p>
      ) : null}
      <h2>{t('Fixed recipients', '固定收款人')}</h2>
      <ol className="public-recipient-list">
        {d.recipients.map((row, index) => (
          <li key={row.address}>
            <span>{index + 1}</span>
            <code>{row.address}</code>
            <strong>{'amount' in row ? `${mon(row.amount)} MON` : `${row.bps / 100}%`}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PublicAmount({ publication: p, snapshot: s }: Props) {
  const { t, locale } = useApp(),
    d = p.data;
  const amount =
    d.tool === 'attend'
      ? d.deposit
      : d.tool === 'deliver'
        ? d.amount
        : d.tool === 'milestones'
          ? (d.stages[s.currentStage ?? 0]?.amount ?? '0')
          : s.locked;
  return (
    <section className="cloud-card public-amount-card">
      <h2>
        {d.tool === 'attend'
          ? t('Reserve a place', '预留一个席位')
          : d.tool === 'milestones'
            ? t('Release funds by progress', '资金按进度释放')
            : d.tool === 'deliver'
              ? t('Review this delivery', '本次交付与验收')
              : d.tool === 'split'
                ? t('Pay by fixed shares', '按固定比例分账')
                : t('Remaining rewards', '剩余奖励')}
      </h2>
      <div className="payment-amount">
        {d.tool === 'split' ? (
          'MON'
        ) : (
          <>
            {mon(amount)} <small>MON</small>
          </>
        )}
      </div>
      <p>
        {d.tool === 'attend'
          ? t('Refundable registration deposit', '报名押金')
          : d.tool === 'milestones'
            ? t('Current stage amount', '当前阶段金额')
            : d.tool === 'deliver'
              ? t('Agreed total payment', '约定付款总额')
              : d.tool === 'split'
                ? t('Enter your payment amount below', '在下方填写本次付款金额')
                : t('Unclaimed rewards held by this Box', '当前 Box 保留的未领取奖励')}
      </p>
      {d.tool === 'attend' ? (
        <>
          <progress
            max={d.capacity}
            value={s.activeCount}
            aria-label={t('Registered places', '已报名名额')}
          />
          <p className="icon-line">
            <IconUsers size={20} />
            {s.activeCount} / {d.capacity} {t('places', '份')}
          </p>
          <p className="icon-line">
            <IconCalendar size={20} />
            {t('Registration closes', '报名截止')} {date(d.registrationDeadline, locale)}
          </p>
          <p className="notice deduction">
            {t('Maximum no-show deduction', '未到场最高扣除')}{' '}
            {mon((BigInt(d.deposit) * BigInt(d.noShowPenaltyBps)) / 10000n)} MON
          </p>
        </>
      ) : (
        <p>
          {t('Remaining in escrow', '剩余保留款')} · {mon(s.locked)} MON
        </p>
      )}
      {s.state === 'SUBMITTED' && s.reviewDue ? (
        <p className="icon-line">
          <IconClock size={20} />
          {t('Review before', '验收截止')} {date(s.reviewDue, locale)}
        </p>
      ) : null}
      <p className="icon-line">
        <IconWallet size={20} />
        {t(
          'Monad Testnet · payments and network fees in MON',
          'Monad 测试网 · 付款与网络费均使用 MON',
        )}
      </p>
    </section>
  );
}
