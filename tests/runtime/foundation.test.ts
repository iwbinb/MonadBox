import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { consumeNonce, requireStorage, readPrivateAttachment } from '../../src/worker/storage';
import { handleQueue, processJob, handleScheduled } from '../../src/worker/jobs';
import type { Env } from '../../src/worker/env';

const vars = {
  APP_ENV: 'test',
  CHAIN_ID: '10143',
  STORAGE_NAMESPACE: 'monadbox-test',
  STORAGE_ENABLED: 'true',
  BACKGROUND_ENABLED: 'true',
  NETWORK_WRITES_ENABLED: 'false',
  MAINNET_ENABLED: 'false',
  ASSET_ALLOWLIST: '[]',
  CONTRACT_REGISTRY: '[]',
};
let mf: Miniflare;
let isolated: Miniflare;
let env: Env;
let db: D1Database;
async function until(check: () => Promise<boolean>, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('Runtime event did not arrive');
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'api',
          modules: true,
          scriptPath: 'dist/worker/index.js',
          compatibilityDate: '2026-09-18',
          compatibilityFlags: ['nodejs_compat'],
          bindings: vars,
          d1Databases: { DB: 'foundation-test-db' },
          r2Buckets: { FILES: 'foundation-test-files' },
          queueProducers: { JOBS: 'foundation-jobs' },
          queueConsumers: {
            'foundation-jobs': {
              maxBatchSize: 1,
              maxBatchTimeout: 0,
              maxRetries: 1,
              deadLetterQueue: 'foundation-dlq',
            },
          },
        },
        {
          name: 'dlq-recorder',
          modules: true,
          script: `export default {async queue(batch,env){for(const message of batch.messages){await env.DB.prepare('INSERT INTO test_dead_letters (message_id) VALUES (?)').bind(message.id).run();message.ack();}}}`,
          compatibilityDate: '2026-09-18',
          d1Databases: { DB: 'foundation-test-db' },
          queueConsumers: { 'foundation-dlq': { maxBatchSize: 1, maxBatchTimeout: 0 } },
        },
      ],
    }),
  );
  db = (await mf.getD1Database('DB', 'api')) as unknown as D1Database;
  const migration = (await readFile('migrations/0001_foundation.sql', 'utf8')).replace(
    /^--.*$/gm,
    '',
  );
  for (const sql of migration
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  await db
    .prepare('INSERT INTO environment_guard (id,namespace) VALUES (1,?)')
    .bind('monadbox-test')
    .run();
  await db.exec('CREATE TABLE test_dead_letters (message_id TEXT PRIMARY KEY);');
  env = {
    ...vars,
    DB: db,
    FILES: (await mf.getR2Bucket('FILES', 'api')) as unknown as R2Bucket,
    JOBS: (await mf.getQueueProducer('JOBS', 'api')) as unknown as Queue,
  };
  isolated = new Miniflare(
    convertV4MiniflareOptions({
      name: 'isolated',
      modules: true,
      script: 'export default {fetch(){return new Response("isolated")}}',
      compatibilityDate: '2026-09-18',
      d1Databases: ['DB'],
      r2Buckets: ['FILES'],
    }),
  );
});
afterAll(async () => {
  await Promise.all([mf?.dispose(), isolated?.dispose()]);
});
describe('actual workerd HTTP handler', () => {
  it('returns the read-only public config', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { capabilities: { payments: boolean } } };
    expect(body.data.capabilities.payments).toBe(false);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('health validates storage marker', async () =>
    expect((await mf.dispatchFetch('http://localhost/api/v1/health')).status).toBe(200));
  it('returns JSON404 for an unknown API even with Accept:text/html', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/nope', {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
  it('does not expose diagnostic or upload write endpoints', async () => {
    for (const path of ['/api/internal/probe', '/api/v1/attachments/upload-intent'])
      expect((await mf.dispatchFetch('http://localhost' + path, { method: 'POST' })).status).toBe(
        404,
      );
  });
  it('keeps cloud login unavailable before setup', async () =>
    expect(
      (await mf.dispatchFetch('http://localhost/api/v1/auth/verify', { method: 'POST' })).status,
    ).toBe(503));
  it('cannot create a fake paid order', async () =>
    expect(
      (
        await mf.dispatchFetch('http://localhost/api/v1/boxes', {
          method: 'POST',
          body: '{"paid":true}',
        })
      ).status,
    ).toBe(503));
  it('rejects inappropriate methods and does not enable cross-origin access', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/v1/config', {
      method: 'POST',
      headers: { Origin: 'https://attacker.invalid' },
    });
    expect(res.status).toBe(405);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
  });
  it('sets security headers and its own request ID', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/v1/config', {
      headers: { 'x-request-id': 'untrusted' },
    });
    expect(res.headers.get('x-request-id')).not.toBe('untrusted');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});
