import { z } from 'zod';
import { decodeEventLog, encodeFunctionData, erc20Abi } from 'viem';
import type { Address, Hex } from 'viem';
import { intentSchema, addressSchema } from '../cloud/model';
import type { PublishIntent } from '../cloud/model';
import { calldata, groupAbi, makeCloudChain, same, verifyDeployment } from '../cloud/chain';
import type { ReceiptResult } from '../cloud/chain';
import { inspectNetwork, TOKEN } from '../lab/network';
import type { ChainClient } from '../lab/network';

export const groupActions = [
  'approve',
  'contribute',
  'leave',
  'finalize',
  'cancel',
  'creditRefund',
  'settle',
  'withdrawFor',
] as const;
export type GroupAction = (typeof groupActions)[number];
export const actionIntentSchema = z.strictObject({
  id: z.string().uuid(),
  group: intentSchema,
  actor: addressSchema,
  action: z.enum(groupActions),
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  startBlock: z.string().regex(/^\d+$/),
  expiresAt: z.number().int().positive(),
});
export type GroupActionIntent = z.infer<typeof actionIntentSchema>;

export function actionCall(i: GroupActionIntent): { to: Address; data: Hex } {
  calldata(i.group); // Validate the complete frozen terms and domain before encoding a funds action.
  const id = i.group.chainBoxId;
  if (i.action === 'approve')
    return {
      to: TOKEN,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [i.group.deployment.address, BigInt(i.group.data.unitPrice)],
      }),
    };
  const data =
    i.action === 'creditRefund' || i.action === 'withdrawFor'
      ? encodeFunctionData({ abi: groupAbi, functionName: i.action, args: [id, i.actor] })
      : encodeFunctionData({ abi: groupAbi, functionName: i.action, args: [id] });
  return { to: i.group.deployment.address, data };
}

export async function groupAccount(client: ChainClient, group: PublishIntent, actor: Address) {
  calldata(group);
  const snapshot = await makeCloudChain(client).snapshot(group);
  const blockNumber = BigInt(snapshot.blockNumber),
    address = group.deployment.address;
  const [position, credit, withdrawn, allowance, balance, paused, stored] = await Promise.all([
    client.readContract({
      address,
      abi: groupAbi,
      functionName: 'positions',
      args: [group.chainBoxId, actor],
      blockNumber,
    }),
    client.readContract({
      address,
      abi: groupAbi,
      functionName: 'creditForBox',
      args: [group.chainBoxId, actor],
      blockNumber,
    }),
    client.readContract({
      address,
      abi: groupAbi,
      functionName: 'withdrawnForBox',
      args: [group.chainBoxId, actor],
      blockNumber,
    }),
    client.readContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [actor, address],
      blockNumber,
    }),
    client.readContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [actor],
      blockNumber,
    }),
    client.readContract({ address, abi: groupAbi, functionName: 'intakePaused', blockNumber }),
    client.readContract({
      address,
      abi: groupAbi,
      functionName: 'getGroup',
      args: [group.chainBoxId],
      blockNumber,
    }),
  ]);
  if ((await client.getBlock({ blockNumber })).hash !== snapshot.blockHash)
    throw Error('FINALITY_UNAVAILABLE');
  return {
    snapshot,
    position,
    credit: credit.toString(),
    withdrawn: withdrawn.toString(),
    allowance: allowance.toString(),
    balance: balance.toString(),
    paused,
    storedState: stored.state,
  };
}
export type GroupAccount = Awaited<ReturnType<typeof groupAccount>>;
export function availableActions(
  group: PublishIntent,
  actor: Address,
  s: GroupAccount,
): GroupAction[] {
  const actions: GroupAction[] = [],
    time = s.snapshot.timestamp;
  if (
    s.snapshot.state === 'OPEN' &&
    !s.paused &&
    s.position === 0 &&
    BigInt(s.balance) >= BigInt(group.data.unitPrice)
  )
    actions.push(BigInt(s.allowance) < BigInt(group.data.unitPrice) ? 'approve' : 'contribute');
  if (s.storedState === 1 && time < group.data.fundingDeadline && s.position === 1)
    actions.push('leave');
  if (s.storedState === 1 && time >= group.data.fundingDeadline) actions.push('finalize');
  if ([1, 2].includes(s.storedState) && same(actor, group.creator)) actions.push('cancel');
  if (['REFUNDABLE', 'CANCELLED'].includes(s.snapshot.state) && s.position === 1)
    actions.push('creditRefund');
  if (s.snapshot.state === 'READY' && time >= group.data.settleNotBefore) actions.push('settle');
  if (BigInt(s.credit) > 0n) actions.push('withdrawFor');
  return actions;
}
export async function prepareAction(
  client: ChainClient,
  group: PublishIntent,
  actor: Address,
  action: GroupAction,
): Promise<GroupActionIntent> {
  await inspectNetwork(client);
  const [state, code, nonce, block] = await Promise.all([
    groupAccount(client, group, actor),
    client.getCode({ address: actor }),
    client.getTransactionCount({ address: actor, blockTag: 'pending' }),
    client.getBlock(),
  ]);
  if (code && code !== '0x') throw Error('UNSUPPORTED_WALLET');
  if (!availableActions(group, actor, state).includes(action)) throw Error('ACTION_UNAVAILABLE');
  const intent: GroupActionIntent = {
    id: crypto.randomUUID(),
    group,
    actor,
    action,
    nonce,
    startBlock: block.number.toString(),
    expiresAt: Number(block.timestamp) + 600,
  };
  const call = actionCall(intent);
  await client.estimateGas({ account: actor, ...call, value: 0n });
  return intent;
}

