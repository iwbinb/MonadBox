import type { InjectedProvider, WalletOption } from './lab/wallet';
export { walletState, requireWallet, switchTestnet, userError, errorCode } from './lab/wallet';
export type { InjectedProvider, WalletOption } from './lab/wallet';
export const supportedWallets = [
  { id: 'metamask', name: 'MetaMask', install: 'https://metamask.io/download/' },
  { id: 'keplr', name: 'Keplr', install: 'https://www.keplr.app/get' },
  { id: 'okx', name: 'OKX', install: 'https://web3.okx.com/download' },
] as const;
type Provider = InjectedProvider & {
  isMetaMask?: boolean;
  isKeplr?: boolean;
  isOkxWallet?: boolean;
  isRabby?: boolean;
  providers?: Provider[];
};
type WalletWindow = EventTarget & {
  ethereum?: Provider;
  keplr?: { ethereum?: Provider };
  okxwallet?: Provider;
};
function valid(p: unknown): p is Provider {
  return !!p && typeof p === 'object' && 'request' in p && typeof p.request === 'function';
}
/** EIP-6963 metadata identifies a user's choice, never an authenticated wallet identity. */
export function discoverWallets(target: WalletWindow, onChange: (wallets: WalletOption[]) => void) {
  const known = new Map<string, WalletOption>();
  let closed = false;
  const add = (id: string, provider: unknown, announced = false) => {
    const brand = supportedWallets.find((w) => w.id === id);
    if (
      closed ||
      !brand ||
      !valid(provider) ||
      (!announced && known.has(id)) ||
      known.get(id)?.provider === provider
    )
      return;
    known.set(id, { id, name: brand.name, provider });
    onChange(supportedWallets.flatMap((w) => (known.has(w.id) ? [known.get(w.id)!] : [])));
  };
  const scan = () => {
    add('keplr', target.keplr?.ethereum);
    add('okx', target.okxwallet);
    for (const p of target.ethereum?.providers ?? [target.ethereum]) {
      if (!valid(p)) continue;
      if (p.isKeplr) add('keplr', p);
      else if (p.isOkxWallet) add('okx', p);
      else if (p.isMetaMask && !p.isRabby) add('metamask', p);
    }
    target.dispatchEvent(new Event('eip6963:requestProvider'));
  };
  const announce = (event: Event) => {
    const d = (event as CustomEvent<unknown>).detail;
    if (
      !d ||
      typeof d !== 'object' ||
      !('info' in d) ||
      !('provider' in d) ||
      !d.info ||
      typeof d.info !== 'object' ||
      !('rdns' in d.info)
    )
      return;
    const id = (
      {
        'io.metamask': 'metamask',
        'app.keplr': 'keplr',
        'com.okex.wallet': 'okx',
        'com.okx.wallet': 'okx',
      } as Record<string, string>
    )[String(d.info.rdns)];
    if (id) add(id, d.provider, true);
  };
  target.addEventListener('eip6963:announceProvider', announce);
  target.addEventListener('ethereum#initialized', scan);
  target.addEventListener('keplr_keystorechange', scan);
  target.addEventListener('focus', scan);
  scan();
  const timers = [250, 1000, 3000].map((delay) => setTimeout(scan, delay));
  return () => {
    closed = true;
    timers.forEach(clearTimeout);
    target.removeEventListener('eip6963:announceProvider', announce);
    target.removeEventListener('ethereum#initialized', scan);
    target.removeEventListener('keplr_keystorechange', scan);
    target.removeEventListener('focus', scan);
  };
}
