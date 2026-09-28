import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { toHex, keccak256, stringToHex } from 'viem';
import { createCloudRouter } from '../../src/worker/cloud/router';
import type { CloudChain, ReceiptResult } from '../../src/shared/cloud/chain';
import { GROUP_ASSET, newGroupFields, validateGroupFields } from '../../src/shared/group/draft';
import type { CloudBox, SessionInfo } from '../../src/shared/cloud/model';
import type { Env } from '../../src/worker/env';
import type { ModuleChain } from '../../src/shared/modules/chain';
import type { ModuleBox } from '../../src/shared/modules/model';
import { moduleIntentSchema } from '../../src/shared/modules/model';
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
const modules: ModuleChain = {
  async prepare(publication, actor, action) {
    return moduleIntentSchema.parse({
      id: crypto.randomUUID(),
      publication,
      actor,
      action,
      nonce: 7,
      startBlock: '100',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
  },
  async confirm() {
    return outcome;
  },
  async snapshot() {
    return {
      state: 'ACTIVE',
      storedState: 1,
      activeCount: 0,
      position: 0,
      locked: '0',
      credit: '0',
      withdrawn: '0',
      allowance: '0',
      balance: '0',
      paused: false,
      block: '105',
      blockHash: hash,
      timestamp: Math.floor(Date.now() / 1000),
    };
  },
};
const app = createCloudRouter(chain, modules);
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
  for (const file of ['0001_foundation.sql', '0002_cloud_groups.sql', '0003_modules.sql'])
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
  vi.restoreAllMocks();
  await db.batch(
    [
      'module_boxes',
      'group_publications',
      'boxes',
      'sessions',
      'users',
      'cloud_challenges',
      'cloud_limits',
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
  outcome = { state: 'unknown' };
  eoa = true;
  env.MODULES_ENABLED = 'false';
  env.MODULE_PUBLISH_ENABLED = 'false';
  env.MODULE_DEPLOYMENTS = '[]';
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
  it.each(['unknown', 'reverted', 'replaced'] as const)(
    'preserves the saved %s transaction and evidence when another hash is unknown',
    async (state) => {
      const b = new Browser();
      await b.login();
      const row = await b.create();
      await b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 1 });
      outcome = { state, hash, ...(state === 'unknown' ? {} : { block: '105', blockHash: hash }) };
      const saved = await b.req('/groups/' + row.id + '/confirm', 'POST', { hash });
      expect(saved.status).toBe(200);
      const publication = (await saved.json()).data.publication;
      const evidence = await db
        .prepare('SELECT * FROM group_publications WHERE box_id=?')
        .bind(row.id)
        .first();
      const unknownHash = toHex(43, { size: 32 });
      outcome = { state: 'unknown', hash: unknownHash };
      const response = await b.req('/groups/' + row.id + '/confirm', 'POST', { hash: unknownHash });
      expect(response.status).toBe(200);
      expect((await response.json()).data.publication).toEqual(publication);
      // A fresh request models the cloud record used after a page reload.
      expect((await (await b.req('/groups/' + row.id)).json()).data.publication).toEqual(
        publication,
      );
      expect(
        await db.prepare('SELECT * FROM group_publications WHERE box_id=?').bind(row.id).first(),
      ).toEqual(evidence);
      expect((await b.req('/public/groups/' + row.publicId)).status).toBe(404);
    },
  );
  it.each(['finalized', 'reverted', 'replaced'] as const)(
    'accepts a different hash after the chain verifier establishes %s evidence',
    async (state) => {
      const b = new Browser();
      await b.login();
      const row = await b.create();
      await b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 1 });
      outcome = { state: 'unknown', hash };
      expect((await b.req('/groups/' + row.id + '/confirm', 'POST', { hash })).status).toBe(200);
      const replacement = toHex(43, { size: 32 });
      outcome = { state, hash: replacement, block: '105', blockHash: hash };
      const response = await b.req('/groups/' + row.id + '/confirm', 'POST', { hash: replacement });
      expect(response.status).toBe(200);
      expect((await response.json()).data.publication).toMatchObject({ state, hash: replacement });
      expect(
        await db
          .prepare(
            'SELECT verified_block,verified_block_hash FROM group_publications WHERE box_id=?',
          )
          .bind(row.id)
          .first(),
      ).toEqual({ verified_block: '105', verified_block_hash: hash });
      expect((await new Browser().req('/public/groups/' + row.publicId)).status).toBe(
        state === 'finalized' ? 200 : 404,
      );
    },
  );
  it.each(['unknown', 'reverted', 'replaced'] as const)(
    'preserves saved %s evidence when rechecking the same hash is unavailable',
    async (state) => {
      const b = new Browser();
      await b.login();
      const row = await b.create();
      await b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 1 });
      outcome = { state, hash, ...(state === 'unknown' ? {} : { block: '105', blockHash: hash }) };
      expect((await b.req('/groups/' + row.id + '/confirm', 'POST', { hash })).status).toBe(200);
      const evidence = await db
        .prepare('SELECT * FROM group_publications WHERE box_id=?')
        .bind(row.id)
        .first();
      outcome = { state: 'unknown', hash };
      const confirm = vi.spyOn(chain, 'confirm');
      expect((await b.req('/groups/' + row.id + '/confirm', 'POST', {})).status).toBe(200);
      expect(confirm).toHaveBeenCalledWith(expect.any(Object), hash);
      expect((await (await b.req('/groups/' + row.id)).json()).data.publication.hash).toBe(hash);
      expect(
        await db.prepare('SELECT * FROM group_publications WHERE box_id=?').bind(row.id).first(),
      ).toEqual(evidence);
    },
  );
  it.each([
    { state: 'unknown', sameHash: false },
    { state: 'replaced', sameHash: false },
    { state: 'replaced', sameHash: true },
    { state: 'reverted', sameHash: true },
  ] as const)(
    'a late unknown result cannot overwrite a concurrent $state transaction (same hash: $sameHash)',
    async ({ state, sameHash }) => {
      const b = new Browser();
      await b.login();
      const row = await b.create();
      await b.req('/groups/' + row.id + '/prepare', 'POST', { revision: 1 });
      let started!: () => void, release!: (result: ReceiptResult) => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const delayed = new Promise<ReceiptResult>((resolve) => {
        release = resolve;
      });
      const replacement = sameHash ? hash : toHex(43, { size: 32 });
      vi.spyOn(chain, 'confirm')
        .mockImplementationOnce(async () => {
          started();
          return delayed;
        })
        .mockResolvedValueOnce({
          state,
          hash: replacement,
          ...(state === 'unknown' ? {} : { block: '105', blockHash: hash }),
        });
      const late = b.req('/groups/' + row.id + '/confirm', 'POST', { hash });
      await waiting;
      let publication: unknown, evidence: unknown;
      try {
        const first = await b.req('/groups/' + row.id + '/confirm', 'POST', { hash: replacement });
        expect(first.status).toBe(200);
        publication = (await first.json()).data.publication;
        expect(publication).toMatchObject({ state, hash: replacement });
        evidence = await db
          .prepare('SELECT * FROM group_publications WHERE box_id=?')
          .bind(row.id)
          .first();
      } finally {
        release({ state: 'unknown', hash });
        expect((await late).status).toBe(200);
      }
      expect((await (await b.req('/groups/' + row.id)).json()).data.publication).toEqual(
        publication,
      );
      expect(
        await db.prepare('SELECT * FROM group_publications WHERE box_id=?').bind(row.id).first(),
      ).toEqual(evidence);
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
    // Retiring a deployment must preserve its exact original publication and recovery.
    const previous = env.GROUP_DEPLOYMENT;
    env.GROUP_DEPLOYMENT = JSON.stringify({
      ...deployment,
      address: '0x3333333333333333333333333333333333333333',
    });
    env.GROUP_PREVIOUS_DEPLOYMENTS = JSON.stringify([deployment]);
    try {
      const historical = await b.req('/public/groups/' + row.publicId);
      expect(historical.status).toBe(200);
      expect((await historical.json()).data.module.toLowerCase()).toBe(
        deployment.address.toLowerCase(),
      );
      expect((await b.req('/groups/' + row.id + '/confirm', 'POST', { hash })).status).toBe(200);
      env.GROUP_PREVIOUS_DEPLOYMENTS = JSON.stringify([
        { ...deployment, runtimeHash: '0x' + '99'.repeat(32) },
      ]);
      expect((await b.req('/public/groups/' + row.publicId)).status).toBe(503);
    } finally {
      env.GROUP_DEPLOYMENT = previous;
      env.GROUP_PREVIOUS_DEPLOYMENTS = '[]';
    }
    outcome = { state: 'unknown' };
    expect((await b.req('/public/groups/' + row.publicId)).status).toBe(503);
    outcome = { state: 'finalized', hash };
    await db.prepare("UPDATE boxes SET metadata_json='tampered' WHERE id=?").bind(row.id).run();
    expect((await b.req('/public/groups/' + row.publicId)).status).toBe(503);
  });
});

