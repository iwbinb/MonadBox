import { describe, it, expect, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, keccak256, toHex } from 'viem';
import { groupArtifact } from '../../src/shared/group/generated/group';
import { groupTerms, groupTermsHash, groupId } from '../../src/shared/group/terms';
import { GROUP_ASSET } from '../../src/shared/group/draft';
import {
  calldata,
  runtimeMatches,
  verifyDeployment,
  makeCloudChain,
  groupAbi,
} from '../../src/shared/cloud/chain';
import type { PublishIntent } from '../../src/shared/cloud/model';
import type { ChainClient } from '../../src/shared/lab/network';
import { readConfig } from '../../src/shared/config';
const A = '0x0000000000000000000000000000000000000011',
  M = '0x0000000000000000000000000000000000000022';
const H = toHex(3, { size: 32 }),
  B = toHex(4, { size: 32 }),
  SALT = toHex(5, { size: 32 });
const data = {
  title: 'Unit fixture',
  description: 'Not live',
  unitPrice: '100000',
  minimum: 2,
  capacity: 3,
  beneficiary: A,
  startsAt: 1000,
  fundingDeadline: 2000,
  settleNotBefore: 3000,
};
const i: PublishIntent = {
  id: crypto.randomUUID(),
  boxId: crypto.randomUUID(),
  publicId: crypto.randomUUID(),
  deployment: {
    chainId: 10143,
    version: 1,
    address: M,
    asset: GROUP_ASSET,
    intakeAdmin: A,
    runtimeHash: keccak256(groupArtifact.runtime),
  },
  creator: A,
  salt: SALT,
  chainBoxId: groupId(M, A, SALT),
  termsHash: groupTermsHash(M, A, SALT, data),
  metadataHash: groupTerms(data).metadataHash,
  data,
  nonce: 7,
  startBlock: '98',
  expiresAt: 9999999999,
};
function fake() {
  const tx = { hash: H, from: A, nonce: 7, to: M, input: calldata(i), value: 0n, blockHash: B };
  const receipt = {
    status: 'success',
    blockNumber: 99n,
    blockHash: B,
    logs: [
      {
        address: M,
        topics: encodeEventTopics({
          abi: groupAbi,
          eventName: 'BoxCreated',
          args: { boxId: i.chainBoxId, creator: A, asset: GROUP_ASSET },
        }),
        data: encodeAbiParameters(
          [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }],
          [A, i.termsHash, i.metadataHash],
        ),
      },
    ],
  };
  const group = {
    creator: A,
    terms: groupTerms(data),
    termsHash: i.termsHash,
    state: 1,
    activeCount: 0,
    locked: 0n,
  };
  const block = { hash: B, number: 100n, timestamp: 1500n, transactions: [tx] };
  const c = {
    getChainId: vi.fn(async () => 10143),
    getCode: vi.fn(async () => groupArtifact.runtime),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === 'asset'
        ? GROUP_ASSET
        : functionName === 'intakeAdmin'
          ? A
          : functionName === 'getGroup'
            ? group
            : false,
    ),
    getBlock: vi.fn(async () => block),
    getBlockNumber: vi.fn(async () => 100n),
    getTransactionCount: vi.fn(async () => 7),
    getTransaction: vi.fn(async () => tx),
    getTransactionReceipt: vi.fn(async () => receipt),
  };
  return { c, tx, receipt, group, block, chain: makeCloudChain(c as unknown as ChainClient) };
}
describe('M1-B public publication verifier', () => {
  it('accepts only this build runtime length and non-immutable bytes', () => {
    expect(runtimeMatches(groupArtifact.runtime)).toBe(true);
    expect(runtimeMatches('0x')).toBe(false);
    expect(runtimeMatches(('0x00' + groupArtifact.runtime.slice(4)) as `0x${string}`)).toBe(false);
  });
  for (const field of ['chainBoxId', 'termsHash', 'metadataHash', 'salt'] as const)
    it(`rejects altered ${field}`, () =>
      expect(() => calldata({ ...i, [field]: toHex(500, { size: 32 }) })).toThrow());
  it('rejects metadata edits before building calldata', () =>
    expect(() => calldata({ ...i, data: { ...data, title: 'changed' } })).toThrow());
  it('does not accept ticker-equivalent arbitrary assets', () =>
    expect(() => calldata({ ...i, deployment: { ...i.deployment, asset: A } })).toThrow());
  it('rejects wrong network', async () => {
    const { c } = fake();
    c.getChainId.mockResolvedValue(143);
    await expect(verifyDeployment(c as unknown as ChainClient, i.deployment)).rejects.toThrow(
      'WRONG_CHAIN',
    );
  });
  it('rejects runtime hash substitutions', async () => {
    const { c } = fake();
    await expect(
      verifyDeployment(c as unknown as ChainClient, { ...i.deployment, runtimeHash: H }),
    ).rejects.toThrow();
  });
  it('accepts exact finalized creation with correct event and group state', async () => {
    const { chain } = fake();
    expect((await chain.confirm(i, H)).state).toBe('finalized');
  });
  it('missing receipt remains unknown', async () => {
    const f = fake();
    f.c.getTransactionReceipt.mockRejectedValue(Error('not found'));
    expect((await f.chain.confirm(i, H)).state).toBe('unknown');
  });
  it('not-finalized receipts remain unknown', async () => {
    const f = fake();
    f.block.number = 98n;
    expect((await f.chain.confirm(i, H)).state).toBe('unknown');
  });
  it('orphaned receipt remains unknown', async () => {
    const f = fake();
    f.block.hash = H;
    expect((await f.chain.confirm(i, H)).state).toBe('unknown');
  });
  it('reverted creation is not publication', async () => {
    const f = fake();
    f.receipt.status = 'reverted';
    expect((await f.chain.confirm(i, H)).state).toBe('reverted');
  });
  it('same nonce different calldata is replaced, not published', async () => {
    const f = fake();
    f.tx.input = '0x';
    expect((await f.chain.confirm(i, H)).state).toBe('replaced');
  });
  it('wrong owner or nonce cannot associate someone else transaction', async () => {
    const f = fake();
    f.tx.nonce = 8;
    await expect(f.chain.confirm(i, H)).rejects.toThrow('TRANSACTION_MISMATCH');
  });
  it('missing creation event is not enough even with receipt success', async () => {
    const f = fake();
    f.receipt.logs = [];
    await expect(f.chain.confirm(i, H)).rejects.toThrow('TRANSACTION_MISMATCH');
  });
  it('read-back terms mismatch blocks publication', async () => {
    const f = fake();
    f.group.termsHash = H;
    await expect(f.chain.confirm(i, H)).rejects.toThrow('INTEGRITY_ERROR');
  });
  it('recovers a hash from the original account and nonce without sending', async () => {
    const f = fake();
    expect((await f.chain.confirm(i)).hash).toBe(H);
    expect(f.c.getTransaction).toHaveBeenCalledOnce();
  });
  it('recovery scans at most 41 blocks and remains unknown if older', async () => {
    const f = fake();
    f.block.transactions = [];
    f.c.getBlockNumber.mockResolvedValue(1000n);
    expect((await f.chain.confirm(i)).state).toBe('unknown');
    expect(f.c.getBlock).toHaveBeenCalledTimes(41);
  });
  for (const [timestamp, count, stored, want] of [
    [900, 0, 1, 'UPCOMING'],
    [1500, 0, 1, 'OPEN'],
    [1500, 3, 1, 'FULL'],
    [2000, 1, 1, 'REFUNDABLE'],
    [2000, 2, 1, 'READY'],
    [3000, 1, 4, 'CANCELLED'],
    [3000, 2, 5, 'SETTLED'],
  ] as const)
    it(`reports ${want} from chain state rather than a browser countdown`, async () => {
      const f = fake();
      f.block.timestamp = BigInt(timestamp);
      f.group.activeCount = count;
      f.group.state = stored;
      expect((await f.chain.snapshot(i)).state).toBe(want);
    });
});
describe('M1-B configuration boundaries', () => {
  const base = {
    APP_ENV: 'production',
    CHAIN_ID: '10143',
    STORAGE_NAMESPACE: 'monadbox-production',
    STORAGE_ENABLED: 'false',
    BACKGROUND_ENABLED: 'false',
    MAINNET_ENABLED: 'false',
    NETWORK_WRITES_ENABLED: 'false',
    ASSET_ALLOWLIST: '[]',
    CONTRACT_REGISTRY: '[]',
    CLOUD_ENABLED: 'true',
    APP_ORIGIN: 'https://app.example',
  };
  it('D1-only cloud does not require legacy storage or background flags', () =>
    expect(readConfig(base).CLOUD_ENABLED).toBe(true));
  for (const origin of [
    'http://app.example',
    'https://app.example/path',
    'https://app.example/',
    'null',
  ])
    it(`rejects unsuitable origin ${origin}`, () =>
      expect(() => readConfig({ ...base, APP_ORIGIN: origin })).toThrow());
  it('requires a validated registry before enabling publication', () =>
    expect(() => readConfig({ ...base, GROUP_PUBLISH_ENABLED: 'true' })).toThrow());
  it('rejects mainnet deployment fields', () =>
    expect(() =>
      readConfig({ ...base, GROUP_DEPLOYMENT: JSON.stringify({ ...i.deployment, chainId: 143 }) }),
    ).toThrow());
});
