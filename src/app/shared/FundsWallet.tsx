import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useApp } from '../context';
import { discoverWallets, walletState, switchTestnet } from '../../shared/lab/wallet';
import type { WalletOption } from '../../shared/lab/wallet';
export function useFundsWallet() {
  const [wallets, setWallets] = useState<WalletOption[]>([]),
    [selected, setSelected] = useState('');
  const [actor, setActor] = useState<Address | null>(null);
  const wallet = wallets.find((w) => w.id === selected) ?? wallets[0];
  useEffect(() => discoverWallets(window, setWallets), []);
  useEffect(() => {
    setActor(null);
    if (!wallet) return;
    const reset = () => setActor(null);
    wallet.provider.on?.('accountsChanged', reset);
    wallet.provider.on?.('chainChanged', reset);
    return () => {
      wallet.provider.removeListener?.('accountsChanged', reset);
      wallet.provider.removeListener?.('chainChanged', reset);
    };
  }, [wallet]);
  async function connect() {
    if (!wallet) throw Error('INVALID_WALLET');
    let s = await walletState(wallet.provider, true);
    if (s.chainId !== 10143) s = await switchTestnet(wallet.provider);
    if (!s.account) throw Error('INVALID_WALLET');
    setActor(s.account);
    return s.account;
  }
  return { wallets, wallet, selected, setSelected, actor, connect };
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
    <>
      <label>
        {t('Funds wallet', '资金钱包')}
        <select value={value.wallet?.id ?? ''} onChange={(e) => value.setSelected(e.target.value)}>
          <option value="" disabled>
            {t('Select wallet', '选择钱包')}
          </option>
          {value.wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      {!value.wallets.length ? (
        <p>
          {t(
            'No browser wallet found. Open this page in a wallet browser or install a supported browser wallet.',
            '未找到浏览器钱包，请在钱包浏览器中打开，或安装支持的浏览器钱包。',
          )}
        </p>
      ) : null}
      <button className="button secondary" disabled={busy || !value.wallet} onClick={connect}>
        {t('Connect funds wallet', '连接资金钱包')}
      </button>
      {value.actor ? (
        <p>
          <code>{value.actor}</code>
        </p>
      ) : (
        <p>
          {t(
            'Connect to read your rights; connection does not sign a payment.',
            '连接后读取你的权益，连接不会签署付款。',
          )}
        </p>
      )}
    </>
  );
}
