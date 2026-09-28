const terminal = new Set(['rejected', 'finalized', 'reverted', 'replaced']);
/** Called inside the shared per-account signing lock, before any wallet request. */
export function requireResolvedTransactions(
  storage: Pick<Storage, 'getItem'>,
  environment: string,
  actor: string,
) {
  for (const prefix of ['monadbox.actions.v1', 'monadbox.module-actions.v1']) {
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
    if ((rows as { state: string }[]).some((r) => !terminal.has(r.state)))
      throw Error('UNRESOLVED_TRANSACTION');
  }
}
