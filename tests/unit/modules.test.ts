import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, stringToHex } from 'viem';
import type { Address, Hex } from 'viem';
import {
  moduleDataSchema,
  moduleDeploymentSchema,
  moduleIntentSchema,
} from '../../src/shared/modules/model';
import type { ModuleIntent, ModulePublication } from '../../src/shared/modules/model';
import {
  allocateSplit,
  definitions,
  metadataFor,
  moduleAbi,
  moduleCall,
  moduleId,
  termsHashFor,
  validatePublication,
} from '../../src/shared/modules/terms';
import { confirmModuleAction, verifyModule } from '../../src/shared/modules/chain';
import { readRecords, saveRecord } from '../../src/app/modules/journal';
import { TOKEN } from '../../src/shared/lab/network';
import type { ChainClient } from '../../src/shared/lab/network';
const A = '0x1111111111111111111111111111111111111111' as Address,
  B = '0x2222222222222222222222222222222222222222' as Address,
  M = '0x3333333333333333333333333333333333333333' as Address;
const H = ('0x' + 'ab'.repeat(32)) as Hex,
  BH = ('0x' + 'cd'.repeat(32)) as Hex,
  SALT = ('0x' + 'ee'.repeat(32)) as Hex;
const data = moduleDataSchema.parse({
  tool: 'split',
  title: 'Split test',
  description: 'Public',
  recipients: [
    { address: A, bps: 7000 },
    { address: B, bps: 3000 },
  ],
});
const deployment = moduleDeploymentSchema.parse({
  tool: 'split',
  chainId: 10143,
  version: 1,
  address: M,
  asset: TOKEN,
  intakeAdmin: A,
  runtimeHash: keccak256(definitions.split.artifact.runtime),
});
function publication(): ModulePublication {
  const partial = { deployment, data, creator: A, salt: SALT };
  const metadata = metadataFor(data);
  return {
    ...partial,
    id: crypto.randomUUID(),
    publicId: crypto.randomUUID(),
    metadata,
    metadataHash: keccak256(stringToHex(metadata)),
    termsHash: termsHashFor(partial),
    chainBoxId: moduleId(M, A, SALT),
  };
}
function intent(): ModuleIntent {
  return moduleIntentSchema.parse({
    id: crypto.randomUUID(),
    publication: publication(),
    actor: A,
    action: 'pay',
    amount: '101',
    paymentNonce: H,
    nonce: 7,
    startBlock: '90',
    expiresAt: 9999999,
  });
}
describe('immutable split rules and integer allocations', () => {
  it.each([0n, 1n, 2n, 3n, 101n, 9999n, 10n ** 30n, (1n << 256n) - 1n])(
    'conserves amount %s',
    (amount) => {
      const shares = allocateSplit(amount, [3333, 3333, 3334]);
      expect(shares.reduce((a, b) => a + b, 0n)).toBe(amount);
      for (let i = 0; i < 3; i++) {
        const ideal = amount * BigInt([3333, 3333, 3334][i]!),
          actual = shares[i]! * 10000n;
        expect(actual > ideal ? actual - ideal : ideal - actual).toBeLessThan(10000n);
      }
    },
  );
  it('handles ties by original order and a 20-recipient plan', () => {
    expect(allocateSplit(1n, [5000, 5000])).toEqual([1n, 0n]);
    expect(allocateSplit(19n, Array(20).fill(500))).toEqual([...Array(19).fill(1n), 0n]);
  });
  it.each(
    [[10000], [7000, 2000], [0, 10000], Array(21).fill(1), [5000.5, 4999.5]].map((weights) => ({
      weights,
    })),
  )('rejects invalid weights $weights', ({ weights }) =>
    expect(() => allocateSplit(1n, weights)).toThrow('INVALID_SPLIT'),
  );
  it('rejects duplicate or zero recipients and invalid totals', () => {
    for (const recipients of [
      [
        { address: A, bps: 7000 },
        { address: A, bps: 3000 },
      ],
      [
        { address: A, bps: 7000 },
        { address: B, bps: 2999 },
      ],
      [
        { address: A, bps: 10000 },
        { address: B, bps: 0 },
      ],
    ])
      expect(moduleDataSchema.safeParse({ ...data, recipients }).success).toBe(false);
  });
  it('binds metadata, domain, module version and recipient order', () => {
    const p = publication();
    expect(validatePublication(p)).toEqual(p);
    expect(() => validatePublication({ ...p, metadata: 'changed' })).toThrow();
    expect(() => validatePublication({ ...p, creator: B })).toThrow();
    expect(() =>
      validatePublication({ ...p, data: { ...data, recipients: [...data.recipients].reverse() } }),
    ).toThrow();
    expect(() => moduleDeploymentSchema.parse({ ...deployment, version: 2 })).toThrow();
  });
  it('encodes exact approval and final payment amounts, rejects unsupported actions', () => {
    const i = intent();
    expect(moduleCall(i).to).toBe(M);
    expect(moduleCall({ ...i, action: 'approve' }).to).toBe(TOKEN);
    expect(() => moduleCall({ ...i, action: 'leave' })).toThrow();
  });
});
function fake() {
  const i = intent(),
    call = moduleCall(i);
  const tx = {
    from: A,
    to: call.to,
    input: call.data,
    value: 0n,
    nonce: 7,
    type: 'eip1559',
    blockHash: BH,
    hash: H,
    authorizationList: undefined as unknown,
  };
  const log = {
    address: M,
    topics: encodeEventTopics({
      abi: moduleAbi('split'),
      eventName: 'SplitPaid',
      args: { boxId: i.publication.chainBoxId, paymentId: H, payer: A },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [101n, H]),
  };
  const receipt = { status: 'success', blockNumber: 100n, blockHash: BH, logs: [log] };
  const c = {
    getChainId: vi.fn(async () => 10143),
    getCode: vi.fn(async () => definitions.split.artifact.runtime),
    getTransaction: vi.fn(async () => tx),
    getTransactionReceipt: vi.fn(async () => receipt),
    getBlock: vi.fn(async () => ({ number: 100n, hash: BH, timestamp: 1000n })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'asset') return TOKEN;
      if (functionName === 'intakeAdmin') return A;
      if (functionName === 'getSplit')
        return {
          creator: A,
          termsHash: i.publication.termsHash,
          terms: { metadataHash: i.publication.metadataHash },
        };
      if (functionName === 'intakePaused') return false;
      return 0n;
    }),
  };
  return { i, tx, receipt, log, c, client: c as unknown as ChainClient };
}
describe('versioned module transaction verification', () => {
  it('requires the matching final-payment event and exact call', async () => {
    const f = fake();
    expect((await confirmModuleAction(f.client, f.i, H)).state).toBe('finalized');
    f.tx.input = '0x';
    expect((await confirmModuleAction(f.client, f.i, H)).state).toBe('replaced');
  });
  it.each(['eip7702', 'eip4844', 'future'])('rejects unsupported envelope %s', async (type) => {
    const f = fake();
    f.tx.type = type;
    await expect(confirmModuleAction(f.client, f.i, H)).rejects.toThrow('UNSUPPORTED_TRANSACTION');
  });
  it('rejects delegation lists, wrong actor and mismatched nonce', async () => {
    const f = fake();
    f.tx.authorizationList = [];
    await expect(confirmModuleAction(f.client, f.i, H)).rejects.toThrow('UNSUPPORTED_TRANSACTION');
    f.tx.authorizationList = undefined;
    f.tx.from = B;
    await expect(confirmModuleAction(f.client, f.i, H)).rejects.toThrow('TRANSACTION_MISMATCH');
    f.tx.from = A;
    f.tx.nonce = 8;
    await expect(confirmModuleAction(f.client, f.i, H)).rejects.toThrow('TRANSACTION_MISMATCH');
  });
  it('does not mistake success without a matching event for payment', async () => {
    const f = fake();
    f.receipt.logs = [];
    await expect(confirmModuleAction(f.client, f.i, H)).rejects.toThrow('TRANSACTION_MISMATCH');
  });
  it('keeps non-final or orphaned receipts unknown and reverts explicit', async () => {
    const f = fake();
    f.tx.blockHash = H;
    expect((await confirmModuleAction(f.client, f.i, H)).state).toBe('unknown');
    f.tx.blockHash = BH;
    f.receipt.status = 'reverted';
    expect((await confirmModuleAction(f.client, f.i, H)).state).toBe('reverted');
    f.c.getTransactionReceipt.mockRejectedValue(Error());
    expect((await confirmModuleAction(f.client, f.i, H)).state).toBe('unknown');
  });
  it('checks pinned runtime hash, immutable admin and original terms', async () => {
    const f = fake();
    await expect(verifyModule(f.client, { ...deployment, runtimeHash: H })).rejects.toThrow(
      'UNVERIFIED_CONTRACT',
    );
    f.c.readContract.mockImplementation(async ({ functionName }) =>
      functionName === 'asset' ? TOKEN : B,
    );
    await expect(verifyModule(f.client, deployment)).rejects.toThrow('UNVERIFIED_CONTRACT');
  });
  it('checks token approvals without treating them as payments', async () => {
    const f = fake(),
      i = { ...f.i, action: 'approve' as const };
    const call = moduleCall(i);
    f.tx.to = call.to;
    f.tx.input = call.data;
    f.receipt.logs = [
      {
        address: TOKEN,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: 'Approval',
          args: { owner: A, spender: M },
        }),
        data: encodeAbiParameters([{ type: 'uint256' }], [101n]),
      },
    ];
    expect((await confirmModuleAction(f.client, i, H)).state).toBe('finalized');
    await expect(confirmModuleAction(f.client, f.i, H)).resolves.toHaveProperty(
      'state',
      'replaced',
    );
  });
});
describe('module recovery journal', () => {
  const storage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  };
  it('never erases evidence with unknown results or changes an original intent', () => {
    const s = storage(),
      i = intent();
    saveRecord(s, 'key', { intent: i, state: 'broadcast', hash: H });
    saveRecord(s, 'key', { intent: i, state: 'unknown', hash: BH });
    expect(readRecords(s, 'key')[0]?.hash).toBe(H);
    saveRecord(s, 'key', { intent: i, state: 'finalized', hash: H, block: '100', blockHash: BH });
    saveRecord(s, 'key', { intent: i, state: 'unknown', hash: H });
    expect(readRecords(s, 'key')[0]?.state).toBe('finalized');
    expect(() =>
      saveRecord(s, 'key', { intent: { ...i, amount: '102' }, state: 'unknown' }),
    ).toThrow('INTENT_CHANGED');
  });
  it('preserves damaged storage and rejects malformed values', () => {
    const s = storage();
    s.setItem('key', 'damaged');
    expect(() => saveRecord(s, 'key', { intent: intent(), state: 'signing' })).toThrow(
      'JOURNAL_UNAVAILABLE',
    );
    expect(s.getItem('key')).toBe('damaged');
    expect(() => moduleIntentSchema.parse({ ...intent(), amount: 'not-a-number' })).toThrow();
  });
});
