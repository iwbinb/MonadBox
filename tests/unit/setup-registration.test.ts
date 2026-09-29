import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseError } from 'viem';
import { checkSetup, setupKinds } from '../../src/app/shared/deployment';
import type { SetupRow } from '../../src/app/shared/deployment';
import { verifySetupRegistration } from '../../src/app/shared/setup-registration';

vi.mock('../../src/app/shared/deployment', async (original) => ({
  ...(await original<typeof import('../../src/app/shared/deployment')>()),
  checkSetup: vi.fn(),
}));
const rows: SetupRow[] = setupKinds.map((kind, nonce) => ({
  intent: {
    id: crypto.randomUUID(),
    kind,
    chainId: 10143,
    actor: '0x1111111111111111111111111111111111111111',
    nonce,
    startBlock: '1',
    expiresAt: 1,
    gas: '1',
    estimatedFee: '1',
    dataHash: `0x${'ab'.repeat(32)}`,
  },
  state: 'finalized',
  hash: `0x${'cd'.repeat(32)}`,
  address: `0x${(nonce + 1).toString().repeat(40)}`,
  runtimeHash: `0x${'ef'.repeat(32)}`,
}));
beforeEach(() => {
  vi.mocked(checkSetup)
    .mockReset()
    .mockImplementation(async (row) => row);
});
afterEach(() => vi.useRealTimers());
describe('verified setup export', () => {
  it('checks only the newest finalized row per kind and reports progress in order', async () => {
    const latest = { ...rows[0]!, address: '0x9999999999999999999999999999999999999999' as const };
    const progress = vi.fn();
    const result = await verifySetupRegistration(
      [...rows, latest],
      new AbortController().signal,
      progress,
    );
    expect(result.GROUP_DEPLOYMENT!.address).toBe(latest.address);
    expect(result.MODULE_DEPLOYMENTS).toHaveLength(6);
    expect(vi.mocked(checkSetup).mock.calls.map(([row]) => row.intent.kind)).toEqual(setupKinds);
    expect(progress.mock.calls.map(([p]) => p.completed)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7,
    ]);
  });
  it('names the failed contract and RPC reason, and stops before later contracts', async () => {
    vi.mocked(checkSetup)
      .mockResolvedValueOnce(rows[0]!)
      .mockRejectedValueOnce(
        new BaseError('HTTP request failed.', { details: '429 Too many requests' }),
      );
    await expect(
      verifySetupRegistration(rows, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('Split: RPC rate limit');
    expect(checkSetup).toHaveBeenCalledTimes(2);
    expect(rows.every((row) => row.state === 'finalized')).toBe(true);
  });
  it('does not export a deployment whose receipt is no longer final', async () => {
    vi.mocked(checkSetup).mockResolvedValueOnce({ ...rows[0]!, state: 'broadcast' });
    await expect(
      verifySetupRegistration(rows, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('Group V1: Deployment is broadcast');
    expect(checkSetup).toHaveBeenCalledOnce();
  });
  it('requires all seven kinds before issuing any RPC request', async () => {
    await expect(
      verifySetupRegistration(rows.slice(1), new AbortController().signal, vi.fn()),
    ).rejects.toThrow('seven');
    expect(checkSetup).not.toHaveBeenCalled();
  });
  it('times out stalled verification and ignores a late response', async () => {
    vi.useFakeTimers();
    let release!: (row: SetupRow) => void;
    vi.mocked(checkSetup).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const progress = vi.fn();
    const result = expect(
      verifySetupRegistration(rows, new AbortController().signal, progress),
    ).rejects.toThrow('Group V1: RPC verification timed out');
    await vi.advanceTimersByTimeAsync(45000);
    await result;
    release(rows[0]!);
    await Promise.resolve();
    expect(checkSetup).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops on account change without exporting an old wallet result', async () => {
    const controller = new AbortController();
    let release!: (row: SetupRow) => void;
    vi.mocked(checkSetup).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const progress = vi.fn();
    const result = expect(
      verifySetupRegistration(rows, controller.signal, progress),
    ).rejects.toThrow('aborted');
    controller.abort();
    await result;
    release(rows[0]!);
    await Promise.resolve();
    expect(checkSetup).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledOnce();
  });
});
