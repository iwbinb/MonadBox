import { useEffect, useState } from 'react';
import { useApp } from '../context';
import type { SessionInfo } from '../../shared/cloud/model';
import { api, ApiError, signIn, validateLogin } from '../cloud/api';
import { userError } from '../../shared/wallet';
import { useFundsWallet, WalletChoice } from './FundsWallet';
export function errorText(e: unknown) {
  if (e instanceof ApiError) {
    const errors: Record<string, string> = {
      CLOUD_UNAVAILABLE:
        'Cloud storage is not configured yet. Local drafts are unchanged. / 云端数据库尚未就绪，本地草稿不受影响。',
      SIGN_IN_REQUIRED:
        'Sign in again; your saved drafts are retained. / 请重新登录，已保存的草稿仍保留。',
      DRAFT_CHANGED_OR_FROZEN:
        'Draft changed elsewhere or publication has frozen its rules. Refresh or clone it. / 草稿已修改或发布规则已冻结，请刷新或复制。',
      PUBLISH_UNAVAILABLE:
        'No verified Group deployment is registered. Publishing remains disabled. / 尚未登记已验证的成团合约，发布保持关闭。',
      UPDATE_DRAFT_TIME_OR_BENEFICIARY:
        'Update the start time or beneficiary before publishing. / 发布前请更新开始时间或收款地址。',
      CSRF_REJECTED: 'Session changed. Reload before saving. / 登录会话已变化，请刷新后再保存。',
      RATE_LIMITED: 'Too many requests. Wait before retrying. / 请求过于频繁，请稍后重试。',
      NOT_FOUND:
        'Group not found or not owned by this account. / 未找到成团记录或当前账号无权查看。',
      INTEGRITY_ERROR:
        'Stored rules do not match verified data. No signing allowed. / 规则校验失败，禁止签名。',
    };
    return (
      errors[e.code] ??
      `Request not completed (${e.code}). Recheck before retrying. / 请求未完成，请先核对。`
    );
  }
  return e instanceof Error && e.message.includes(' / ') ? e.message : userError(e);
}
export function useSession(enabled = true) {
  const [session, setSession] = useState<SessionInfo | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) {
      setSession(null);
      setLoading(false);
      return;
    }
    let active = true;
    void api<SessionInfo>('/auth/session')
      .then((s) => {
        if (active) setSession(s);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  return { session, setSession, loading };
}
export function Login({ onLogin }: { onLogin: (s: SessionInfo) => void }) {
  const { t } = useApp();
  const funds = useFundsWallet(),
    { wallet, actor: account } = funds;
  const [challenge, setChallenge] = useState<{ id: string; message: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function connect() {
    setBusy(true);
    setError('');
    setChallenge(null);
    try {
      const actor = await funds.connect();
      const c = await api<{ id: string; message: string }>('/auth/nonce', 'POST', {
        address: actor,
      });
      validateLogin(c.message, c.id, actor);
      setChallenge(c);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setChallenge(null);
  }, [account, wallet]);
  async function login() {
    if (!wallet || !account || !challenge) return;
    setBusy(true);
    setError('');
    try {
      onLogin(await signIn(wallet.provider, account, challenge));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cloud-card">
      <h2>{t('Sign in with your wallet', '使用钱包签名登录')}</h2>
      <p>
        {t(
          'This signature creates a website session. No funds are transferred.',
          '该签名仅建立网站会话，不会转账。',
        )}
      </p>
      <WalletChoice value={funds} busy={busy} connect={() => void connect()} />
      <button
        className="button secondary"
        disabled={busy || !account}
        onClick={() => void connect()}
      >
        {t('Prepare sign-in', '准备登录签名')}
      </button>
      {challenge ? (
        <>
          <pre className="cloud-message">{challenge.message}</pre>
          <button className="button primary" disabled={busy} onClick={() => void login()}>
            {t('Sign in (no payment)', '签名登录（不付款）')}
          </button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
export function Header({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const { t } = useApp();
  const [error, setError] = useState('');
  return (
    <div className="cloud-session">
      <span>
        {t('Signed in: ', '登录账号：')}
        <code>{session.address}</code>
      </span>
      <button
        className="button secondary"
        onClick={() =>
          void api('/auth/logout', 'POST', {}, session.csrf)
            .then(onLogout)
            .catch((e) => setError(errorText(e)))
        }
      >
        {t('Sign out', '退出登录')}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
