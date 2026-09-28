import { describe, it, expect, vi } from 'vitest';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { readConfig, toPublicConfig } from '../../src/shared/config';
import {
  walletState,
  requireWallet,
  switchTestnet,
  discoverWallets,
} from '../../src/shared/lab/wallet';
import type { InjectedProvider } from '../../src/shared/lab/wallet';
import { journalKey, readJournal, storeOperation, unresolved } from '../../src/shared/lab/journal';
import type { Operation } from '../../src/shared/lab/journal';
import {
  sendOperation,
  JournalAfterSendError,
  assertExpectedReceipt,
  inspectOperation,
} from '../../src/shared/lab/transactions';
import { TOKEN, inspectNetwork, paymentId } from '../../src/shared/lab/network';
import type { ChainClient } from '../../src/shared/lab/network';
import { tokenAbi, probeAbi, expectedRuntime, verifyProbe } from '../../src/shared/lab/artifact';
import { projectProbe } from '../../src/shared/lab/projection';
import type { ProbeEvent } from '../../src/shared/lab/projection';
const base = {
  APP_ENV: 'test',
  CHAIN_ID: '10143',
  STORAGE_NAMESPACE: 'monadbox-test',
  STORAGE_ENABLED: 'false',
  BACKGROUND_ENABLED: 'false',
  NETWORK_WRITES_ENABLED: 'false',
  MAINNET_ENABLED: 'false',
  ASSET_ALLOWLIST: '[]',
  CONTRACT_REGISTRY: '[]',
};
const A = ('0x' + '11'.repeat(20)) as Address,
  B = ('0x' + '22'.repeat(20)) as Address;
const H = ('0x' + '33'.repeat(32)) as Hex,
  H2 = ('0x' + '44'.repeat(32)) as Hex;
