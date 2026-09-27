import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { toHex, keccak256, stringToHex } from 'viem';
import { createCloudRouter } from '../../src/worker/cloud/router';
import type { CloudChain, ReceiptResult } from '../../src/shared/cloud/chain';
import { GROUP_ASSET, newGroupFields, validateGroupFields } from '../../src/shared/group/draft';
import type { CloudBox, SessionInfo } from '../../src/shared/cloud/model';
import type { Env } from '../../src/worker/env';
// Isolated test identities, never funded on or connected to a public chain.
const alice = privateKeyToAccount(toHex(1, { size: 32 })),
  bob = privateKeyToAccount(toHex(2, { size: 32 }));
const origin = 'https://cloud.test';
const hash = toHex(42, { size: 32 });
const deployment = {
  chainId: 10143,
  version: 1,
  address: '0x0000000000000000000000000000000000000022',
  asset: GROUP_ASSET,
  intakeAdmin: alice.address,
  runtimeHash: hash,
};
let mf: Miniflare, env: Env, db: D1Database;
let outcome: ReceiptResult,
  eoa = true;
const chain: CloudChain = {
  async eoa() {
    return eoa;
  },
  async prepare() {
    return { timestamp: Math.floor(Date.now() / 1000), block: '100', nonce: 7 };
  },
  async confirm() {
    return outcome;
  },
  async snapshot() {
    return {
      state: 'OPEN',
      activeCount: 0,
      locked: '0',
      blockNumber: '105',
      blockHash: hash,
      timestamp: Math.floor(Date.now() / 1000),
    };
  },
};
const app = createCloudRouter(chain);
const data = () =>
  validateGroupFields({
    ...newGroupFields(),
    title: 'Private workshop draft',
    beneficiary: bob.address,
  }).data!;
