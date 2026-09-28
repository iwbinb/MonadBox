import { z } from 'zod';
import { toHex } from 'viem';
import type { Address, Hex } from 'viem';
import {
  actionCall,
  actionIntentSchema,
  availableActions,
  confirmAction,
  groupAccount,
} from '../../shared/group/actions';
import type { GroupActionIntent } from '../../shared/group/actions';
import { hashSchema } from '../../shared/cloud/model';
import { same } from '../../shared/cloud/chain';
import { makeClient } from '../../shared/lab/network';
import { errorCode, requireWallet } from '../../shared/lab/wallet';
import type { InjectedProvider } from '../../shared/lab/wallet';

export const actionRecordSchema = z.strictObject({
  intent: actionIntentSchema,
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
export type ActionRecord = z.infer<typeof actionRecordSchema>;
const terminal = ['rejected', 'finalized', 'reverted', 'replaced'];
export function actionKey(environment: string, actor: Address) {
  return `monadbox.actions.v1:${environment}:10143:${actor.toLowerCase()}`;
}
export function readActions(storage: Pick<Storage, 'getItem'>, key: string): ActionRecord[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    if (raw.length > 1_000_000) throw Error();
    const rows = z.array(actionRecordSchema).max(200).parse(JSON.parse(raw));
    if (new Set(rows.map((r) => r.intent.id)).size !== rows.length) throw Error();
    return rows;
  } catch {
    throw Error('JOURNAL_UNAVAILABLE');
  }
}
export function saveAction(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  record: ActionRecord,
) {
  record = actionRecordSchema.parse(record);
  const rows = readActions(storage, key),
    index = rows.findIndex((r) => r.intent.id === record.intent.id);
  if (index < 0) {
    if (rows.length >= 200) throw Error('JOURNAL_FULL');
    rows.push(actionRecordSchema.parse(record));
  } else {
    const old = rows[index]!;
    if (JSON.stringify(old.intent) !== JSON.stringify(record.intent))
      throw Error('INTEGRITY_ERROR');
    if (old.state === 'finalized' || (record.state === 'unknown' && old.hash)) return;
    rows[index] = actionRecordSchema.parse(record);
  }
  storage.setItem(key, JSON.stringify(rows));
}
export async function sendGroupAction(
  provider: InjectedProvider,
  environment: string,
  input: GroupActionIntent,
): Promise<Hex> {
  const i = actionIntentSchema.parse(input),
    key = actionKey(environment, i.actor);
  if (!navigator.locks) throw Error('JOURNAL_UNAVAILABLE');
  return navigator.locks.request(`monadbox.sign:${i.actor.toLowerCase()}`, async () => {
    const rows = readActions(localStorage, key);
    if (rows.some((r) => !terminal.includes(r.state))) throw Error('UNRESOLVED_TRANSACTION');
    if (rows.some((r) => r.intent.id === i.id && r.state !== 'rejected'))
      throw Error('UNRESOLVED_TRANSACTION');
    await requireWallet(provider, i.actor);
    const client = makeClient(),
      call = actionCall(i);
    const [s, code, nonce, block] = await Promise.all([
      groupAccount(client, i.group, i.actor),
      client.getCode({ address: i.actor }),
      client.getTransactionCount({ address: i.actor, blockTag: 'pending' }),
      client.getBlock(),
    ]);
    if (code && code !== '0x') throw Error('UNSUPPORTED_WALLET');
    if (
      nonce !== i.nonce ||
      block.timestamp >= BigInt(i.expiresAt) ||
      !availableActions(i.group, i.actor, s).includes(i.action)
    )
      throw Error('ACTION_CHANGED');
    const gas = await client.estimateGas({ account: i.actor, ...call, value: 0n });
    if ((await client.getBalance({ address: i.actor })) < gas * (await client.getGasPrice()) * 2n)
      throw Error('INSUFFICIENT_GAS');
    await requireWallet(provider, i.actor);
    saveAction(localStorage, key, { intent: i, state: 'signing' });
    try {
      const hash = hashSchema.parse(
        await provider.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: i.actor,
              ...call,
              value: '0x0',
              chainId: toHex(10143),
              nonce: toHex(i.nonce),
              gas: toHex(gas + gas / 5n),
            },
          ],
        }),
      );
      try {
        saveAction(localStorage, key, { intent: i, state: 'broadcast', hash });
      } catch {
        /* The signing marker remains unresolved; return the known hash for manual recovery. */
      }
      return hash;
    } catch (e) {
      try {
        saveAction(localStorage, key, {
          intent: i,
          state: errorCode(e) === 4001 ? 'rejected' : 'unknown',
        });
      } catch {
        /* Preserve the earlier signing marker. */
      }
      throw e;
    }
  });
}
export async function recheckAction(environment: string, record: ActionRecord, supplied?: Hex) {
  if (!navigator.locks) throw Error('JOURNAL_UNAVAILABLE');
  return navigator.locks.request(`monadbox.sign:${record.intent.actor.toLowerCase()}`, async () => {
    const key = actionKey(environment, record.intent.actor);
    const saved = readActions(localStorage, key).find((r) => r.intent.id === record.intent.id);
    if (!saved || !same(saved.intent.actor, record.intent.actor))
      throw Error('JOURNAL_UNAVAILABLE');
    const result = await confirmAction(makeClient(), saved.intent, supplied ?? saved.hash);
    saveAction(localStorage, key, { intent: saved.intent, ...result });
    return { result, records: readActions(localStorage, key) };
  });
}
