import { requireResolvedTransactions } from '../shared/transaction-storage';
import { calldata, same, verifyDeployment } from '../../shared/cloud/chain';
import { intentSchema, LOGIN_STATEMENT } from '../../shared/cloud/model';
import type { PublishIntent, SessionInfo } from '../../shared/cloud/model';
import { makeClient } from '../../shared/network';
import type { InjectedProvider } from '../../shared/lab/wallet';
import { requireWallet } from '../../shared/lab/wallet';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { toHex } from 'viem';
import type { Address, Hex } from 'viem';
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  csrf?: string,
  key?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-MonadBox-Client': 'web',
  };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (key) headers['Idempotency-Key'] = key;
  const r = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await r.json()) as { data?: T; error?: { code: string } };
  if (!r.ok || payload.data === undefined)
    throw new ApiError(payload.error?.code ?? 'SERVICE_UNAVAILABLE', r.status);
  return payload.data;
}
export function validateLogin(
  message: string,
  id: string,
  address: Address,
  origin = location.origin,
) {
  const m = parseSiweMessage(message);
  if (
    !validateSiweMessage({ message: m, address, domain: new URL(origin).host, nonce: id }) ||
    m.chainId !== 10143 ||
    m.uri !== `${origin}/app/groups` ||
    m.statement !== LOGIN_STATEMENT ||
    !m.issuedAt ||
    m.issuedAt.getTime() > Date.now() + 10_000 ||
    !m.expirationTime ||
    m.expirationTime.getTime() - m.issuedAt.getTime() !== 600_000
  )
    throw Error('Invalid login request / 登录请求不匹配');
}
export async function signIn(
  provider: InjectedProvider,
  address: Address,
  challenge: { id: string; message: string },
): Promise<SessionInfo> {
  await requireWallet(provider, address);
  validateLogin(challenge.message, challenge.id, address);
  const signature = await provider.request({
    method: 'personal_sign',
    params: [toHex(challenge.message), address],
  });
  await requireWallet(provider, address);
  return api('/auth/verify', 'POST', { id: challenge.id, message: challenge.message, signature });
}
export function journalKey(intent: PublishIntent) {
  return `monadbox.publish.v1:${intent.creator.toLowerCase()}:${intent.id}`;
}
export type Journal = { state: 'signing' | 'broadcast' | 'rejected' | 'unknown'; hash?: Hex };
export function readJournal(intent: PublishIntent): Journal | null {
  const raw = localStorage.getItem(journalKey(intent));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Journal;
    if (
      !['signing', 'broadcast', 'rejected', 'unknown'].includes(parsed.state) ||
      (parsed.hash && !/^0x[0-9a-f]{64}$/i.test(parsed.hash))
    )
      throw Error();
    return parsed;
  } catch {
    throw Error(
      'Recovery record is damaged; recheck on chain before continuing. / 恢复记录损坏，请先查链。',
    );
  }
}
/** No automatic resend. A Web Lock serializes same-account publication attempts across tabs. */
export async function sendPublication(
  provider: InjectedProvider,
  input: PublishIntent,
  environment: string,
): Promise<Hex> {
  const i = intentSchema.parse(input);
  if (!navigator.locks) throw Error('Safe multi-tab signing unavailable / 浏览器不支持安全签名锁');
  return navigator.locks.request(`monadbox.sign:${i.creator.toLowerCase()}`, async () => {
    requireResolvedTransactions(localStorage, environment, i.creator);
    const previous = readJournal(i);
    if (previous && previous.state !== 'rejected')
      throw Error('Recheck the previous transaction; do not resend. / 请核实前一笔交易，勿重发。');
    if (Date.now() / 1000 >= i.expiresAt)
      throw Error(
        'Publication intent expired. Clone the draft to change terms. / 发布意图已过期，可复制草稿后修改。',
      );
    await requireWallet(provider, i.creator);
    const client = makeClient();
    await verifyDeployment(client, i.deployment);
    const [block, code, nonce] = await Promise.all([
      client.getBlock(),
      client.getCode({ address: i.creator }),
      client.getTransactionCount({ address: i.creator, blockTag: 'pending' }),
    ]);
    if (code && code !== '0x')
      throw Error('Only ordinary EOA accounts are supported / 暂仅支持普通外部账户');
    if (
      nonce !== i.nonce ||
      block.timestamp >= BigInt(i.data.startsAt) ||
      block.timestamp >= BigInt(i.expiresAt)
    )
      throw Error(
        'Network time or nonce changed. Recheck before signing. / 链时间或交易序号已变化',
      );
    const data = calldata(i);
    const gas = await client.estimateGas({
      account: i.creator,
      to: i.deployment.address,
      data,
      value: 0n,
    });
    await requireWallet(provider, i.creator);
    localStorage.setItem(journalKey(i), JSON.stringify({ state: 'signing' }));
    let hash: Hex | undefined;
    try {
      const value = await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: i.creator,
            to: i.deployment.address,
            data,
            value: '0x0',
            chainId: toHex(10143),
            nonce: toHex(i.nonce),
            gas: toHex(gas + gas / 5n),
          },
        ],
      });
      if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
        throw Error('Invalid transaction hash');
      hash = value as Hex;
      try {
        localStorage.setItem(journalKey(i), JSON.stringify({ state: 'broadcast', hash }));
      } catch {
        /* Return the known hash so the page can send it to the server and display it. */
      }
      return hash;
    } catch (e) {
      const rejected = e && typeof e === 'object' && 'code' in e && e.code === 4001;
      try {
        localStorage.setItem(
          journalKey(i),
          JSON.stringify({ state: rejected ? 'rejected' : 'unknown', ...(hash ? { hash } : {}) }),
        );
      } catch {
        /* Earlier signing marker stays unresolved. */
      }
      throw e;
    }
  });
}
export function sameAccount(a: string, b: string) {
  return same(a, b);
}
