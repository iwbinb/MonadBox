import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { toHex, createWalletClient, http, defineChain } from 'viem';
import type { Address, Hex } from 'viem';
import { calldata } from '../../src/shared/cloud/chain';
import type { CloudBox, SessionInfo, PublicGroup } from '../../src/shared/cloud/model';
// Uses only the fixed local server started by scripts/cloud-test-server.mjs.
const origin = 'http://127.0.0.1:18889',
  endpoint = 'http://127.0.0.1:18745';
const fixture = JSON.parse(readFileSync('artifacts/cloud-test.json', 'utf8')) as {
  accounts: Address[];
};
const actor = fixture.accounts[8]!,
  beneficiary = fixture.accounts[9]!;
const chain = defineChain({
  id: 10143,
  name: 'Local only',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [endpoint] } },
});
const wallet = createWalletClient({ chain, transport: http(endpoint) });
const cookies = new Map<string, string>();
let csrf = '';
async function req<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const r = await fetch(origin + '/api/v1' + path, {
    method,
    headers: {
      'content-type': 'application/json',
      Origin: origin,
      'X-MonadBox-Client': 'web',
      'X-CSRF-Token': csrf,
      Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const item of r.headers.getSetCookie()) {
    const [pair] = item.split(';');
    const [k, ...v] = pair!.split('=');
    cookies.set(k!, v.join('='));
  }
  const payload = (await r.json()) as { data: T; error?: unknown };
  return { status: r.status, data: payload.data, error: payload.error };
}
async function rpc(method: string, params: unknown[] = []) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const p = (await r.json()) as { result: unknown; error?: unknown };
  assert(!p.error);
  return p.result;
}
assert.match(String(await rpc('web3_clientVersion')), /anvil/i);
const challenge = await req<{ id: string; message: string }>('/auth/nonce', 'POST', {
  address: actor,
});
assert.equal(challenge.status, 200);
const signature = await wallet.signMessage({ account: actor, message: challenge.data.message });
const login = await req<SessionInfo>('/auth/verify', 'POST', {
  id: challenge.data.id,
  message: challenge.data.message,
  signature,
});
assert.equal(login.status, 200, JSON.stringify(login));
csrf = login.data.csrf;
const t = Math.floor(Date.now() / 1000);
const data = {
  title: 'Local HTTP publication',
  description: 'Actual Worker + D1 + Anvil, not public Monad.',
  unitPrice: '100000',
  minimum: 2,
  capacity: 3,
  beneficiary,
  startsAt: t + 3600,
  fundingDeadline: t + 7200,
  settleNotBefore: t + 10800,
};
const saved = await req<CloudBox>(
  '/groups',
  'POST',
  { data },
  { 'Idempotency-Key': crypto.randomUUID() },
);
assert.equal(saved.status, 200, JSON.stringify(saved));
assert.equal((await req('/public/groups/' + saved.data.publicId)).status, 404);
const prepared = await req<CloudBox>(`/groups/${saved.data.id}/prepare`, 'POST', { revision: 1 });
assert.equal(prepared.status, 200, JSON.stringify(prepared));
const i = prepared.data.publication!.intent;
const tx = (await rpc('eth_sendTransaction', [
  { from: actor, to: i.deployment.address, data: calldata(i), value: '0x0', nonce: toHex(i.nonce) },
])) as Hex;
await rpc('anvil_mine', ['0x41']);
const confirmed = await req<CloudBox>(`/groups/${i.boxId}/confirm`, 'POST', { hash: tx });
assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
assert.equal(confirmed.data.state, 'published');
assert.equal((await req(`/groups/${i.boxId}`, 'PATCH', { data, revision: 1 })).status, 409);
const anonymous = await fetch(origin + '/api/v1/public/groups/' + i.publicId);
assert.equal(anonymous.status, 200);
const page = ((await anonymous.json()) as { data: PublicGroup }).data;
assert.equal(page.data.title, data.title);
assert.equal(page.snapshot.state, 'UPCOMING');
assert.equal(page.paymentsEnabled, false);
assert.equal((await req('/auth/logout', 'POST', {})).status, 200);
assert.equal((await req('/groups')).status, 401);
writeFileSync(
  'artifacts/cloud-http.json',
  JSON.stringify(
    {
      mode: 'LOCAL Worker/D1/Anvil ONLY',
      checks: 10,
      publication: tx,
      chainBoxId: i.chainBoxId,
      publicId: i.publicId,
      actualSnapshot: page.snapshot,
    },
    null,
    2,
  ),
);
console.log(
  'M1-B HTTP: 10 assertions passed, private draft -> signed local creation -> anonymous verified public page; no public transaction.',
);
