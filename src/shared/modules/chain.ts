import { decodeEventLog, decodeFunctionData, erc20Abi, keccak256, stringToHex } from 'viem';
import type { Address, Hex } from 'viem';
import { inspectNetwork, makeClient, TOKEN } from '../lab/network';
import type { ChainClient } from '../lab/network';
import { recoverNonce } from '../nonce-recovery';
import { same } from '../cloud/chain';
import type { ReceiptResult } from '../cloud/chain';
import { approvalAmount, definitions, moduleAbi, moduleCall, validatePublication } from './terms';
import { moduleIntentSchema } from './model';
import type {
  Agreement,
  AgreementSignatures,
  ModuleAction,
  ModuleDeployment,
  ModuleIntent,
  ModulePublication,
} from './model';

export async function verifyModule(client: ChainClient, d: ModuleDeployment) {
  if (d.chainId !== 10143 || !same(d.asset, TOKEN) || (await client.getChainId()) !== 10143)
    throw Error('WRONG_CHAIN');
  const definition = definitions[d.tool];
  if (definition.version !== d.version) throw Error('UNSUPPORTED_MODULE');
  const abi = moduleAbi(d.tool),
    address = d.address;
  const [code, token, admin] = await Promise.all([
    client.getCode({ address }),
    client.readContract({ address, abi, functionName: 'asset' }),
    client.readContract({ address, abi, functionName: 'intakeAdmin' }),
  ]);
  if (
    !code ||
    code.length !== definition.artifact.runtime.length ||
    keccak256(code) !== d.runtimeHash ||
    typeof token !== 'string' ||
    !same(token, TOKEN) ||
    typeof admin !== 'string' ||
    !same(admin, d.intakeAdmin)
  )
    throw Error('UNVERIFIED_CONTRACT');
  if (
    d.tool === 'deliver' &&
    (await client.readContract({ address, abi, functionName: 'domainNameHash' })) !==
      keccak256(stringToHex('DeliveryEscrowV1'))
  )
    throw Error('UNVERIFIED_CONTRACT');
  let normalized: string = code.toLowerCase();
  for (const refs of Object.values(definition.artifact.immutableReferences))
    for (const { start, length } of refs) {
      const from = 2 + start * 2,
        to = from + length * 2;
      normalized =
        normalized.slice(0, from) +
        definition.artifact.runtime.slice(from, to) +
        normalized.slice(to);
    }
  if (normalized !== definition.artifact.runtime.toLowerCase()) throw Error('UNVERIFIED_CONTRACT');
}
export interface ModuleSnapshot {
  state: string;
  storedState: number;
  activeCount: number;
  position: number;
  locked: string;
  credit: string;
  withdrawn: string;
  allowance: string;
  balance: string;
  paused: boolean;
  block: string;
  blockHash: Hex;
  timestamp: number;
  submitDue?: number;
  reviewDue?: number;
  disputeDue?: number;
  settledAt?: number;
  evidenceHash?: Hex;
  reasonHash?: Hex;
  settlementNonce?: string;
}
export async function moduleSnapshot(
  client: ChainClient,
  input: ModulePublication,
  actor: Address,
): Promise<ModuleSnapshot> {
  const p = validatePublication(input);
  await verifyModule(client, p.deployment);
  const block = await client.getBlock({ blockTag: 'finalized' });
  if (!block.hash || block.number === null) throw Error('FINALITY_UNAVAILABLE');
  const abi = moduleAbi(p.data.tool),
    address = p.deployment.address,
    blockNumber = block.number,
    id = p.chainBoxId;
  const read = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ abi, address, functionName, args, blockNumber });
  const [record, locked, credit, withdrawn, paused, position, allowance, balance] =
    await Promise.all([
      read(definitions[p.data.tool].get, [id]),
      read('locked', [id]),
      read('creditForBox', [id, actor]),
      read('withdrawnForBox', [id, actor]),
      read('intakePaused'),
      p.data.tool === 'group' ? read('positions', [id, actor]) : 0,
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
    ]);
  const r = record as {
    creator: Address;
    termsHash: Hex;
    terms: { metadataHash: Hex };
    state?: number;
    activeCount?: number;
    submitDue?: bigint;
    reviewDue?: bigint;
    disputeDue?: bigint;
    settledAt?: bigint;
    evidenceHash?: Hex;
    reasonHash?: Hex;
  };
  if (
    !same(r.creator, p.creator) ||
    r.termsHash !== p.termsHash ||
    r.terms.metadataHash !== p.metadataHash
  )
    throw Error('INTEGRITY_ERROR');
  const storedState = r.state ?? 1,
    activeCount = r.activeCount ?? 0;
  let state = 'ACTIVE';
  if (p.data.tool === 'group') {
    state = ['NONE', 'OPEN', 'READY', 'REFUNDABLE', 'CANCELLED', 'SETTLED'][storedState] ?? 'NONE';
    if (state === 'OPEN')
      state =
        Number(block.timestamp) < p.data.startsAt
          ? 'UPCOMING'
          : Number(block.timestamp) >= p.data.fundingDeadline
            ? activeCount >= p.data.minimum
              ? 'READY'
              : 'REFUNDABLE'
            : activeCount >= p.data.capacity
              ? 'FULL'
              : 'OPEN';
    if (state === 'NONE') throw Error('INTEGRITY_ERROR');
  }
  const delivery =
    p.data.tool === 'deliver'
      ? {
          submitDue: Number(r.submitDue),
          reviewDue: Number(r.reviewDue),
          disputeDue: Number(r.disputeDue),
          settledAt: Number(r.settledAt),
          evidenceHash: r.evidenceHash!,
          reasonHash: r.reasonHash!,
          settlementNonce: String(await read('settlementNonce', [id])),
        }
      : {};
  if (p.data.tool === 'deliver') {
    state =
      [
        'NONE',
        'AWAITING_FUNDS',
        'FUNDED',
        'SUBMITTED',
        'DISPUTED',
        'RELEASED',
        'REFUNDED',
        'RESOLVED',
        'CANCELLED',
        'EXPIRED',
      ][storedState] ?? 'NONE';
    if (state === 'NONE') throw Error('INTEGRITY_ERROR');
  }
  if ((await client.getBlock({ blockNumber })).hash !== block.hash)
    throw Error('FINALITY_UNAVAILABLE');
  return {
    ...delivery,
    state,
    storedState,
    activeCount,
    position: Number(position),
    locked: String(locked),
    credit: String(credit),
    withdrawn: String(withdrawn),
    paused: Boolean(paused),
    allowance: allowance.toString(),
    balance: balance.toString(),
    block: blockNumber.toString(),
    blockHash: block.hash,
    timestamp: Number(block.timestamp),
  };
}
export function moduleActions(
  p: ModulePublication,
  actor: Address,
  s: ModuleSnapshot,
  amount?: string,
): ModuleAction[] {
  const actions: ModuleAction[] = [];
  if (BigInt(s.credit) > 0n) actions.push('withdrawFor');
  if (p.data.tool === 'split') {
    if (!s.paused && amount && BigInt(amount) > 0n && BigInt(s.balance) >= BigInt(amount))
      actions.push(BigInt(s.allowance) < BigInt(amount) ? 'approve' : 'pay');
    return actions;
  }
  const d = p.data;
  if (d.tool === 'deliver') {
    const buyer = same(actor, d.buyer),
      seller = same(actor, d.seller),
      now = s.timestamp;
    if (s.state === 'AWAITING_FUNDS') {
      if (!s.paused && buyer && now < d.fundBy && BigInt(s.balance) >= BigInt(d.amount))
        actions.push(BigInt(s.allowance) < BigInt(d.amount) ? 'approve' : 'fund');
      if (buyer || seller || now >= d.fundBy) actions.push('cancelOffer');
    }
    if (s.state === 'FUNDED') {
      if (seller && now < s.submitDue!) actions.push('submitDelivery');
      if (now >= s.submitDue!) actions.push('refundAfterMissingDelivery');
    }
    if (s.state === 'SUBMITTED') {
      if (buyer) actions.push('accept');
      if (buyer && now < s.reviewDue!) actions.push('dispute');
      if (now >= s.reviewDue!) actions.push('settleAfterReview');
    }
    if (s.state === 'DISPUTED')
      actions.push(now >= s.disputeDue! ? 'refundAfterDisputeTimeout' : 'resolveByAgreement');
    if (seller && ['FUNDED', 'SUBMITTED', 'DISPUTED'].includes(s.state))
      actions.push('refundBySeller');
    return actions;
  }
  if (
    !s.paused &&
    s.state === 'OPEN' &&
    s.position === 0 &&
    BigInt(s.balance) >= BigInt(d.unitPrice)
  )
    actions.push(BigInt(s.allowance) < BigInt(d.unitPrice) ? 'approve' : 'contribute');
  if (s.position === 1 && s.storedState === 1 && s.timestamp < d.fundingDeadline)
    actions.push('leave');
  if (s.storedState === 1 && s.timestamp >= d.fundingDeadline) actions.push('finalize');
  if (same(actor, p.creator) && [1, 2].includes(s.storedState)) actions.push('cancel');
  if (s.position === 1 && ['REFUNDABLE', 'CANCELLED'].includes(s.state))
    actions.push('creditRefund');
  if (s.state === 'READY' && s.timestamp >= d.settleNotBefore) actions.push('settle');
  return actions;
}
export interface ModuleActionOptions {
  evidenceHash?: Hex;
  agreement?: Agreement;
  signatures?: AgreementSignatures;
}
export async function prepareModuleAction(
  client: ChainClient,
  p: ModulePublication,
  actor: Address,
  action: ModuleAction,
  amount?: string,
  options: ModuleActionOptions = {},
): Promise<ModuleIntent> {
  validatePublication(p);
  await inspectNetwork(client);
  await verifyModule(client, p.deployment);
  const [block, nonce, code] = await Promise.all([
    client.getBlock(),
    client.getTransactionCount({ address: actor, blockTag: 'pending' }),
    client.getCode({ address: actor }),
  ]);
  if (code && code !== '0x') throw Error('EOA_REQUIRED');
  if (
    action !== 'create' &&
    !moduleActions(p, actor, await moduleSnapshot(client, p, actor), amount).includes(action)
  )
    throw Error('ACTION_UNAVAILABLE');
  const paymentAmount =
    p.data.tool === 'split'
      ? amount
      : action === 'approve' || action === 'fund' || action === 'contribute'
        ? approvalAmount({ publication: p })
        : undefined;
  const i = moduleIntentSchema.parse({
    id: crypto.randomUUID(),
    publication: p,
    actor,
    action,
    ...(paymentAmount ? { amount: paymentAmount } : {}),
    ...(['submitDelivery', 'dispute'].includes(action) && options.evidenceHash
      ? { evidenceHash: options.evidenceHash }
      : {}),
    ...(action === 'resolveByAgreement' && options.agreement
      ? { agreement: options.agreement }
      : {}),
    ...(action === 'pay'
      ? { paymentNonce: keccak256(crypto.getRandomValues(new Uint8Array(32))) }
      : {}),
    nonce,
    startBlock: block.number.toString(),
    expiresAt: Number(block.timestamp) + 600,
  });
  const call = moduleCall(i, options.signatures);
  if (action === 'resolveByAgreement') i.calldataHash = keccak256(call.data);
  await client.estimateGas({ account: actor, ...call, value: 0n });
  return i;
}
function eventMatches(
  i: ModuleIntent,
  log: { address: Address; topics: readonly Hex[]; data: Hex },
): boolean {
  const p = i.publication,
    approval = i.action === 'approve';
  if (!same(log.address, approval ? TOKEN : p.deployment.address)) return false;
  try {
    const event = decodeEventLog({
      abi: approval ? erc20Abi : moduleAbi(p.data.tool),
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
    });
    const a = event.args as unknown as Record<string, unknown>;
    const addressMatches = (key: string, value: string) =>
      typeof a[key] === 'string' && same(a[key] as string, value);
    if (approval)
      return (
        event.eventName === 'Approval' &&
        addressMatches('owner', i.actor) &&
        addressMatches('spender', p.deployment.address) &&
        a.value === BigInt(approvalAmount(i)!)
      );
    if (a.boxId !== p.chainBoxId) return false;
    switch (i.action) {
      case 'create':
        return (
          event.eventName === 'BoxCreated' &&
          addressMatches('creator', p.creator) &&
          addressMatches('asset', TOKEN) &&
          a.version === BigInt(p.deployment.version) &&
          a.termsHash === p.termsHash &&
          a.metadataHash === p.metadataHash
        );
      case 'pay':
        return (
          event.eventName === 'SplitPaid' &&
          addressMatches('payer', i.actor) &&
          a.amount === BigInt(i.amount!) &&
          a.paymentNonce === i.paymentNonce
        );
      case 'contribute':
        return (
          event.eventName === 'Funded' &&
          addressMatches('payer', i.actor) &&
          p.data.tool === 'group' &&
          a.amount === BigInt(p.data.unitPrice)
        );
      case 'leave':
        return event.eventName === 'ParticipantLeft' && addressMatches('participant', i.actor);
      case 'finalize':
        return event.eventName === 'GroupFinalized' && [2, 3].includes(Number(a.state));
      case 'cancel':
        return event.eventName === 'GroupCancelled';
      case 'creditRefund':
        return (
          event.eventName === 'CreditAssigned' &&
          addressMatches('beneficiary', i.actor) &&
          p.data.tool === 'group' &&
          a.amount === BigInt(p.data.unitPrice)
        );
      case 'settle':
        return event.eventName === 'GroupSettled' && typeof a.amount === 'bigint' && a.amount > 0n;
      case 'withdrawFor':
        return (
          event.eventName === 'Withdrawal' &&
          addressMatches('beneficiary', i.actor) &&
          typeof a.amount === 'bigint' &&
          a.amount > 0n
        );
      default:
        return (
          p.data.tool === 'deliver' &&
          event.eventName === 'ActionExecuted' &&
          addressMatches('actor', i.actor) &&
          a.action === keccak256(stringToHex(i.action)) &&
          a.stageIndex === 0n
        );
    }
  } catch {
    return false;
  }
}
export async function confirmModuleAction(
  client: ChainClient,
  input: ModuleIntent,
  supplied?: Hex,
): Promise<ReceiptResult> {
  const i = moduleIntentSchema.parse(input);
  await verifyModule(client, i.publication.deployment);
  let hash = supplied;
  if (!hash) {
    hash = await recoverNonce(client, i.actor, i.nonce, BigInt(i.startBlock));
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
    canonical.hash !== receipt.blockHash ||
    finalized.number < receipt.blockNumber ||
    tx.blockHash !== receipt.blockHash
  )
    return { state: 'unknown', hash };
  const evidence = { hash, block: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
  if (receipt.status !== 'success') return { ...evidence, state: 'reverted' };
  let call;
  try {
    let signatures: AgreementSignatures | undefined;
    if (i.action === 'resolveByAgreement') {
      if (!i.calldataHash || keccak256(tx.input) !== i.calldataHash)
        return { ...evidence, state: 'replaced' };
      const decoded = decodeFunctionData({
        abi: moduleAbi(i.publication.data.tool),
        data: tx.input,
      });
      if (decoded.functionName !== 'resolveByAgreement') return { ...evidence, state: 'replaced' };
      signatures = { first: decoded.args![1] as Hex, second: decoded.args![2] as Hex };
    }
    call = moduleCall(i, signatures);
  } catch {
    return { ...evidence, state: 'replaced' };
  }
  if (!tx.to || !same(tx.to, call.to) || !same(tx.input, call.data) || tx.value !== 0n)
    return { ...evidence, state: 'replaced' };
  if (!receipt.logs.some((log) => eventMatches(i, log))) throw Error('TRANSACTION_MISMATCH');
  if (i.action !== 'approve') await moduleSnapshot(client, i.publication, i.actor);
  return { ...evidence, state: 'finalized' };
}
export function makeModuleChain(client: ChainClient = makeClient()) {
  return {
    prepare: (
      p: ModulePublication,
      actor: Address,
      action: ModuleAction,
      amount?: string,
      options?: ModuleActionOptions,
    ) => prepareModuleAction(client, p, actor, action, amount, options),
    confirm: (i: ModuleIntent, hash?: Hex) => confirmModuleAction(client, i, hash),
    snapshot: (p: ModulePublication, actor: Address) => moduleSnapshot(client, p, actor),
  };
}
export type ModuleChain = ReturnType<typeof makeModuleChain>;
