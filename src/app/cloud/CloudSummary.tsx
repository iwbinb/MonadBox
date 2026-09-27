import { useApp } from '../context';
import { formatAmount } from '../../shared/amount';
import { GROUP_ASSET } from '../../shared/group/draft';
import type { GroupData } from '../../shared/group/draft';
export function CloudSummary({
  data,
  published = false,
}: {
  data: GroupData;
  published?: boolean;
}) {
  const { t, locale } = useApp();
  return (
    <div className="group-summary">
      <h2>{data.title}</h2>
      <p className="group-description">
        {data.description || t('No description added.', '未填写说明。')}
      </p>
      <dl>
        <div>
          <dt>{t('Each participant', '每人金额')}</dt>
          <dd>
            {formatAmount(BigInt(data.unitPrice), 6)} {t('test AUSD', '测试 AUSD')}
          </dd>
        </div>
        <div>
          <dt>{t('Target / capacity', '成团人数 / 上限')}</dt>
          <dd>
            {data.minimum} / {data.capacity}
          </dd>
        </div>
        <div>
          <dt>{t('Target amount', '成团目标金额')}</dt>
          <dd>
            {formatAmount(BigInt(data.unitPrice) * BigInt(data.minimum), 6)}{' '}
            {t('test AUSD', '测试 AUSD')}
          </dd>
        </div>
        <div>
          <dt>{t('Maximum collection', '最大收款金额')}</dt>
          <dd>
            {formatAmount(BigInt(data.unitPrice) * BigInt(data.capacity), 6)}{' '}
            {t('test AUSD', '测试 AUSD')}
          </dd>
        </div>
        <div>
          <dt>{t('Fixed beneficiary', '固定收款地址')}</dt>
          <dd className="mono">{data.beneficiary}</dd>
        </div>
        {(
          [
            ['startsAt', t('Collection starts', '募集开始')],
            ['fundingDeadline', t('Collection deadline', '募集截止')],
            ['settleNotBefore', t('Earliest settlement', '最早结算')],
          ] as const
        ).map(([field, label]) => (
          <div key={field}>
            <dt>{label}</dt>
            <dd>
              {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
                dateStyle: 'medium',
                timeStyle: 'long',
              }).format(new Date(data[field] * 1000))}
              <small>{new Date(data[field] * 1000).toISOString()}</small>
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>{t('Network and asset', '网络与资产')}</summary>
        <p>Monad Testnet · 10143</p>
        <p className="mono">{GROUP_ASSET}</p>
        <p>
          {published
            ? t(
                'Published rules are verified, not real-world delivery. Funding UI is still disabled.',
                '已核验发布规则，不代表现实交付已完成；付款界面仍关闭。',
              )
            : t(
                'A cloud record is not an on-chain publication or collected money.',
                '云端记录不等于链上发布，更不代表已经收款。',
              )}
        </p>
      </details>
    </div>
  );
}
