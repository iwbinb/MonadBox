import { z } from 'zod';
import type { Address, Hex } from 'viem';
const hex = z
  .string()
  .regex(/^0x(?:[a-f0-9]{2})*$/i)
  .max(100000);
const hash = z.string().regex(/^0x[a-f0-9]{64}$/i);
const address = z.string().regex(/^0x[a-f0-9]{40}$/i);
export const operationSchema = z.object({
  version: z.literal(1),
  chainId: z.literal(10143),
  localId: hash,
  kind: z.enum(['deploy', 'approve', 'fund', 'refund']),
  account: address,
  to: address.nullable(),
  data: hex,
  amount: z.string().regex(/^\d+$/).max(78),
  transactionNonce: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  paymentNonce: hash,
  paymentId: hash,
  probe: address.nullable(),
  hash: hash.nullable(),
  startBlock: z.string().regex(/^\d+$/).max(24),
  createdAt: z.string(),
  state: z.enum([
    'signing',
    'broadcast',
    'included',
    'finalized',
    'rejected',
    'reverted',
    'replaced',
    'unknown',
  ]),
});
export type Operation = Omit<
  z.infer<typeof operationSchema>,
  'account' | 'to' | 'data' | 'localId' | 'paymentNonce' | 'paymentId' | 'probe' | 'hash'
> & {
  account: Address;
  to: Address | null;
  data: Hex;
  localId: Hex;
  paymentNonce: Hex;
  paymentId: Hex;
  probe: Address | null;
  hash: Hex | null;
};
export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function journalKey(account: Address) {
  return `monadbox.lab.v1.10143.${account.toLowerCase()}`;
}
export function readJournal(storage: RecoveryStorage, account: Address): Operation[] {
  const raw = storage.getItem(journalKey(account));
  if (!raw) return [];
  const records = z.array(operationSchema).max(50).parse(JSON.parse(raw)) as Operation[];
  if (records.some((r) => r.account.toLowerCase() !== account.toLowerCase()))
    throw Error('Corrupt recovery journal');
  return records;
}
export function unresolved(op: Operation) {
  return !['finalized', 'rejected', 'reverted', 'replaced'].includes(op.state);
}
export function storeOperation(storage: RecoveryStorage, op: Operation) {
  try {
    operationSchema.parse(op);
    const records = readJournal(storage, op.account);
    const previous = records.findIndex((r) => r.localId === op.localId);
    if (previous >= 0) records[previous] = op;
    else records.push(op);
    if (records.length > 50) {
      const drop = records.findIndex((r) => !unresolved(r));
      if (drop < 0) throw Error('Too many pending operations');
      records.splice(drop, 1);
    }
    storage.setItem(journalKey(op.account), JSON.stringify(records));
  } catch {
    throw Error('JOURNAL_UNAVAILABLE');
  }
}
