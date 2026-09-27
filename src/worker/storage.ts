import { z } from 'zod';
import { readConfig } from '../shared/config';
import type { Env } from './env';

export async function requireStorage(env: Env): Promise<D1Database> {
  const config = readConfig(env);
  if (!config.STORAGE_ENABLED || !env.DB || !env.FILES || !env.JOBS)
    throw new Error('Storage unavailable');
  const marker = await env.DB.prepare(
    'SELECT namespace FROM environment_guard WHERE id = 1',
  ).first<{ namespace: string }>();
  if (marker?.namespace !== config.STORAGE_NAMESPACE) throw new Error('Storage namespace mismatch');
  return env.DB;
}
/** One conditional statement wins; concurrent attempts cannot both consume the nonce. */
export async function consumeNonce(db: D1Database, hash: string, now: number): Promise<boolean> {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid time');
  const row = await db
    .prepare(
      'UPDATE auth_nonces SET consumed_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING nonce_hash',
    )
    .bind(now, hash, now)
    .first();
  return row !== null;
}
const idSchema = z.string().uuid();
/** Internal primitive only: authorization is enforced here, not by an unguessable URL. */
export async function readPrivateAttachment(
  env: Env,
  actor: string,
  attachmentId: string,
): Promise<R2ObjectBody> {
  idSchema.parse(attachmentId);
  const db = await requireStorage(env);
  const row = await db
    .prepare('SELECT object_key FROM attachments WHERE id = ? AND owner_wallet = ?')
    .bind(attachmentId, actor.toLowerCase())
    .first<{ object_key: string }>();
  if (!row) throw new Error('Attachment unavailable');
  if (!row.object_key.startsWith(`${env.STORAGE_NAMESPACE}/`))
    throw new Error('Storage namespace mismatch');
  const object = await env.FILES!.get(row.object_key);
  if (!object) throw new Error('Attachment unavailable');
  return object;
}
