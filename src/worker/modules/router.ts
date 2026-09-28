import { mountFileRoutes } from './files';
import type { Hono } from 'hono';
import { z } from 'zod';
import { getAddress, keccak256, stringToHex } from 'viem';
import type { Hex } from 'viem';
import { readConfig } from '../../shared/config';
import { hashSchema } from '../../shared/cloud/model';
import { same } from '../../shared/cloud/chain';
import { moduleDataSchema, moduleIntentSchema } from '../../shared/modules/model';
import type { ModuleBox, ModulePublication, ModuleDeployment } from '../../shared/modules/model';
import {
  metadataFor,
  moduleId,
  termsHashFor,
  validatePublication,
} from '../../shared/modules/terms';
import type { ModuleChain } from '../../shared/modules/chain';
import { authenticate, CloudError, limited } from '../cloud/router';
import type { AppEnv } from '../cloud/router';
const uuid = z.string().uuid();
const now = () => Math.floor(Date.now() / 1000);
const hash = (text: string) => keccak256(stringToHex(text));
export interface Row {
  id: string;
  public_id: string;
  owner: string;
  revision: number;
  state: ModuleBox['state'];
  tool: string;
  data_json: string;
  metadata: string;
  intent_json: string | null;
  receipt_state: NonNullable<ModuleBox['receipt']>['state'] | null;
  tx_hash: Hex | null;
  verified_block: string | null;
  verified_block_hash: Hex | null;
}
export function fromRow(r: Row): ModuleBox {
  const data = moduleDataSchema.parse(JSON.parse(r.data_json));
  if (r.tool !== data.tool || r.metadata !== metadataFor(data))
    throw new CloudError('INTEGRITY_ERROR', 503);
  const publication = r.intent_json ? moduleIntentSchema.parse(JSON.parse(r.intent_json)) : null;
  if (publication) {
    const p = validatePublication(publication.publication);
    if (
      publication.action !== 'create' ||
      !same(publication.actor, r.owner) ||
      !same(p.creator, r.owner) ||
      p.id !== r.id ||
      p.publicId !== r.public_id ||
      JSON.stringify(p.data) !== JSON.stringify(data) ||
      p.metadata !== r.metadata
    )
      throw new CloudError('INTEGRITY_ERROR', 503);
  }
  return {
    id: r.id,
    publicId: r.public_id,
    owner: getAddress(r.owner),
    revision: r.revision,
    state: r.state,
    data,
    metadata: r.metadata,
    publication,
    receipt: r.receipt_state
      ? {
          state: r.receipt_state,
          ...(r.tx_hash ? { hash: r.tx_hash } : {}),
          ...(r.verified_block ? { block: r.verified_block } : {}),
          ...(r.verified_block_hash ? { blockHash: r.verified_block_hash } : {}),
        }
      : null,
  };
}
async function owned(db: D1DatabaseSession, id: string, actor: string) {
  const r = await db
    .prepare("SELECT * FROM module_boxes WHERE id=? AND owner=? AND state!='deleted'")
    .bind(uuid.parse(id), actor.toLowerCase())
    .first<Row>();
  if (!r) throw new CloudError('NOT_FOUND', 404);
  return fromRow(r);
}
export function registered(config: ReturnType<typeof readConfig>, d: ModuleDeployment) {
  if (!config.MODULE_DEPLOYMENTS.some((r) => JSON.stringify(r.deployment) === JSON.stringify(d)))
    throw new CloudError('UNVERIFIED_CONTRACT', 503);
}
export function mountModuleRoutes(app: Hono<AppEnv>, chain: ModuleChain) {
  for (const route of ['/modules', '/modules/*', '/public/modules/*'])
    app.use(route, async (c, next) => {
      if (!readConfig(c.env).MODULES_ENABLED) throw new CloudError('MODULES_UNAVAILABLE', 503);
      const schema = await c
        .get('db')
        .prepare('SELECT version FROM module_schema WHERE id=1')
        .first<{ version: number }>();
      if (schema?.version !== 1) throw new CloudError('MODULES_UNAVAILABLE', 503);
      if (!c.req.path.includes('/public/')) await authenticate(c);
      await next();
    });
  mountFileRoutes(app, chain);
  app.get('/modules', async (c) => {
    const rows = await c
      .get('db')
      .prepare(
        "SELECT * FROM module_boxes WHERE owner=? AND state!='deleted' ORDER BY created_at DESC,id DESC LIMIT 40",
      )
      .bind(c.get('session').address.toLowerCase())
      .all<Row>();
    return c.json({ data: rows.results.map(fromRow), requestId: c.get('requestId') });
  });
  app.post('/modules', async (c) => {
    const { data } = z.strictObject({ data: moduleDataSchema }).parse(await c.req.json());
    const key = z
      .string()
      .regex(/^[a-zA-Z0-9_-]{16,100}$/)
      .parse(c.req.header('Idempotency-Key'));
    const actor = c.get('session').address.toLowerCase(),
      db = c.get('db'),
      payload = JSON.stringify(data);
    await limited(db, `module-create:${actor}`, 50, 3600);
    await db
      .prepare(
        "INSERT INTO module_boxes(id,public_id,owner,tool,data_json,metadata,created_at,create_key,create_hash) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM module_boxes WHERE owner=? AND state!='deleted')<40 ON CONFLICT(owner,create_key) DO NOTHING",
      )
      .bind(
        crypto.randomUUID(),
        crypto.randomUUID(),
        actor,
        data.tool,
        payload,
        metadataFor(data),
        now(),
        key,
        hash(payload),
        actor,
      )
      .run();
    const saved = await db
      .prepare('SELECT id,create_hash FROM module_boxes WHERE owner=? AND create_key=?')
      .bind(actor, key)
      .first<{ id: string; create_hash: string }>();
    if (!saved) throw new CloudError('DRAFT_LIMIT', 429);
    if (saved.create_hash !== hash(payload)) throw new CloudError('IDEMPOTENCY_CONFLICT', 409);
    return c.json({ data: await owned(db, saved.id, actor), requestId: c.get('requestId') });
  });
  app.get('/modules/:id', async (c) =>
    c.json({
      data: await owned(c.get('db'), c.req.param('id'), c.get('session').address),
      requestId: c.get('requestId'),
    }),
  );
  app.patch('/modules/:id', async (c) => {
    const { data, revision } = z
      .strictObject({ data: moduleDataSchema, revision: z.number().int().positive() })
      .parse(await c.req.json());
    const actor = c.get('session').address,
      db = c.get('db'),
      b = await owned(db, c.req.param('id'), actor);
    if (data.tool !== b.data.tool) throw new CloudError('TOOL_IMMUTABLE', 409);
    const result = await db
      .prepare(
        "UPDATE module_boxes SET data_json=?,metadata=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND state='draft'",
      )
      .bind(JSON.stringify(data), metadataFor(data), b.id, actor.toLowerCase(), revision)
      .run();
    if (result.meta.changes !== 1) throw new CloudError('DRAFT_CHANGED_OR_FROZEN', 409);
    return c.json({ data: await owned(db, b.id, actor), requestId: c.get('requestId') });
  });
  app.delete('/modules/:id', async (c) => {
    const { revision } = z
      .strictObject({ revision: z.number().int().positive() })
      .parse(await c.req.json());
    const actor = c.get('session').address,
      db = c.get('db'),
      b = await owned(db, c.req.param('id'), actor);
    const result = await db
      .prepare(
        "UPDATE module_boxes SET state='deleted',revision=revision+1 WHERE id=? AND owner=? AND revision=? AND state='draft'",
      )
      .bind(b.id, actor.toLowerCase(), revision)
      .run();
    if (result.meta.changes !== 1) throw new CloudError('DRAFT_CHANGED_OR_FROZEN', 409);
    return c.json({ data: { deleted: true }, requestId: c.get('requestId') });
  });
  app.post('/modules/:id/prepare', async (c) => {
    const { revision } = z
      .strictObject({ revision: z.number().int().positive() })
      .parse(await c.req.json());
    const actor = c.get('session').address,
      db = c.get('db'),
      b = await owned(db, c.req.param('id'), actor),
      config = readConfig(c.env);
    if (b.publication) return c.json({ data: b, requestId: c.get('requestId') });
    if (b.revision !== revision) throw new CloudError('DRAFT_CHANGED_OR_FROZEN', 409);
    const deployment = config.MODULE_DEPLOYMENTS.find(
      (r) => r.current && r.deployment.tool === b.data.tool,
    )?.deployment;
    if (!config.MODULE_PUBLISH_ENABLED || !deployment)
      throw new CloudError('PUBLISH_UNAVAILABLE', 503);
    await limited(db, `module-prepare:${actor}`, 20, 60);
    const salt = keccak256(crypto.getRandomValues(new Uint8Array(32)));
    const partial = { deployment, creator: actor, salt, data: b.data };
    const p: ModulePublication = {
      ...partial,
      id: b.id,
      publicId: b.publicId,
      chainBoxId: moduleId(deployment.address, actor, salt),
      termsHash: termsHashFor(partial),
      metadata: b.metadata,
      metadataHash: hash(b.metadata),
    };
    const intent = await chain.prepare(p, actor, 'create');
    await db
      .prepare(
        "UPDATE module_boxes SET intent_json=?,receipt_state='prepared',state='prepared' WHERE id=? AND owner=? AND revision=? AND state='draft'",
      )
      .bind(JSON.stringify(intent), b.id, actor.toLowerCase(), revision)
      .run();
    const saved = await owned(db, b.id, actor);
    if (!saved.publication) throw new CloudError('DRAFT_CHANGED_OR_FROZEN', 409);
    return c.json({ data: saved, requestId: c.get('requestId') });
  });
  app.post('/modules/:id/confirm', async (c) => {
    const { hash } = z.strictObject({ hash: hashSchema.optional() }).parse(await c.req.json());
    const actor = c.get('session').address,
      db = c.get('db'),
      b = await owned(db, c.req.param('id'), actor);
    if (!b.publication) throw new CloudError('NOT_PREPARED', 409);
    registered(readConfig(c.env), b.publication.publication.deployment);
    await limited(db, `module-confirm:${actor}`, 30, 60);
    const result = await chain.confirm(b.publication, hash ?? b.receipt?.hash);
    if (
      b.receipt?.state === 'finalized' &&
      (result.state !== 'finalized' || result.hash !== b.receipt.hash)
    )
      throw new CloudError('CHAIN_RECHECK_REQUIRED', 503);
    await db
      .prepare(
        "UPDATE module_boxes SET receipt_state=?,tx_hash=COALESCE(?,tx_hash),verified_block=?,verified_block_hash=?,state=CASE WHEN ?='finalized' THEN 'published' ELSE state END WHERE id=? AND receipt_state!='finalized' AND (tx_hash IS NULL OR ?!='unknown')",
      )
      .bind(
        result.state,
        result.hash ?? null,
        result.block ?? null,
        result.blockHash ?? null,
        result.state,
        b.id,
        result.state,
      )
      .run();
    return c.json({ data: await owned(db, b.id, actor), requestId: c.get('requestId') });
  });
  app.get('/public/modules/:id', async (c) => {
    const parsed = uuid.safeParse(c.req.param('id'));
    if (!parsed.success) throw new CloudError('NOT_FOUND', 404);
    const r = await c
      .get('db')
      .prepare("SELECT * FROM module_boxes WHERE public_id=? AND state='published'")
      .bind(parsed.data)
      .first<Row>();
    if (!r) throw new CloudError('NOT_FOUND_OR_NOT_PUBLISHED', 404);
    const b = fromRow(r),
      i = b.publication;
    if (!i || b.receipt?.state !== 'finalized' || !b.receipt.hash)
      throw new CloudError('CHAIN_RECHECK_REQUIRED', 503);
    const config = readConfig(c.env);
    registered(config, i.publication.deployment);
    if ((await chain.confirm(i, b.receipt.hash)).state !== 'finalized')
      throw new CloudError('CHAIN_RECHECK_REQUIRED', 503);
    return c.json({
      data: {
        publication: i.publication,
        transactionHash: b.receipt.hash,
        snapshot: await chain.snapshot(i.publication, i.actor),
        paymentsEnabled: config.NETWORK_WRITES_ENABLED,
      },
      requestId: c.get('requestId'),
    });
  });
}
