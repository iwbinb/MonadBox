import { z } from 'zod';
import type { Hono, Context } from 'hono';
import type { AppEnv } from '../cloud/router';
import { CloudError, limited } from '../cloud/router';
import { readConfig } from '../../shared/config';
import { same } from '../../shared/cloud/chain';
import {
  fileMetaSchema,
  fileDigest,
  validFileContent,
  FILE_LIMIT,
} from '../../shared/modules/files';
import type { PrivateFile } from '../../shared/modules/files';
import type { ModuleChain } from '../../shared/modules/chain';
import { fromRow, registered } from './router';
import type { Row } from './router';
const now = () => Math.floor(Date.now() / 1000),
  uuid = z.string().uuid();
export async function readFileBody(request: Request, expected: number): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new CloudError('FILE_SIZE', 413);
  const limit = Math.min(expected, FILE_LIMIT),
    chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new CloudError('FILE_SIZE', 413);
    }
    chunks.push(value);
  }
  if (size !== expected) throw new CloudError('FILE_SIZE', 413);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}
interface FileRow {
  id: string;
  box_id: string;
  uploader: string;
  name: string;
  mime: PrivateFile['mime'];
  bytes: number;
  sha256: string;
  stage_index: number;
  created_at: number;
  expires_at: number;
  state: 'reserved' | 'ready';
  fingerprint: string;
}
const view = (r: FileRow): PrivateFile => ({
  id: r.id,
  uploader: r.uploader,
  name: r.name,
  mime: r.mime,
  bytes: r.bytes,
  sha256: r.sha256,
  stageIndex: r.stage_index,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  state: r.state,
});
export function isFileUpload(method: string, path: string) {
  return (
    method === 'PUT' && /^(?:\/api\/v1)?\/modules\/[a-f0-9-]{36}\/files\/[a-f0-9-]{36}$/.test(path)
  );
}
async function context(c: Context<AppEnv>, chain: ModuleChain) {
  const config = readConfig(c.env),
    db = c.get('db');
  if (!config.ATTACHMENTS_ENABLED || !c.env.FILES) throw new CloudError('FILES_UNAVAILABLE', 503);
  const [schema, guard] = await Promise.all([
    db.prepare('SELECT version FROM attachment_schema WHERE id=1').first<{ version: number }>(),
    c.env.FILES.head('.monadbox-environment'),
  ]);
  if (schema?.version !== 1 || guard?.customMetadata?.namespace !== config.STORAGE_NAMESPACE)
    throw new CloudError('FILES_UNAVAILABLE', 503);
  const r = await db
    .prepare("SELECT * FROM module_boxes WHERE id=? AND state='published'")
    .bind(uuid.parse(c.req.param('id')))
    .first<Row>();
  if (!r) throw new CloudError('NOT_FOUND', 404);
  const box = fromRow(r),
    i = box.publication,
    actor = c.get('session').address;
  if (
    !i ||
    (i.publication.data.tool !== 'deliver' && i.publication.data.tool !== 'milestones') ||
    ![i.publication.data.buyer, i.publication.data.seller].some((a) => same(a, actor))
  )
    throw new CloudError('NOT_FOUND', 404);
  registered(config, i.publication.deployment);
  if (
    box.receipt?.state !== 'finalized' ||
    !box.receipt.hash ||
    (await chain.confirm(i, box.receipt.hash)).state !== 'finalized'
  )
    throw new CloudError('CHAIN_RECHECK_REQUIRED', 503);
  const snapshot = await chain.snapshot(i.publication, actor);
  const settledAt = snapshot.settledAt ?? 0;
  if (settledAt > 0 && now() >= settledAt + 90 * 86400)
    throw new CloudError('FILE_RETENTION_ENDED', 404);
  return {
    db,
    files: c.env.FILES,
    box,
    actor: actor.toLowerCase(),
    namespace: config.STORAGE_NAMESPACE,
    snapshot,
  };
}
const objectKey = (namespace: string, r: FileRow) =>
  `${namespace}/deliveries/${r.box_id}/${r.stage_index}/${r.id}`;
