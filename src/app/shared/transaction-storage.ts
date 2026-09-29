const terminal = new Set(['rejected', 'finalized', 'reverted', 'replaced']);
export const transactionJournalPrefixes = [
  'monadbox.setup.mon-v2',
  'monadbox.actions.v1',
  'monadbox.module-actions.v1',
  'monadbox.actions.mon-v2',
  'monadbox.module-actions.mon-v2',
] as const;
export type TransactionJournalPrefix = (typeof transactionJournalPrefixes)[number];
export interface PendingTransaction {
  prefix: TransactionJournalPrefix;
  index: number;
  id: string;
  state: string;
  hash?: string;
  title: string;
  action: string;
}
function shortText(value: unknown) {
  return typeof value === 'string' ? value.slice(0, 80) : '';
}
/** Read the same journals checked by the send guard, without changing their evidence. */
export function pendingTransactions(
  storage: Pick<Storage, 'getItem'>,
  environment: string,
  actor: string,
): PendingTransaction[] {
  const pending: PendingTransaction[] = [];
  for (const prefix of transactionJournalPrefixes) {
    const raw = storage.getItem(`${prefix}:${environment}:10143:${actor.toLowerCase()}`);
    if (!raw) continue;
    let rows: unknown;
    try {
      if (raw.length > 2_000_000) throw Error();
      rows = JSON.parse(raw);
      if (
        !Array.isArray(rows) ||
        rows.length > 200 ||
        rows.some(
          (r) =>
            !r ||
            typeof r !== 'object' ||
            typeof r.state !== 'string' ||
            !['signing', 'broadcast', 'unknown', ...terminal].includes(r.state),
        )
      )
        throw Error();
    } catch {
      throw Error('JOURNAL_UNAVAILABLE');
    }
    (rows as Record<string, unknown>[]).forEach((row, index) => {
      if (terminal.has(row.state as string)) return;
      const intent =
        row.intent && typeof row.intent === 'object' ? (row.intent as Record<string, unknown>) : {};
      const publication =
        intent.publication && typeof intent.publication === 'object'
          ? (intent.publication as Record<string, unknown>)
          : {};
      const group =
        intent.group && typeof intent.group === 'object'
          ? (intent.group as Record<string, unknown>)
          : {};
      const data =
        (publication.data ?? group.data) && typeof (publication.data ?? group.data) === 'object'
          ? ((publication.data ?? group.data) as Record<string, unknown>)
          : {};
      pending.push({
        prefix,
        index,
        id: shortText(intent.id),
        state: row.state as string,
        ...(typeof row.hash === 'string' ? { hash: row.hash } : {}),
        title: shortText(data.title || intent.kind),
        action: shortText(intent.action),
      });
    });
  }
  return pending;
}
/** Called inside the shared per-account signing lock, before any wallet request. */
export function requireResolvedTransactions(
  storage: Pick<Storage, 'getItem'>,
  environment: string,
  actor: string,
) {
  if (pendingTransactions(storage, environment, actor).length)
    throw Error('UNRESOLVED_TRANSACTION');
}