function matchingEvent(
  i: GroupActionIntent,
  receipt: Awaited<ReturnType<ChainClient['getTransactionReceipt']>>,
) {
  return receipt.logs.some((log) => {
    try {
      if (i.action === 'approve') {
        if (!same(log.address, TOKEN)) return false;
        const e = decodeEventLog({
          abi: erc20Abi,
          eventName: 'Approval',
          data: log.data,
          topics: log.topics,
        });
        return (
          same(e.args.owner, i.actor) &&
          same(e.args.spender, i.group.deployment.address) &&
          e.args.value === BigInt(i.group.data.unitPrice)
        );
      }
      if (!same(log.address, i.group.deployment.address)) return false;
      const e = decodeEventLog({ abi: groupAbi, data: log.data, topics: log.topics });
      if (!('boxId' in e.args) || !same(e.args.boxId, i.group.chainBoxId)) return false;
      switch (i.action) {
        case 'contribute':
          return (
            e.eventName === 'Funded' &&
            same(e.args.participant, i.actor) &&
            e.args.amount === BigInt(i.group.data.unitPrice)
          );
        case 'leave':
          return e.eventName === 'ParticipantLeft' && same(e.args.participant, i.actor);
        case 'finalize':
          return e.eventName === 'GroupFinalized' && [2, 3].includes(e.args.state);
        case 'cancel':
          return e.eventName === 'GroupCancelled';
        case 'creditRefund':
          return (
            e.eventName === 'CreditAssigned' &&
            e.args.reason === 1 &&
            same(e.args.beneficiary, i.actor) &&
            e.args.amount === BigInt(i.group.data.unitPrice)
          );
        case 'settle':
          return e.eventName === 'GroupSettled' && e.args.amount > 0n;
        case 'withdrawFor':
          return (
            e.eventName === 'Withdrawal' && same(e.args.beneficiary, i.actor) && e.args.amount > 0n
          );
      }
    } catch {
      return false;
    }
  });
}
export async function confirmAction(
  client: ChainClient,
  input: GroupActionIntent,
  supplied?: Hex,
): Promise<ReceiptResult> {
  const i = actionIntentSchema.parse(input),
    call = actionCall(i);
  await verifyDeployment(client, i.group.deployment);
  let hash = supplied;
  if (!hash) {
    const head = await client.getBlockNumber();
    for (let n = head; n >= BigInt(i.startBlock) && head - n < 41n; n--) {
      const b = await client.getBlock({ blockNumber: n, includeTransactions: true });
      const tx = b.transactions.find((t) => same(t.from, i.actor) && t.nonce === i.nonce);
      if (tx) {
        hash = tx.hash;
        break;
      }
    }
  }
  if (!hash) return { state: 'unknown' };
  let tx, receipt;
  try {
    [tx, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
  } catch {
    return { state: 'unknown', hash };
  }
  if (!same(tx.from, i.actor) || tx.nonce !== i.nonce) throw Error('TRANSACTION_MISMATCH');
  if (!['legacy', 'eip2930', 'eip1559'].includes(tx.type) || tx.authorizationList != null)
    throw Error('UNSUPPORTED_TRANSACTION');
  const [canonical, finalized] = await Promise.all([
    client.getBlock({ blockNumber: receipt.blockNumber }),
    client.getBlock({ blockTag: 'finalized' }),
  ]);
  if (
    !canonical.hash ||
    canonical.hash !== receipt.blockHash ||
    tx.blockHash !== receipt.blockHash ||
    finalized.number < receipt.blockNumber
  )
    return { state: 'unknown', hash };
  const result = { hash, block: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
  if (receipt.status !== 'success') return { ...result, state: 'reverted' };
  if (!tx.to || !same(tx.to, call.to) || !same(tx.input, call.data) || tx.value !== 0n)
    return { ...result, state: 'replaced' };
  if (!matchingEvent(i, receipt)) throw Error('TRANSACTION_MISMATCH');
  await groupAccount(client, i.group, i.actor);
  return { ...result, state: 'finalized' };
}
