import { isFileUpload } from '../modules/files';
import { FILE_LIMIT } from '../../shared/modules/files';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { verifyMessage, keccak256, stringToHex, getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { readConfig } from '../../shared/config';
import { registeredGroup } from '../../shared/cloud/registry';
import { groupDataSchema } from '../../shared/group/draft';
import { groupMetadata, groupTermsHash, groupId } from '../../shared/group/terms';
import {
  addressSchema,
  hashSchema,
  intentSchema,
  deploymentSchema,
  LOGIN_STATEMENT,
} from '../../shared/cloud/model';
import type {
  CloudBox,
  PublishIntent,
  SessionInfo,
  PublicGroup,
  PublicationState,
} from '../../shared/cloud/model';
import { makeCloudChain, calldata, same } from '../../shared/cloud/chain';
import type { CloudChain } from '../../shared/cloud/chain';
import type { Env } from '../env';
import { mountModuleRoutes } from '../modules/router';
import { makeModuleChain } from '../../shared/modules/chain';
import type { ModuleChain } from '../../shared/modules/chain';
export class CloudError extends Error {
  constructor(
    public code: string,
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503 = 400,
  ) {
    super(code);
  }
}
type Variables = {
  requestId: string;
  db: D1DatabaseSession;
  session: SessionInfo;
  sessionHash: string;
};
export type AppEnv = { Bindings: Env; Variables: Variables };
type C = Context<AppEnv>;
const now = () => Math.floor(Date.now() / 1000);
const uuid = z.string().uuid();
const opaque = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
const digest = (value: string) => keccak256(stringToHex(value));
const keySchema = z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/);
export async function requireCloud(env: Env): Promise<D1DatabaseSession> {
  const config = readConfig(env);
  if (!config.CLOUD_ENABLED || !env.DB) throw new CloudError('CLOUD_UNAVAILABLE', 503);
  const db = env.DB.withSession('first-primary');
  const [guard, schema] = await Promise.all([
    db.prepare('SELECT namespace FROM environment_guard WHERE id=1').first<{ namespace: string }>(),
    db.prepare('SELECT version FROM cloud_schema WHERE id=1').first<{ version: number }>(),
  ]);
  if (guard?.namespace !== config.STORAGE_NAMESPACE || schema?.version !== 2)
    throw new CloudError('CLOUD_UNAVAILABLE', 503);
  return db;
}
function cookieName(c: C, purpose: string) {
  return `${c.req.url.startsWith('https:') ? '__Host-' : ''}monadbox_${purpose}`;
}
function cookie(c: C, purpose: string, value: string, maxAge: number) {
  setCookie(c, cookieName(c, purpose), value, {
    path: '/',
    httpOnly: true,
    secure: c.req.url.startsWith('https:'),
    sameSite: 'Strict',
    maxAge,
  });
}
const ok = (c: C, data: unknown) => c.json({ data, requestId: c.get('requestId') });
export function cloudError(c: C, error: unknown) {
  const known = error instanceof CloudError;
  const validation = error instanceof z.ZodError || error instanceof SyntaxError;
  const code = known ? error.code : validation ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE';
  return c.json(
    {
      error: { code, message: code, retryable: !known && !validation },
      requestId: c.get('requestId'),
    },
    known ? error.status : validation ? 400 : 503,
  );
}
export async function limited(db: D1DatabaseSession, key: string, limit: number, seconds: number) {
  const t = now(),
    bucket = `${key}:${Math.floor(t / seconds)}`;
  const row = await db
    .prepare(
      'INSERT INTO cloud_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count',
    )
    .bind(bucket, t + seconds, limit)
    .first();
  if (!row) throw new CloudError('RATE_LIMITED', 429);
}
interface Row {
  id: string;
  owner_id: string;
  revision: number;
  draft_json: string;
  state: CloudBox['state'] | 'deleted';
  public_id: string;
  metadata_json: string;
  metadata_hash: Hex;
  create_hash: string;
}
interface Pub {
  intent_json: string;
  state: PublicationState;
  tx_hash: Hex | null;
}
async function box(db: D1DatabaseSession, id: string, actor: string): Promise<CloudBox> {
  uuid.parse(id);
  const row = await db
    .prepare("SELECT * FROM boxes WHERE id=? AND owner_id=? AND tool='group' AND state!='deleted'")
    .bind(id, actor)
    .first<Row>();
  if (!row) throw new CloudError('NOT_FOUND', 404);
  return fromRow(db, row);
}
async function fromRow(db: D1DatabaseSession, r: Row): Promise<CloudBox> {
  if (r.state === 'deleted') throw new CloudError('NOT_FOUND', 404);
  const data = groupDataSchema.parse(JSON.parse(r.draft_json));
  if (r.metadata_json !== groupMetadata(data) || !same(digest(r.metadata_json), r.metadata_hash))
    throw new CloudError('INTEGRITY_ERROR', 503);
  const pub = await db
    .prepare('SELECT * FROM group_publications WHERE box_id=?')
    .bind(r.id)
    .first<Pub>();
  const intent = pub ? intentSchema.parse(JSON.parse(pub.intent_json)) : null;
  if (
    intent &&
    (JSON.stringify(intent.data) !== JSON.stringify(data) ||
      !same(intent.creator, r.owner_id) ||
      intent.boxId !== r.id ||
      intent.publicId !== r.public_id ||
      intent.metadataHash !== r.metadata_hash)
  )
    throw new CloudError('INTEGRITY_ERROR', 503);
  if (intent) calldata(intent);
  return {
    id: r.id,
    publicId: r.public_id,
    owner: getAddress(r.owner_id),
    revision: r.revision,
    state: r.state,
    data,
    metadata: r.metadata_json,
    metadataHash: r.metadata_hash,
    publication: pub && intent ? { intent, state: pub.state, hash: pub.tx_hash } : null,
  };
}
export async function authenticate(c: C) {
  const raw = getCookie(c, cookieName(c, 'session'));
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new CloudError('SIGN_IN_REQUIRED', 401);
  const hash = digest(raw);
  const row = await c
    .get('db')
    .prepare(
      'SELECT user_id,csrf,expires_at FROM sessions WHERE id_hash=? AND revoked_at IS NULL AND expires_at>? AND origin=?',
    )
    .bind(hash, now(), c.env.APP_ORIGIN!)
    .first<{ user_id: string; csrf: string; expires_at: number }>();
  if (!row) throw new CloudError('SIGN_IN_REQUIRED', 401);
  if (!['GET', 'HEAD'].includes(c.req.method) && c.req.header('X-CSRF-Token') !== row.csrf)
    throw new CloudError('CSRF_REJECTED', 403);
  const session = { address: getAddress(row.user_id), csrf: row.csrf, expiresAt: row.expires_at };
  c.set('session', session);
  c.set('sessionHash', hash);
  return session;
}
export function createCloudRouter(
  chain: CloudChain = makeCloudChain(),
  modules: ModuleChain = makeModuleChain(),
) {
  const app = new Hono<AppEnv>();
  app.use('*', (c, next) =>
    bodyLimit({
      maxSize: isFileUpload(c.req.method, c.req.path) ? FILE_LIMIT : 20_000,
      onError: (c) => cloudError(c, new CloudError('BODY_TOO_LARGE', 413)),
    })(c, next),
  );
  app.use('*', async (c, next) => {
    if (!c.get('requestId')) c.set('requestId', crypto.randomUUID());
    c.header('Cache-Control', 'no-store');
    try {
      const config = readConfig(c.env);
      if (!config.CLOUD_ENABLED) throw new CloudError('CLOUD_UNAVAILABLE', 503);
      if (new URL(c.req.url).origin !== config.APP_ORIGIN)
        throw new CloudError('ORIGIN_REJECTED', 403);
      if (c.req.header('Sec-Fetch-Site') === 'cross-site')
        throw new CloudError('ORIGIN_REJECTED', 403);
      if (
        !['GET', 'HEAD'].includes(c.req.method) &&
        (c.req.header('Origin') !== config.APP_ORIGIN ||
          c.req.header('X-MonadBox-Client') !== 'web' ||
          (!isFileUpload(c.req.method, c.req.path) &&
            !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')))
      )
        throw new CloudError('ORIGIN_REJECTED', 403);
      c.set('db', await requireCloud(c.env));
      await limited(
        c.get('db'),
        digest(`ip:${c.req.header('CF-Connecting-IP') ?? 'local'}`),
        240,
        60,
      );
      await next();
    } catch (e) {
      return cloudError(c, e);
    }
  });
  app.post('/auth/nonce', async (c) => {
    const { address } = z.strictObject({ address: addressSchema }).parse(await c.req.json());
    const db = c.get('db');
    await db.batch([
      db
        .prepare(
          'DELETE FROM cloud_challenges WHERE id IN (SELECT id FROM cloud_challenges WHERE expires_at < ? LIMIT 100)',
        )
        .bind(now() - 86400),
      db
        .prepare(
          'DELETE FROM cloud_limits WHERE key IN (SELECT key FROM cloud_limits WHERE expires_at < ? LIMIT 100)',
        )
        .bind(now() - 3600),
    ]);
    await db
      .prepare(
        'DELETE FROM sessions WHERE id_hash IN (SELECT id_hash FROM sessions WHERE expires_at < ? LIMIT 100)',
      )
      .bind(now() - 86400)
      .run();
    await limited(db, `login:${address.toLowerCase()}`, 10, 600);
    const id = opaque(),
      token = opaque(),
      t = now(),
      origin = new URL(c.env.APP_ORIGIN!);
    const message = createSiweMessage({
      address,
      chainId: 10143,
      domain: origin.host,
      uri: `${origin.origin}/app/groups`,
      version: '1',
      nonce: id,
      issuedAt: new Date(t * 1000),
      expirationTime: new Date((t + 600) * 1000),
      statement: LOGIN_STATEMENT,
    });
    await db
      .prepare('INSERT INTO cloud_challenges VALUES(?,?,?,?,?,?,NULL)')
      .bind(id, address.toLowerCase(), origin.origin, message, digest(token), t + 600)
      .run();
    cookie(c, 'challenge', token, 600);
    return ok(c, { message, id, expiresAt: t + 600 });
  });
  app.post('/auth/verify', async (c) => {
    const body = z
      .strictObject({
        id: z.string().regex(/^[a-f0-9]{64}$/),
        message: z.string().max(2500),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      })
      .parse(await c.req.json());
    const token = getCookie(c, cookieName(c, 'challenge')),
      db = c.get('db'),
      t = now();
    const row = await db
      .prepare('SELECT * FROM cloud_challenges WHERE id=? AND expires_at>? AND consumed_at IS NULL')
      .bind(body.id, t)
      .first<{ address: Address; origin: string; message: string; token_hash: string }>();
    if (
      !row ||
      !token ||
      row.token_hash !== digest(token) ||
      row.message !== body.message ||
      row.origin !== c.env.APP_ORIGIN
    )
      throw new CloudError('INVALID_CHALLENGE', 401);
    if (
      !(await verifyMessage({
        address: row.address,
        message: body.message,
        signature: body.signature as Hex,
      })) ||
      !(await chain.eoa(row.address))
    )
      throw new CloudError('INVALID_SIGNATURE_OR_ACCOUNT', 401);
    const sessionToken = opaque(),
      sessionHash = digest(sessionToken),
      csrf = opaque();
    const acceptedAt = now();
    const old = getCookie(c, cookieName(c, 'session'));
    const results = await db.batch([
      db
        .prepare(
          'INSERT INTO users(id,primary_wallet,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',
        )
        .bind(row.address, row.address, t),
      db
        .prepare(
          'INSERT INTO sessions(id_hash,user_id,expires_at,origin,csrf,challenge_id) SELECT ?,?,?,?, ?, id FROM cloud_challenges WHERE id=? AND consumed_at IS NULL AND expires_at>?',
        )
        .bind(sessionHash, row.address, t + 86400, row.origin, csrf, body.id, acceptedAt),
      db
        .prepare(
          'UPDATE cloud_challenges SET consumed_at=? WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE id_hash=?)',
        )
        .bind(t, body.id, sessionHash),
      db
        .prepare(
          'UPDATE sessions SET revoked_at=? WHERE id_hash=? AND EXISTS(SELECT 1 FROM sessions WHERE id_hash=?)',
        )
        .bind(t, old ? digest(old) : '', sessionHash),
    ]);
    if (results[1]?.meta.changes !== 1) throw new CloudError('INVALID_CHALLENGE', 401);
    cookie(c, 'session', sessionToken, 86400);
    cookie(c, 'challenge', '', 0);
    return ok(c, { address: getAddress(row.address), csrf, expiresAt: t + 86400 });
  });
  app.get('/auth/session', async (c) => ok(c, await authenticate(c)));
  app.post('/auth/logout', async (c) => {
    await authenticate(c);
    await c
      .get('db')
      .prepare('UPDATE sessions SET revoked_at=? WHERE id_hash=?')
      .bind(now(), c.get('sessionHash'))
      .run();
    cookie(c, 'session', '', 0);
    return ok(c, { signedOut: true });
  });
  app.use('/groups/*', async (c, next) => {
    await authenticate(c);
    await next();
  });
  app.use('/groups', async (c, next) => {
    await authenticate(c);
    await next();
  });
  app.get('/groups', async (c) => {
    const rows = await c
      .get('db')
      .prepare(
        "SELECT * FROM boxes WHERE owner_id=? AND tool='group' AND state!='deleted' ORDER BY created_at DESC,id DESC LIMIT 40",
      )
      .bind(c.get('session').address.toLowerCase())
      .all<Row>();
    return ok(c, await Promise.all(rows.results.map((r) => fromRow(c.get('db'), r))));
  });
  app.post('/groups', async (c) => {
    const db = c.get('db'),
      actor = c.get('session').address.toLowerCase();
    const { data } = z.strictObject({ data: groupDataSchema }).parse(await c.req.json());
    const key = keySchema.parse(c.req.header('Idempotency-Key')),
      payload = JSON.stringify(data),
      fingerprint = digest(payload);
    await limited(db, `create:${actor}`, 50, 3600);
    const metadata = groupMetadata(data),
      id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO boxes(id,owner_id,tool,draft_json,created_at,public_id,metadata_json,metadata_hash,create_key,create_hash) SELECT ?,?,'group',?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM boxes WHERE owner_id=? AND state!='deleted')<40 ON CONFLICT(owner_id,create_key) DO NOTHING",
      )
      .bind(
        id,
        actor,
        payload,
        now(),
        crypto.randomUUID(),
        metadata,
        digest(metadata),
        key,
        fingerprint,
        actor,
      )
      .run();
    const saved = await db
      .prepare('SELECT id,create_hash,state FROM boxes WHERE owner_id=? AND create_key=?')
      .bind(actor, key)
      .first<Row>();
    if (!saved) throw new CloudError('GROUP_LIMIT', 429);
    if (saved.create_hash !== fingerprint) throw new CloudError('IDEMPOTENCY_CONFLICT', 409);
    return ok(c, await box(db, saved.id, actor));
  });
  app.get('/groups/:id', async (c) =>
    ok(c, await box(c.get('db'), c.req.param('id'), c.get('session').address.toLowerCase())),
  );
  app.patch('/groups/:id', async (c) => {
    const { data, revision } = z
      .strictObject({ data: groupDataSchema, revision: z.number().int().positive() })
      .parse(await c.req.json());
    const id = uuid.parse(c.req.param('id')),
      actor = c.get('session').address.toLowerCase(),
      db = c.get('db');
    await box(db, id, actor);
    const metadata = groupMetadata(data);
    const result = await db
      .prepare(
        "UPDATE boxes SET draft_json=?,metadata_json=?,metadata_hash=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=? AND state='draft'",
      )
      .bind(JSON.stringify(data), metadata, digest(metadata), id, actor, revision)
      .run();
    if (result.meta.changes !== 1) throw new CloudError('DRAFT_CHANGED_OR_FROZEN', 409);
    return ok(c, await box(db, id, actor));
  });
  app.delete('/groups/:id', async (c) => {
    const { revision } = z
      .strictObject({ revision: z.number().int().positive() })
      .parse(await c.req.json());
    const id = uuid.parse(c.req.param('id')),
      actor = c.get('session').address.toLowerCase(),
      db = c.get('db');
    await box(db, id, actor);
    const result = await db
      .prepare(
        "UPDATE boxes SET state='deleted',revision=revision+1 WHERE id=? AND owner_id=? AND revision=? AND state='draft'",
      )
      .bind(id, actor, revision)
      .run();
    if (result.meta.changes !== 1) throw new CloudError('DRAFT_CHANGED_OR_FROZEN', 409);
    return ok(c, { deleted: true });
  });
  app.post('/groups/:id/prepare', async (c) => {
    const { revision } = z
      .strictObject({ revision: z.number().int().positive() })
      .parse(await c.req.json());
    const db = c.get('db'),
      actor = c.get('session').address,
      b = await box(db, c.req.param('id'), actor.toLowerCase());
    if (b.publication) return ok(c, b); // Retries never create another salt/nonce.
    if (b.revision !== revision) throw new CloudError('DRAFT_CHANGED_OR_FROZEN', 409);
    const config = readConfig(c.env);
    if (!config.GROUP_PUBLISH_ENABLED || !config.GROUP_DEPLOYMENT)
      throw new CloudError('PUBLISH_UNAVAILABLE', 503);
    const deployment = deploymentSchema.parse(config.GROUP_DEPLOYMENT);
    const current = await chain.prepare(deployment, actor);
    if (
      b.data.startsAt <= current.timestamp + 60 ||
      b.data.startsAt <= now() + 60 ||
      same(b.data.beneficiary, deployment.address)
    )
      throw new CloudError('UPDATE_DRAFT_TIME_OR_BENEFICIARY', 409);
    const salt = `0x${opaque()}` as Hex;
    const intent: PublishIntent = {
      id: crypto.randomUUID(),
      boxId: b.id,
      publicId: b.publicId,
      deployment,
      creator: actor,
      salt,
      chainBoxId: groupId(deployment.address, actor, salt),
      termsHash: groupTermsHash(deployment.address, actor, salt, b.data),
      metadataHash: b.metadataHash,
      data: b.data,
      nonce: current.nonce,
      startBlock: current.block,
      expiresAt: Math.min(now() + 600, b.data.startsAt - 30),
    };
    calldata(intent);
    await db.batch([
      db
        .prepare(
          "INSERT INTO group_publications(box_id,intent_json,state,module,chain_box_id) SELECT id,?,'prepared',?,? FROM boxes WHERE id=? AND revision=? AND state='draft' ON CONFLICT(box_id) DO NOTHING",
        )
        .bind(
          JSON.stringify(intent),
          deployment.address.toLowerCase(),
          intent.chainBoxId,
          b.id,
          revision,
        ),
      db
        .prepare(
          "UPDATE boxes SET state='prepared' WHERE id=? AND EXISTS(SELECT 1 FROM group_publications WHERE box_id=boxes.id)",
        )
        .bind(b.id),
    ]);
    const saved = await box(db, b.id, actor.toLowerCase());
    if (!saved.publication) throw new CloudError('DRAFT_CHANGED_OR_FROZEN', 409);
    return ok(c, saved);
  });
  app.post('/groups/:id/confirm', async (c) => {
    const { hash } = z.strictObject({ hash: hashSchema.optional() }).parse(await c.req.json());
    const db = c.get('db'),
      actor = c.get('session').address.toLowerCase(),
      b = await box(db, c.req.param('id'), actor);
    if (!b.publication) throw new CloudError('NOT_PREPARED', 409);
    await limited(db, `confirm:${actor}`, 30, 60);
    if (!registeredGroup(readConfig(c.env), b.publication.intent.deployment))
      throw new CloudError('UNVERIFIED_CONTRACT', 503);
    const result = await chain.confirm(
      b.publication.intent,
      hash ?? b.publication.hash ?? undefined,
    );
    // Once finalized, never replace the historical publication by an unverified client hash.
    if (b.publication.state === 'finalized' && result.state !== 'finalized')
      throw new CloudError('CHAIN_RECHECK_REQUIRED', 503);
    if (
      b.publication.hash &&
      result.hash &&
      b.publication.state === 'finalized' &&
      !same(b.publication.hash, result.hash)
    )
      throw new CloudError('TRANSACTION_MISMATCH', 409);
    await db.batch([
      db
        .prepare(
          // Unknown results can seed recovery once, but cannot erase any saved evidence.
          "UPDATE group_publications SET state=?,tx_hash=COALESCE(?,tx_hash),verified_block=?,verified_block_hash=? WHERE box_id=? AND state!='finalized' AND (tx_hash IS NULL OR ?!='unknown')",
        )
        .bind(
          result.state,
          result.hash ?? null,
          result.block ?? null,
          result.blockHash ?? null,
          b.id,
          result.state,
        ),
      db
        .prepare(
          "UPDATE boxes SET state='published' WHERE id=? AND EXISTS(SELECT 1 FROM group_publications WHERE box_id=boxes.id AND state='finalized')",
        )
        .bind(b.id),
    ]);
    return ok(c, await box(db, b.id, actor));
  });
  app.get('/public/groups/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) throw new CloudError('NOT_FOUND', 404);
    const db = c.get('db');
    const r = await db
      .prepare("SELECT * FROM boxes WHERE public_id=? AND tool='group' AND state='published'")
      .bind(id.data)
      .first<Row>();
    if (!r) throw new CloudError('NOT_FOUND_OR_NOT_PUBLISHED', 404);
    const b = await fromRow(db, r),
      pub = b.publication;
    if (!pub || pub.state !== 'finalized' || !pub.hash)
      throw new CloudError('CHAIN_RECHECK_REQUIRED', 503);
    if (!registeredGroup(readConfig(c.env), pub.intent.deployment))
      throw new CloudError('UNVERIFIED_CONTRACT', 503);
    if ((await chain.confirm(pub.intent, pub.hash)).state !== 'finalized')
      throw new CloudError('CHAIN_RECHECK_REQUIRED', 503);
    const snapshot = await chain.snapshot(pub.intent);
    const data: PublicGroup = {
      publicId: b.publicId,
      creator: b.owner,
      data: b.data,
      metadata: b.metadata,
      metadataHash: b.metadataHash,
      termsHash: pub.intent.termsHash,
      module: pub.intent.deployment.address,
      chainBoxId: pub.intent.chainBoxId,
      transactionHash: pub.hash,
      snapshot,
      paymentsEnabled: readConfig(c.env).NETWORK_WRITES_ENABLED,
      intent: pub.intent,
    };
    return ok(c, data);
  });
  mountModuleRoutes(app, modules);
  app.onError((e, c) => cloudError(c, e));
  return app;
}
