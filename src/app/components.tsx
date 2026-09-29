import {
  IconArrowRight,
  IconUsers,
  IconArrowsSplit,
  IconClipboardCheck,
  IconCalendarCheck,
  IconFlag,
  IconGift,
} from '@tabler/icons-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { WalletButton } from './shared/FundsWallet';
import { useApp } from './context';
import type { Tool } from '../shared/tools';
export function Arrow() {
  return <IconArrowRight aria-hidden="true" size={18} stroke={1.8} />;
}
export function ToolIcon({ id }: { id: string }) {
  const Icon =
    (
      {
        group: IconUsers,
        split: IconArrowsSplit,
        deliver: IconClipboardCheck,
        attend: IconCalendarCheck,
        milestones: IconFlag,
        rewards: IconGift,
      } as Record<string, typeof IconUsers>
    )[id] ?? IconUsers;
  return <Icon aria-hidden="true" size={28} stroke={1.7} />;
}
export function ToolCard({ tool }: { tool: Tool }) {
  const { locale } = useApp();
  return (
    <Link className="tool-card" to={`/create/${tool.id}`}>
      <span className="tool-icon">
        <ToolIcon id={tool.id} />
      </span>
      <div>
        <h3>
          {tool.name} {locale === 'zh' ? tool.label.zh : ''}
        </h3>
        <p>{tool.description[locale]}</p>
      </div>
      <Arrow />
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
          'This workspace has no live orders or balances. Wallet testing is available only in the separate testnet lab.',
          '此工作台尚无真实订单或余额；钱包测试仅在独立测试网实验室中开放。',
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
              {t('Create Box', '创建 Box')}
            </NavLink>
            <NavLink to="/app">{t('My boxes', '我的 Box')}</NavLink>
            <NavLink to="/help/refunds">{t('Help', '帮助')}</NavLink>
          </nav>
          <span className="network-pill">
            <span className="status-dot" />
            {t('Monad Testnet', 'Monad 测试网')}
          </span>
          <button
            className="language-button"
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            aria-label={t('Switch to Chinese', '切换到英文')}
          >
            {locale === 'en' ? '中文' : 'EN'}
          </button>
          <WalletButton />
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
          <Link to="/app">{t('Funds workbench', '资金工作台')}</Link>
          <Link to="/help/refunds">{t('Refund rules', '退款规则')}</Link>
          <Link to="/status">{t('System status', '系统状态')}</Link>
          <Link to="/privacy">{t('Privacy', '隐私说明')}</Link>
          <Link to="/terms">{t('Test version terms', '测试版使用说明')}</Link>
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
