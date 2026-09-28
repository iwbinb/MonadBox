import { describe, it, expect, vi } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  decodeFunctionData,
  keccak256,
  stringToHex,
  toHex,
} from 'viem';
import { milestonesSchema, MAX_UINT256 } from '../../src/shared/modules/model';
import type { ModulePublication, ModuleIntent, Agreement } from '../../src/shared/modules/model';
import {
  definitions,
  metadataFor,
  moduleId,
  moduleCall,
  moduleAbi,
  termsHashFor,
  approvalAmount,
  validatePublication,
} from '../../src/shared/modules/terms';
import {
  agreementContext,
  agreementTypedData,
  validateAgreement,
} from '../../src/shared/modules/agreement';
import { confirmModuleAction, moduleActions } from '../../src/shared/modules/chain';
import type { ModuleSnapshot } from '../../src/shared/modules/chain';
import { TOKEN } from '../../src/shared/lab/network';
import type { ChainClient } from '../../src/shared/lab/network';
const buyer = '0x1111111111111111111111111111111111111111',
  seller = '0x2222222222222222222222222222222222222222',
  M = '0x3333333333333333333333333333333333333333',
  H = toHex(7, { size: 32 });
const data = milestonesSchema.parse({
  tool: 'milestones',
  title: 'Three stages',
  description: 'Public',
  buyer,
  seller,
  fundBy: 10000,
  disputeDuration: 86400,
  stages: [31, 40, 30].map((amount, n) => ({
    title: 'Stage ' + (n + 1),
    description: 'Accepted output',
    amount: String(amount),
    workDuration: 3600,
    reviewDuration: 3600,
  })),
});
const partial = {
  data,
  creator: buyer,
  salt: H,
  deployment: {
    tool: 'milestones' as const,
    chainId: 10143 as const,
    version: 1,
    address: M,
    asset: TOKEN,
    intakeAdmin: buyer,
    runtimeHash: keccak256(definitions.milestones.artifact.runtime),
  },
};
const p: ModulePublication = {
  ...partial,
  id: crypto.randomUUID(),
  publicId: crypto.randomUUID(),
  chainBoxId: moduleId(M, buyer, H),
  termsHash: termsHashFor(partial),
  metadata: metadataFor(data),
  metadataHash: keccak256(stringToHex(metadataFor(data))),
};
const s: ModuleSnapshot = {
  state: 'DISPUTED',
  storedState: 4,
  position: 0,
  activeCount: 0,
  currentStage: 1,
  released: '31',
  locked: '70',
  credit: '0',
  withdrawn: '0',
  allowance: '0',
  balance: '1000',
  paused: false,
  block: '100',
  blockHash: H,
  timestamp: 20000,
  submitDue: 24000,
  reviewDue: 25000,
  disputeDue: 100000,
  settledAt: 0,
  settlementNonce: '0',
};
const agreement: Agreement = {
  schemaVersion: 1,
  boxId: p.chainBoxId,
  orderId: p.chainBoxId,
  termsHash: p.termsHash,
  asset: TOKEN,
  remaining: '70',
  buyer,
  seller,
  buyerAmount: '50',
  sellerAmount: '20',
  settlementNonce: '0',
  deadline: 50000,
  stageIndex: 1,
};
describe('Milestones frozen plan and stage binding', () => {
  it('requires 2–10 stages, positive amounts, bounded sums and per-stage clocks', () => {
    for (const stages of [
      data.stages.slice(0, 1),
      Array(11).fill(data.stages[0]),
      [{ ...data.stages[0], amount: '0' }, data.stages[1]],
      [{ ...data.stages[0], amount: MAX_UINT256.toString() }, data.stages[1]],
      [{ ...data.stages[0], workDuration: 3599 }, data.stages[1]],
    ])
      expect(milestonesSchema.safeParse({ ...data, stages }).success).toBe(false);
    expect(approvalAmount({ publication: p })).toBe('101');
  });
  it('binds stage titles and acceptance criteria as well as amounts and durations', () => {
    for (const patch of [
      { title: 'Changed' },
      { description: 'Changed' },
      { amount: '32' },
      { workDuration: 7200 },
      { reviewDuration: 7200 },
    ]) {
      const changed = {
        ...data,
        stages: [{ ...data.stages[0]!, ...patch }, ...data.stages.slice(1)],
      };
      expect(termsHashFor({ ...partial, data: changed })).not.toBe(p.termsHash);
      expect(() => validatePublication({ ...p, data: changed })).toThrow();
    }
  });
  it('includes the reviewed stage in calldata and refuses omitted stage indices', () => {
    const i: ModuleIntent = {
      id: crypto.randomUUID(),
      publication: p,
      actor: buyer,
      action: 'accept',
      stageIndex: 1,
      nonce: 7,
      startBlock: '90',
      expiresAt: 20600,
    };
    expect(
      decodeFunctionData({ abi: moduleAbi('milestones'), data: moduleCall(i).data }).args,
    ).toEqual([p.chainBoxId, 1n]);
    const { stageIndex: _stage, ...missing } = i;
    void _stage;
    expect(() => moduleCall(missing)).toThrow('STAGE_REQUIRED');
    expect(moduleCall({ ...i, stageIndex: 0 }).data).not.toBe(moduleCall(i).data);
  });
  it('binds disputes to all remaining funds at the current stage', () => {
    expect(validateAgreement(p, s, agreement)).toEqual(agreement);
    expect(agreementContext(p, s).stageIndex).toBe(1);
    expect(agreementTypedData(p, agreement).domain.name).toBe('MilestoneEscrowV1');
    for (const patch of [
      { stageIndex: 0 },
      { remaining: '40', buyerAmount: '20' },
      { remaining: '101', buyerAmount: '81' },
      { seller: buyer },
    ])
      expect(() => validateAgreement(p, s, { ...agreement, ...patch })).toThrow();
    expect(() => validateAgreement(p, { ...s, state: 'RESOLVED' }, agreement)).toThrow();
  });
  it('uses whole-plan allowance for funding and never restarts terminated plans', () => {
    const unfunded = { ...s, state: 'AWAITING_FUNDS', timestamp: 9000, allowance: '100' };
    expect(moduleActions(p, buyer, unfunded)).toContain('approve');
    expect(moduleActions(p, buyer, { ...unfunded, allowance: '101' })).toContain('fund');
    for (const state of ['TERMINATED', 'COMPLETED', 'RESOLVED'])
      expect(moduleActions(p, seller, { ...s, state, credit: '31' })).toEqual(['withdrawFor']);
    expect(moduleActions(p, seller, { ...s, state: 'FUNDED', paused: true })).toEqual([
      'submitDelivery',
      'refundBySeller',
    ]);
  });
});
function fake() {
  const i: ModuleIntent = {
      id: crypto.randomUUID(),
      publication: p,
      actor: buyer,
      action: 'accept',
      stageIndex: 1,
      nonce: 7,
      startBlock: '90',
      expiresAt: 20600,
    },
    call = moduleCall(i);
  const log = {
    address: M,
    topics: encodeEventTopics({
      abi: moduleAbi('milestones'),
      eventName: 'ActionExecuted',
      args: { boxId: p.chainBoxId, actor: buyer },
    }),
    data: encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }],
      [keccak256(stringToHex('accept')), 1n],
    ),
  };
  const offer = {
    creator: buyer,
    termsHash: p.termsHash,
    terms: { metadataHash: p.metadataHash },
    state: 2,
    currentStage: 2n,
    released: 71n,
    submitDue: 24000n,
    reviewDue: 0n,
    disputeDue: 0n,
    settledAt: 0n,
    evidenceHash: H,
    reasonHash: H,
  };
  const c = {
    getChainId: vi.fn(async () => 10143),
    getCode: vi.fn(async () => definitions.milestones.artifact.runtime),
    getTransaction: vi.fn(async () => ({
      from: buyer,
      to: M,
      input: call.data,
      value: 0n,
      nonce: 7,
      type: 'eip1559',
      blockHash: H,
      hash: H,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      status: 'success',
      blockNumber: 100n,
      blockHash: H,
      logs: [log],
    })),
    getBlock: vi.fn(async () => ({ number: 100n, hash: H, timestamp: 20000n })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'asset') return TOKEN;
      if (functionName === 'intakeAdmin') return buyer;
      if (functionName === 'domainNameHash') return keccak256(stringToHex('MilestoneEscrowV1'));
      if (functionName === 'getOffer') return offer;
      if (functionName === 'intakePaused') return false;
      return 0n;
    }),
  };
  return { i, log, offer, c: c as unknown as ChainClient };
}
it('recovers a prior stage release after the contract advanced, checking the original stage event', async () => {
  const f = fake();
  expect((await confirmModuleAction(f.c, f.i, H)).state).toBe('finalized');
  expect((await confirmModuleAction(f.c, { ...f.i, stageIndex: 0 }, H)).state).toBe('replaced');
  f.log.data = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }],
    [keccak256(stringToHex('accept')), 0n],
  );
  await expect(confirmModuleAction(f.c, f.i, H)).rejects.toThrow('TRANSACTION_MISMATCH');
});
it('fails closed when the stage readback conflicts with the released amount', async () => {
  const f = fake();
  f.offer.released = 31n;
  await expect(confirmModuleAction(f.c, f.i, H)).rejects.toThrow('INTEGRITY_ERROR');
});
