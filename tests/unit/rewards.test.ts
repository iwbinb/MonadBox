import { describe, it, expect } from 'vitest';
import { decodeFunctionData, formatUnits, keccak256, stringToHex, toHex } from 'viem';
import { rewardsSchema, MAX_UINT256 } from '../../src/shared/modules/model';
import type { ModulePublication, ModuleIntent } from '../../src/shared/modules/model';
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
import { moduleActions } from '../../src/shared/modules/chain';
import type { ModuleSnapshot } from '../../src/shared/modules/chain';
import { parseRewardList } from '../../src/shared/modules/rewards';
import { TOKEN } from '../../src/shared/network';
const a = '0x1111111111111111111111111111111111111111',
  b = '0x2222222222222222222222222222222222222222',
  m = '0x3333333333333333333333333333333333333333',
  H = toHex(7, { size: 32 });
const data = rewardsSchema.parse({
  tool: 'rewards',
  title: 'Rewards',
  description: 'Public',
  recipients: [
    { address: a, amount: '31' },
    { address: b, amount: '70' },
  ],
  claimStart: 1000,
  claimDeadline: 2000,
});
const partial = {
  data,
  creator: a,
  salt: H,
  deployment: {
    tool: 'rewards' as const,
    chainId: 10143 as const,
    version: 1,
    address: m,
    asset: TOKEN,
    intakeAdmin: a,
    runtimeHash: keccak256(definitions.rewards.artifact.runtime),
  },
};
const p: ModulePublication = {
  ...partial,
  id: crypto.randomUUID(),
  publicId: crypto.randomUUID(),
  chainBoxId: moduleId(m, a, H),
  termsHash: termsHashFor(partial),
  metadata: metadataFor(data),
  metadataHash: keccak256(stringToHex(metadataFor(data))),
};
const i: ModuleIntent = {
  id: crypto.randomUUID(),
  publication: p,
  actor: a,
  action: 'create',
  nonce: 7,
  startBlock: '90',
  expiresAt: 1600,
};
const s: ModuleSnapshot = {
  state: 'CLAIM_OPEN',
  storedState: 1,
  position: 1,
  activeCount: 0,
  locked: '101',
  credit: '0',
  withdrawn: '0',
  allowance: '101',
  balance: '1000',
  paused: false,
  block: '100',
  blockHash: H,
  timestamp: 1000,
  allocation: '31',
  claimedCount: 0,
  claimedAmount: '0',
  reclaimed: false,
};
describe('Rewards exact list and claim boundaries', () => {
  it('parses CSV or tab header and sorts wallets without detaching amounts', () => {
    expect(
      parseRewardList(`address,amount\n${b},0.000000000000000070\n${a},0.000000000000000031`),
    ).toEqual(data.recipients);
    expect(parseRewardList(`address\tamount_mon\r\n${a}\t0.000000000000000031`)).toEqual(
      data.recipients.slice(0, 1),
    );
  });
  it('rejects duplicate wallets, extra private columns, oversized and invalid amounts', () => {
    for (const text of [
      '',
      `${a},1\n${a},2`,
      `${a},1,name`,
      `${a},0`,
      `${a},1e6`,
      `${a},0.0000000000000000001`,
      'x'.repeat(20001),
      Array(101).fill(`${a},1`).join('\n'),
    ])
      expect(() => parseRewardList(text)).toThrow();
    const mixed = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    expect(() =>
      parseRewardList(`${mixed},1\n${mixed.toUpperCase().replace('0X', '0x')},2`),
    ).toThrow();
  });
  it('supports 100 wallets and the full integer range but rejects aggregate overflow', () => {
    expect(
      parseRewardList(
        Array.from(
          { length: 100 },
          (_, n) => `${toHex(n + 1, { size: 20 })},0.000000000000000001`,
        ).join('\n'),
      ),
    ).toHaveLength(100);
    expect(parseRewardList(`${a},${formatUnits(MAX_UINT256, 18)}`)[0]!.amount).toBe(
      MAX_UINT256.toString(),
    );
    expect(() =>
      parseRewardList(`${a},${formatUnits(MAX_UINT256, 18)}\n${b},0.000000000000000001`),
    ).toThrow();
  });
  it('validates sorted unique fixed rules and strictly ordered windows', () => {
    for (const patch of [
      { recipients: [] },
      { recipients: [...data.recipients].reverse() },
      { recipients: [data.recipients[0], data.recipients[0]] },
      { recipients: [{ address: a, amount: '0' }] },
      { claimDeadline: 1000 },
    ])
      expect(rewardsSchema.safeParse({ ...data, ...patch }).success).toBe(false);
    for (const patch of [
      { claimStart: 999 },
      { recipients: [{ address: a, amount: '32' }, data.recipients[1]!] },
    ])
      expect(() => validatePublication({ ...p, data: { ...data, ...patch } })).toThrow();
    expect(approvalAmount(i)).toBe('101');
  });
  it('binds atomic creation and routes claims only to their selected original recipient', () => {
    expect(
      decodeFunctionData({ abi: moduleAbi('rewards'), data: moduleCall(i).data }).functionName,
    ).toBe('createAndFundBatch');
    expect(
      decodeFunctionData({
        abi: moduleAbi('rewards'),
        data: moduleCall({ ...i, action: 'claimFor', actor: b }).data,
      }).args,
    ).toEqual([p.chainBoxId, b]);
  });
  it('keeps claims available during intake pause, with no overlapping expiry or repeated claim', () => {
    expect(moduleActions(p, b, { ...s, timestamp: 999 })).toEqual([]);
    expect(moduleActions(p, b, { ...s, paused: true })).toEqual(['claimFor']);
    expect(moduleActions(p, b, { ...s, timestamp: 2000 })).toEqual([]);
    expect(moduleActions(p, a, { ...s, timestamp: 2000 })).toEqual(['reclaimExpired']);
    expect(
      moduleActions(p, b, { ...s, position: 2, credit: '70', reclaimed: true, timestamp: 2000 }),
    ).toEqual(['withdrawFor']);
    expect(moduleActions(p, a, { ...s, locked: '0', reclaimed: true, timestamp: 2000 })).toEqual(
      [],
    );
  });
});
