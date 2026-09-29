import { decodeEventLog, decodeFunctionData, erc20Abi, keccak256, stringToHex } from 'viem';
import type { Address, Hex } from 'viem';
import { inspectNetwork, makeClient, TOKEN } from '../network';
import type { ChainClient } from '../network';
import { recoverNonce } from '../nonce-recovery';
import { same } from '../cloud/chain';
import type { ReceiptResult } from '../cloud/chain';
import {
  attendanceOrderId,
  signedModuleNames,
  approvalAmount,
  definitions,
  moduleAbi,
  moduleCall,
  validatePublication,
} from './terms';
import { moduleIntentSchema } from './model';
import { validateAgreement } from './agreement';
import { validateCheckIn } from './checkin';
import type {
  Agreement,
  ModuleSignatures,
  CheckInProof,
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
    (d.tool === 'deliver' || d.tool === 'attend' || d.tool === 'milestones') &&
    (await client.readContract({ address, abi, functionName: 'domainNameHash' })) !==
      keccak256(stringToHex(signedModuleNames[d.tool]))
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
  participant?: Address;
  positionState?: string;
  positionLocked?: string;
  cancelled?: boolean;
  checkinNonce?: string;
  currentStage?: number;
  released?: string;
  allocation?: string;
  claimedCount?: number;
  claimedAmount?: string;
  reclaimed?: boolean;
}
export async function moduleSnapshot(
  client: ChainClient,
  input: ModulePublication,
  actor: Address,
  participant: Address = actor,
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
      Promise.resolve(0n),
      client.getBalance({ address: actor, blockNumber }),
    ]);
  const r = record as {
    creator: Address;
    termsHash: Hex;
    terms: { metadataHash: Hex };
    state?: number;
    activeCount?: number;
    cancelled?: boolean;
    submitDue?: bigint;
    reviewDue?: bigint;
    disputeDue?: bigint;
    settledAt?: bigint;
    currentStage?: bigint;
    released?: bigint;
    totalAmount?: bigint;
    claimedAmount?: bigint;
    claimedCount?: number;
    reclaimed?: boolean;
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
    p.data.tool === 'deliver' || p.data.tool === 'milestones'
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
  if (p.data.tool === 'deliver' || p.data.tool === 'milestones') {
    state =
      [
        'NONE',
        'AWAITING_FUNDS',
        'FUNDED',
        'SUBMITTED',
        'DISPUTED',
        p.data.tool === 'milestones' ? 'COMPLETED' : 'RELEASED',
        p.data.tool === 'milestones' ? 'TERMINATED' : 'REFUNDED',
        'RESOLVED',
        'CANCELLED',
        'EXPIRED',
      ][storedState] ?? 'NONE';
    if (state === 'NONE') throw Error('INTEGRITY_ERROR');
  }
  if (p.data.tool === 'milestones') {
    const index = Number(r.currentStage);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= p.data.stages.length ||
      String(r.released) !==
        p.data.stages
          .slice(0, state === 'COMPLETED' ? index + 1 : index)
          .reduce((sum, stage) => sum + BigInt(stage.amount), 0n)
          .toString()
    )
      throw Error('INTEGRITY_ERROR');
  }
  let rewards: Partial<ModuleSnapshot> = {};
  if (p.data.tool === 'rewards') {
    const [allocation, claimed] = await Promise.all([
      read('allocation', [id, actor]),
      read('claimed', [id, actor]),
    ]);
    const total = BigInt(approvalAmount({ publication: p })!);
    if (
      r.totalAmount !== total ||
      typeof r.claimedAmount !== 'bigint' ||
      r.claimedAmount > total ||
      BigInt(String(locked)) !== (r.reclaimed ? 0n : total - r.claimedAmount)
    )
      throw Error('INTEGRITY_ERROR');
    rewards = {
      allocation: String(allocation),
      position: claimed ? 2 : BigInt(String(allocation)) > 0n ? 1 : 0,
      claimedCount: Number(r.claimedCount),
      claimedAmount: String(r.claimedAmount),
      reclaimed: !!r.reclaimed,
    };
    state = r.reclaimed
      ? 'RECLAIMED'
      : r.claimedAmount === total
        ? 'FULLY_CLAIMED'
        : Number(block.timestamp) >= p.data.claimDeadline
          ? 'CLAIM_EXPIRED'
          : Number(block.timestamp) < p.data.claimStart
            ? 'UPCOMING'
            : 'CLAIM_OPEN';
  }
  let attendance: Partial<ModuleSnapshot> = {};
  if (p.data.tool === 'attend') {
    const order = attendanceOrderId(id, participant),
      [attendanceRecord, settlementNonce, checkinNonce] = await Promise.all([
        read('getAttendance', [id, participant]),
        read('settlementNonce', [order]),
        read('checkinNonce', [order]),
      ]);
    const a = attendanceRecord as { state: number; disputeDue: bigint; reasonHash: Hex },
      position = Number(a.state),
      now = Number(block.timestamp),
      d = p.data;
    const positionState = ['NONE', 'REGISTERED', 'LEFT', 'CHECKED_IN', 'DISPUTED', 'SETTLED'][
      position
    ];
    if (!positionState) throw Error('INTEGRITY_ERROR');
    attendance = {
      participant,
      position,
      positionState,
      positionLocked: [1, 4].includes(position) ? d.deposit : '0',
      cancelled: !!r.cancelled,
      disputeDue: Number(a.disputeDue),
      reasonHash: a.reasonHash,
      settlementNonce: String(settlementNonce),
      checkinNonce: String(checkinNonce),
    };
    state = r.cancelled
      ? 'CANCELLED'
      : position >= 2
        ? positionState
        : now >= d.challengeDeadline
          ? 'EVENT_ENDED'
          : now >= d.checkinDeadline
            ? 'CHALLENGE_OPEN'
            : now >= d.checkinStart
              ? 'CHECKIN_OPEN'
              : now >= d.registrationDeadline
                ? 'REGISTRATION_CLOSED'
                : activeCount >= d.capacity
                  ? 'FULL'
                  : 'OPEN';
  }
  if ((await client.getBlock({ blockNumber })).hash !== block.hash)
    throw Error('FINALITY_UNAVAILABLE');
  return {
    ...delivery,
    ...(p.data.tool === 'milestones'
      ? { currentStage: Number(r.currentStage), released: String(r.released) }
      : {}),
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
    ...attendance,
    ...rewards,
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
      actions.push('pay');
    return actions;
  }
  const d = p.data;
  if (d.tool === 'rewards') {
    if (
      s.position === 1 &&
      s.timestamp >= d.claimStart &&
      s.timestamp < d.claimDeadline &&
      !s.reclaimed
    )
      actions.push('claimFor');
    if (
      same(actor, p.creator) &&
      s.timestamp >= d.claimDeadline &&
      BigInt(s.locked) > 0n &&
      !s.reclaimed
    )
      actions.push('reclaimExpired');
    return actions;
  }
  if (d.tool === 'attend') {
    const now = s.timestamp,
      owns = s.participant && same(actor, s.participant),
      organizer = same(actor, p.creator);
    if (
      !s.cancelled &&
      owns &&
      !s.paused &&
      s.position === 0 &&
      now < d.registrationDeadline &&
      s.activeCount < d.capacity &&
      BigInt(s.balance) >= BigInt(d.deposit)
    )
      actions.push('register');
    if (owns && s.position === 1 && now < d.registrationDeadline) actions.push('leave');
    if (!s.cancelled && s.position === 1) {
      if (now >= d.checkinStart && now < d.checkinDeadline) actions.push('checkIn');
      if (owns && now >= d.checkinDeadline && now < d.challengeDeadline)
        actions.push('challengeNoShow');
      if (now >= d.challengeDeadline) actions.push('finalizeNoShow');
    }
    if (organizer && !s.cancelled && now < d.challengeDeadline) actions.push('cancelEvent');
    if (s.cancelled && [1, 4].includes(s.position)) actions.push('creditRefund');
    if (s.position === 4) {
      if (organizer) actions.push('refundDispute');
      if (now >= s.disputeDue!) actions.push('refundAfterDisputeTimeout');
      else if (!s.cancelled) actions.push('resolveByAgreement');
    }
    return actions;
  }
  if (d.tool === 'deliver' || d.tool === 'milestones') {
    const buyer = same(actor, d.buyer),
      seller = same(actor, d.seller),
      now = s.timestamp,
      fullAmount = approvalAmount({ publication: p })!;
    if (s.state === 'AWAITING_FUNDS') {
      if (!s.paused && buyer && now < d.fundBy && BigInt(s.balance) >= BigInt(fullAmount))
        actions.push('fund');
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
    actions.push('contribute');
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
  stageIndex?: number;
  evidenceHash?: Hex;
  agreement?: Agreement;
  signatures?: ModuleSignatures;
  participant?: Address;
  checkIn?: CheckInProof;
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
  let currentStage = 0;
  if (action === 'approve') throw Error('ACTION_UNAVAILABLE');
  if (action !== 'create') {
    const snapshot = await moduleSnapshot(client, p, actor, options.participant);
    currentStage = snapshot.currentStage ?? 0;
    if (
      p.data.tool === 'milestones' &&
      options.stageIndex !== undefined &&
      options.stageIndex !== currentStage
    )
      throw Error('ACTION_CHANGED');
    if (!moduleActions(p, actor, snapshot, amount).includes(action))
      throw Error('ACTION_UNAVAILABLE');
    if (action === 'checkIn') validateCheckIn(p, snapshot, options.checkIn);
    if (action === 'resolveByAgreement') validateAgreement(p, snapshot, options.agreement);
  }
  const paymentAmount =
    p.data.tool === 'split'
      ? amount
      : action === 'fund' ||
          action === 'contribute' ||
          action === 'register' ||
          (p.data.tool === 'rewards' && action === 'create')
        ? approvalAmount({ publication: p })
        : undefined;
  const i = moduleIntentSchema.parse({
    id: crypto.randomUUID(),
    publication: p,
    actor,
    action,
    ...(p.data.tool === 'milestones' ? { stageIndex: currentStage } : {}),
    ...(paymentAmount ? { amount: paymentAmount } : {}),
    ...(['submitDelivery', 'dispute', 'challengeNoShow'].includes(action) && options.evidenceHash
      ? { evidenceHash: options.evidenceHash }
      : {}),
    ...(p.data.tool === 'attend' ? { participant: options.participant ?? actor } : {}),
    ...(action === 'checkIn' && options.checkIn ? { checkIn: options.checkIn } : {}),
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
  if (['resolveByAgreement', 'checkIn'].includes(action)) i.calldataHash = keccak256(call.data);
  await client.estimateGas({ account: actor, ...call });
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
    if (p.data.tool === 'attend' && !['create', 'withdrawFor'].includes(i.action))
      return (
        event.eventName === 'ActionExecuted' &&
        addressMatches('actor', i.actor) &&
        a.action === keccak256(stringToHex(i.action)) &&
        a.stageIndex === 0n
      );
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
      case 'claimFor':
        return (
          p.data.tool === 'rewards' &&
          event.eventName === 'RewardClaimed' &&
          addressMatches('recipient', i.actor) &&
          a.amount ===
            BigInt(p.data.recipients.find((r) => same(r.address, i.actor))?.amount ?? '0')
        );
      case 'reclaimExpired':
        return (
          p.data.tool === 'rewards' &&
          event.eventName === 'ExpiredReclaimed' &&
          addressMatches('creator', p.creator) &&
          typeof a.amount === 'bigint' &&
          a.amount > 0n
        );
      case 'withdrawFor':
        return (
          event.eventName === 'Withdrawal' &&
          addressMatches('beneficiary', i.actor) &&
          typeof a.amount === 'bigint' &&
          a.amount > 0n
        );
      default:
        return (
          (p.data.tool === 'deliver' || p.data.tool === 'milestones') &&
          event.eventName === 'ActionExecuted' &&
          addressMatches('actor', i.actor) &&
          a.action === keccak256(stringToHex(i.action)) &&
          a.stageIndex === BigInt(i.stageIndex ?? 0)
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
    let signatures: ModuleSignatures | undefined;
    if (['resolveByAgreement', 'checkIn'].includes(i.action)) {
      if (!i.calldataHash || keccak256(tx.input) !== i.calldataHash)
        return { ...evidence, state: 'replaced' };
      const decoded = decodeFunctionData({
        abi: moduleAbi(i.publication.data.tool),
        data: tx.input,
      });
      if (decoded.functionName !== i.action) return { ...evidence, state: 'replaced' };
      signatures =
        i.action === 'checkIn'
          ? { checkIn: decoded.args![1] as Hex }
          : { first: decoded.args![1] as Hex, second: decoded.args![2] as Hex };
    }
    call = moduleCall(i, signatures);
  } catch {
    return { ...evidence, state: 'replaced' };
  }
  if (!tx.to || !same(tx.to, call.to) || !same(tx.input, call.data) || tx.value !== call.value)
    return { ...evidence, state: 'replaced' };
  if (!receipt.logs.some((log) => eventMatches(i, log))) throw Error('TRANSACTION_MISMATCH');
  if (i.action !== 'approve') await moduleSnapshot(client, i.publication, i.actor, i.participant);
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
    snapshot: (p: ModulePublication, actor: Address, participant?: Address) =>
      moduleSnapshot(client, p, actor, participant),
  };
}
export type ModuleChain = ReturnType<typeof makeModuleChain>;
