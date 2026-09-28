import { z } from 'zod';
import { toHex } from 'viem';
import type { Hex } from 'viem';
import { hashSchema } from '../../shared/cloud/model';
import { moduleIntentSchema } from '../../shared/modules/model';
import type { ModuleIntent } from '../../shared/modules/model';
import { moduleCall } from '../../shared/modules/terms';
import { confirmModuleAction, verifyModule } from '../../shared/modules/chain';
import { makeClient } from '../../shared/lab/network';
import { requireWallet } from '../../shared/lab/wallet';
import type { InjectedProvider } from '../../shared/lab/wallet';
import { requireResolvedTransactions } from '../shared/transaction-storage';
export const transactionRecordSchema = z.strictObject({
  intent: moduleIntentSchema,
  state: z.enum([
    'signing',
    'broadcast',
    'unknown',
    'rejected',
    'finalized',
    'reverted',
    'replaced',
  ]),
  hash: hashSchema.optional(),
  block: z.string().regex(/^\d+$/).optional(),
  blockHash: hashSchema.optional(),
});
export type TransactionRecord = z.infer<typeof transactionRecordSchema>;
export const journalKey = (environment: string, actor: string) =>
  `monadbox.module-actions.v1:${environment}:10143:${actor.toLowerCase()}`;
export const terminal = (row: TransactionRecord) =>
  ['rejected', 'finalized', 'reverted', 'replaced'].includes(row.state);
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export function readRecords(storage: StoragePort, key: string): TransactionRecord[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    if (raw.length > 2_000_000) throw Error();
    const rows = transactionRecordSchema.array().max(200).parse(JSON.parse(raw));
    if (new Set(rows.map((r) => r.intent.id)).size !== rows.length) throw Error();
    return rows;
  } catch {
    throw Error('JOURNAL_UNAVAILABLE');
  }
}
export function saveRecord(
  storage: StoragePort,
  key: string,
  input: TransactionRecord,
): TransactionRecord[] {
  const row = transactionRecordSchema.parse(input),
    rows = readRecords(storage, key),
    index = rows.findIndex((r) => r.intent.id === row.intent.id),
    old = rows[index];
  if (old) {
    if (JSON.stringify(old.intent) !== JSON.stringify(row.intent)) throw Error('INTENT_CHANGED');
    if (old.state === 'finalized' || (row.state === 'unknown' && old.hash)) return rows;
    rows[index] = row;
  } else {
    if (rows.length >= 200) throw Error('JOURNAL_FULL');
    rows.push(row);
  }
  storage.setItem(key, JSON.stringify(rows));
  return rows;
}
export async function sendModuleAction(
  provider: InjectedProvider,
  environment: string,
  input: ModuleIntent,
): Promise<Hex> {
  const i = moduleIntentSchema.parse(input);
  if (!navigator.locks) throw Error('LOCKS_REQUIRED');
  return navigator.locks.request(`monadbox.sign:${i.actor.toLowerCase()}`, async () => {
    requireResolvedTransactions(localStorage, environment, i.actor);
    const key = journalKey(environment, i.actor),
      rows = readRecords(localStorage, key);
    if (
      rows.some((r) => !terminal(r)) ||
      rows.some((r) => r.intent.id === i.id && r.state !== 'rejected')
    )
      throw Error('RECHECK_REQUIRED');
    await requireWallet(provider, i.actor);
    const client = makeClient();
    await verifyModule(client, i.publication.deployment);
    const [block, nonce, code] = await Promise.all([
      client.getBlock(),
      client.getTransactionCount({ address: i.actor, blockTag: 'pending' }),
      client.getCode({ address: i.actor }),
    ]);
    if (code && code !== '0x') throw Error('EOA_REQUIRED');
    if (nonce !== i.nonce || block.timestamp >= BigInt(i.expiresAt)) throw Error('ACTION_CHANGED');
    const call = moduleCall(i),
      gas = await client.estimateGas({ account: i.actor, ...call, value: 0n });
    const [balance, price] = await Promise.all([
      client.getBalance({ address: i.actor }),
      client.getGasPrice(),
    ]);
    if (balance < gas * price * 2n) throw Error('INSUFFICIENT_GAS');
    await requireWallet(provider, i.actor);
    saveRecord(localStorage, key, { intent: i, state: 'signing' });
    let hash: Hex | undefined;
    try {
      hash = hashSchema.parse(
        await provider.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: i.actor,
              to: call.to,
              data: call.data,
              value: '0x0',
              chainId: toHex(10143),
              nonce: toHex(i.nonce),
              gas: toHex(gas + gas / 5n),
            },
          ],
        }),
      );
      try {
        saveRecord(localStorage, key, { intent: i, state: 'broadcast', hash });
      } catch {
        /* Retain the earlier signing marker and return the known hash. */
      }
      return hash;
    } catch (error) {
      const rejected = error && typeof error === 'object' && 'code' in error && error.code === 4001;
      try {
        saveRecord(localStorage, key, {
          intent: i,
          state: rejected ? 'rejected' : 'unknown',
          ...(hash ? { hash } : {}),
        });
      } catch {
        /* Never erase the earlier intent. */
      }
      throw error;
    }
  });
}
export async function recheckModule(environment: string, row: TransactionRecord, supplied?: Hex) {
  if (!navigator.locks) throw Error('LOCKS_REQUIRED');
  return navigator.locks.request(`monadbox.sign:${row.intent.actor.toLowerCase()}`, async () => {
    const key = journalKey(environment, row.intent.actor),
      saved = readRecords(localStorage, key).find((r) => r.intent.id === row.intent.id);
    if (!saved) throw Error('JOURNAL_UNAVAILABLE');
    const result = await confirmModuleAction(makeClient(), saved.intent, supplied ?? saved.hash);
    const records = saveRecord(localStorage, key, { intent: saved.intent, ...result });
    return { result, records };
  });
}