export function mountFileRoutes(app: Hono<AppEnv>, chain: ModuleChain) {
  app.get('/modules/:id/files', async (c) => {
    const x = await context(c, chain),
      rows = await x.db
        .prepare(
          "SELECT * FROM delivery_files WHERE box_id=? AND (state='ready' OR (uploader=? AND expires_at>?)) ORDER BY created_at,id LIMIT 50",
        )
        .bind(x.box.id, x.actor, now())
        .all<FileRow>();
    return c.json({ data: rows.results.map(view), requestId: c.get('requestId') });
  });
  app.post('/modules/:id/files', async (c) => {
    const x = await context(c, chain),
      meta = fileMetaSchema.parse(await c.req.json()),
      key = z
        .string()
        .regex(/^[a-zA-Z0-9_-]{16,100}$/)
        .parse(c.req.header('Idempotency-Key'));
    if (
      meta.stageIndex !== (x.snapshot.currentStage ?? 0) ||
      !['FUNDED', 'SUBMITTED', 'DISPUTED'].includes(x.snapshot.state)
    )
      throw new CloudError('FILE_UPLOAD_CLOSED', 409);
    await limited(x.db, `files:${x.actor}`, 20, 600);
    const fingerprint = await fileDigest(
        new TextEncoder().encode(JSON.stringify(meta)).buffer as ArrayBuffer,
      ),
      t = now();
    await x.db
      .prepare(
        "INSERT INTO delivery_files(id,box_id,uploader,name,mime,bytes,sha256,stage_index,created_at,expires_at,request_key,fingerprint) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM delivery_files WHERE box_id=? AND stage_index=? AND (state='ready' OR expires_at>?))<5 ON CONFLICT(box_id,uploader,request_key) DO NOTHING",
      )
      .bind(
        crypto.randomUUID(),
        x.box.id,
        x.actor,
        meta.name,
        meta.mime,
        meta.bytes,
        meta.sha256,
        meta.stageIndex,
        t,
        t + 600,
        key,
        fingerprint,
        x.box.id,
        meta.stageIndex,
        t,
      )
      .run();
    const r = await x.db
      .prepare('SELECT * FROM delivery_files WHERE box_id=? AND uploader=? AND request_key=?')
      .bind(x.box.id, x.actor, key)
      .first<FileRow>();
    if (!r) throw new CloudError('FILE_LIMIT', 429);
    if (r.fingerprint !== fingerprint) throw new CloudError('IDEMPOTENCY_CONFLICT', 409);
    if (r.state === 'reserved' && r.expires_at <= t) throw new CloudError('UPLOAD_EXPIRED', 409);
    return c.json({ data: view(r), requestId: c.get('requestId') });
  });
  app.put('/modules/:id/files/:fileId', async (c) => {
    const x = await context(c, chain),
      r = await x.db
        .prepare('SELECT * FROM delivery_files WHERE id=? AND box_id=? AND uploader=?')
        .bind(uuid.parse(c.req.param('fileId')), x.box.id, x.actor)
        .first<FileRow>();
    if (!r) throw new CloudError('NOT_FOUND', 404);
    if (c.req.header('Content-Type') !== r.mime) throw new CloudError('FILE_TYPE', 400);
    if (
      r.state === 'reserved' &&
      (r.expires_at <= now() ||
        r.stage_index !== (x.snapshot.currentStage ?? 0) ||
        !['FUNDED', 'SUBMITTED', 'DISPUTED'].includes(x.snapshot.state))
    )
      throw new CloudError('UPLOAD_EXPIRED', 409);
    const body = await readFileBody(c.req.raw, r.bytes);
    if (body.byteLength !== r.bytes || body.byteLength > FILE_LIMIT)
      throw new CloudError('FILE_SIZE', 413);
    if ((await fileDigest(body)) !== r.sha256 || !validFileContent(body, r.mime))
      throw new CloudError('FILE_CONTENT', 400);
    if (r.state === 'ready') return c.json({ data: view(r), requestId: c.get('requestId') });
    // Object keys and expected contents are immutable; concurrent retries can write only these same bytes.
    await x.files.put(objectKey(x.namespace, r), body, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { sha256: r.sha256, boxId: r.box_id, namespace: x.namespace },
    });
    const updated = await x.db
      .prepare(
        "UPDATE delivery_files SET state='ready' WHERE id=? AND state='reserved' AND expires_at>? RETURNING *",
      )
      .bind(r.id, now())
      .first<FileRow>();
    if (!updated) {
      const current = await x.db
        .prepare("SELECT * FROM delivery_files WHERE id=? AND state='ready'")
        .bind(r.id)
        .first<FileRow>();
      if (current) return c.json({ data: view(current), requestId: c.get('requestId') });
      throw new CloudError('UPLOAD_EXPIRED', 409);
    }
    return c.json({ data: view(updated), requestId: c.get('requestId') });
  });
  app.get('/modules/:id/files/:fileId', async (c) => {
    const x = await context(c, chain),
      r = await x.db
        .prepare("SELECT * FROM delivery_files WHERE id=? AND box_id=? AND state='ready'")
        .bind(uuid.parse(c.req.param('fileId')), x.box.id)
        .first<FileRow>();
    if (!r) throw new CloudError('NOT_FOUND', 404);
    const object = await x.files.get(objectKey(x.namespace, r));
    if (
      !object ||
      object.size !== r.bytes ||
      object.customMetadata?.sha256 !== r.sha256 ||
      object.customMetadata?.boxId !== r.box_id ||
      object.customMetadata?.namespace !== x.namespace
    )
      throw new CloudError('FILE_INTEGRITY_ERROR', 503);
    // Files are bounded; verify stored bytes before returning them, including storage corruption.
    const body = await object.arrayBuffer();
    if ((await fileDigest(body)) !== r.sha256) throw new CloudError('FILE_INTEGRITY_ERROR', 503);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(r.name)}`,
        'Content-Length': String(r.bytes),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });
}
