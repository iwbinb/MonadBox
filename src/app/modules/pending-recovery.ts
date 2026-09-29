import { z } from 'zod';
import type { Address, Hex } from 'viem';
import { addressSchema, hashSchema } from '../../shared/cloud/model';
import { makeClient } from '../../shared/network';
import type { ChainClient } from '../../shared/network';
import { recoverNonce } from '../../shared/nonce-recovery';
import type { PendingTransaction } from '../shared/transaction-storage';

const legacyRecordSchema = z
  .object({
    intent: z
      .object({
        id: z.string().uuid(),
        actor: addressSchema,
        nonce: z.number().int().nonnegative(),
        startBlock: z.string().regex(/^\d+$/),
      })
      .passthrough(),
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
  })
  .passthrough();
type LegacyRecord = z.infer<typeof legacyRecordSchema>;
type LegacyPrefix = 'monadbox.actions.v1' | 'monadbox.module-actions.v1';

/** A finalized transaction using the old nonce makes a resend impossible.
 * We label it replaced unless the receipt proves a revert; old asset rules are never reinterpreted as MON.
 */
export async function recheckLegacyTransaction(
  environment: string,
  actor: Address,
  entry: PendingTransaction & { prefix: LegacyPrefix },
  supplied?: Hex,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  client: ChainClient = makeClient(),
) {
  if (!navigator.locks) throw Error('LOCKS_REQUIRED');
  return navigator.locks.request(`monadbox.sign:${actor.toLowerCase()}`, async () => {
    const key = `${entry.prefix}:${environment}:10143:${actor.toLowerCase()}`;
    const raw = storage.getItem(key);
    if (!raw || raw.length > 2_000_000) throw Error('JOURNAL_UNAVAILABLE');
    let rows: LegacyRecord[];
    try {
      rows = legacyRecordSchema.array().max(200).parse(JSON.parse(raw));
      if (new Set(rows.map((r) => r.intent.id)).size !== rows.length) throw Error();
    } catch {
      throw Error('JOURNAL_UNAVAILABLE');
    }
    const index = rows.findIndex((r) => r.intent.id === entry.id);
    const saved = rows[index];
    if (!saved || saved.intent.actor.toLowerCase() !== actor.toLowerCase())
      throw Error('JOURNAL_UNAVAILABLE');
    if (['rejected', 'finalized', 'reverted', 'replaced'].includes(saved.state))
      return { state: saved.state, hash: saved.hash };
    if ((await client.getChainId()) !== 10143) throw Error('WRONG_RPC_CHAIN');
    let hash = supplied
      ? hashSchema.parse(supplied)
      : (saved.hash ??
        (await recoverNonce(client, actor, saved.intent.nonce, BigInt(saved.intent.startBlock))));
    if (!hash) return { state: 'unknown' as const };
    let tx, receipt;
    try {
      [tx, receipt] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
      ]);
    } catch {
      const found =
        !supplied && saved.hash
          ? await recoverNonce(client, actor, saved.intent.nonce, BigInt(saved.intent.startBlock))
          : undefined;
      if (!found || found.toLowerCase() === hash.toLowerCase())
        return { state: 'unknown' as const, hash };
      hash = found;
      try {
        [tx, receipt] = await Promise.all([
          client.getTransaction({ hash }),
          client.getTransactionReceipt({ hash }),
        ]);
      } catch {
        return { state: 'unknown' as const, hash };
      }
    }
    if (
      tx.from.toLowerCase() !== actor.toLowerCase() ||
      tx.nonce !== saved.intent.nonce ||
      tx.chainId !== 10143
    )
      throw Error('TRANSACTION_MISMATCH');
    const [canonical, finalized] = await Promise.all([
      client.getBlock({ blockNumber: receipt.blockNumber }),
      client.getBlock({ blockTag: 'finalized' }),
    ]);
    if (
      canonical.hash !== receipt.blockHash ||
      tx.blockHash !== receipt.blockHash ||
      finalized.number < receipt.blockNumber
    )
      return { state: 'unknown' as const, hash };
    const state = receipt.status === 'success' ? 'replaced' : 'reverted';
    rows[index] = { ...saved, state, hash };
    storage.setItem(key, JSON.stringify(rows));
    return { state, hash };
  });
}

export async function recheckPendingTransaction(
  environment: string,
  actor: Address,
  entry: PendingTransaction,
  supplied?: Hex,
) {
  if (entry.prefix === 'monadbox.module-actions.mon-v2') {
    const { journalKey, readRecords, recheckModule } = await import('./journal');
    const row = readRecords(localStorage, journalKey(environment, actor)).find(
      (r) => r.intent.id === entry.id,
    );
    if (!row || row.intent.actor.toLowerCase() !== actor.toLowerCase())
      throw Error('JOURNAL_UNAVAILABLE');
    const first = (await recheckModule(environment, row, supplied)).result;
    if (first.state !== 'unknown' || supplied || !row.hash) return first;
    const found = await recoverNonce(
      makeClient(),
      actor,
      row.intent.nonce,
      BigInt(row.intent.startBlock),
    );
    return found && found.toLowerCase() !== row.hash.toLowerCase()
      ? (await recheckModule(environment, row, found)).result
      : first;
  }
  if (entry.prefix === 'monadbox.actions.mon-v2') {
    const { actionKey, readActions, recheckAction } = await import('../group/action-journal');
    const row = readActions(localStorage, actionKey(environment, actor)).find(
      (r) => r.intent.id === entry.id,
    );
    if (!row || row.intent.actor.toLowerCase() !== actor.toLowerCase())
      throw Error('JOURNAL_UNAVAILABLE');
    const first = (await recheckAction(environment, row, supplied)).result;
    if (first.state !== 'unknown' || supplied || !row.hash) return first;
    const found = await recoverNonce(
      makeClient(),
      actor,
      row.intent.nonce,
      BigInt(row.intent.startBlock),
    );
    return found && found.toLowerCase() !== row.hash.toLowerCase()
      ? (await recheckAction(environment, row, found)).result
      : first;
  }
  if (entry.prefix === 'monadbox.setup.mon-v2') {
    const { readSetup, recoverSetup, setupKey } = await import('../shared/deployment');
    const row = readSetup(localStorage, setupKey(environment, actor)).find(
      (r) => r.intent.id === entry.id,
    );
    if (!row || row.intent.actor.toLowerCase() !== actor.toLowerCase())
      throw Error('JOURNAL_UNAVAILABLE');
    const first = await recoverSetup(environment, row, localStorage, makeClient(), supplied);
    if (!['unknown', 'broadcast'].includes(first.state) || supplied || !row.hash) return first;
    const found = await recoverNonce(
      makeClient(),
      actor,
      row.intent.nonce,
      BigInt(row.intent.startBlock),
    );
    return found && found.toLowerCase() !== row.hash.toLowerCase()
      ? recoverSetup(environment, row, localStorage, makeClient(), found)
      : first;
  }
  return recheckLegacyTransaction(
    environment,
    actor,
    entry as PendingTransaction & {
      prefix: LegacyPrefix;
    },
    supplied,
  );
}
