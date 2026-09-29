import { IconUser, IconPlus, IconLink } from '@tabler/icons-react';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { STAGE } from '../shared/config';
import { useApp } from './context';
import { tools, getTool } from '../shared/tools';
import { Arrow, ToolCard, ToolIcon, Unavailable } from './components';

export function HomePage() {
  const { t } = useApp();
  return (
    <div className="container home-page">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            {t('Payments made for working together', '为合作而生的支付工具')}
          </span>
          <h1>
            {t('One link.', '一个链接，')}
            <br />
            <span>{t('Keep your promises.', '让合作按约定进行。')}</span>
          </h1>
          <p>
            {t(
              'Collect, split, deliver and reward. All in one place.',
              '收款、分账、交付与奖励，在同一处完成。',
            )}
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#tools">
              {t('Create your first Box', '创建第一个 Box')}
              <Arrow />
            </a>
            <a className="text-link" href="#how">
              {t('See how it works', '查看如何使用')}
            </a>
          </div>
          <span className="muted small">
            {t('Create first. Connect your wallet when you publish.', '先创建，再连接钱包发布。')}
          </span>
        </div>
        <div className="hero-visual">
          <img
            src="/images/cooperation-box.png"
            alt=""
            fetchPriority="high"
            width="1391"
            height="1131"
          />
          <div className="hero-example">
            <div className="example-head">
              <span className="tool-icon">
                <ToolIcon id="group" />
              </span>
              <div>
                <strong>{t('Weekend creator meetup', '周末创作小聚')}</strong>
                <p>Group · {t('Collect together', '成团收款')}</p>
              </div>
              <span className="status-label">{t('Example', '示例')}</span>
            </div>
            <div className="example-amount">
              <strong>
                0.1 MON <small>/ {t('person', '份')}</small>
              </strong>
              <span>2 / 3 {t('joined', '份')}</span>
            </div>
            <progress value="2" max="3" aria-label={t('Example group progress', '示例成团进度')} />
            <p className="muted small">
              {t('Refund available if the group does not form', '未成团可退款')}
            </p>
            <div className="example-bottom">
              <span className="avatar-stack">
                <i>
                  <IconUser size={17} />
                </i>
                <i>
                  <IconUser size={17} />
                </i>
                <i>
                  <IconPlus size={17} />
                </i>
              </span>
              <span className="text-link">
                {t('One shared agreement', '同一个约定')} <IconLink size={15} />
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="tools-section" id="tools" aria-labelledby="tools-title">
        <div className="section-heading">
          <div>
            <h2 id="tools-title">{t('Choose how you work together', '选择你的合作方式')}</h2>
            <p className="muted">{t('Start with a clear agreement.', '从一个明确的约定开始。')}</p>
          </div>
        </div>
        <div className="tools-grid">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </section>
      <section className="how-it-works" id="how" aria-label={t('How it works', '如何使用')}>
        <ol>
          {[
            [
              t('Set the rules', '约定规则'),
              t('Choose a tool, amount and participants.', '选择工具，设置金额、参与人和规则。'),
            ],
            [
              t('Share your link', '分享链接'),
              t('Send your Box to your partners or community.', '把链接发给你的成员或社区。'),
            ],
            [
              t('Follow the progress', '查看进展'),
              t('Track payments, refunds and settlement.', '在同一处跟踪收款、退款和结算状态。'),
            ],
          ].map(([title, body], i) => (
            <li key={title}>
              <span className="step-number">{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
              {i < 2 ? <Arrow /> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
export function ToolPage() {
  const { id } = useParams();
  const tool = getTool(id);
  const { locale, t } = useApp();
  if (!tool) return <NotFoundPage />;
  return (
    <div className="container detail-page">
      <Link className="back-link" to="/">
        {t('All tools', '全部工具')}
      </Link>
      <div className="detail-grid">
        <section>
          <span className="tool-icon large">
            <ToolIcon id={tool.id} />
          </span>
          <h1>{locale === 'en' ? tool.name : tool.label.zh}</h1>
          <p className="lead">{tool.description[locale]}</p>
          <p className="muted">{tool.scenario[locale]}</p>
          <h2>{t('How it works', '使用流程')}</h2>
          <ol className="detail-steps">
            {tool.steps.map((step, index) => (
              <li key={index}>
                <span className="step-number">{index + 1}</span>
                {step[locale]}
              </li>
            ))}
          </ol>
        </section>
        <aside className="rule-panel">
          <span className="status-label">
            {['group', 'split', 'deliver', 'attend', 'milestones', 'rewards'].includes(tool.id)
              ? t('Local drafts available', '可创建本地草稿')
              : t('Not open yet', '尚未开放')}{' '}
            · {tool.stage}
          </span>
          <h2>{t('Before any payment', '付款前必须了解')}</h2>
          <p>{tool.caution[locale]}</p>
          {tool.id === 'group' ? (
            <Link className="button primary" to="/create/group">
              {t('Prepare a group draft', '创建成团草稿')}
            </Link>
          ) : tool.id === 'split' ? (
            <Link className="button primary" to="/create/split">
              {t('Prepare a split draft', '创建分账草稿')}
            </Link>
          ) : tool.id === 'deliver' ? (
            <Link className="button primary" to="/create/deliver">
              {t('Prepare delivery escrow', '创建交付托管')}
            </Link>
          ) : tool.id === 'milestones' ? (
            <Link className="button primary" to="/create/milestones">
              {t('Prepare milestone escrow', '创建分阶段托管')}
            </Link>
          ) : tool.id === 'rewards' ? (
            <Link className="button primary" to="/create/rewards">
              {t('Prepare funded rewards', '创建入金奖励')}
            </Link>
          ) : tool.id === 'attend' ? (
            <Link className="button primary" to="/create/attend">
              {t('Prepare attendance bond', '创建报名押金')}
            </Link>
          ) : (
            <button className="button primary" disabled>
              {t('Creation not available yet', '暂未开放创建')}
            </button>
          )}
          <p className="small muted">
            {t(
              'Create and review your rules first. Publish and pay with MON through MetaMask, Keplr or OKX.',
              '先创建并核对规则，再使用 MetaMask、Keplr 或 OKX 发布和支付 MON。',
            )}
          </p>
          {tool.id === 'group' ? (
            <p>
              <Link to="/create/group-split">
                {t('Create a group with fixed split recipients', '创建固定多人分账的成团')}
              </Link>
            </p>
          ) : null}
          <Link to="/help/refunds">{t('Review all refund rules', '查看全部退款规则')}</Link>
        </aside>
      </div>
    </div>
  );
}
export function RefundsPage() {
  const { locale, t } = useApp();
  return (
    <div className="container help-page">
      <h1>{t('Clear rules, including the exit.', '规则清晰，也包括退出。')}</h1>
      <p className="lead">
        {t(
          'Different tools carry different payment rights. Review the terms before signing; the website cannot judge real-world service quality.',
          '不同工具对应不同的资金权利。签名前请查看规则；网站无法自行判断现实服务质量。',
        )}
      </p>
      <div className="help-list">
        {tools.map((tool) => (
          <article key={tool.id}>
            <h2>{locale === 'en' ? tool.name : tool.label.zh}</h2>
            <p>{tool.caution[locale]}</p>
            <Link to={`/tools/${tool.id}`}>
              {t('Read about this tool', '了解这个工具')}
              <Arrow />
            </Link>
          </article>
        ))}
      </div>
      <div className="notice">
        <p>
          {t(
            'Claimable credit requires a withdrawal to your wallet. Payments and network fees use Monad Testnet MON.',
            '可领取款需要提款后才会转入钱包。付款与网络费用均使用 Monad 测试网 MON。',
          )}
        </p>
      </div>
    </div>
  );
}
export function StatusPage() {
  const { state, retry, t } = useApp();
  const [health, setHealth] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/v1/health', { signal: ctrl.signal, cache: 'no-store' })
      .then((res) => {
        if (!ctrl.signal.aborted) setHealth(res.ok ? 'ok' : 'error');
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setHealth('error');
      });
    return () => ctrl.abort();
  }, []);
  return (
    <div className="container status-page">
      <h1>{t('System status', '系统状态')}</h1>
      <p className="lead">
        {t(
          'A transparent view of this build, not a claim that payment tools are live.',
          '查看当前构建的实际能力，不代表支付工具已经上线。',
        )}
      </p>
      <dl className="status-table">
        <div>
          <dt>{t('Release stage', '当前阶段')}</dt>
          <dd>{STAGE}</dd>
        </div>
        <div>
          <dt>{t('Application API', '应用接口')}</dt>
          <dd>
            {health === 'ok'
              ? t('Responding', '响应正常')
              : health === 'error'
                ? t('Unavailable', '暂不可用')
                : t('Checking…', '正在检查…')}
          </dd>
        </div>
        <div>
          <dt>{t('Deployment environment', '部署环境')}</dt>
          <dd>
            {state.status === 'ready' ? state.config.environment : t('Unconfirmed', '尚未确认')}
          </dd>
        </div>
        <div>
          <dt>{t('Network', '网络')}</dt>
          <dd>Monad Testnet · 10143</dd>
        </div>
        <div>
          <dt>{t('Build revision', '构建版本')}</dt>
          <dd className="mono">
            {state.status === 'ready' ? state.config.revision : t('Unconfirmed', '尚未确认')}
          </dd>
        </div>
        <div>
          <dt>{t('Business payments', '业务付款')}</dt>
          <dd>
            {state.status === 'ready' && state.config.capabilities.payments
              ? t('Test assets; explicit signatures', '测试资产；逐笔明确签名')
              : t('Disabled', '未开放')}
          </dd>
        </div>
        <div>
          <dt>{t('Testnet wallet lab', '测试网钱包实验室')}</dt>
          <dd>
            {state.status === 'ready' && state.config.capabilities.testnetLab ? (
              <Link to="/lab">{t('Explicit wallet signatures only', '仅显式钱包签名')}</Link>
            ) : (
              t('Disabled', '未开放')
            )}
          </dd>
        </div>
        <div>
          <dt>{t('Local Group drafts', '本地成团草稿')}</dt>
          <dd>
            <Link to="/app/group-drafts">
              {t('Available on this browser only', '仅当前浏览器保存')}
            </Link>
          </dd>
        </div>
        <div>
          <dt>{t('Deployed business contracts', '已部署业务合约')}</dt>
          <dd>
            <Link to="/setup">{t('Deployment setup and verification', '部署准备与核验')}</Link>
          </dd>
        </div>
        <div>
          <dt>{t('Remote storage', '远程存储')}</dt>
          <dd>
            {state.status === 'ready'
              ? state.config.storageEnabled || state.config.capabilities.cloudGroups
                ? t('Configured; see API health', '已配置，请核对接口健康状态')
                : t('Disabled until bindings are verified', '绑定验收前保持关闭')
              : t('Unconfirmed', '尚未确认')}
          </dd>
        </div>
      </dl>
      {state.status === 'error' ? (
        <button className="button secondary" onClick={retry}>
          {t('Retry configuration', '重新加载配置')}
        </button>
      ) : null}
    </div>
  );
}
export function UnavailablePage() {
  const { t } = useApp();
  return (
    <div className="container workspace-page">
      <Unavailable title={t('This flow is not open yet', '此流程尚未开放')} />
    </div>
  );
}
export function NotFoundPage() {
  const { t } = useApp();
  return (
    <div className="container not-found">
      <p className="muted">404</p>
      <h1>{t('This page is not here.', '没有找到这个页面。')}</h1>
      <p>
        {t(
          'The link may be incomplete. No payment has been initiated.',
          '链接可能不完整，没有发起任何付款。',
        )}
      </p>
      <Link className="button primary" to="/">
        {t('Back to tools', '返回工具首页')}
      </Link>
    </div>
  );
}
