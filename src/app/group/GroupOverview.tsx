import { IconClock, IconShieldCheck, IconFlag } from '@tabler/icons-react';
import { formatUnits } from 'viem';
import { useApp } from '../context';
import { ToolIcon } from '../components';
import type { PublicGroup } from '../../shared/cloud/model';
export function GroupOverview({ group: g }: { group: PublicGroup }) {
  const { t, locale } = useApp(),
    d = g.data;
  const rules = [
    {
      icon: IconClock,
      title: t('Exit before the collection deadline', '募集截止前可退出'),
      text:
        new Date(d.fundingDeadline * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB') +
        ' · ' +
        t(
          'Your payment becomes refundable credit. The same address cannot rejoin.',
          '已付款项转为可领取款，同地址不能再次加入。',
        ),
    },
    {
      icon: IconShieldCheck,
      title: t('A failed group returns your principal', '截止未成团：本金可退款'),
      text: t(
        'If the target is missed or the organizer cancels, participants can claim their full payment.',
        '未达到最低份数或组织者取消时，参与者可领取全额退款。',
      ),
    },
    {
      icon: IconFlag,
      title: t(
        'A successful group settles at the agreed time',
        '成团且到结算时间：按固定收款方结算',
      ),
      text:
        new Date(d.settleNotBefore * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB') +
        ' · ' +
        t('A successful group does not prove delivery.', '成团不代表实际交付完成。'),
    },
  ];
  return (
    <>
      <div className="public-group-title">
        <span className="tool-icon">
          <ToolIcon id="group" />
        </span>
        <div>
          <h2>{d.title}</h2>
          <p>{d.description}</p>
        </div>
      </div>
      <div className="project-totals">
        <div>
          <span>{t('Per participant', '每人参与金额')}</span>
          <strong>{formatUnits(BigInt(d.unitPrice), 18)} MON</strong>
        </div>
        <div>
          <span>{t('Current / target', '当前参与 / 成团目标')}</span>
          <strong>
            {g.snapshot.activeCount} / {d.minimum}
          </strong>
        </div>
        <div>
          <span>{t('Capacity', '名额上限')}</span>
          <strong>{d.capacity}</strong>
        </div>
      </div>
      <progress
        max={d.minimum}
        value={Math.min(g.snapshot.activeCount, d.minimum)}
        aria-label={t('Group progress', '成团进度')}
      />
      <p className="progress-caption">
        {g.snapshot.activeCount} / {d.minimum} ·{' '}
        {g.snapshot.activeCount >= d.minimum
          ? t('Target reached', '已达到成团人数')
          : t(
              `${d.minimum - g.snapshot.activeCount} more to reach the target`,
              `还需 ${d.minimum - g.snapshot.activeCount} 份即可成团`,
            )}
      </p>
      <h2 className="rules-title">{t('Group rules', '团组规则')}</h2>
      <div className="cloud-card public-rules">
        {rules.map(({ icon: Icon, title, text }) => (
          <div className="rule-row" key={title}>
            <Icon size={28} />
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="notice">
        {t(
          'Refunds and settlement first become claimable credit. Withdraw separately to receive MON in your wallet. Each transaction also needs a MON network fee.',
          '退款与结算先转为可领取款，再单独提款到账。每笔链上操作还需支付 MON 网络费。',
        )}
      </p>
      <p className="public-beneficiary">
        {t('Fixed beneficiary', '固定收款人')} · <code>{d.beneficiary}</code>
      </p>
    </>
  );
}