class Browser {
  cookies = new Map<string, string>();
  csrf = '';
  async req(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-MonadBox-Client': 'web',
      'CF-Connecting-IP': '192.0.2.1',
      Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      'X-CSRF-Token': this.csrf,
      ...extra,
    };
    const r = await app.request(
      origin + path,
      { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      env,
    );
    for (const cookie of r.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [k, ...v] = pair!.split('=');
      this.cookies.set(k!, v.join('='));
    }
    return r;
  }
  async challenge(account = alice) {
    const r = await this.req('/auth/nonce', 'POST', { address: account.address });
    expect(r.status).toBe(200);
    const c = (await r.json()).data;
    return {
      id: c.id,
      message: c.message,
      signature: await account.signMessage({ message: c.message }),
    };
  }
  async login(account = alice) {
    const c = await this.challenge(account);
    const r = await this.req('/auth/verify', 'POST', c);
    expect(r.status).toBe(200);
    const s = (await r.json()).data as SessionInfo;
    this.csrf = s.csrf;
    return s;
  }
  async create(key = crypto.randomUUID()) {
    const r = await this.req('/groups', 'POST', { data: data() }, { 'Idempotency-Key': key });
    expect(r.status).toBe(200);
    return (await r.json()).data as CloudBox;
  }
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'cloud-db',
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: '2026-09-18',
      d1Databases: { DB: 'cloud-test' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of ['0001_foundation.sql', '0002_cloud_groups.sql'])
    for (const sql of (await readFile('migrations/' + file, 'utf8'))
      .replace(/^--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  await db.prepare('INSERT INTO environment_guard VALUES(1,?)').bind('monadbox-test').run();
  env = {
    APP_ENV: 'test',
    APP_ORIGIN: origin,
    CHAIN_ID: '10143',
    CLOUD_ENABLED: 'true',
    GROUP_PUBLISH_ENABLED: 'true',
    GROUP_DEPLOYMENT: JSON.stringify(deployment),
    STORAGE_NAMESPACE: 'monadbox-test',
    STORAGE_ENABLED: 'false',
    BACKGROUND_ENABLED: 'false',
    NETWORK_WRITES_ENABLED: 'false',
    MAINNET_ENABLED: 'false',
    ASSET_ALLOWLIST: '[]',
    CONTRACT_REGISTRY: '[]',
    DB: db,
  };
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await db.batch(
    ['group_publications', 'boxes', 'sessions', 'users', 'cloud_challenges', 'cloud_limits'].map(
      (t) => db.prepare(`DELETE FROM ${t}`),
    ),
  );
  outcome = { state: 'unknown' };
  eoa = true;
});
describe('SIWE and sessions with real isolated D1', () => {
  it('creates a bound session, never stores a raw signature, and revokes logout', async () => {
    const b = new Browser();
    await b.login();
    expect((await b.req('/auth/session')).status).toBe(200);
    const c = [...b.cookies.values()].find((v) => v.length === 64)!;
    expect(await db.prepare('SELECT * FROM sessions WHERE id_hash=?').bind(c).first()).toBeNull();
    expect((await b.req('/auth/logout', 'POST', {})).status).toBe(200);
    expect((await b.req('/auth/session')).status).toBe(401);
  });
  it('uses Secure HttpOnly host-only Strict cookies', async () => {
    const b = new Browser();
    const c = await b.challenge();
    const r = await b.req('/auth/verify', 'POST', c);
    const cookies = r.headers.getSetCookie().join(';');
    expect(cookies).toContain('__Host-monadbox_session');
    for (const word of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'])
      expect(cookies).toContain(word);
    expect(cookies).not.toContain('Domain=');
  });
  it.each(['domain', 'uri', 'chain', 'nonce', 'issued', 'expiry', 'statement'])(
    'rejects tampering with %s even when re-signed',
    async (field) => {
      const b = new Browser();
      const c = await b.challenge();
      const replacements: Record<string, [string, string]> = {
        domain: ['cloud.test', 'attacker.test'],
        uri: ['/app/groups', '/evil'],
        chain: ['Chain ID: 10143', 'Chain ID: 143'],
        nonce: [c.id, 'a'.repeat(64)],
        issued: ['Issued At:', 'Not Before:'],
        expiry: ['Expiration Time:', 'Invalid Field:'],
        statement: ['does not authorize', 'authorizes'],
      };
      const [old, value] = replacements[field]!;
      c.message = c.message.replace(old, value);
      c.signature = await alice.signMessage({ message: c.message });
      expect((await b.req('/auth/verify', 'POST', c)).status).toBe(401);
    },
  );
  it('rejects missing challenge cookie and wrong signer', async () => {
    const b = new Browser(),
      c = await b.challenge();
    expect((await new Browser().req('/auth/verify', 'POST', c)).status).toBe(401);
    c.signature = await bob.signMessage({ message: c.message });
    expect((await b.req('/auth/verify', 'POST', c)).status).toBe(401);
  });
  it('allows one nonce redemption under concurrent requests', async () => {
    const b = new Browser(),
      c = await b.challenge();
    const results = await Promise.all([
      b.req('/auth/verify', 'POST', c),
      b.req('/auth/verify', 'POST', c),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await db.prepare('SELECT count(*) n FROM sessions').first<{ n: number }>())?.n).toBe(1);
  });
  it('rejects expired challenges, sessions, unsupported accounts', async () => {
    const b = new Browser(),
      c = await b.challenge();
    await db.prepare('UPDATE cloud_challenges SET expires_at=0').run();
    expect((await b.req('/auth/verify', 'POST', c)).status).toBe(401);
    eoa = false;
    const other = await b.challenge();
    expect((await b.req('/auth/verify', 'POST', other)).status).toBe(401);
    eoa = true;
    await b.login();
    await db.prepare('UPDATE sessions SET expires_at=0').run();
    expect((await b.req('/auth/session')).status).toBe(401);
  });
  it('rejects cross-origin, missing custom header and CSRF', async () => {
    const b = new Browser();
    await b.login();
    for (const h of [
      { Origin: 'https://evil.test' },
      { 'X-MonadBox-Client': '' },
      { 'X-CSRF-Token': '' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ])
      expect(
        (
          await b.req(
            '/groups',
            'POST',
            { data: data() },
            { 'Idempotency-Key': crypto.randomUUID(), ...h },
          )
        ).status,
      ).toBe(403);
  });
  it('fails closed with missing database, wrong marker and cross-origin cookies', async () => {
    const r = await app.request(
      origin + '/groups',
      { headers: { Origin: origin } },
      { ...env, DB: undefined },
    );
    expect(r.status).toBe(503);
    await db.prepare("UPDATE environment_guard SET namespace='monadbox-production'").run();
    expect((await new Browser().req('/groups')).status).toBe(503);
    await db.prepare("UPDATE environment_guard SET namespace='monadbox-test'").run();
  });
  it('limits repeated challenge requests and oversized input', async () => {
    const b = new Browser();
    for (let i = 0; i < 10; i++)
      expect((await b.req('/auth/nonce', 'POST', { address: alice.address })).status).toBe(200);
    expect((await b.req('/auth/nonce', 'POST', { address: alice.address })).status).toBe(429);
    expect((await b.req('/auth/nonce', 'POST', { x: 'x'.repeat(21000) })).status).toBe(413);
  });
});
describe('cloud metadata and immutable publication', () => {
  it('creates private cloud data accessible to same session but not another wallet or public ID', async () => {
    const a = new Browser(),
      b = new Browser();
    await a.login();
    await b.login(bob);
    const row = await a.create();
    expect((await a.req('/groups/' + row.id)).status).toBe(200);
    expect((await b.req('/groups/' + row.id)).status).toBe(404);
    expect((await a.req('/public/groups/' + row.publicId)).status).toBe(404);
  });
  it('deduplicates concurrent create and rejects changed payload for same key', async () => {
    const b = new Browser();
    await b.login();
    const key = crypto.randomUUID(),
      d = data();
    const responses = await Promise.all([
      b.req('/groups', 'POST', { data: d }, { 'Idempotency-Key': key }),
      b.req('/groups', 'POST', { data: d }, { 'Idempotency-Key': key }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect((await db.prepare('SELECT count(*) n FROM boxes').first<{ n: number }>())?.n).toBe(1);
    expect(
      (
        await b.req(
          '/groups',
          'POST',
          { data: { ...d, title: 'changed' } },
          { 'Idempotency-Key': key },
        )
      ).status,
    ).toBe(409);
  });
  it('rejects stale edits and preserves original UTF-8 metadata bytes', async () => {
    const b = new Browser();
    await b.login();
    const row = await b.create(),
      d = { ...row.data, title: '中文 <script>escaped</script>' };
    expect((await b.req('/groups/' + row.id, 'PATCH', { data: d, revision: 1 })).status).toBe(200);
    expect(
      (await b.req('/groups/' + row.id, 'PATCH', { data: row.data, revision: 1 })).status,
    ).toBe(409);
    const current = (await (await b.req('/groups/' + row.id)).json()).data;
    expect(current.metadataHash).toBe(keccak256(stringToHex(current.metadata)));
  });
  it('only deletes the owner draft and rejects deletion after freeze', async () => {
    const b = new Browser();
    await b.login();
    const row = await b.create();
    expect((await b.req('/groups/' + row.id, 'DELETE', { revision: 2 })).status).toBe(409);
    expect((await b.req('/groups/' + row.id, 'DELETE', { revision: 1 })).status).toBe(200);
    expect((await b.req('/groups/' + row.id)).status).toBe(404);
  });
  it('freezes a single intent under concurrent preparation and refuses edits or deletes', async () => {
    const b = new Browser();
    await b.login();
    const row = await b.create();
    const rs = await Promise.all([
      b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 1 }),
      b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 1 }),
    ]);
    const a = (await rs[0]!.json()).data,
      c = (await rs[1]!.json()).data;
    expect(a.publication.intent.id).toBe(c.publication.intent.id);
    expect(
      (await b.req('/groups/' + row.id, 'PATCH', { data: row.data, revision: 1 })).status,
    ).toBe(409);
    expect((await b.req('/groups/' + row.id, 'DELETE', { revision: 1 })).status).toBe(409);
  });
  it('rejects stale timestamps and disabled registration', async () => {
    const b = new Browser();
    await b.login();
    const row = await b.create();
    await b.req('/groups/' + row.id, 'PATCH', { data: { ...row.data, startsAt: 10 }, revision: 1 });
    expect((await b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 2 })).status).toBe(
      409,
    );
  });
  it.each(['unknown', 'reverted', 'replaced'] as const)(
    '%s does not publish a share page',
    async (state) => {
      const b = new Browser();
      await b.login();
      const row = await b.create();
      await b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 1 });
      outcome = { state, hash };
      const r = await b.req('/groups/' + row.id + '/confirm', 'POST', { hash });
      expect(r.status).toBe(200);
      expect((await r.json()).data.state).toBe('prepared');
      expect((await b.req('/public/groups/' + row.publicId)).status).toBe(404);
    },
  );
  it('publishes only finalized evidence, lets unauthenticated second browser read, rejects corruption and reorg', async () => {
    const b = new Browser();
    await b.login();
    const row = await b.create();
    await b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 1 });
    outcome = { state: 'finalized', hash, block: '105', blockHash: hash };
    expect((await b.req('/groups/' + row.id + '/confirm', 'POST', { hash })).status).toBe(200);
    const r = await new Browser().req('/public/groups/' + row.publicId);
    expect(r.status).toBe(200);
    const d = (await r.json()).data;
    expect(d.paymentsEnabled).toBe(false);
    expect(d.revision).toBeUndefined();
    outcome = { state: 'unknown' };
    expect((await b.req('/public/groups/' + row.publicId)).status).toBe(503);
    outcome = { state: 'finalized', hash };
    await db.prepare("UPDATE boxes SET metadata_json='tampered' WHERE id=?").bind(row.id).run();
    expect((await b.req('/public/groups/' + row.publicId)).status).toBe(503);
  });
});
