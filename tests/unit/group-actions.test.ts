import { describe, it, expect, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, toHex } from 'viem';
import type { Abi, Address } from 'viem';
import { groupArtifact } from '../../src/shared/group/generated/group';
import { groupTerms, groupTermsHash, groupId } from '../../src/shared/group/terms';
import { TOKEN } from '../../src/shared/lab/network';
import type { ChainClient } from '../../src/shared/lab/network';
import type { PublishIntent } from '../../src/shared/cloud/model';
import { groupAbi } from '../../src/shared/cloud/chain';
import {
  actionCall,
  availableActions,
  confirmAction,
  groupActions,
  groupAccount,
  prepareAction,
} from '../../src/shared/group/actions';
import type { GroupAction, GroupActionIntent, GroupAccount } from '../../src/shared/group/actions';
import { readActions, saveAction } from '../../src/app/group/action-journal';
const A: Address = '0x0000000000000000000000000000000000000011';
const M: Address = '0x0000000000000000000000000000000000000022';
const H = toHex(3, { size: 32 }),
  B = toHex(4, { size: 32 }),
  SALT = toHex(5, { size: 32 });
const data = {
  title: 'Local action fixture',
  description: 'Not a real payment',
  unitPrice: '100000',
  minimum: 2,
  capacity: 3,
  beneficiary: A,
  startsAt: 1000,
  fundingDeadline: 2000,
  settleNotBefore: 3000,
};
const group: PublishIntent = {
  id: crypto.randomUUID(),
  boxId: crypto.randomUUID(),
  publicId: crypto.randomUUID(),
  deployment: {
    chainId: 10143,
    version: 1,
    address: M,
    asset: TOKEN,
    intakeAdmin: A,
    runtimeHash: keccak256(groupArtifact.runtime),
  },
  creator: A,
  salt: SALT,
  chainBoxId: groupId(M, A, SALT),
  termsHash: groupTermsHash(M, A, SALT, data),
  metadataHash: groupTerms(data).metadataHash,
  data,
  nonce: 1,
  startBlock: '1',
  expiresAt: 9999999,
};
function intent(action: GroupAction): GroupActionIntent {
  return {
    id: crypto.randomUUID(),
    group,
    action,
    actor: A,
    nonce: 7,
    startBlock: '98',
    expiresAt: 9000,
  };
}
function event(action: GroupAction) {
  const id = group.chainBoxId;
  const def: Record<
    GroupAction,
    { name: string; args: Record<string, unknown>; types: string[]; values: unknown[] }
  > = {
    approve: {
      name: 'Approval',
      args: { owner: A, spender: M },
      types: ['uint256'],
      values: [100000n],
    },
    contribute: {
      name: 'Funded',
      args: { boxId: id, participant: A },
      types: ['uint256'],
      values: [100000n],
    },
    leave: { name: 'ParticipantLeft', args: { boxId: id, participant: A }, types: [], values: [] },
    finalize: {
      name: 'GroupFinalized',
      args: { boxId: id },
      types: ['uint8', 'uint32'],
      values: [2, 2],
    },
    cancel: { name: 'GroupCancelled', args: { boxId: id }, types: [], values: [] },
    creditRefund: {
      name: 'CreditAssigned',
      args: { boxId: id, beneficiary: A },
      types: ['uint256', 'uint8'],
      values: [100000n, 1],
    },
    settle: { name: 'GroupSettled', args: { boxId: id }, types: ['uint256'], values: [200000n] },
    withdrawFor: {
      name: 'Withdrawal',
      args: { boxId: id, beneficiary: A },
      types: ['uint256'],
      values: [100000n],
    },
  };
  const d = def[action];
  return {
    address: action === 'approve' ? TOKEN : M,
    topics: encodeEventTopics({
      abi: (action === 'approve' ? erc20Abi : groupAbi) as Abi,
      eventName: d.name,
      args: d.args,
    }),
    data: encodeAbiParameters(
      d.types.map((type) => ({ type })),
      d.values,
    ),
  };
}
function fake(action: GroupAction = 'contribute') {
  const i = intent(action),
    call = actionCall(i);
  const tx = {
    hash: H,
    from: A,
    nonce: 7,
    to: call.to,
    input: call.data,
    value: 0n,
    blockHash: B,
    type: 'eip1559' as string | undefined,
    authorizationList: undefined as unknown[] | undefined,
  };
  const receipt = { status: 'success', blockNumber: 99n, blockHash: B, logs: [event(action)] };
  const block = { number: 100n, hash: B, timestamp: 1500n, transactions: [tx] };
  const fields: Record<string, unknown> = {
    asset: TOKEN,
    intakeAdmin: A,
    intakePaused: false,
    getGroup: {
      creator: A,
      terms: groupTerms(data),
      termsHash: group.termsHash,
      state: 1,
      activeCount: 0,
      locked: 0n,
    },
    positions: 0,
    creditForBox: 0n,
    withdrawnForBox: 0n,
    allowance: 100000n,
    balanceOf: 1000000n,
    decimals: 6,
    symbol: 'AUSD',
  };
  const c = {
    getChainId: vi.fn(async () => 10143),
    getCode: vi.fn(async ({ address }: { address: Address }) =>
      address === M ? groupArtifact.runtime : address === TOKEN ? '0x01' : '0x',
    ),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => fields[functionName]),
    getBlock: vi.fn(async () => block),
    getBlockNumber: vi.fn(async () => 100n),
    getTransaction: vi.fn(async () => tx),
    getTransactionReceipt: vi.fn(async () => receipt),
    getTransactionCount: vi.fn(async (args?: { blockNumber?: bigint }) =>
      args?.blockNumber !== undefined && args.blockNumber >= 99n ? 8 : 7,
    ),
    estimateGas: vi.fn(async () => 100000n),
  };
  return { i, c, client: c as unknown as ChainClient, tx, receipt, block, fields };
}
describe('Group funds evidence', () => {
  it.each(groupActions)(
    '%s requires its own exact finalized transaction and event',
    async (action) => {
      const f = fake(action);
      expect((await confirmAction(f.client, f.i, H)).state).toBe('finalized');
    },
  );
  it.each(groupActions)('%s receipt success without matching event is rejected', async (action) => {
    const f = fake(action);
    f.receipt.logs = [];
    await expect(confirmAction(f.client, f.i, H)).rejects.toThrow('TRANSACTION_MISMATCH');
  });
  it.each(['eip7702', 'eip4844', 'future', undefined])(
    'rejects unsupported transaction %s',
    async (type) => {
      const f = fake();
      f.tx.type = type;
      await expect(confirmAction(f.client, f.i, H)).rejects.toThrow('UNSUPPORTED_TRANSACTION');
    },
  );
  it('rejects authorization lists on an otherwise supported transaction', async () => {
    const f = fake();
    f.tx.authorizationList = [];
    await expect(confirmAction(f.client, f.i, H)).rejects.toThrow('UNSUPPORTED_TRANSACTION');
  });
  it('preserves unknown when RPC cannot find the receipt', async () => {
    const f = fake();
    f.c.getTransactionReceipt.mockRejectedValue(Error('offline'));
    expect((await confirmAction(f.client, f.i, H)).state).toBe('unknown');
  });
  it('does not report orphaned or not finalized transactions as paid', async () => {
    const f = fake();
    f.receipt.blockHash = H;
    expect((await confirmAction(f.client, f.i, H)).state).toBe('unknown');
    f.receipt.blockHash = B;
    f.block.number = 98n;
    expect((await confirmAction(f.client, f.i, H)).state).toBe('unknown');
  });
  it('marks finalized revert separately from replacement', async () => {
    const f = fake();
    f.receipt.status = 'reverted';
    expect((await confirmAction(f.client, f.i, H)).state).toBe('reverted');
    f.receipt.status = 'success';
    f.tx.input = '0x';
    expect((await confirmAction(f.client, f.i, H)).state).toBe('replaced');
  });
  it('rejects another actor or nonce', async () => {
    const f = fake();
    f.tx.from = M;
    await expect(confirmAction(f.client, f.i, H)).rejects.toThrow();
    f.tx.from = A;
    f.tx.nonce = 8;
    await expect(confirmAction(f.client, f.i, H)).rejects.toThrow();
  });
  it('checks event emitter and beneficiary, not just an event topic', async () => {
    const f = fake('withdrawFor');
    f.receipt.logs[0]!.address = TOKEN;
    await expect(confirmAction(f.client, f.i, H)).rejects.toThrow();
  });
  it('recovers by original nonce with bounded historical reads', async () => {
    const f = fake();
    expect((await confirmAction(f.client, f.i)).hash).toBe(H);
    f.block.transactions = [];
    f.c.getBlockNumber.mockResolvedValue(1000n);
    f.c.getBlock.mockClear();
    expect((await confirmAction(f.client, f.i)).state).toBe('unknown');
    expect(f.c.getBlock).toHaveBeenCalledTimes(1);
    expect(f.c.getTransactionCount.mock.calls.length).toBeLessThan(30);
  });
  it('a changed rules snapshot cannot authorize an action', () => {
    const f = fake();
    f.i.group = { ...group, data: { ...data, unitPrice: '200000' } };
    expect(() => actionCall(f.i)).toThrow('INTEGRITY_ERROR');
  });
  it('prepares only currently available actions after token/EOA/state/simulation checks', async () => {
    const f = fake();
    expect((await prepareAction(f.client, group, A, 'contribute')).nonce).toBe(7);
    await expect(prepareAction(f.client, group, A, 'leave')).rejects.toThrow('ACTION_UNAVAILABLE');
    f.c.getCode.mockResolvedValue(groupArtifact.runtime);
    await expect(prepareAction(f.client, group, A, 'contribute')).rejects.toThrow(
      'UNSUPPORTED_WALLET',
    );
  });
  it('rejects snapshot reorg after account reads', async () => {
    const f = fake();
    f.c.getBlock
      .mockResolvedValueOnce(f.block)
      .mockResolvedValueOnce(f.block)
      .mockResolvedValueOnce({ ...f.block, hash: H });
    await expect(groupAccount(f.client, group, A)).rejects.toThrow('FINALITY_UNAVAILABLE');
  });
});
describe('Group legal actions and time boundaries', () => {
  const base: GroupAccount = {
    snapshot: {
      state: 'OPEN',
      activeCount: 0,
      locked: '0',
      blockNumber: '100',
      blockHash: B,
      timestamp: 1500,
    },
    position: 0,
    credit: '0',
    withdrawn: '0',
    allowance: '0',
    balance: '1000000',
    paused: false,
    storedState: 1,
  };
  it('approval and contribution are separate and an address cannot rejoin', () => {
    expect(availableActions(group, M, base)).toEqual(['approve']);
    expect(availableActions(group, M, { ...base, allowance: '100000' })).toEqual(['contribute']);
    expect(availableActions(group, M, { ...base, position: 2 })).toEqual([]);
  });
  it('target met before deadline still permits exit, and pause preserves exits/credit', () => {
    const s = {
      ...base,
      position: 1,
      paused: true,
      credit: '100000',
      snapshot: { ...base.snapshot, activeCount: 2 },
    };
    expect(availableActions(group, M, s)).toEqual(['leave', 'withdrawFor']);
  });
  it('at deadline a participant cannot leave and a failed group grants refund credit', () => {
    const s = {
      ...base,
      position: 1,
      snapshot: { ...base.snapshot, state: 'REFUNDABLE' as const, timestamp: 2000 },
    };
    expect(availableActions(group, M, s)).toEqual(['finalize', 'creditRefund']);
  });
  it('only creator can cancel and settlement waits for the agreed time', () => {
    const s = { ...base, snapshot: { ...base.snapshot, state: 'READY' as const, timestamp: 2500 } };
    expect(availableActions(group, M, s)).toEqual(['finalize']);
    expect(availableActions(group, A, s)).toContain('cancel');
    expect(
      availableActions(group, M, { ...s, snapshot: { ...s.snapshot, timestamp: 3000 } }),
    ).toContain('settle');
  });
  it('already refunded positions cannot be refunded twice', () => {
    expect(
      availableActions(group, M, {
        ...base,
        position: 3,
        storedState: 4,
        snapshot: { ...base.snapshot, state: 'CANCELLED' },
      }),
    ).toEqual([]);
  });
});
describe('browser recovery evidence', () => {
  function storage() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    };
  }
  it('unknown never erases an existing hash or evidence, even for the same hash', () => {
    const s = storage(),
      i = intent('contribute');
    saveAction(s, 'x', { intent: i, state: 'broadcast', hash: H });
    saveAction(s, 'x', { intent: i, state: 'unknown', hash: B });
    expect(readActions(s, 'x')[0]!.hash).toBe(H);
    saveAction(s, 'x', { intent: i, state: 'finalized', hash: H, block: '99', blockHash: B });
    saveAction(s, 'x', { intent: i, state: 'unknown', hash: H });
    expect(readActions(s, 'x')[0]!.state).toBe('finalized');
    expect(readActions(s, 'x')[0]!.block).toBe('99');
  });
  it('does not overwrite corrupt records or permit changed intents', () => {
    const s = storage();
    s.setItem('x', 'broken');
    expect(() => saveAction(s, 'x', { intent: intent('leave'), state: 'signing' })).toThrow(
      'JOURNAL_UNAVAILABLE',
    );
    expect(s.getItem('x')).toBe('broken');
    const i = intent('leave');
    saveAction(s, 'ok', { intent: i, state: 'signing' });
    expect(() =>
      saveAction(s, 'ok', { intent: { ...i, action: 'cancel' }, state: 'unknown' }),
    ).toThrow('INTEGRITY_ERROR');
  });
  it('rejected signatures do not count as a finalized funds action', () => {
    const s = storage();
    saveAction(s, 'x', { intent: intent('contribute'), state: 'rejected' });
    expect(readActions(s, 'x')[0]!.hash).toBeUndefined();
  });
});
