import { describe, expect, it, vi } from 'vitest';
import { recoverNonce } from '../../src/shared/nonce-recovery';
import type { ChainClient } from '../../src/shared/lab/network';
import type { Address, Hex } from 'viem';
const actor = '0x1111111111111111111111111111111111111111' as Address,
  hash = ('0x' + 'ab'.repeat(32)) as Hex;
function fake(target = 500n, head = 5_000_000n) {
  const reads = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
    blockNumber >= target ? 8 : 7,
  );
  const block = vi.fn(async () => ({ transactions: [{ from: actor, nonce: 7, hash }] }));
  return {
    reads,
    block,
    client: {
      getBlockNumber: async () => head,
      getTransactionCount: reads,
      getBlock: block,
    } as unknown as ChainClient,
  };
}
describe('EOA nonce recovery across delayed finality', () => {
  it('finds the original transaction after millions of later blocks with logarithmic reads', async () => {
    const f = fake();
    expect(await recoverNonce(f.client, actor, 7, 1n)).toBe(hash);
    expect(f.reads.mock.calls.length).toBeLessThan(26);
    expect(f.block).toHaveBeenCalledWith({ blockNumber: 500n, includeTransactions: true });
  });
  it('finds a transaction in the start block and exact head', async () => {
    for (const target of [1n, 500n]) {
      const f = fake(target, 500n);
      expect(await recoverNonce(f.client, actor, 7, 1n)).toBe(hash);
    }
  });
  it('does not guess if a nonce predates the intent or is not consumed', async () => {
    const f = fake();
    expect(await recoverNonce(f.client, actor, 7, 501n)).toBeUndefined();
    expect(await recoverNonce(f.client, actor, 8, 1n)).toBeUndefined();
    expect(f.block).not.toHaveBeenCalled();
  });
  it('keeps archive/RPC failures unknown', async () => {
    const f = fake();
    f.reads.mockRejectedValue(Error('archive unavailable'));
    expect(await recoverNonce(f.client, actor, 7, 1n)).toBeUndefined();
  });
  it('requires the original actor and nonce in the located block', async () => {
    const f = fake();
    f.block.mockResolvedValue({ transactions: [{ from: actor, nonce: 8, hash }] });
    expect(await recoverNonce(f.client, actor, 7, 1n)).toBeUndefined();
  });
});
