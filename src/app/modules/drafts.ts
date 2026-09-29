import { z } from 'zod';
import { moduleDataSchema } from '../../shared/modules/model';
import type { ModuleData } from '../../shared/modules/model';
const schema = z.strictObject({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  data: moduleDataSchema,
});
export type ModuleDraft = z.infer<typeof schema>;
export const draftKey = (environment: string) =>
  `monadbox.module-drafts.mon-v2:${environment}:10143`;
export function readDrafts(key: string): ModuleDraft[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    if (raw.length > 1_000_000) throw Error();
    const rows = schema.array().max(40).parse(JSON.parse(raw));
    if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error();
    return rows;
  } catch {
    throw Error(
      'Draft storage is damaged. Export the existing browser data before recovery; it has not been cleared. / 草稿存储损坏，原数据已保留，请先备份。',
    );
  }
}
export async function saveDraft(
  key: string,
  data: ModuleData,
  original?: ModuleDraft,
): Promise<ModuleDraft> {
  if (!navigator.locks) throw Error('Browser lacks safe draft locking / 浏览器不支持安全草稿锁');
  return navigator.locks.request(key, () => {
    const rows = readDrafts(key),
      index = rows.findIndex((r) => r.id === original?.id),
      current = rows[index];
    if (original && (!current || current.revision !== original.revision))
      throw Error(
        'Draft changed in another tab; reload before saving / 草稿已在其他标签修改，请刷新',
      );
    if (!original && rows.length >= 40) throw Error('Draft limit: 40 / 草稿上限40条');
    const row = schema.parse({
      id: original?.id ?? crypto.randomUUID(),
      revision: (original?.revision ?? 0) + 1,
      updatedAt: Date.now(),
      data,
    });
    if (original) rows[index] = row;
    else rows.push(row);
    localStorage.setItem(key, JSON.stringify(rows));
    return row;
  });
}
export async function deleteDraft(key: string, original: ModuleDraft) {
  if (!navigator.locks) throw Error('Browser lacks safe draft locking / 浏览器不支持安全草稿锁');
  await navigator.locks.request(key, () => {
    const rows = readDrafts(key),
      row = rows.find((r) => r.id === original.id);
    if (!row || row.revision !== original.revision) throw Error('Draft changed / 草稿已更新');
    localStorage.setItem(key, JSON.stringify(rows.filter((r) => r.id !== original.id)));
  });
}
export function exportModule(data: ModuleData) {
  return JSON.stringify(
    { schema: 2, asset: 'MON', decimals: 18, chainId: 10143, data: moduleDataSchema.parse(data) },
    null,
    2,
  );
}
export function importModule(raw: string) {
  if (raw.length > 16000) throw Error('Import too large / 导入内容过大');
  return z
    .strictObject({
      schema: z.literal(2),
      asset: z.literal('MON'),
      decimals: z.literal(18),
      chainId: z.literal(10143),
      data: moduleDataSchema,
    })
    .parse(JSON.parse(raw)).data;
}
