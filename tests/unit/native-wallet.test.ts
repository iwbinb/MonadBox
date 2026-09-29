import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverWallets, walletState, switchTestnet } from '../../src/shared/wallet';
import type { InjectedProvider, WalletOption } from '../../src/shared/wallet';
import { importModule, exportModule, draftKey } from '../../src/app/modules/drafts';
import { assetSchema, addressSchema } from '../../src/shared/cloud/model';
import { inspectNetwork } from '../../src/shared/network';
import type { ChainClient } from '../../src/shared/network';
import { requireResolvedTransactions } from '../../src/app/shared/transaction-storage';
const account = '0x1111111111111111111111111111111111111111';
const provider = () => ({
  request: vi.fn(async ({ method }: { method: string }) =>
    method === 'eth_chainId' ? '0x279f' : [account],
  ),
});
afterEach(() => vi.useRealTimers());
describe('native MON wallet selection', () => {
  it('finds all three namespaces without allowing a Rabby masquerade as MetaMask', () => {
    const target = Object.assign(new EventTarget(), {
      ethereum: { ...provider(), isMetaMask: true, isRabby: true },
      keplr: { ethereum: provider() },
      okxwallet: provider(),
    });
    let wallets: WalletOption[] = [];
    const stop = discoverWallets(target, (w) => (wallets = w));
    expect(wallets.map((w) => w.id)).toEqual(['keplr', 'okx']);
    stop();
  });
  it('deduplicates EIP-6963 and preserves separate wallet providers', () => {
    const meta = { ...provider(), isMetaMask: true },
      okx = provider();
    const target = Object.assign(new EventTarget(), { ethereum: meta, okxwallet: okx });
    let wallets: WalletOption[] = [];
    const stop = discoverWallets(target, (w) => (wallets = w));
    for (let n = 0; n < 2; n++)
      target.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: { uuid: 'id', rdns: 'io.metamask', name: 'Untrusted label' },
            provider: meta,
          },
        }),
      );
    expect(wallets).toHaveLength(2);
    expect(wallets[0]?.name).toBe('MetaMask');
    expect(wallets[1]?.provider).toBe(okx);
    stop();
  });
  it('finds delayed injection and stops discovery after unmount', () => {
    vi.useFakeTimers();
    const target = Object.assign(new EventTarget(), {
      keplr: undefined as { ethereum: InjectedProvider } | undefined,
    });
    const change = vi.fn();
    const stop = discoverWallets(target, change);
    target.keplr = { ethereum: provider() };
    vi.advanceTimersByTime(1000);
    expect(change).toHaveBeenCalledOnce();
    stop();
    vi.runAllTimers();
    target.dispatchEvent(new Event('focus'));
    expect(change).toHaveBeenCalledOnce();
  });
  it('ignores unsupported and malformed announcements', () => {
    const target = new EventTarget(),
      change = vi.fn(),
      stop = discoverWallets(target, change);
    for (const detail of [
      null,
      { info: { rdns: 'unknown' }, provider: provider() },
      { info: { rdns: 'io.metamask' }, provider: {} },
    ])
      target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    expect(change).not.toHaveBeenCalled();
    stop();
  });
  it('does not request permission during passive wallet restoration', async () => {
    const p = provider();
    await walletState(p);
    expect(p.request.mock.calls.map(([q]) => q.method)).toEqual(['eth_accounts', 'eth_chainId']);
  });
  it('adds Monad Testnet only when the wallet reports an unknown chain', async () => {
    let chain = '0x1',
      switches = 0;
    const p = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'wallet_switchEthereumChain') {
          if (++switches === 1) throw { code: 4902 };
          chain = '0x279f';
          return null;
        }
        return method === 'eth_chainId' ? chain : method === 'eth_accounts' ? [account] : null;
      }),
    };
    expect((await switchTestnet(p)).chainId).toBe(10143);
    expect(
      p.request.mock.calls.filter(([q]) => q.method === 'wallet_addEthereumChain'),
    ).toHaveLength(1);
  });
  it('does not add a network when a user rejects switching', async () => {
    const p = {
      request: vi.fn(async () => {
        throw { code: 4001 };
      }),
    };
    await expect(switchTestnet(p)).rejects.toEqual({ code: 4001 });
    expect(p.request).toHaveBeenCalledOnce();
  });
});
describe('MON asset and draft isolation', () => {
  const data = {
    tool: 'split' as const,
    title: 'Native split',
    description: '',
    recipients: [
      { address: account, bps: 5000 },
      { address: '0x2222222222222222222222222222222222222222', bps: 5000 },
    ],
  };
  it('permits the zero native asset marker while rejecting zero recipients', () => {
    expect(assetSchema.parse('0x0000000000000000000000000000000000000000')).toBeDefined();
    expect(() => addressSchema.parse('0x0000000000000000000000000000000000000000')).toThrow();
  });
  it('round trips MON drafts and rejects legacy or altered precision exports', () => {
    const encoded = exportModule(data);
    expect(importModule(encoded)).toEqual(data);
    expect(() => importModule(JSON.stringify({ schema: 1, chainId: 10143, data }))).toThrow();
    expect(() => importModule(encoded.replace('"decimals": 18', '"decimals": 6'))).toThrow();
    expect(draftKey('production')).toContain('mon-v2');
  });
  it('inspects native finality without querying a token contract', async () => {
    const readContract = vi.fn(),
      client = {
        getChainId: async () => 10143,
        getBlock: async () => ({ number: 1n, hash: '0x01' }),
        readContract,
      };
    expect(await inspectNetwork(client as unknown as ChainClient)).toMatchObject({
      decimals: 18,
      symbol: 'MON',
    });
    expect(readContract).not.toHaveBeenCalled();
  });
  it('keeps old unresolved transactions as a cross-version send guard', () => {
    const storage = {
      getItem: (key: string) =>
        key.startsWith('monadbox.actions.v1:') ? '[{"state":"unknown"}]' : null,
    };
    expect(() => requireResolvedTransactions(storage, 'production', account)).toThrow(
      'UNRESOLVED_TRANSACTION',
    );
  });
});
