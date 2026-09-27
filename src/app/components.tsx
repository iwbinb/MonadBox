import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useApp } from './context';
import type { Tool } from '../shared/tools';

export function Arrow() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
export function ToolIcon({ id }: { id: string }) {
  const paths: Record<string, string> = {
    group:
      'M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a2 2 0 1 0 0-4M3 20v-2a5 5 0 0 1 10 0v2M16 14a4 4 0 0 1 4 4v2',
    split: 'M12 3v7M12 10 5 17M12 10l7 7M5 12v5h5M14 17h5v-5',
    deliver: 'M4 7h16v14H4zM8 7V3h8v4M8 14l3 3 5-5',
    attend: 'M5 5h14v16H5zM8 3v4M16 3v4M5 10h14M8 15l3 3 5-5',
    milestones: 'M4 20V4M4 5h13l-3 4 3 4H4M8 20h12',
    rewards:
      'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z',
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[id] ?? paths.group} />
    </svg>
  );
}
export function ToolCard({ tool }: { tool: Tool }) {
  const { locale, t } = useApp();
  return (
    <Link className="tool-card" to={`/tools/${tool.id}`}>
      <div className="card-top">
        <span className="tool-icon">
          <ToolIcon id={tool.id} />
        </span>
        <span className="status-label">{t('Not open yet', '尚未开放')}</span>
      </div>
      <h3>{locale === 'en' ? tool.name : tool.label.zh}</h3>
      <p>{tool.description[locale]}</p>
      <span className="card-bottom">
        {t('Explore the flow', '了解使用流程')}
        <Arrow />
      </span>
    </Link>
  );
}
export function Unavailable({ title }: { title: string }) {
  const { t } = useApp();
  return (
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">
        ○
      </span>
      <h2>{title}</h2>
      <p>
        {t(
          'This foundation release has no connected wallets, live orders or balances. No funds can be sent or claimed here.',
          '当前工程基础版本尚未连接钱包，也没有真实订单或余额，不能付款或领取资金。',
        )}
      </p>
      <Link className="button secondary" to="/">
        {t('Explore the tools', '浏览工具')}
      </Link>
    </div>
  );
}
export function Layout() {
  const { locale, setLocale, state, retry, t } = useApp();
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  useEffect(() => {
    window.scrollTo(0, 0);
    if (previousPath.current !== pathname)
      document.getElementById('main')?.focus({ preventScroll: true });
    previousPath.current = pathname;
  }, [pathname]);
  return (
    <>
      <a className="skip-link" href="#main">
        {t('Skip to content', '跳到正文')}
      </a>
      <div className="environment-bar" role="status">
        <span className="status-dot" />
        {t(
          'Monad Testnet · Foundation release · Payments disabled',
          'Monad 测试网 · 工程基础版本 · 付款未开放',
        )}
      </div>
      <header className="site-header">
        <div className="container nav-row">
          <Link className="brand" to="/" aria-label="MonadBox home">
            <span className="brand-mark" aria-hidden="true">
              M
            </span>
            MonadBox
          </Link>
          <nav aria-label={t('Main navigation', '主导航')}>
            <NavLink to="/" end>
              {t('Tools', '工具')}
            </NavLink>
            <NavLink to="/app">{t('My boxes', '我的 Box')}</NavLink>
            <NavLink to="/help/refunds">{t('Help', '帮助')}</NavLink>
          </nav>
          <button
            className="language-button"
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            aria-label={t('Switch to Chinese', '切换到英文')}
          >
            {locale === 'en' ? '中文' : 'EN'}
          </button>
        </div>
      </header>
      {state.status === 'error' ? (
        <div className="container">
          <div className="notice danger" role="alert">
            <span>
              {t(
                'Configuration could not be loaded. All payment actions remain disabled.',
                '无法加载配置，所有资金操作保持关闭。',
              )}
            </span>
            <button onClick={retry}>{t('Retry', '重试')}</button>
          </div>
        </div>
      ) : null}
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer container">
        <div>
          <span className="footer-brand">MonadBox</span>
          <p>{t('One link. Clear rules.', '一个链接，规则清晰。')}</p>
        </div>
        <div className="footer-links">
          <Link to="/help/refunds">{t('Refund rules', '退款规则')}</Link>
          <Link to="/status">{t('System status', '系统状态')}</Link>
          <span>
            {state.status === 'ready'
              ? `${state.config.environment} · ${state.config.revision.slice(0, 7)}`
              : t('Checking configuration', '正在检查配置')}
          </span>
        </div>
      </footer>
    </>
  );
}
