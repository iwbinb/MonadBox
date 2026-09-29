import { z } from 'zod';
import type { Address } from 'viem';
import { intentSchema } from '../../shared/cloud/model';
import type { PublishIntent } from '../../shared/cloud/model';
import { modulePublicationSchema } from '../../shared/modules/model';
import type { ModulePublication } from '../../shared/modules/model';
import { groupAccount, availableActions } from '../../shared/group/actions';
import { moduleSnapshot, moduleActions } from '../../shared/modules/chain';
import { makeClient } from '../../shared/network';
import { actionKey, readActions } from '../group/action-journal';
import { journalKey, readRecords } from '../modules/journal';

export type KnownBox =
  | { kind: 'group-v1'; publication: PublishIntent }
  | { kind: 'module'; publication: ModulePublication };
export interface WorkspaceBox {
  id: string;
  title: string;
  href: string;
  tool: string;
  source: 'local' | 'cloud' | 'chain';
  created: boolean;
  joined: boolean;
  pending: boolean;
  history: boolean;
  unresolved?: boolean;
  known?: KnownBox;
  credit?: string;
  locked?: string;
  withdrawn?: string;
  block?: string;
  state: string;
  error?: string;
}
export type WorkspaceView = 'created' | 'joined' | 'pending' | 'claim' | 'history';
export const knownSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('group-v1'), publication: intentSchema }),
  z.strictObject({ kind: z.literal('module'), publication: modulePublicationSchema }),
]);
const bookmarkKey = (environment: string) => `monadbox.workspace.mon-v2:${environment}:10143`;
export const boxKey = (box: KnownBox) =>
  `${box.publication.deployment.address.toLowerCase()}:${box.publication.chainBoxId}`;
export function readBookmarks(storage: Pick<Storage, 'getItem'>, environment: string): KnownBox[] {
  const raw = storage.getItem(bookmarkKey(environment));
  if (!raw) return [];
  try {
    if (raw.length > 4_000_000) throw Error();
    const rows = knownSchema.array().max(200).parse(JSON.parse(raw));
    if (new Set(rows.map(boxKey)).size !== rows.length) throw Error();
    return rows;
  } catch {
    throw Error(
      'Saved links cannot be read. Existing data has been retained. / 已保存链接无法读取，原数据已保留。',
    );
  }
}
export async function saveBookmark(environment: string, input: KnownBox) {
  const box = knownSchema.parse(input);
  if (!navigator.locks) throw Error('Safe browser storage unavailable / 浏览器不支持安全存储');
  await navigator.locks.request(bookmarkKey(environment), () => {
    const rows = readBookmarks(localStorage, environment),
      index = rows.findIndex((r) => boxKey(r) === boxKey(box));
    if (index < 0) {
      if (rows.length >= 200) throw Error('Saved link limit reached / 已达200条链接上限');
      rows.push(box);
    } else if (JSON.stringify(rows[index]?.publication) !== JSON.stringify(box.publication)) {
      throw Error('Saved rules differ from this link / 已保存的规则与此链接不符');
    }
    localStorage.setItem(bookmarkKey(environment), JSON.stringify(rows));
  });
}
export function knownRow(box: KnownBox, actor: Address | null): WorkspaceBox {
  const p = box.publication;
  return {
    id: boxKey(box),
    title: p.data.title,
    href: `/${box.kind === 'group-v1' ? 'b' : 'box'}/${p.publicId}`,
    tool:
      box.kind === 'group-v1'
        ? 'Group V1'
        : box.publication.data.tool === 'group'
          ? 'Group V2'
          : box.publication.data.tool === 'deliver'
            ? 'Deliver'
            : box.publication.data.tool === 'rewards'
              ? 'Rewards'
              : box.publication.data.tool === 'milestones'
                ? 'Milestones'
                : box.publication.data.tool === 'attend'
                  ? 'Attend'
                  : 'Split',
    source: 'chain',
    created: !!actor && actor.toLowerCase() === p.creator.toLowerCase(),
    joined: false,
    pending: false,
    history: false,
    state: 'UNCHECKED',
    known: box,
  };
}
export function collectRecords(environment: string, actor: Address): WorkspaceBox[] {
  const map = new Map<string, WorkspaceBox>();
  const add = (box: KnownBox, action: string, state: string) => {
    const key = boxKey(box),
      row = map.get(key) ?? knownRow(box, actor);
    row.history = true;
    row.joined ||=
      ['pay', 'contribute', 'register', 'fund', 'claimFor'].includes(action) &&
      state === 'finalized';
    row.pending ||= !['rejected', 'finalized', 'reverted', 'replaced'].includes(state);
    row.unresolved = row.pending;
    map.set(key, row);
  };
  for (const r of readActions(localStorage, actionKey(environment, actor)))
    add({ kind: 'group-v1', publication: r.intent.group }, r.intent.action, r.state);
  for (const r of readRecords(localStorage, journalKey(environment, actor)))
    add({ kind: 'module', publication: r.intent.publication }, r.intent.action, r.state);
  return [...map.values()];
}
export function inView(row: WorkspaceBox, view: WorkspaceView) {
  return view === 'claim' ? row.credit !== undefined && BigInt(row.credit) > 0n : row[view];
}
export async function verifyWorkspaceBox(row: WorkspaceBox, actor: Address): Promise<WorkspaceBox> {
  if (!row.known) return row;
  const client = makeClient();
  let result: Pick<WorkspaceBox, 'credit' | 'locked' | 'withdrawn' | 'block' | 'state'>,
    actions: string[],
    position: number;
  if (row.known.kind === 'group-v1') {
    const s = await groupAccount(client, row.known.publication, actor);
    result = {
      credit: s.credit,
      locked: s.snapshot.locked,
      withdrawn: s.withdrawn,
      block: s.snapshot.blockNumber,
      state: s.snapshot.state,
    };
    actions = availableActions(row.known.publication, actor, s);
    position = s.position;
  } else {
    const s = await moduleSnapshot(client, row.known.publication, actor);
    result = {
      credit: s.credit,
      locked: s.locked,
      withdrawn: s.withdrawn,
      block: s.block,
      state: s.state,
    };
    actions = moduleActions(row.known.publication, actor, s);
    const d = row.known.publication.data;
    position =
      (d.tool === 'deliver' || d.tool === 'milestones') &&
      [d.buyer, d.seller].some((a) => a.toLowerCase() === actor.toLowerCase())
        ? 1
        : s.position;
  }
  const { error: _error, ...clean } = row;
  void _error;
  return {
    ...clean,
    ...result,
    joined: row.joined || position > 0,
    pending:
      !!row.unresolved ||
      actions.some((a) =>
        [
          'finalize',
          'creditRefund',
          'settle',
          'fund',
          'submitDelivery',
          'accept',
          'dispute',
          'refundAfterMissingDelivery',
          'refundAfterDisputeTimeout',
          'settleAfterReview',
          'checkIn',
          'challengeNoShow',
          'finalizeNoShow',
          'refundDispute',
          'claimFor',
          'reclaimExpired',
        ].includes(a),
      ),
    history:
      row.history ||
      ['REFUNDED', 'SETTLED', 'COMPLETED', 'RESOLVED', 'TERMINATED'].includes(result.state) ||
      BigInt(result.withdrawn!) > 0n,
  };
}
