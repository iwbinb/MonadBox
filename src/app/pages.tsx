import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { STAGE } from '../shared/config';
import { useApp } from './context';
import { tools, getTool } from '../shared/tools';
import { Arrow, ToolCard, ToolIcon, Unavailable } from './components';

export function HomePage() {
  const { t } = useApp();
  return (
    <div className="container">
      <section className="hero">
        <h1>
          {t('One link.', '一个链接，')}
          <br />
          <span>{t('Clear rules.', '按约定支付。')}</span>
        </h1>
        <div className="hero-copy">
          <p>
            {t(
              'A stablecoin payment toolkit for creators, communities and small teams. Collect together, return funds and share the proceeds.',
              '面向创作者、社区和小团队的稳定币支付工具箱。把收款、退款和分账放在同一套规则里。',
            )}
          </p>
          <a className="button primary" href="#tools">
            {t('Find your tool', '选择适合的工具')}
            <Arrow />
          </a>
          <span className="muted small">
            {t('Explore the foundation. No wallet required.', '先了解工具，无需连接钱包。')}
          </span>
        </div>
      </section>
      <section className="tools-section" id="tools" aria-labelledby="tools-title">
        <div className="section-heading">
          <h2 id="tools-title">{t('Six tools. One workspace.', '六个工具，一个工作台。')}</h2>
          <span>{t('Built in stages, starting with Group', '分阶段开放，从成团收款开始')}</span>
        </div>
        <div className="tools-grid">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </section>
      <section className="how-it-works" aria-labelledby="flow-title">
        <h2 id="flow-title">{t('Know the rules before you pay.', '付款之前，先看清规则。')}</h2>
        <ol>
          {[
            [
              t('Set the terms', '约定规则'),
              t(
                'Choose the amount, participants and exit conditions.',
                '明确金额、参与方与退出条件。',
              ),
            ],
            [
              t('Share a link', '分享链接'),
              t('Let everyone review the same payment terms.', '让每个人查看同一份付款约定。'),
            ],
            [
              t('Track what happens', '核对进展'),
              t(
                'Keep payment, refund and settlement states distinct.',
                '清楚区分付款、退款资格和实际到账。',
              ),
            ],
          ].map(([title, body], index) => (
            <li key={index}>
              <span className="step-number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>
      <div className="notice">
        <p>
          {t(
            'Group and Split drafts are available in this browser. Publishing and business payments depend on the capabilities enabled in this environment.',
            '本浏览器支持成团与分账草稿；发布和业务付款以当前环境已开放能力为准。',
          )}
        </p>
        <Link to="/status">
          {t('View current capabilities', '查看当前能力')}
          <Arrow />
        </Link>
      </div>
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
          <h2>{t('The planned flow', '计划中的使用流程')}</h2>
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
            {['group', 'split'].includes(tool.id)
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
          ) : (
            <button className="button primary" disabled>
              {t('Creation not available yet', '暂未开放创建')}
            </button>
          )}
          <p className="small muted">
            {t(
              'No business signatures or transfers on this tool page. Testnet wallet actions are separate in the lab.',
              '此工具页不请求业务签名或转账；测试网钱包操作在独立实验室进行。',
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
            'A claimable credit is not money already in your wallet. Network fees are separate. Business payments remain disabled; Group drafts do not accept funds.',
            '“可领取款”不等于钱包已经到账，网络费用另行承担。六工具业务付款仍关闭，成团草稿不收款。',
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
          <dd>{t('Disabled', '未开放')}</dd>
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
          <dd>{t('None', '无')}</dd>
        </div>
        <div>
          <dt>{t('Remote storage', '远程存储')}</dt>
          <dd>
            {state.status === 'ready'
              ? state.config.storageEnabled
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
