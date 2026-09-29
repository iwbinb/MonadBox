import { Link } from 'react-router-dom';
import { useApp } from './context';
import './cloud/cloud.css';

export default function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { t } = useApp();
  const privacy = kind === 'privacy';
  const sections = privacy
    ? [
        [
          'On this browser',
          '本浏览器的数据',
          'Language, local drafts, bookmarks and public transaction recovery records stay in this browser. They do not sync automatically. Export needed records before clearing site data; clearing it cannot cancel an onchain transaction.',
          '语言、本地草稿、书签及公开交易恢复记录保存在本浏览器，不会自动同步。清除网站数据前请导出必要记录；清除数据不能取消链上交易。',
        ],
        [
          'When you use cloud features',
          '使用云端功能时',
          'An explicit sign-in verifies your wallet and creates an HttpOnly session cookie that expires after 24 hours. Sign out revokes that session. Cloud drafts upload only when you explicitly copy or save them. The server keeps wallet identity, rules, revision and public transaction evidence; it does not keep raw wallet signatures or private keys.',
          '明确登录会验证钱包并创建24小时到期的HttpOnly会话Cookie；退出登录会撤销该会话。只有明确复制或保存才上传云端草稿。服务器保存钱包身份、规则、版本和公开交易证据，不保存原始钱包签名或私钥。',
        ],
        [
          'Public and private information',
          '公开与私密信息',
          'Published rules, wallet addresses, reward lists, amounts and onchain signatures are public. Do not include personal contact details in public rules. Private Deliver and Milestones files are limited to their two fixed parties, checked on every request. They are not end-to-end encrypted and the storage operator can access stored objects.',
          '发布规则、钱包地址、奖励名单、金额及已上链签名公开。公开规则中不要包含个人联系方式。Deliver和Milestones私密文件每次访问均检查固定双方权限；文件并非端到端加密，存储运营者可以访问对象。',
        ],
        [
          'Retention and external services',
          '保留期限与外部服务',
          'File access ends 90 days after the order settles. Automatic physical deletion is not enabled: remote files remain disabled until the operator confirms storage, deletion and support arrangements. Cloudflare handles requests and the configured RPC provider sees public chain queries. No advertising or analytics SDK is included. Infrastructure log retention depends on its configuration.',
          '订单结算90天后停止文件访问。自动物理删除尚未启用：运营方确认存储、删除及支持安排前，远程文件功能保持关闭。Cloudflare处理网络请求，配置的RPC服务商可看到公开链查询。项目未接入广告或分析SDK；基础设施日志保留依赖实际配置。',
        ],
        [
          'Data requests',
          '数据请求',
          'You can delete unfrozen cloud drafts and sign out. Published records and public blockchains cannot be erased by clearing a browser. For non-sensitive project questions, use the source repository. Do not post private files, signatures, session cookies or keys in public issues. A private support contact must be configured before public data collection opens.',
          '可删除尚未冻结的云端草稿并退出登录。清除浏览器无法抹除已发布记录或公共区块链。非敏感项目问题可通过源码仓库反馈；不要在公开issue中提交私密文件、签名、会话Cookie或密钥。开放公众数据收集前须配置私密支持渠道。',
        ],
      ]
    : [
        [
          'Test assets and explicit actions',
          '测试资产与明确操作',
          'This version targets Monad Testnet. Public business payments remain disabled until deployment and wallet acceptance checks are completed. Never enter a seed phrase or private key. Sign-in, MON payment, credit assignment and withdrawal are separate actions; read each wallet request.',
          '此版本面向Monad测试网。完成部署与钱包验收前，公众业务付款保持关闭。不要输入助记词或私钥。登录、MON 付款、权益归属和提款是不同动作，请逐笔阅读钱包请求。',
        ],
        [
          'Fixed rules and exit rights',
          '固定规则与退出权',
          'Review recipients, totals and deadlines before publication. Rules cannot be edited after freezing. Group success does not prove delivery; Split payments are final; Deliver and Milestones can settle after a silent review period; Attend trusts its named check-in signer; Rewards publishes its entire list and reclaims only unclaimed amounts after expiry.',
          '发布前核对收款人、总额和截止时间，冻结后不能修改。Group成团不证明现实交付；Split付款为最终付款；Deliver和Milestones可能在沉默验收期后结算；Attend依赖指定签到方；Rewards公开完整名单，到期仅回收未领取款。',
        ],
        [
          'Funds, fees and recovery',
          '资金、费用与恢复',
          'Credit belongs to its fixed recipient but reaches the wallet only after withdrawal. Network gas is separate. Unknown transactions must be recovered before a new send. The platform does not arbitrate disputes or redirect funds.',
          'credit归固定受益人，提款后才实际到钱包；网络Gas另计。交易结果未知时先恢复记录，再考虑新交易。平台不裁决争议，也不能任意更换收款人。',
        ],
        [
          'Verification limits',
          '验证边界',
          'Local and automated tests are engineering evidence. They do not certify real wallet compatibility, public deployment safety, independent audit, legal eligibility or investment value. Smart and delegated account writes are unsupported. Real assets, devices, user trials and independent security review still require acceptance.',
          '本地及自动化测试属于工程证据，不代表真实钱包兼容、公开部署安全、独立审计、法律资格或投资价值。暂不支持智能或委托账号写入；真实资产、设备、用户试用及独立安全复核仍须验收。',
        ],
      ];
  return (
    <div className="container cloud-page">
      <h1>
        {privacy ? t('Privacy notice', '隐私说明') : t('Test version terms', '测试版使用说明')}
      </h1>
      <p>
        {t(
          'Updated 28 September 2026. This describes the current test version. Public service contact and policies require operator review before launch.',
          '更新于2026年9月28日。本文描述当前测试版；正式开放前须由运营方复核服务联系与政策。',
        )}
      </p>
      {sections.map(([en, zh, bodyEn, bodyZh]) => (
        <section className="cloud-card" key={en}>
          <h2>{t(en!, zh!)}</h2>
          <p>{t(bodyEn!, bodyZh!)}</p>
        </section>
      ))}
      <p>
        <Link to="/help/refunds">{t('Read each tool’s exit rules', '查看各工具退出规则')}</Link> ·{' '}
        <a href="https://github.com/iwbinb/MonadBox" target="_blank" rel="noreferrer">
          {t('Source and project questions', '源码与项目反馈')}
        </a>
      </p>
    </div>
  );
}