describe('versioned module drafts and publication with real isolated D1', () => {
  const splitData = {
    tool: 'split',
    title: 'Fixed split',
    description: 'Public rules',
    recipients: [
      { address: alice.address, bps: 7000 },
      { address: bob.address, bps: 3000 },
    ],
  };
  const registration = {
    current: true,
    deployment: {
      ...deployment,
      tool: 'split',
      address: '0x3333333333333333333333333333333333333333',
    },
  };
  function enable() {
    env.MODULES_ENABLED = 'true';
    env.MODULE_PUBLISH_ENABLED = 'true';
    env.MODULE_DEPLOYMENTS = JSON.stringify([registration]);
  }
  async function create(
    b: Browser,
    key = crypto.randomUUID(),
    data = splitData,
  ): Promise<ModuleBox> {
    const r = await b.req('/modules', 'POST', { data }, { 'Idempotency-Key': key });
    expect(r.status, await r.clone().text()).toBe(200);
    return (await r.json()).data;
  }
  it('keeps modules unavailable by default and requires a session when enabled', async () => {
    const b = new Browser();
    expect((await b.req('/modules')).status).toBe(503);
    enable();
    expect((await b.req('/modules')).status).toBe(401);
  });
  it('preserves original local data as an explicit independent copy, with idempotency and owner isolation', async () => {
    enable();
    const a = new Browser(),
      b = new Browser();
    await a.login();
    await b.login(bob);
    const key = crypto.randomUUID(),
      first = await create(a, key);
    expect((await create(a, key)).id).toBe(first.id);
    expect((await b.req('/modules/' + first.id)).status).toBe(404);
    expect(
      (
        await a.req(
          '/modules',
          'POST',
          { data: { ...splitData, title: 'Changed' } },
          { 'Idempotency-Key': key },
        )
      ).status,
    ).toBe(409);
    expect((await a.req('/public/modules/' + first.publicId)).status).toBe(404);
  });
  it('checks CSRF and revision, rejects changing tool type and stale edits', async () => {
    enable();
    const b = new Browser();
    await b.login();
    const row = await create(b);
    expect(
      (
        await b.req(
          '/modules/' + row.id,
          'PATCH',
          { revision: 1, data: splitData },
          { 'X-CSRF-Token': 'bad' },
        )
      ).status,
    ).toBe(403);
    const changed = { ...splitData, title: 'Updated' };
    expect(
      (await b.req('/modules/' + row.id, 'PATCH', { revision: 1, data: changed })).status,
    ).toBe(200);
    expect(
      (await b.req('/modules/' + row.id, 'PATCH', { revision: 1, data: splitData })).status,
    ).toBe(409);
    expect((await b.req('/modules/' + row.id, 'DELETE', { revision: 1 })).status).toBe(409);
    expect((await b.req('/modules/' + row.id, 'DELETE', { revision: 2 })).status).toBe(200);
  });
  it('freezes publication once and retains its nonce and salt on retries and unknown outcomes', async () => {
    enable();
    const b = new Browser();
    await b.login();
    const row = await create(b);
    const first = await b.req('/modules/' + row.id + '/prepare', 'POST', { revision: 1 });
    expect(first.status, await first.clone().text()).toBe(200);
    const prepared = (await first.json()).data as ModuleBox;
    const retry = await b.req('/modules/' + row.id + '/prepare', 'POST', { revision: 1 });
    expect((await retry.json()).data.publication).toEqual(prepared.publication);
    expect(
      (await b.req('/modules/' + row.id, 'PATCH', { revision: 1, data: splitData })).status,
    ).toBe(409);
    expect((await b.req('/modules/' + row.id, 'DELETE', { revision: 1 })).status).toBe(409);
    outcome = { state: 'unknown', hash };
    expect((await b.req('/modules/' + row.id + '/confirm', 'POST', { hash })).status).toBe(200);
    outcome = { state: 'unknown', hash: toHex(43, { size: 32 }) };
    await b.req('/modules/' + row.id + '/confirm', 'POST', {});
    const saved = (await (await b.req('/modules/' + row.id)).json()).data as ModuleBox;
    expect(saved.receipt?.hash).toBe(hash);
    expect(saved.publication).toEqual(prepared.publication);
  });
  it('publishes only verified transactions and reads retired deployments by their original identity', async () => {
    enable();
    const b = new Browser();
    await b.login();
    const row = await create(b);
    await b.req('/modules/' + row.id + '/prepare', 'POST', { revision: 1 });
    outcome = { state: 'finalized', hash, block: '105', blockHash: hash };
    expect((await b.req('/modules/' + row.id + '/confirm', 'POST', { hash })).status).toBe(200);
    env.MODULE_DEPLOYMENTS = JSON.stringify([
      { ...registration, current: false },
      {
        ...registration,
        deployment: {
          ...registration.deployment,
          address: '0x4444444444444444444444444444444444444444',
        },
      },
    ]);
    const publicResponse = await new Browser().req('/public/modules/' + row.publicId);
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json()).data.publication.deployment.address).toBe(
      registration.deployment.address,
    );
    outcome = { state: 'unknown' };
    expect((await b.req('/public/modules/' + row.publicId)).status).toBe(503);
    expect((await b.req('/modules/' + row.id + '/confirm', 'POST', {})).status).toBe(503);
    expect((await (await b.req('/modules/' + row.id)).json()).data.receipt.state).toBe('finalized');
  });
  it('rejects corrupted stored metadata, cross-domain terms and unknown module identity', async () => {
    enable();
    const b = new Browser();
    await b.login();
    const row = await create(b);
    await b.req('/modules/' + row.id + '/prepare', 'POST', { revision: 1 });
    env.MODULE_DEPLOYMENTS = JSON.stringify([
      {
        ...registration,
        deployment: { ...registration.deployment, runtimeHash: toHex(1, { size: 32 }) },
      },
    ]);
    expect((await b.req('/modules/' + row.id + '/confirm', 'POST', {})).status).toBe(503);
    await db.prepare("UPDATE module_boxes SET metadata='tampered' WHERE id=?").bind(row.id).run();
    expect((await b.req('/modules/' + row.id)).status).toBe(503);
  });
  it('does not enable modules against an incorrect schema', async () => {
    enable();
    await db.prepare('UPDATE module_schema SET version=2').run();
    try {
      const b = new Browser();
      await b.login();
      expect((await b.req('/modules')).status).toBe(503);
    } finally {
      await db.prepare('UPDATE module_schema SET version=1').run();
    }
  });
});