const operation = (extra: Partial<Operation> = {}): Operation => ({
  version: 1,
  chainId: 10143,
  localId: H,
  kind: 'fund',
  account: A,
  to: B,
  data: '0x1234',
  amount: '100',
  transactionNonce: 3,
  paymentNonce: H,
  paymentId: H2,
  probe: B,
  hash: null,
  startBlock: '1',
  createdAt: '2026-09-27',
  state: 'signing',
  ...extra,
});
function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}
function provider(chain = '0x279f', account: Address = A): InjectedProvider {
  return {
    request: vi.fn(async ({ method }) =>
      method === 'eth_chainId' ? chain : method === 'eth_sendTransaction' ? H : [account],
    ),
  };
}
const prepared = { op: operation(), gas: 100000n, gasPrice: 1n };
describe('M0-C wallet boundary', () => {
  it('lab flag defaults off, never enables business payments', () => {
    expect(toPublicConfig(readConfig(base), 'x').capabilities.testnetLab).toBe(false);
    const result = toPublicConfig(readConfig({ ...base, TESTNET_LAB_ENABLED: 'true' }), 'x');
    expect(result.capabilities).toEqual({
      testnetLab: true,
      wallets: true,
      payments: false,
      drafts: false,
      cloudGroups: false,
      groupPublishing: false,
      cloudModules: false,
      modulePublishing: false,
      localGroupDrafts: true,
    });
  });
  it('rejects invalid lab flag', () =>
    expect(() => readConfig({ ...base, TESTNET_LAB_ENABLED: 'yes' })).toThrow());
  it('reads account without requesting access', async () => {
    const p = provider();
    expect((await walletState(p)).account).toBe(A);
    expect(p.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'eth_requestAccounts' }),
    );
  });
  it('connect requests accounts only on explicit call', async () => {
    const p = provider();
    await walletState(p, true);
    expect(p.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });
  it('rejects wrong chain', async () =>
    await expect(requireWallet(provider('0x8f'), A)).rejects.toThrow('WRONG_WALLET_CHAIN'));
  it('rejects changed account', async () =>
    await expect(requireWallet(provider('0x279f', B), A)).rejects.toThrow('ACCOUNT_CHANGED'));
  it('rejects malformed chain', async () =>
    await expect(walletState(provider('10143'))).rejects.toThrow('INVALID_WALLET'));
  it('adds only fixed testnet after 4902 and rechecks it', async () => {
    let calls = 0;
    const p: InjectedProvider = {
      request: vi.fn(async ({ method }) => {
        if (method === 'wallet_switchEthereumChain' && calls++ === 0) throw { code: 4902 };
        return method === 'eth_chainId' ? '0x279f' : method === 'eth_accounts' ? [A] : null;
      }),
    };
    await switchTestnet(p);
    expect(p.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'wallet_addEthereumChain',
        params: [
          expect.objectContaining({
            chainId: '0x279f',
            rpcUrls: ['https://testnet-rpc.monad.xyz'],
          }),
        ],
      }),
    );
  });
  it('does not add chain after rejection', async () => {
    const p: InjectedProvider = {
      request: vi.fn(async () => {
        throw { code: 4001 };
      }),
    };
    await expect(switchTestnet(p)).rejects.toEqual({ code: 4001 });
    expect(p.request).toHaveBeenCalledTimes(1);
  });
  it('discovers, deduplicates and removes listeners without wallet icon rendering', () => {
    const target = new EventTarget();
    const result = vi.fn();
    const clean = discoverWallets(target, result);
    const event = () =>
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: { uuid: 'one', name: 'Wallet', icon: 'javascript:bad' },
          provider: provider(),
        },
      });
    target.dispatchEvent(event());
    target.dispatchEvent(event());
    expect(result.mock.calls.at(-1)?.[0]).toHaveLength(1);
    clean();
    result.mockClear();
    target.dispatchEvent(event());
    expect(result).not.toHaveBeenCalled();
  });
});
describe('M0-C recovery journal and send', () => {
  it('namespaces by chain/account and keeps a single local ID', () => {
    const s = storage();
    storeOperation(s, operation());
    storeOperation(s, operation({ state: 'broadcast', hash: H }));
    expect(readJournal(s, A)).toHaveLength(1);
    expect(readJournal(s, B)).toHaveLength(0);
    expect(journalKey(A)).toContain('10143');
  });
  it('rejects corrupt cross-account entries', () => {
    const s = storage();
    s.setItem(journalKey(A), JSON.stringify([operation({ account: B })]));
    expect(() => readJournal(s, A)).toThrow();
  });
  it('never prompts when storage is unavailable', async () => {
    const p = provider();
    const s = {
      getItem: () => null,
      setItem: () => {
        throw Error('quota');
      },
    };
    await expect(sendOperation(p, s, prepared)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    expect(p.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'eth_sendTransaction' }),
    );
  });
  it('records before asking wallet and stores hash', async () => {
    const s = storage();
    const p = provider();
    const original = p.request;
    p.request = async (q) => {
      if (q.method === 'eth_sendTransaction') expect(readJournal(s, A)[0]?.state).toBe('signing');
      return original(q);
    };
    const sent = await sendOperation(p, s, prepared);
    expect(sent.hash).toBe(H);
    expect(sent.state).toBe('broadcast');
  });
  it('never repeats an unresolved send', async () => {
    const s = storage();
    storeOperation(s, operation({ state: 'unknown' }));
    const p = provider();
    await expect(sendOperation(p, s, prepared)).rejects.toThrow('UNRESOLVED_TRANSACTION');
    expect(p.request).not.toHaveBeenCalled();
  });
  it('wallet rejection is terminal and not payment success', async () => {
    const s = storage();
    const p = provider();
    const previous = p.request;
    p.request = async (q) => {
      if (q.method === 'eth_sendTransaction') throw { code: 4001 };
      return previous(q);
    };
    await expect(sendOperation(p, s, prepared)).rejects.toEqual({ code: 4001 });
    expect(readJournal(s, A)[0]?.state).toBe('rejected');
  });
  it('ambiguous send stays unresolved', async () => {
    const s = storage();
    const p = provider();
    const previous = p.request;
    p.request = async (q) => {
      if (q.method === 'eth_sendTransaction') throw Error('timeout');
      return previous(q);
    };
    await expect(sendOperation(p, s, prepared)).rejects.toThrow('timeout');
    expect(unresolved(readJournal(s, A)[0]!)).toBe(true);
  });
  it('retains known hash in an error when persistence fails after send', async () => {
    let writes = 0;
    const s = storage();
    const set = s.setItem;
    s.setItem = (k, v) => {
      if (++writes === 2) throw Error('quota');
      set(k, v);
    };
    try {
      await sendOperation(provider(), s, prepared);
      throw Error('expected failure');
    } catch (e) {
      expect(e).toBeInstanceOf(JournalAfterSendError);
      expect((e as JournalAfterSendError).operation.hash).toBe(H);
    }
  });
});
function receipt(
  kind: 'Approval' | 'Funded' | 'Refunded',
  extra: Record<string, unknown> = {},
): TransactionReceipt {
  const topics =
    kind === 'Approval'
      ? encodeEventTopics({ abi: tokenAbi, eventName: kind, args: { owner: A, spender: B } })
      : encodeEventTopics({ abi: probeAbi, eventName: kind, args: { id: H2, payer: A } });
  return {
    status: 'success',
    from: A,
    to: kind === 'Approval' ? TOKEN : B,
    blockNumber: 2n,
    blockHash: H,
    transactionHash: H2,
    logs: [
      {
        address: kind === 'Approval' ? TOKEN : B,
        topics,
        data: encodeAbiParameters([{ type: 'uint256' }], [100n]),
      },
    ],
    ...extra,
  } as unknown as TransactionReceipt;
}
describe('M0-C receipt and finality verification', () => {
  it('checks exact approval event but never treats it as fund', () => {
    expect(() =>
      assertExpectedReceipt(operation({ kind: 'approve', to: TOKEN }), receipt('Approval')),
    ).not.toThrow();
    expect(() => assertExpectedReceipt(operation(), receipt('Approval'))).toThrow();
  });
  it('accepts exact funded and refunded events', () => {
    assertExpectedReceipt(operation(), receipt('Funded'));
    assertExpectedReceipt(operation({ kind: 'refund' }), receipt('Refunded'));
  });
  it.each([{ status: 'reverted' }, { from: B }, { logs: [] }, { to: A }])(
    'rejects mismatched receipt %j',
    (override) =>
      expect(() => assertExpectedReceipt(operation(), receipt('Funded', override))).toThrow(),
  );
  it('rejects duplicate event evidence', () => {
    const r = receipt('Funded');
    expect(() =>
      assertExpectedReceipt(operation(), { ...r, logs: [...r.logs, ...r.logs] }),
    ).toThrow();
  });
  it('verifies runtime and fixed token, not address label', async () => {
    const p = {
      getChainId: async () => 10143,
      getCode: async () => expectedRuntime(),
      readContract: async () => TOKEN,
    } as unknown as ChainClient;
    await verifyProbe(p, B);
    await expect(
      verifyProbe({ ...p, getCode: async () => '0x1234' } as unknown as ChainClient, B),
    ).rejects.toThrow('UNVERIFIED_PROBE');
  });
  it('rejects wrong RPC chain before reading token', async () =>
    await expect(
      inspectNetwork({ getChainId: async () => 143 } as unknown as ChainClient),
    ).rejects.toThrow('WRONG_RPC_CHAIN'));
  it('domain separates payment ID by probe and payer', () => {
    expect(paymentId(A, B, H)).not.toBe(paymentId(B, B, H));
    expect(paymentId(A, A, H)).not.toBe(paymentId(A, B, H));
  });
  it('does not finalize an included receipt before finalized height', async () => {
    const r = receipt('Funded');
    const p = {
      getChainId: async () => 10143,
      getTransactionReceipt: async () => r,
      getTransaction: async () => ({
        from: A,
        nonce: 3,
        to: B,
        input: '0x1234',
        value: 0n,
        blockHash: H,
      }),
      getBlock: async (q: { blockTag?: string }) => ({
        number: q.blockTag === 'finalized' ? 1n : 2n,
        hash: H,
      }),
    } as unknown as ChainClient;
    expect((await inspectOperation(p, operation({ hash: H2 }))).state).toBe('included');
  });
  it('rejects orphaned receipt as unknown', async () => {
    const p = {
      getChainId: async () => 10143,
      getTransactionReceipt: async () => receipt('Funded'),
      getTransaction: async () => ({ blockHash: H }),
      getBlock: async () => ({ number: 9n, hash: H2 }),
    } as unknown as ChainClient;
    expect((await inspectOperation(p, operation({ hash: H2 }))).state).toBe('unknown');
  });
});
const ev: ProbeEvent = {
  chainId: 10143,
  contract: B,
  blockNumber: 1n,
  blockHash: H,
  transactionHash: H2,
  logIndex: 0,
  kind: 'Funded',
  id: H,
  payer: A,
  amount: 100n,
};
describe('M0-C replay projection fixtures', () => {
  it('deduplicates and orders events, preserving conservation', () => {
    const result = projectProbe(
      [{ ...ev, kind: 'Refunded', blockNumber: 2n, blockHash: H2, transactionHash: H }, ev, ev],
      B,
      new Map([
        [1n, H],
        [2n, H2],
      ]),
    );
    expect(result.locked).toBe(0n);
    expect(result.received).toBe(100n);
    expect(result.returned).toBe(100n);
  });
  it('reorg removes orphaned refund without losing original deposit', () => {
    const result = projectProbe(
      [ev, { ...ev, kind: 'Refunded', blockNumber: 2n }],
      B,
      new Map([
        [1n, H],
        [2n, H2],
      ]),
    );
    expect(result.locked).toBe(100n);
  });
  it('ignores removed/wrong-chain/wrong-contract events', () => {
    const result = projectProbe(
      [
        { ...ev, removed: true },
        { ...ev, chainId: 143 },
        { ...ev, contract: A },
      ],
      B,
      new Map([[1n, H]]),
    );
    expect(result.received).toBe(0n);
  });
  it('rejects contradictory duplicate and orphan-only history', () => {
    expect(() => projectProbe([ev, { ...ev, amount: 101n }], B, new Map([[1n, H]]))).toThrow();
    expect(() => projectProbe([{ ...ev, kind: 'Refunded' }], B, new Map([[1n, H]]))).toThrow();
  });
});
