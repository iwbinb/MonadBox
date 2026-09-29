import { BaseError } from 'viem';
import { checkSetup, setupKinds, setupRegistry } from './deployment';
import type { SetupKind, SetupRow } from './deployment';
import { makeClient } from '../../shared/network';
import type { ChainClient } from '../../shared/network';

export const setupNames: Record<SetupKind, string> = {
  'group-v1': 'Group V1',
  split: 'Split',
  group: 'Group V2',
  deliver: 'Deliver',
  attend: 'Attend',
  milestones: 'Milestones',
  rewards: 'Rewards',
};
export type SetupProgress = { kind: SetupKind; completed: number };

export function setupCheckError(error: unknown): string {
  const detail =
    error instanceof BaseError
      ? [error.shortMessage, error.details].filter(Boolean).join(' ')
      : error instanceof Error
        ? error.message
        : 'Unknown verification error / 未知核验错误';
  if (/429|rate limit|too many requests/i.test(detail))
    return 'RPC rate limit reached. Wait briefly, then retry verification. / 节点请求限流，请稍后重新核验。';
  if (/timeout|timed out|SETUP_CHECK_TIMEOUT/i.test(detail))
    return 'RPC verification timed out. Retry verification. / 节点核验超时，请重新核验。';
  if (detail === 'UNVERIFIED_CONTRACT')
    return 'Contract code, asset or administrator does not match. / 合约代码、资产或管理员不匹配。';
  if (/WRONG_.*CHAIN/.test(detail))
    return 'RPC returned a different network. / 节点返回的网络不匹配。';
  return detail.slice(0, 600);
}

/** Recheck one deployment at a time to avoid a seven-contract RPC burst. */
export async function verifySetupRegistration(
  rows: SetupRow[],
  signal: AbortSignal,
  progress: (value: SetupProgress) => void,
  client: ChainClient = makeClient(),
) {
  // Only the latest verified deployment of each kind belongs in this export.
  const selected = setupKinds.map((kind) =>
    [...rows].reverse().find((row) => row.intent.kind === kind && row.state === 'finalized'),
  );
  if (selected.some((row) => !row))
    throw Error('Verify all seven deployments before exporting. / 请先核验全部七个合约。');
  const verified: SetupRow[] = [];
  for (const row of selected) {
    signal.throwIfAborted();
    const current = row!;
    progress({ kind: current.intent.kind, completed: verified.length });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(Error('SETUP_CHECK_TIMEOUT')), 45000);
      });
      const checked = await Promise.race([checkSetup(current, client), interrupted]);
      signal.throwIfAborted();
      if (checked.state !== 'finalized')
        throw Error(
          `Deployment is ${checked.state}; recheck the original transaction. / 部署状态为 ${checked.state}，请核验原交易。`,
        );
      verified.push(checked);
      progress({ kind: current.intent.kind, completed: verified.length });
    } catch (error) {
      signal.throwIfAborted();
      throw Error(`${setupNames[current.intent.kind]}: ${setupCheckError(error)}`, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  return setupRegistry(verified);
}
