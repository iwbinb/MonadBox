import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import type { ChainClient } from '../../src/shared/network';
import { recheckLegacyTransaction } from '../../src/app/modules/pending-recovery';
import type { PendingTransaction } from '../../src/app/shared/transaction-storage';
import { requireResolvedTransactions } from '../../src/app/shared/transaction-storage';

const actor = '0x1111111111111111111111111111111111111111' as Address;
const hash = ('0x' + 'ab'.repeat(32)) as Hex;
const blockHash = ('0x' + 'cd'.repeat(32)) as Hex;
const prefix = 'monadbox.actions.v1';
const environment = 'test';
const key = `${prefix}:${environment}:10143:${actor}`;
const id = '7be49550-a607-47d0-95b8-8621bb8f1166';
const entry: PendingTransaction & { prefix: typeof prefix } = {
  prefix,
  index: 0,
  id,
  state: 'unknown',
  hash,
  title: '',
  action: '',
};

function fixture(
  options: { nonce?: number; finalized?: bigint; status?: 'success' | 'reverted' } = {},
) {
  let raw = JSON.stringify([
    {
      intent: { id, actor, nonce: 7, startBlock: '10', action: 'pay' },
      state: 'unknown',
      hash,
    },
  ]);
  const storage = {
    getItem: (name: string) => (name === key ? raw : null),
    setItem: (name: string, value: string) => {
      if (name !== key) throw Error('Unexpected key');
      raw = value;
    },
  };
  const client = {
    getChainId: vi.fn(async () => 10143),
    getTransaction: vi.fn(async () => ({
      from: actor,
      nonce: options.nonce ?? 7,
      chainId: 10143,
      blockHash,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      blockNumber: 20n,
      blockHash,
      status: options.status ?? 'success',
    })),
    getBlock: vi.fn(async (request: { blockNumber?: bigint; blockTag?: string }) =>
      request.blockTag === 'finalized' ? { number: options.finalized ?? 30n } : { hash: blockHash },
    ),
  } as unknown as ChainClient;
  return { storage, client, read: () => JSON.parse(raw) as { state: string }[] };
}

afterEach(() => vi.unstubAllGlobals());

describe('earlier-version pending transaction recovery', () => {
  it('unblocks only after the same wallet nonce has a canonical finalized receipt', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: (_key: string, callback: () => Promise<unknown>) => callback() },
    });
    const f = fixture();
    expect(() => requireResolvedTransactions(f.storage, environment, actor)).toThrow();
    expect(
      (await recheckLegacyTransaction(environment, actor, entry, undefined, f.storage, f.client))
        .state,
    ).toBe('replaced');
    expect(f.read()[0]?.state).toBe('replaced');
    expect(() => requireResolvedTransactions(f.storage, environment, actor)).not.toThrow();
  });

  it.each([
    { name: 'wrong nonce', nonce: 8, finalized: 30n },
    { name: 'unfinalized receipt', nonce: 7, finalized: 19n },
  ])('keeps the send blocked for $name', async ({ nonce, finalized }) => {
    vi.stubGlobal('navigator', {
      locks: { request: (_key: string, callback: () => Promise<unknown>) => callback() },
    });
    const f = fixture({ nonce, finalized });
    if (nonce !== 7)
      await expect(
        recheckLegacyTransaction(environment, actor, entry, undefined, f.storage, f.client),
      ).rejects.toThrow('TRANSACTION_MISMATCH');
    else
      expect(
        (await recheckLegacyTransaction(environment, actor, entry, undefined, f.storage, f.client))
          .state,
      ).toBe('unknown');
    expect(f.read()[0]?.state).toBe('unknown');
    expect(() => requireResolvedTransactions(f.storage, environment, actor)).toThrow();
  });
});
