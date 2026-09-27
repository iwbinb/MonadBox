import type { Address, Hex } from 'viem';
export interface ProbeEvent {
  chainId: number;
  contract: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  kind: 'Funded' | 'Refunded';
  id: Hex;
  payer: Address;
  amount: bigint;
  removed?: boolean;
}
/** Rebuild a complete bounded probe history, not a financial authority or persistent indexer. */
export function projectProbe(
  events: readonly ProbeEvent[],
  contract: Address,
  canonical: ReadonlyMap<bigint, Hex>,
) {
  const unique = new Map<string, ProbeEvent>();
  for (const event of events) {
    if (
      event.chainId !== 10143 ||
      event.contract.toLowerCase() !== contract.toLowerCase() ||
      event.removed ||
      canonical.get(event.blockNumber) !== event.blockHash
    )
      continue;
    if (event.amount <= 0n || event.amount > 1000000n) throw Error('Invalid event amount');
    const key = `${event.chainId}:${event.contract.toLowerCase()}:${event.blockHash}:${event.transactionHash}:${event.logIndex}`;
    const previous = unique.get(key);
    if (
      previous &&
      (previous.kind !== event.kind ||
        previous.id !== event.id ||
        previous.payer.toLowerCase() !== event.payer.toLowerCase() ||
        previous.amount !== event.amount)
    )
      throw Error('Conflicting duplicate');
    unique.set(key, event);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
  const payments = new Map<Hex, { payer: Address; amount: bigint; refunded: boolean }>();
  let locked = 0n,
    received = 0n,
    returned = 0n;
  for (const event of ordered) {
    if (event.kind === 'Funded') {
      if (payments.has(event.id)) throw Error('Payment ID reused');
      payments.set(event.id, { payer: event.payer, amount: event.amount, refunded: false });
      received += event.amount;
      locked += event.amount;
    } else {
      const payment = payments.get(event.id);
      if (
        !payment ||
        payment.refunded ||
        payment.payer.toLowerCase() !== event.payer.toLowerCase() ||
        payment.amount !== event.amount
      )
        throw Error('Incomplete or invalid refund history');
      payment.refunded = true;
      returned += event.amount;
      locked -= event.amount;
    }
  }
  if (locked < 0n || received !== locked + returned) throw Error('Conservation failure');
  return { payments, locked, received, returned };
}
