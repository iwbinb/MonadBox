import { z } from 'zod';
import { readConfig } from '../shared/config';
import { requireStorage } from './storage';
import type { Env } from './env';

const jobSchema = z
  .object({
    type: z.literal('foundation.probe'),
    key: z.string().uuid(),
    namespace: z.string(),
    message: z.string().max(200),
  })
  .strict();
export type FoundationJob = z.infer<typeof jobSchema>;
/** A diagnostic job only, never a payment, signature, or fund-release action. */
export async function processJob(env: Env, body: unknown): Promise<void> {
  const config = readConfig(env);
  if (!config.BACKGROUND_ENABLED) throw new Error('Background processing disabled');
  const job = jobSchema.parse(body);
  if (job.namespace !== config.STORAGE_NAMESPACE) throw new Error('Job namespace mismatch');
  const db = await requireStorage(env);
  const fingerprint = JSON.stringify(job);
  // The unique key makes a duplicate harmless. A reused key with different content is rejected.
  await db
    .prepare(
      'INSERT INTO job_receipts (job_key, fingerprint, processed_at) VALUES (?, ?, ?) ON CONFLICT(job_key) DO NOTHING',
    )
    .bind(job.key, fingerprint, Math.floor(Date.now() / 1000))
    .run();
  const receipt = await db
    .prepare('SELECT fingerprint FROM job_receipts WHERE job_key = ?')
    .bind(job.key)
    .first<{ fingerprint: string }>();
  if (receipt?.fingerprint !== fingerprint) throw new Error('Conflicting job key');
}
export async function handleQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processJob(env, message.body);
      message.ack();
    } catch {
      // Configure max_retries and a dead-letter queue before enabling a remote consumer.
      // No body or signature is written to logs.
      console.warn(
        JSON.stringify({
          event: 'foundation_job_retry',
          messageId: message.id,
          attempt: message.attempts,
        }),
      );
      message.retry({ delaySeconds: Math.min(300, 2 ** Math.min(message.attempts, 8)) });
    }
  }
}
export async function handleScheduled(env: Env): Promise<void> {
  const config = readConfig(env);
  if (!config.BACKGROUND_ENABLED) return;
  const db = await requireStorage(env);
  // Housekeeping only. There is no chain scanner or funding action in M0-B.
  await db
    .prepare('DELETE FROM auth_nonces WHERE expires_at <= ?')
    .bind(Math.floor(Date.now() / 1000))
    .run();
}
