import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, stringToHex } from 'viem';
import type { Abi, AbiParameter, Address, Hex } from 'viem';
import { artifact as split } from './generated/SplitPaymentsV1';
import { artifact as group } from './generated/GroupEscrowV2';
import { artifact as attend } from './generated/AttendanceBondV1';
import { artifact as deliver } from './generated/DeliveryEscrowV1';
import { artifact as milestones } from './generated/MilestoneEscrowV1';
import { artifact as rewards } from './generated/RewardsDistributorV1';
import { moduleDataSchema, modulePublicationSchema } from './model';
import type {
  ModuleData,
  ModuleIntent,
  ModulePublication,
  ModuleSignatures,
  CheckInProof,
  Agreement,
} from './model';
import { TOKEN } from '../lab/network';
import { same } from '../cloud/chain';
export const definitions = {
  split: { artifact: split, create: 'createSplit', get: 'getSplit', version: 1 },
  group: { artifact: group, create: 'createGroup', get: 'getGroup', version: 2 },
  attend: { artifact: attend, create: 'createEvent', get: 'getEvent', version: 1 },
  deliver: { artifact: deliver, create: 'createOffer', get: 'getOffer', version: 1 },
  milestones: { artifact: milestones, create: 'createOffer', get: 'getOffer', version: 1 },
  rewards: { artifact: rewards, create: 'createAndFundBatch', get: 'getBatch', version: 1 },
} as const;
export const signedModuleNames = {
  deliver: 'DeliveryEscrowV1',
  attend: 'AttendanceBondV1',
  milestones: 'MilestoneEscrowV1',
} as const;
export function moduleAbi(tool: ModuleData['tool']): Abi {
  return definitions[tool].artifact.abi;
}
export function metadataFor(input: ModuleData): string {
  const data = moduleDataSchema.parse(input);
  return JSON.stringify({
    schema: 1,
    tool: data.tool,
    title: data.title,
    description: data.description,
    ...(data.tool === 'milestones'
      ? { stages: data.stages.map((s) => ({ title: s.title, description: s.description })) }
      : {}),
  });
}
export function termsFor(data: ModuleData) {
  if (data.tool === 'rewards')
    return {
      recipients: data.recipients.map((r) => r.address),
      amounts: data.recipients.map((r) => BigInt(r.amount)),
      claimStart: BigInt(data.claimStart),
      claimDeadline: BigInt(data.claimDeadline),
      metadataHash: keccak256(stringToHex(metadataFor(data))),
    };
  if (data.tool === 'milestones')
    return {
      buyer: data.buyer,
      seller: data.seller,
      fundBy: BigInt(data.fundBy),
      disputeDuration: BigInt(data.disputeDuration),
      stages: data.stages.map((s) => ({
        amount: BigInt(s.amount),
        workDuration: BigInt(s.workDuration),
        reviewDuration: BigInt(s.reviewDuration),
      })),
      metadataHash: keccak256(stringToHex(metadataFor(data))),
    };
  if (data.tool === 'attend')
    return {
      deposit: BigInt(data.deposit),
      capacity: data.capacity,
      registrationDeadline: BigInt(data.registrationDeadline),
      eventStart: BigInt(data.eventStart),
      eventEnd: BigInt(data.eventEnd),
      checkinStart: BigInt(data.checkinStart),
      checkinDeadline: BigInt(data.checkinDeadline),
      challengeDeadline: BigInt(data.challengeDeadline),
      disputeDuration: BigInt(data.disputeDuration),
      noShowPenaltyBps: data.noShowPenaltyBps,
      penaltyBeneficiary: data.penaltyBeneficiary,
      checkinSigner: data.checkinSigner,
      metadataHash: keccak256(stringToHex(metadataFor(data))),
    };
  if (data.tool === 'deliver')
    return {
      buyer: data.buyer,
      seller: data.seller,
      amount: BigInt(data.amount),
      fundBy: BigInt(data.fundBy),
      workDuration: BigInt(data.workDuration),
      reviewDuration: BigInt(data.reviewDuration),
      disputeDuration: BigInt(data.disputeDuration),
      metadataHash: keccak256(stringToHex(metadataFor(data))),
    };
  const shares = {
    recipients: data.recipients.map((r) => r.address),
    bps: data.recipients.map((r) => r.bps),
    metadataHash: keccak256(stringToHex(metadataFor(data))),
  };
  return data.tool === 'split'
    ? shares
    : {
        unitPrice: BigInt(data.unitPrice),
        minParticipants: data.minimum,
        capacity: data.capacity,
        startsAt: BigInt(data.startsAt),
        fundingDeadline: BigInt(data.fundingDeadline),
        settleNotBefore: BigInt(data.settleNotBefore),
        ...shares,
      };
}
export function moduleId(module: Address, creator: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }],
      [10143n, module, creator, salt],
    ),
  );
}
export function termsHashFor(
  p: Pick<ModulePublication, 'deployment' | 'creator' | 'salt' | 'data'>,
): Hex {
  const definition = definitions[p.data.tool];
  const fn = moduleAbi(p.data.tool).find(
    (f) => f.type === 'function' && f.name === definition.create,
  );
  if (!fn || fn.type !== 'function') throw Error('UNSUPPORTED_MODULE');
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        fn.inputs[0] as AbiParameter,
      ],
      [
        BigInt(definition.version),
        10143n,
        p.deployment.address,
        moduleId(p.deployment.address, p.creator, p.salt),
        TOKEN,
        p.creator,
        termsFor(p.data),
      ],
    ),
  );
}
export function validatePublication(input: ModulePublication): ModulePublication {
  const p = modulePublicationSchema.parse(input);
  if (
    p.data.tool !== p.deployment.tool ||
    !same(p.deployment.asset, TOKEN) ||
    p.metadata !== metadataFor(p.data) ||
    p.metadataHash !== keccak256(stringToHex(p.metadata)) ||
    p.chainBoxId !== moduleId(p.deployment.address, p.creator, p.salt) ||
    p.termsHash !== termsHashFor(p) ||
    (p.data.tool === 'deliver' || p.data.tool === 'milestones'
      ? [p.data.buyer, p.data.seller].some((a) => same(a, p.deployment.address))
      : p.data.tool === 'attend'
        ? same(p.data.penaltyBeneficiary, p.deployment.address)
        : p.data.recipients.some((r) => same(r.address, p.deployment.address)))
  )
    throw Error('INTEGRITY_ERROR');
  return p;
}
export function approvalAmount(i: Pick<ModuleIntent, 'publication' | 'amount'>) {
  const d = i.publication.data;
  if (d.tool === 'rewards')
    return d.recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n).toString();
  if (d.tool === 'milestones')
    return d.stages.reduce((sum, s) => sum + BigInt(s.amount), 0n).toString();
  return d.tool === 'attend'
    ? d.deposit
    : d.tool === 'group'
      ? d.unitPrice
      : d.tool === 'deliver'
        ? d.amount
        : i.amount;
}
export function agreementTerms(a: Agreement) {
  return {
    ...a,
    schemaVersion: 1n,
    remaining: BigInt(a.remaining),
    buyerAmount: BigInt(a.buyerAmount),
    sellerAmount: BigInt(a.sellerAmount),
    settlementNonce: BigInt(a.settlementNonce),
    deadline: BigInt(a.deadline),
    stageIndex: BigInt(a.stageIndex),
  };
}
export function checkInTerms(p: CheckInProof) {
  return {
    ...p,
    schemaVersion: 1n,
    issuedAt: BigInt(p.issuedAt),
    deadline: BigInt(p.deadline),
    nonce: BigInt(p.nonce),
  };
}
export function attendanceOrderId(id: Hex, participant: Address) {
  return keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }], [id, participant]),
  );
}
export function moduleCall(
  i: ModuleIntent,
  signatures?: ModuleSignatures,
): { to: Address; data: Hex } {
  const p = validatePublication(i.publication),
    abi = moduleAbi(p.data.tool),
    id = p.chainBoxId;
  if (i.action === 'approve') {
    const amount = approvalAmount(i);
    if (!amount) throw Error('INVALID_AMOUNT');
    return {
      to: TOKEN,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [p.deployment.address, BigInt(amount)],
      }),
    };
  }
  let name: string = i.action,
    args: readonly unknown[] = [id];
  if (i.action === 'create') {
    if (!same(i.actor, p.creator)) throw Error('WRONG_ACCOUNT');
    name = definitions[p.data.tool].create;
    args = [termsFor(p.data), p.salt];
  } else if (i.action === 'withdrawFor') args = [id, i.actor];
  else if (i.action === 'resolveByAgreement') {
    if (
      !i.agreement ||
      !signatures?.first ||
      !signatures.second ||
      !/^0x[0-9a-f]{130}$/i.test(signatures.first) ||
      !/^0x[0-9a-f]{130}$/i.test(signatures.second)
    )
      throw Error('SIGNATURES_REQUIRED');
    args = [agreementTerms(i.agreement), signatures.first, signatures.second];
  } else if (p.data.tool === 'attend') {
    if (i.action === 'checkIn') {
      if (!i.checkIn || !signatures?.checkIn || !/^0x[0-9a-f]{130}$/i.test(signatures.checkIn))
        throw Error('SIGNATURES_REQUIRED');
      args = [checkInTerms(i.checkIn), signatures.checkIn];
    } else if (
      ['creditRefund', 'finalizeNoShow', 'refundDispute', 'refundAfterDisputeTimeout'].includes(
        i.action,
      )
    ) {
      if (!i.participant) throw Error('PARTICIPANT_REQUIRED');
      args = [id, i.participant];
    } else if (i.action === 'challengeNoShow') {
      if (!i.evidenceHash || /^0x0{64}$/.test(i.evidenceHash)) throw Error('EVIDENCE_REQUIRED');
      args = [id, i.evidenceHash];
    } else if (!['register', 'leave', 'cancelEvent'].includes(i.action))
      throw Error('ACTION_UNAVAILABLE');
  } else if (p.data.tool === 'rewards') {
    if (i.action === 'claimFor') args = [id, i.actor];
    else if (i.action !== 'reclaimExpired') throw Error('ACTION_UNAVAILABLE');
  } else if (i.action === 'creditRefund' && p.data.tool === 'group') args = [id, i.actor];
  else if (p.data.tool === 'deliver' || p.data.tool === 'milestones') {
    if (p.data.tool === 'milestones' && !['fund', 'cancelOffer'].includes(i.action)) {
      if (i.stageIndex === undefined) throw Error('STAGE_REQUIRED');
      args = [id, BigInt(i.stageIndex)];
    }
    if (['submitDelivery', 'dispute'].includes(i.action)) {
      if (!i.evidenceHash || /^0x0{64}$/.test(i.evidenceHash)) throw Error('EVIDENCE_REQUIRED');
      args = [...args, i.evidenceHash];
    } else if (
      ![
        'fund',
        'cancelOffer',
        'accept',
        'refundBySeller',
        'settleAfterReview',
        'refundAfterMissingDelivery',
        'refundAfterDisputeTimeout',
      ].includes(i.action)
    )
      throw Error('ACTION_UNAVAILABLE');
  } else if (i.action === 'pay') {
    if (p.data.tool !== 'split' || !i.amount || !i.paymentNonce) throw Error('INVALID_PAYMENT');
    args = [id, BigInt(i.amount), i.paymentNonce];
  } else if (p.data.tool !== 'group') throw Error('ACTION_UNAVAILABLE');
  return { to: p.deployment.address, data: encodeFunctionData({ abi, functionName: name, args }) };
}
/** Identical bounded integer allocation to SplitMath.sol; order resolves ties. */
export function allocateSplit(amount: bigint, bps: readonly number[]): bigint[] {
  if (
    amount < 0n ||
    amount > (1n << 256n) - 1n ||
    bps.length < 2 ||
    bps.length > 20 ||
    bps.some((v) => !Number.isInteger(v) || v <= 0) ||
    bps.reduce((a, b) => a + b, 0) !== 10000
  )
    throw Error('INVALID_SPLIT');
  const shares = bps.map((b) => (amount * BigInt(b)) / 10000n);
  const ranked = bps
    .map((b, index) => ({ index, remainder: (amount * BigInt(b)) % 10000n }))
    .sort((a, b) => Number(b.remainder - a.remainder) || a.index - b.index);
  const remaining = Number(amount - shares.reduce((a, b) => a + b, 0n));
  for (let n = 0; n < remaining; n++) shares[ranked[n]!.index]! += 1n;
  return shares;
}
