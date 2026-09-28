import { describe, it, expect, vi, afterEach } from 'vitest';
import { requireResolvedTransactions } from '../../src/app/shared/transaction-storage';
import { inView, readBookmarks, verifyWorkspaceBox } from '../../src/app/shared/workspace';
import type { WorkspaceBox } from '../../src/app/shared/workspace';
import { moduleSnapshot, moduleActions } from '../../src/shared/modules/chain';
vi.mock('../../src/shared/modules/chain', () => ({
  moduleSnapshot: vi.fn(),
  moduleActions: vi.fn(),
}));
const actor = '0x1111111111111111111111111111111111111111';
afterEach(() => vi.resetAllMocks());
describe('shared funds transaction protection', () => {
  it.each(['signing', 'broadcast', 'unknown'])('blocks %s across both tool families', (state) => {
    for (const prefix of ['monadbox.actions.v1', 'monadbox.module-actions.v1']) {
      const storage = {
        getItem: (key: string) =>
          key === `${prefix}:test:10143:${actor}` ? JSON.stringify([{ state }]) : null,
      };
      expect(() => requireResolvedTransactions(storage, 'test', actor)).toThrow(
        'UNRESOLVED_TRANSACTION',
      );
      expect(() => requireResolvedTransactions(storage, 'preview', actor)).not.toThrow();
      expect(() =>
        requireResolvedTransactions(storage, 'test', '0x2222222222222222222222222222222222222222'),
      ).not.toThrow();
    }
  });
  it.each(['rejected', 'finalized', 'reverted', 'replaced'])(
    'allows a new explicit action after %s',
    (state) =>
      expect(() =>
        requireResolvedTransactions({ getItem: () => JSON.stringify([{ state }]) }, 'test', actor),
      ).not.toThrow(),
  );
  it.each(['broken', '{}', '[null]', '[{"state":"fake-success"}]'])(
    'retains and blocks corrupted journal %s',
    (raw) => {
      const storage = { getItem: () => raw };
      expect(() => requireResolvedTransactions(storage, 'test', actor)).toThrow(
        'JOURNAL_UNAVAILABLE',
      );
      expect(storage.getItem()).toBe(raw);
    },
  );
});
describe('workspace rights and failure states', () => {
  const row: WorkspaceBox = {
    id: 'box',
    title: 'Example',
    tool: 'Split',
    href: '/box/example',
    source: 'chain',
    state: 'UNCHECKED',
    created: false,
    joined: true,
    pending: true,
    history: true,
  };
  it('never puts an unchecked amount in claimable credit', () => {
    expect(inView(row, 'claim')).toBe(false);
    expect(inView({ ...row, credit: '0' }, 'claim')).toBe(false);
    expect(inView({ ...row, credit: '1' }, 'claim')).toBe(true);
  });
  it('clears obsolete actionable status after on-chain settlement, keeps unresolved transaction status', async () => {
    vi.mocked(moduleSnapshot).mockResolvedValue({
      credit: '0',
      withdrawn: '100',
      locked: '0',
      block: '500',
      state: 'SETTLED',
      position: 1,
    } as never);
    vi.mocked(moduleActions).mockReturnValue([]);
    const known = { kind: 'module', publication: { data: { tool: 'group' } } } as never;
    const settled = await verifyWorkspaceBox({ ...row, known }, actor);
    expect(settled.pending).toBe(false);
    expect(settled.history).toBe(true);
    expect(settled.withdrawn).toBe('100');
    expect((await verifyWorkspaceBox({ ...row, known, unresolved: true }, actor)).pending).toBe(
      true,
    );
  });
  it('rejects malformed bookmarks without erasing stored contents', () => {
    const raw = '[{"kind":"external-url","publication":"https://example.invalid"}]';
    const storage = { getItem: () => raw };
    expect(() => readBookmarks(storage, 'test')).toThrow('retained');
    expect(storage.getItem()).toBe(raw);
  });
});