describe('D1 isolation and atomicity', () => {
  it('consumes a nonce once under concurrency', async () => {
    await db
      .prepare('INSERT INTO auth_nonces VALUES (?,?,?,?,NULL)')
      .bind('race', 'localhost', 10143, 200)
      .run();
    const results = await Promise.all([
      consumeNonce(db, 'race', 100),
      consumeNonce(db, 'race', 100),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('rejects the expiry equality boundary', async () => {
    await db
      .prepare('INSERT INTO auth_nonces VALUES (?,?,?,?,NULL)')
      .bind('expired', 'localhost', 10143, 100)
      .run();
    expect(await consumeNonce(db, 'expired', 100)).toBe(false);
  });
  it('rolls back the whole batch on a unique-key conflict', async () => {
    await expect(
      db.batch([
        db.prepare('INSERT INTO job_receipts VALUES (?,?,?)').bind('rollback', 'a', 1),
        db.prepare('INSERT INTO job_receipts VALUES (?,?,?)').bind('rollback', 'b', 1),
      ]),
    ).rejects.toThrow();
    expect(
      await db.prepare('SELECT job_key FROM job_receipts WHERE job_key=?').bind('rollback').first(),
    ).toBeNull();
  });
  it('does not share D1 data or R2 objects across local environments', async () => {
    const other = await isolated.getD1Database('DB');
    await other.exec('CREATE TABLE isolation_test (id TEXT);');
    await env.FILES!.put('monadbox-test/private', 'secret');
    const otherBucket = await isolated.getR2Bucket('FILES');
    expect(await otherBucket.get('monadbox-test/private')).toBeNull();
    await expect(other.prepare('SELECT * FROM job_receipts').all()).rejects.toThrow();
  });
  it('rejects a production configuration attached to the test database', async () =>
    expect(
      requireStorage({ ...env, APP_ENV: 'production', STORAGE_NAMESPACE: 'monadbox-production' }),
    ).rejects.toThrow('Storage namespace mismatch'));
  it('fails closed when a required binding is missing', async () => {
    const missing = { ...env };
    delete missing.FILES;
    await expect(requireStorage(missing)).rejects.toThrow('Storage unavailable');
  });
});
describe('private R2 primitive', () => {
  const id = '455f4ce3-6f75-40eb-a09f-3898b3fd305d';
  it('requires the original owner; unguessable IDs alone do not authorize downloads', async () => {
    await db
      .prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?)')
      .bind(id, '0xowner', 'monadbox-test/private', 'test-only-hash', 6, 1)
      .run();
    await expect(readPrivateAttachment(env, '0xother', id)).rejects.toThrow(
      'Attachment unavailable',
    );
    expect(await (await readPrivateAttachment(env, '0xowner', id)).text()).toBe('secret');
  });
});
describe('Queue runtime and housekeeping (no chain operations)', () => {
  const job = {
    type: 'foundation.probe' as const,
    key: '0e1d2713-61ac-43b2-9874-e3b43ac63c48',
    namespace: 'monadbox-test',
    message: 'runtime probe',
  };
  it('handles an actual local queue message and deduplicates repeated delivery', async () => {
    const producer = await mf.getQueueProducer('JOBS', 'api');
    await producer.send(job);
    await producer.send(job);
    await until(
      async () =>
        !!(await db
          .prepare('SELECT job_key FROM job_receipts WHERE job_key=?')
          .bind(job.key)
          .first()),
    );
    await processJob(env, job);
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM job_receipts WHERE job_key=?')
      .bind(job.key)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
  it('rejects a reused key with different content', async () =>
    expect(processJob(env, { ...job, message: 'changed' })).rejects.toThrow('Conflicting job key'));
  it('rejects cross-environment jobs', async () =>
    expect(processJob(env, { ...job, namespace: 'monadbox-production' })).rejects.toThrow(
      'Job namespace mismatch',
    ));
  it('retries rather than acknowledging a failed job', async () => {
    const ack = vi.fn(),
      retry = vi.fn();
    await handleQueue(
      {
        queue: 'test',
        messages: [
          { id: 'diagnostic', timestamp: new Date(), body: { bad: true }, attempts: 1, ack, retry },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch<unknown>,
      env,
    );
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 2 });
  });
  it('routes an actual repeatedly failing message to a local dead-letter queue', async () => {
    await (await mf.getQueueProducer('JOBS', 'api')).send({ invalid: true });
    await until(
      async () => !!(await db.prepare('SELECT message_id FROM test_dead_letters LIMIT 1').first()),
    );
  });
  it('runs housekeeping when directly invoked and keeps it off by default', async () => {
    await handleScheduled({ ...env, STORAGE_ENABLED: 'false', BACKGROUND_ENABLED: 'false' });
    expect(
      await db
        .prepare('SELECT nonce_hash FROM auth_nonces WHERE nonce_hash=?')
        .bind('expired')
        .first(),
    ).not.toBeNull();
    await handleScheduled(env);
    expect(
      await db
        .prepare('SELECT nonce_hash FROM auth_nonces WHERE nonce_hash=?')
        .bind('expired')
        .first(),
    ).toBeNull();
  });
});
