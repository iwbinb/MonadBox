import { describe, it, expect, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, keccak256, stringToHex, toHex } from 'viem';
import type { Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  agreementHash,
  agreementTypedData,
  validateAgreement,
} from '../../src/shared/modules/agreement';
import {
  definitions,
  metadataFor,
  moduleId,
  termsHashFor,
  moduleCall,
  moduleAbi,
} from '../../src/shared/modules/terms';
import { moduleActions, confirmModuleAction, verifyModule } from '../../src/shared/modules/chain';
import type { ModuleSnapshot } from '../../src/shared/modules/chain';
import { deliverySchema, moduleIntentSchema } from '../../src/shared/modules/model';
import type { Agreement, ModuleIntent, ModulePublication } from '../../src/shared/modules/model';
import { TOKEN } from '../../src/shared/lab/network';
import type { ChainClient } from '../../src/shared/lab/network';
const a = privateKeyToAccount(toHex(101, { size: 32 })),
  b = privateKeyToAccount(toHex(102, { size: 32 })),
  M = '0x3333333333333333333333333333333333333333' as Address,
  H = toHex(100, { size: 32 });
const data = deliverySchema.parse({
  tool: 'deliver',
  title: 'Delivery',
  description: 'Public',
  buyer: a.address,
  seller: b.address,
  amount: '101',
  fundBy: 10000,
  workDuration: 3600,
  reviewDuration: 3600,
  disputeDuration: 86400,
});
const partial = {
  data,
  creator: a.address,
  salt: H,
  deployment: {
    tool: 'deliver' as const,
    chainId: 10143 as const,
    version: 1,
    address: M,
    asset: TOKEN,
    intakeAdmin: a.address,
    runtimeHash: keccak256(definitions.deliver.artifact.runtime),
  },
};
const p: ModulePublication = {
  ...partial,
  id: crypto.randomUUID(),
  publicId: crypto.randomUUID(),
  chainBoxId: moduleId(M, a.address, H),
  termsHash: termsHashFor(partial),
  metadata: metadataFor(data),
  metadataHash: keccak256(stringToHex(metadataFor(data))),
};
const snapshot: ModuleSnapshot = {
  state: 'DISPUTED',
  storedState: 4,
  activeCount: 0,
  position: 0,
  locked: '101',
  credit: '0',
  withdrawn: '0',
  allowance: '0',
  balance: '101',
  paused: false,
  block: '100',
  blockHash: H,
  timestamp: 1000,
  submitDue: 1500,
  reviewDue: 2000,
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
  remaining: '101',
  buyer: a.address,
  seller: b.address,
  buyerAmount: '31',
  sellerAmount: '70',
  settlementNonce: '0',
  deadline: 5000,
  stageIndex: 0,
};
function intent(): ModuleIntent {
  return {
    id: crypto.randomUUID(),
    publication: p,
    actor: a.address,
    action: 'resolveByAgreement',
    agreement,
    nonce: 7,
    startBlock: '90',
    expiresAt: 1600,
  };
}
describe('Deliver permissions and typed settlement', () => {
  it('binds every identity, amount, nonce, stage and deadline to the disputed order', () => {
    expect(validateAgreement(p, snapshot, agreement)).toEqual(agreement);
    for (const change of [
      { boxId: H },
      { orderId: H },
      { termsHash: H },
      { asset: M },
      { remaining: '102', buyerAmount: '32' },
      { buyer: b.address },
      { seller: a.address },
      { settlementNonce: '1' },
      { stageIndex: 1 },
      { deadline: 1000 },
      { deadline: 100001 },
      { buyerAmount: '0' },
    ])
      expect(() => validateAgreement(p, snapshot, { ...agreement, ...change })).toThrow();
    expect(() => validateAgreement(p, { ...snapshot, state: 'SUBMITTED' }, agreement)).toThrow();
  });
  it('encodes the complete typed domain and rejects raw signatures in persisted intents', async () => {
    const typed = agreementTypedData(p, agreement),
      first = await a.signTypedData(typed),
      second = await b.signTypedData(typed),
      i = intent();
    expect(typed.domain).toEqual({
      name: 'DeliveryEscrowV1',
      version: '1',
      chainId: 10143,
      verifyingContract: M,
    });
    expect(agreementHash(p, agreement)).not.toBe(
      agreementHash(p, { ...agreement, deadline: 5001 }),
    );
    expect(moduleCall(i, { first, second }).data).toMatch(/^0x/);
    expect(() => moduleCall(i)).toThrow('SIGNATURES_REQUIRED');
    expect(moduleIntentSchema.safeParse({ ...i, signatures: { first, second } }).success).toBe(
      false,
    );
  });
  it('offers role-correct funding, exits and exact time boundaries even during intake pause', () => {
    const s = { ...snapshot, state: 'AWAITING_FUNDS', storedState: 1 };
    expect(moduleActions(p, a.address, s)).toEqual(['approve', 'cancelOffer']);
    expect(moduleActions(p, b.address, s)).toEqual(['cancelOffer']);
    expect(moduleActions(p, a.address, { ...s, allowance: '101' })).toContain('fund');
    expect(moduleActions(p, a.address, { ...s, timestamp: data.fundBy })).toEqual(['cancelOffer']);
    expect(moduleActions(p, b.address, { ...snapshot, state: 'FUNDED', paused: true })).toEqual([
      'submitDelivery',
      'refundBySeller',
    ]);
    expect(moduleActions(p, b.address, { ...snapshot, state: 'FUNDED', timestamp: 1500 })).toEqual([
      'refundAfterMissingDelivery',
      'refundBySeller',
    ]);
    expect(
      moduleActions(p, a.address, { ...snapshot, state: 'SUBMITTED', timestamp: 1999 }),
    ).toEqual(['accept', 'dispute']);
    expect(
      moduleActions(p, a.address, { ...snapshot, state: 'SUBMITTED', timestamp: 2000 }),
    ).toEqual(['accept', 'settleAfterReview']);
    expect(
      moduleActions(p, a.address, { ...snapshot, timestamp: 100000, credit: '1', paused: true }),
    ).toEqual(['withdrawFor', 'refundAfterDisputeTimeout']);
  });
  it('requires a nonzero evidence digest and exact fixed funding amount', () => {
    const i = { ...intent(), action: 'submitDelivery' as const };
    expect(() => moduleCall(i)).toThrow('EVIDENCE_REQUIRED');
    expect(() => moduleCall({ ...i, evidenceHash: toHex(0, { size: 32 }) })).toThrow();
    expect(moduleCall({ ...i, evidenceHash: H }).to).toBe(M);
    expect(
      moduleCall({ ...i, action: 'approve', amount: '999' }).data.endsWith(
        toHex(101, { size: 32 }).slice(2),
      ),
    ).toBe(true);
  });
});
async function fake() {
  const i = intent(),
    typed = agreementTypedData(p, agreement),
    first = await a.signTypedData(typed),
    second = await b.signTypedData(typed),
    call = moduleCall(i, { first, second });
  i.calldataHash = keccak256(call.data);
  const tx = {
    from: a.address,
    to: M,
    input: call.data,
    value: 0n,
    nonce: 7,
    type: 'eip1559',
    blockHash: H,
    hash: H,
    authorizationList: undefined as unknown,
  };
  const log = {
    address: M,
    topics: encodeEventTopics({
      abi: moduleAbi('deliver'),
      eventName: 'ActionExecuted',
      args: { boxId: p.chainBoxId, actor: a.address },
    }),
    data: encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }],
      [keccak256(stringToHex('resolveByAgreement')), 0n],
    ),
  };
  const receipt = { status: 'success', blockNumber: 100n, blockHash: H, logs: [log] };
  const c = {
    getChainId: vi.fn(async () => 10143),
    getCode: vi.fn(async () => definitions.deliver.artifact.runtime),
    getTransaction: vi.fn(async () => tx),
    getTransactionReceipt: vi.fn(async () => receipt),
    getBlock: vi.fn(async () => ({ number: 100n, hash: H, timestamp: 1000n })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'asset') return TOKEN;
      if (functionName === 'intakeAdmin') return a.address;
      if (functionName === 'domainNameHash') return keccak256(stringToHex('DeliveryEscrowV1'));
      if (functionName === 'getOffer')
        return {
          creator: a.address,
          termsHash: p.termsHash,
          terms: { metadataHash: p.metadataHash },
          state: 7,
          submitDue: 1500n,
          reviewDue: 2000n,
          disputeDue: 100000n,
          settledAt: 1000n,
          evidenceHash: H,
          reasonHash: H,
        };
      if (functionName === 'intakePaused') return false;
      return 0n;
    }),
  };
  return { i, first, second, tx, receipt, c, client: c as unknown as ChainClient };
}
describe('signature-free transaction recovery', () => {
  it('reconstructs witnesses from the finalized transaction without persisting signatures', async () => {
    const f = await fake();
    expect(JSON.stringify(f.i)).not.toContain(f.first);
    expect((await confirmModuleAction(f.client, f.i, H)).state).toBe('finalized');
  });
  it('rejects changed proposal, calldata and missing action event', async () => {
    const f = await fake();
    expect(
      (
        await confirmModuleAction(
          f.client,
          { ...f.i, agreement: { ...agreement, deadline: 5001 } },
          H,
        )
      ).state,
    ).toBe('replaced');
    expect(
      (await confirmModuleAction(f.client, { ...f.i, calldataHash: toHex(1, { size: 32 }) }, H))
        .state,
    ).toBe('replaced');
    f.receipt.logs = [];
    await expect(confirmModuleAction(f.client, f.i, H)).rejects.toThrow('TRANSACTION_MISMATCH');
  });
  it('checks the immutable EIP712 name instead of trusting masked immutable slots', async () => {
    const f = await fake(),
      original = f.c.readContract.getMockImplementation()!;
    f.c.readContract.mockImplementation(async (args) =>
      args.functionName === 'domainNameHash' ? toHex(0, { size: 32 }) : original(args),
    );
    await expect(verifyModule(f.client, p.deployment)).rejects.toThrow('UNVERIFIED_CONTRACT');
  });
});
