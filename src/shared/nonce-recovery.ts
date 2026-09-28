import type { Address, Hex } from 'viem';
import type { ChainClient } from './lab/network';

/** Locate the block that consumed an EOA nonce with at most 66 historical nonce reads.
 * Archive/RPC failures remain unknown; callers still verify the complete transaction and finality.
 */
export async function recoverNonce(
  client: ChainClient,
  actor: Address,
  nonce: number,
  start: bigint,
): Promise<Hex | undefined> {
  try {
    let low = start,
      high = await client.getBlockNumber();
    if (low > high || high - low >= 1n << 64n) return;
    const count = (blockNumber: bigint) =>
      client.getTransactionCount({ address: actor, blockNumber });
    if ((await count(high)) <= nonce || (low > 0n && (await count(low - 1n)) > nonce)) return;
    for (let step = 0; low < high && step < 64; step++) {
      const middle = (low + high) / 2n;
      if ((await count(middle)) > nonce) high = middle;
      else low = middle + 1n;
    }
    if (low !== high) return;
    const block = await client.getBlock({ blockNumber: low, includeTransactions: true });
    return block.transactions.find(
      (tx) => tx.from.toLowerCase() === actor.toLowerCase() && tx.nonce === nonce,
    )?.hash;
  } catch {
    return undefined;
  }
}
