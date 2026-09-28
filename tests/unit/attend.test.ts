import { describe, it, expect, vi } from 'vitest';
import {
  keccak256,
  stringToHex,
  toHex,
  verifyTypedData,
  encodeEventTopics,
  encodeAbiParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { attendanceSchema, MAX_UINT256, moduleIntentSchema } from '../../src/shared/modules/model';
import type { ModulePublication, CheckInProof, ModuleIntent } from '../../src/shared/modules/model';
import {
  definitions,
  metadataFor,
  moduleId,
  termsHashFor,
  attendanceOrderId,
  moduleCall,
  moduleAbi,
} from '../../src/shared/modules/terms';
import { moduleActions, confirmModuleAction } from '../../src/shared/modules/chain';
import type { ModuleSnapshot } from '../../src/shared/modules/chain';
import { validateCheckIn, checkInTypedData, checkInHash } from '../../src/shared/modules/checkin';
import { agreementContext, validateAgreement } from '../../src/shared/modules/agreement';
import { TOKEN } from '../../src/shared/lab/network';
const [organizer, attendee, beneficiary] = [11, 12, 13].map((v) =>
  privateKeyToAccount(toHex(v, { size: 32 })),
) as [
  ReturnType<typeof privateKeyToAccount>,
  ReturnType<typeof privateKeyToAccount>,
  ReturnType<typeof privateKeyToAccount>,
];
const M = '0x3333333333333333333333333333333333333333',
  H = toHex(100, { size: 32 });
const data = attendanceSchema.parse({
  tool: 'attend',
  title: 'Attend',
  description: '',
  deposit: '101',
  capacity: 3,
  registrationDeadline: 10000,
  eventStart: 20000,
  eventEnd: 30000,
  checkinStart: 18000,
  checkinDeadline: 32000,
  challengeDeadline: 40000,
  disputeDuration: 86400,
  noShowPenaltyBps: 2500,
  penaltyBeneficiary: beneficiary.address,
  checkinSigner: organizer.address,
});
const partial = {
  data,
  creator: organizer.address,
  salt: H,
  deployment: {
    tool: 'attend' as const,
    chainId: 10143 as const,
    version: 1,
    address: M,
    asset: TOKEN,
    intakeAdmin: organizer.address,
    runtimeHash: keccak256(definitions.attend.artifact.runtime),
  },
};
const p: ModulePublication = {
  ...partial,
  id: crypto.randomUUID(),
  publicId: crypto.randomUUID(),
  chainBoxId: moduleId(M, organizer.address, H),
  termsHash: termsHashFor(partial),
  metadata: metadataFor(data),
  metadataHash: keccak256(stringToHex(metadataFor(data))),
};
const s: ModuleSnapshot = {
  state: 'CHECKIN_OPEN',
  storedState: 1,
  position: 1,
  activeCount: 2,
  locked: '202',
  credit: '0',
  withdrawn: '0',
  allowance: '0',
  balance: '101',
  paused: false,
  block: '100',
  blockHash: H,
  timestamp: 20000,
  participant: attendee.address,
  positionState: 'REGISTERED',
  positionLocked: '101',
  checkinNonce: '0',
  settlementNonce: '0',
  cancelled: false,
  disputeDue: 126400,
};
const proof: CheckInProof = {
  schemaVersion: 1,
  boxId: p.chainBoxId,
  termsHash: p.termsHash,
  attendee: attendee.address,
  signer: organizer.address,
  issuedAt: 20000,
  deadline: 32000,
  nonce: '0',
};
describe('Attend rules, permissions and proof binding', () => {
  it('checks temporal ordering, capacity overflow and exact penalty bounds', () => {
    for (const patch of [
      { capacity: 201 },
      { capacity: 2, deposit: MAX_UINT256.toString() },
      { noShowPenaltyBps: 10001 },
      { noShowPenaltyBps: -1 },
      { eventStart: 30000 },
      { checkinDeadline: 29000 },
      { challengeDeadline: 32000 },
    ])
      expect(attendanceSchema.safeParse({ ...data, ...patch }).success).toBe(false);
    expect(
      attendanceSchema.safeParse({
        ...data,
        deposit: MAX_UINT256.toString(),
        capacity: 1,
        noShowPenaltyBps: 0,
      }).success,
    ).toBe(true);
  });
  it('binds proof to current participant, activity, time, signer and nonce', () => {
    expect(validateCheckIn(p, s, proof)).toEqual(proof);
    for (const patch of [
      { boxId: H },
      { termsHash: H },
      { attendee: beneficiary.address },
      { signer: beneficiary.address },
      { issuedAt: 20001 },
      { issuedAt: 17000 },
      { deadline: 32001 },
      { deadline: 20000 },
      { nonce: '1' },
    ])
      expect(() => validateCheckIn(p, s, { ...proof, ...patch })).toThrow();
    for (const patch of [
      { timestamp: 32000 },
      { timestamp: 17999 },
      { position: 3 },
      { cancelled: true },
    ])
      expect(() => validateCheckIn(p, { ...s, ...patch }, proof)).toThrow();
  });
  it('keeps signature outside persisted intent while hashing exact submitted calldata', async () => {
    const typed = checkInTypedData(p, proof),
      signature = await organizer.signTypedData(typed);
    expect(await verifyTypedData({ ...typed, address: organizer.address, signature })).toBe(true);
    expect(checkInHash(p, proof)).not.toBe(checkInHash(p, { ...proof, nonce: '1' }));
    const i: ModuleIntent = {
      id: crypto.randomUUID(),
      publication: p,
      actor: attendee.address,
      action: 'checkIn',
      participant: attendee.address,
      checkIn: proof,
      nonce: 1,
      startBlock: '100',
      expiresAt: 20600,
    };
    expect(() => moduleCall(i)).toThrow('SIGNATURES_REQUIRED');
    i.calldataHash = keccak256(moduleCall(i, { checkIn: signature }).data);
    expect(moduleIntentSchema.safeParse(i).success).toBe(true);
    expect(moduleIntentSchema.safeParse({ ...i, signatures: { checkIn: signature } }).success).toBe(
      false,
    );
    expect(JSON.stringify(i)).not.toContain(signature);
  });
  it('does not expose registration or personal appeals for an inspected third party', () => {
    const open = { ...s, timestamp: 9999, position: 0 };
    expect(moduleActions(p, attendee.address, open)).toContain('approve');
    expect(moduleActions(p, organizer.address, open)).not.toContain('approve');
    expect(moduleActions(p, attendee.address, { ...open, timestamp: 10000 })).not.toContain(
      'approve',
    );
    expect(moduleActions(p, attendee.address, { ...s, timestamp: 32000 })).toContain(
      'challengeNoShow',
    );
    expect(moduleActions(p, organizer.address, { ...s, timestamp: 32000 })).not.toContain(
      'challengeNoShow',
    );
    expect(moduleActions(p, attendee.address, { ...s, timestamp: 39999 })).not.toContain(
      'finalizeNoShow',
    );
    expect(moduleActions(p, organizer.address, { ...s, timestamp: 40000 })).toContain(
      'finalizeNoShow',
    );
  });
  it('preserves cancellation refunds and dispute exits under pause', () => {
    expect(moduleActions(p, attendee.address, { ...s, cancelled: true, paused: true })).toEqual([
      'creditRefund',
    ]);
    const disputed = { ...s, timestamp: 126400, position: 4, paused: true };
    expect(moduleActions(p, attendee.address, disputed)).toEqual(['refundAfterDisputeTimeout']);
    expect(moduleActions(p, organizer.address, disputed)).toContain('refundDispute');
  });
  it('separates the organizer signature from the fixed penalty beneficiary', () => {
    const disputed = { ...s, position: 4 },
      context = agreementContext(p, disputed);
    expect(context.secondSigner).toBe(organizer.address);
    expect(context.seller).toBe(beneficiary.address);
    expect(context.orderId).toBe(attendanceOrderId(p.chainBoxId, attendee.address));
    const agreement = {
      schemaVersion: 1,
      boxId: p.chainBoxId,
      orderId: context.orderId,
      termsHash: p.termsHash,
      asset: TOKEN,
      remaining: '101',
      buyer: attendee.address,
      seller: beneficiary.address,
      buyerAmount: '76',
      sellerAmount: '25',
      settlementNonce: '0',
      deadline: 126400,
      stageIndex: 0,
    };
    expect(validateAgreement(p, disputed, agreement)).toEqual(agreement);
    expect(() =>
      validateAgreement(p, disputed, { ...agreement, seller: organizer.address }),
    ).toThrow();
    expect(() => validateAgreement(p, { ...disputed, cancelled: true }, agreement)).toThrow();
  });
});

// Recovery must use the witness from the public transaction after page memory is gone.
it('recovers a finalized check-in without storing its signature and rejects changed calldata', async () => {
  const signature = await organizer.signTypedData(checkInTypedData(p, proof));
  const i: ModuleIntent = {
    id: crypto.randomUUID(),
    publication: p,
    actor: attendee.address,
    action: 'checkIn',
    participant: attendee.address,
    checkIn: proof,
    nonce: 1,
    startBlock: '90',
    expiresAt: 20600,
  };
  const call = moduleCall(i, { checkIn: signature });
  i.calldataHash = keccak256(call.data);
  const tx = {
    from: attendee.address,
    to: M,
    input: call.data,
    value: 0n,
    nonce: 1,
    type: 'eip1559',
    blockHash: H,
    hash: H,
  };
  const log = {
    address: M,
    topics: encodeEventTopics({
      abi: moduleAbi('attend'),
      eventName: 'ActionExecuted',
      args: { boxId: p.chainBoxId, actor: attendee.address },
    }),
    data: encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }],
      [keccak256(stringToHex('checkIn')), 0n],
    ),
  };
  const c = {
    getChainId: vi.fn(async () => 10143),
    getCode: vi.fn(async () => definitions.attend.artifact.runtime),
    getTransaction: vi.fn(async () => tx),
    getTransactionReceipt: vi.fn(async () => ({
      status: 'success',
      blockNumber: 100n,
      blockHash: H,
      logs: [log],
    })),
    getBlock: vi.fn(async () => ({ number: 100n, hash: H, timestamp: 20001n })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'asset') return TOKEN;
      if (functionName === 'intakeAdmin') return organizer.address;
      if (functionName === 'domainNameHash') return keccak256(stringToHex('AttendanceBondV1'));
      if (functionName === 'getEvent')
        return {
          creator: organizer.address,
          termsHash: p.termsHash,
          terms: { metadataHash: p.metadataHash },
          activeCount: 1,
          cancelled: false,
        };
      if (functionName === 'getAttendance') return { state: 3, disputeDue: 0n, reasonHash: H };
      if (functionName === 'intakePaused') return false;
      return 0n;
    }),
  } as unknown as import('../../src/shared/lab/network').ChainClient;
  expect((await confirmModuleAction(c, i, H)).state).toBe('finalized');
  expect((await confirmModuleAction(c, { ...i, checkIn: { ...proof, nonce: '1' } }, H)).state).toBe(
    'replaced',
  );
  expect(JSON.stringify(i)).not.toContain(signature);
});
