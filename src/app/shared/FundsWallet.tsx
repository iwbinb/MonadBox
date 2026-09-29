import { IconX, IconArrowRight } from '@tabler/icons-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatUnits } from 'viem';
import type { Address } from 'viem';
import { useApp } from '../context';
import {
  discoverWallets,
  walletState,
  switchTestnet,
  userError,
  supportedWallets,
} from '../../shared/wallet';
import type { WalletOption } from '../../shared/wallet';
import { makeClient } from '../../shared/network';
function useWalletController() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selected, select] = useState(() => {
    try {
      return localStorage.getItem('monadbox.wallet') ?? '';
    } catch {
      return '';
    }
  });
  const [actor, setActor] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const epoch = useRef(0),
    pending = useRef(false);
  const wallet =
    wallets.find((w) => w.id === selected) ??
    (!selected && wallets.length === 1 ? wallets[0] : undefined);
  useEffect(() => discoverWallets(window, setWallets), []);
  const setSelected = (id: string) => {
    epoch.current++;
    setActor(null);
    setChainId(null);
    setBalance(null);
    select(id);
    try {
      localStorage.setItem('monadbox.wallet', id);
    } catch {
      /* Optional preference. */
    }
  };
  useEffect(() => {
    ++epoch.current;
    setActor(null);
    setChainId(null);
    setBalance(null);
    if (!wallet) return;
    let active = true;
    const refresh = async () => {
      const request = ++epoch.current;
      try {
        const s = await walletState(wallet.provider);
        if (active && request === epoch.current) {
          setChainId(s.chainId);
          setActor(s.chainId === 10143 ? s.account : null);
        }
      } catch {
        if (active && request === epoch.current) {
          setActor(null);
          setChainId(null);
        }
      }
    };
    const reset = () => {
      setActor(null);
      setBalance(null);
      void refresh();
    };
    const disconnect = () => {
      epoch.current++;
      setActor(null);
      setChainId(null);
      setBalance(null);
    };
    void refresh();
    wallet.provider.on?.('accountsChanged', reset);
    wallet.provider.on?.('chainChanged', reset);
    wallet.provider.on?.('disconnect', disconnect);
    return () => {
      active = false;
      wallet.provider.removeListener?.('accountsChanged', reset);
      wallet.provider.removeListener?.('chainChanged', reset);
      wallet.provider.removeListener?.('disconnect', disconnect);
    };
  }, [wallet]);
  useEffect(() => {
    let active = true;
    setBalance(null);
    if (actor)
      void makeClient()
        .getBalance({ address: actor })
        .then((v) => {
          if (active) setBalance(formatUnits(v, 18));
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [actor]);
  async function connect(id?: string) {
    const choice = id ? wallets.find((w) => w.id === id) : wallet;
    if (!choice) {
      setOpen(true);
      throw Error('Choose MetaMask, Keplr or OKX / 请选择 MetaMask、Keplr 或 OKX');
    }
    if (pending.current) throw Error('Check the pending wallet request / 请先处理钱包中的请求');
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      let s = await walletState(choice.provider, true);
      if (s.chainId !== 10143) s = await switchTestnet(choice.provider);
      const current = await walletState(choice.provider);
      if (!current.account || current.chainId !== 10143 || current.account !== s.account)
        throw Error('ACCOUNT_CHANGED');
      setSelected(choice.id);
      setActor(current.account);
      setChainId(current.chainId);
      setOpen(false);
      return current.account;
    } catch (e) {
      setError(userError(e));
      throw e;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return {
    wallets,
    wallet,
    selected,
    setSelected,
    actor,
    chainId,
    balance,
    connect,
    disconnect: () => {
      setSelected('disconnected');
      setOpen(false);
    },
    open,
    setOpen,
    busy,
    error,
  };
}
const WalletContext = createContext<ReturnType<typeof useWalletController> | null>(null);
export function WalletProvider({ children }: { children: ReactNode }) {
  const value = useWalletController();
  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletModal />
    </WalletContext.Provider>
  );
}
export function useFundsWallet() {
  const value = useContext(WalletContext);
  if (!value) throw Error('Missing WalletProvider');
  return value;
}
export function WalletButton() {
  const w = useFundsWallet(),
    { t } = useApp();
  return (
    <button className="button primary wallet-trigger" onClick={() => w.setOpen(true)}>
      {w.actor ? `${w.actor.slice(0, 6)}…${w.actor.slice(-4)}` : t('Connect wallet', '连接钱包')}
    </button>
  );
}
function WalletModal() {
  const w = useFundsWallet(),
    { t } = useApp(),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (w.open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [w.open]);
  return (
    <dialog
      className="wallet-modal"
      ref={dialog}
      onCancel={() => w.setOpen(false)}
      onClick={(e) => {
        if (e.target === e.currentTarget && !w.busy) w.setOpen(false);
      }}
    >
      <div className="wallet-modal-head">
        <span className="brand-mark">M</span>
        <button
          className="icon-button"
          aria-label={t('Close', '关闭')}
          disabled={w.busy}
          onClick={() => w.setOpen(false)}
        >
          <IconX size={20} />
        </button>
      </div>
      <h2>{t('Connect your wallet', '连接你的钱包')}</h2>
      <p className="muted">
        {t('Choose a wallet to use Monad Testnet MON.', '选择钱包，开始使用 Monad 测试网 MON。')}
      </p>
      <div className="wallet-options">
        {supportedWallets.map((brand) => {
          const installed = w.wallets.find((x) => x.id === brand.id);
          const content = (
            <>
              <span className={`wallet-symbol ${brand.id}`}>
                <img
                  src={`/images/wallets/${brand.id}.${brand.id === 'keplr' ? 'svg' : 'png'}`}
                  alt=""
                  width={36}
                  height={36}
                />
              </span>
              <strong>{brand.name}</strong>
              <span className="wallet-option-state">
                {installed
                  ? w.busy
                    ? t('Connecting…', '连接中…')
                    : t('Detected', '已检测到')
                  : t('Install', '安装钱包')}{' '}
                <IconArrowRight size={15} />
              </span>
            </>
          );
          return installed ? (
            <button
              key={brand.id}
              disabled={w.busy}
              onClick={() => void w.connect(brand.id).catch(() => {})}
            >
              {content}
            </button>
          ) : (
            <a key={brand.id} href={brand.install} target="_blank" rel="noreferrer">
              {content}
            </a>
          );
        })}
      </div>
      {w.actor ? (
        <div className="wallet-account">
          <span>{t('Connected account', '当前账号')}</span>
          <code>{w.actor}</code>
          <strong>
            {w.balance === null ? t('Balance unavailable', '余额暂不可用') : `${w.balance} MON`}
          </strong>
          <button className="text-link" onClick={w.disconnect}>
            {t('Disconnect wallet', '断开钱包')}
          </button>
        </div>
      ) : null}
      {w.chainId && w.chainId !== 10143 ? (
        <p role="status">
          {t('Select your wallet to switch to Monad Testnet.', '选择钱包以切换到 Monad 测试网。')}
        </p>
      ) : null}
      {w.error ? (
        <p className="field-error" role="alert">
          {w.error}
        </p>
      ) : null}
      <p className="wallet-footnote">
        {t(
          'Connecting does not transfer funds. Confirm each payment in your wallet.',
          '连接不会转账，每笔付款都需要你在钱包中确认。',
        )}
      </p>
    </dialog>
  );
}
export function WalletChoice({
  value,
  busy,
  connect,
}: {
  value: ReturnType<typeof useFundsWallet>;
  busy: boolean;
  connect: () => void;
}) {
  const { t } = useApp();
  return (
    <div className="funds-wallet-card">
      <div>
        <span className="eyebrow">{t('Payment wallet', '付款钱包')}</span>
        <strong>
          {value.actor
            ? `${value.wallet?.name} · ${value.actor.slice(0, 6)}…${value.actor.slice(-4)}`
            : t('Choose your wallet', '连接后查看你的权益')}
        </strong>
        {value.actor && value.balance !== null ? (
          <span className="muted">{value.balance} MON</span>
        ) : null}
      </div>
      <button
        className="button secondary"
        disabled={busy}
        onClick={value.actor || !value.wallet ? () => value.setOpen(true) : connect}
      >
        {value.actor ? t('Change', '更换') : t('Connect wallet', '连接钱包')}
      </button>
    </div>
  );
}
