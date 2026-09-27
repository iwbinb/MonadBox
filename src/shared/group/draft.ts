import { z } from 'zod';
import { isAddress, getAddress } from 'viem';
import { parseAmount, formatAmount } from '../amount';

export const GROUP_ASSET = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' as const;
export const GROUP_CHAIN = 10143 as const;
const MAX_UINT256 = (1n << 256n) - 1n;
const time = z.number().int().min(1).max(4_102_444_799);
const address = z.string().refine((v) => isAddress(v) && !/^0x0{40}$/i.test(v));
export const groupDataSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(2000),
    unitPrice: z
      .string()
      .regex(/^[1-9]\d{0,77}$/)
      .refine((v) => /^[1-9]\d{0,77}$/.test(v) && BigInt(v) <= MAX_UINT256),
    minimum: z.number().int().min(2).max(200),
    capacity: z.number().int().min(2).max(200),
    beneficiary: address,
    startsAt: time,
    fundingDeadline: time,
    settleNotBefore: time,
  })
  .superRefine((v, ctx) => {
    if (v.minimum > v.capacity)
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'capacity' });
    if (v.startsAt >= v.fundingDeadline)
      ctx.addIssue({ code: 'custom', path: ['fundingDeadline'], message: 'deadline' });
    if (v.fundingDeadline > v.settleNotBefore)
      ctx.addIssue({ code: 'custom', path: ['settleNotBefore'], message: 'settle' });
    if (
      /^[1-9]\d{0,77}$/.test(v.unitPrice) &&
      Number.isSafeInteger(v.capacity) &&
      v.capacity > 0 &&
      BigInt(v.unitPrice) > MAX_UINT256 / BigInt(v.capacity)
    )
      ctx.addIssue({ code: 'custom', path: ['unitPrice'], message: 'overflow' });
  });
export type GroupData = z.infer<typeof groupDataSchema>;
export type GroupFields = Record<
  | 'title'
  | 'description'
  | 'amount'
  | 'minimum'
  | 'capacity'
  | 'beneficiary'
  | 'startsAt'
  | 'fundingDeadline'
  | 'settleNotBefore',
  string
>;
export type GroupField = keyof GroupFields;
export type GroupErrors = Partial<Record<GroupField, { en: string; zh: string }>>;

export function localDateInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Round-trip local components to reject nonexistent dates/DST gaps instead of normalizing them. */
export function parseLocalDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || localDateInput(ms / 1000) !== value) return null;
  const seconds = Math.floor(ms / 1000);
  return seconds > 0 && seconds <= 4_102_444_799 ? seconds : null;
}
export function newGroupFields(now = Date.now()): GroupFields {
  const seconds = Math.floor(now / 60_000) * 60;
  return {
    title: '',
    description: '',
    amount: '30',
    minimum: '3',
    capacity: '20',
    beneficiary: '',
    startsAt: localDateInput(seconds + 1800),
    fundingDeadline: localDateInput(seconds + 7 * 86400),
    settleNotBefore: localDateInput(seconds + 8 * 86400),
  };
}
export function fieldsFromData(d: GroupData): GroupFields {
  return {
    title: d.title,
    description: d.description,
    amount: formatAmount(BigInt(d.unitPrice), 6),
    minimum: String(d.minimum),
    capacity: String(d.capacity),
    beneficiary: d.beneficiary,
    startsAt: localDateInput(d.startsAt),
    fundingDeadline: localDateInput(d.fundingDeadline),
    settleNotBefore: localDateInput(d.settleNotBefore),
  };
}
export function validateGroupFields(
  f: GroupFields,
  now = Date.now(),
): { data?: GroupData; errors: GroupErrors } {
  const errors: GroupErrors = {};
  const issue = (key: GroupField, en: string, zh: string) => {
    errors[key] = { en, zh };
  };
  if (!f.title.trim() || f.title.trim().length > 80)
    issue('title', 'Enter a title of 1–80 characters.', '请输入 1–80 个字符的标题。');
  if (f.description.trim().length > 2000)
    issue('description', 'Use no more than 2,000 characters.', '说明最多 2,000 个字符。');
  let price = 0n;
  try {
    price = parseAmount(f.amount, 6);
  } catch {
    issue(
      'amount',
      'Enter a positive amount with at most 6 decimals; no exponent notation.',
      '请输入正数，最多 6 位小数，不支持科学记数法。',
    );
  }
  const integer = (key: 'minimum' | 'capacity') => {
    const n = Number(f[key]);
    if (!/^[1-9]\d{0,2}$/.test(f[key]) || n < 2 || n > 200) {
      issue(key, 'Enter a whole number from 2 to 200.', '请输入 2–200 的整数。');
      return 0;
    }
    return n;
  };
  const minimum = integer('minimum'),
    capacity = integer('capacity');
  if (capacity && minimum > capacity)
    issue('capacity', 'Capacity cannot be smaller than the target.', '人数上限不能小于成团人数。');
  if (capacity && price > MAX_UINT256 / BigInt(capacity))
    issue(
      'amount',
      'The maximum collection exceeds the supported amount.',
      '最大收款金额超出支持范围。',
    );
  let beneficiary = f.beneficiary.trim();
  if (!isAddress(beneficiary) || /^0x0{40}$/i.test(beneficiary))
    issue(
      'beneficiary',
      'Enter a valid, non-zero EVM address; verify every character.',
      '请输入有效的非零 EVM 地址，并逐字核对。',
    );
  else beneficiary = getAddress(beneficiary);
  const startsAt = parseLocalDate(f.startsAt),
    fundingDeadline = parseLocalDate(f.fundingDeadline),
    settleNotBefore = parseLocalDate(f.settleNotBefore);
  if (startsAt === null || startsAt <= Math.floor(now / 1000))
    issue(
      'startsAt',
      'Choose a future start time in your local timezone.',
      '请选择当地时区的未来开始时间。',
    );
  if (fundingDeadline === null || (startsAt !== null && fundingDeadline <= startsAt))
    issue(
      'fundingDeadline',
      'Collection must end after it starts.',
      '募集截止时间必须晚于开始时间。',
    );
  if (settleNotBefore === null || (fundingDeadline !== null && settleNotBefore < fundingDeadline))
    issue(
      'settleNotBefore',
      'Settlement cannot precede the collection deadline.',
      '最早结算时间不能早于募集截止时间。',
    );
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    data: groupDataSchema.parse({
      title: f.title.trim(),
      description: f.description.trim(),
      unitPrice: price.toString(),
      minimum,
      capacity,
      beneficiary,
      startsAt,
      fundingDeadline,
      settleNotBefore,
    }),
  };
}
const recordSchema = z.strictObject({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  savedAt: z.number().int().nonnegative(),
  data: groupDataSchema,
});
export type GroupDraft = z.infer<typeof recordSchema>;
const recordsSchema = z
  .array(recordSchema)
  .max(40)
  .refine((v) => new Set(v.map((r) => r.id)).size === v.length);
const exportSchema = z.strictObject({
  format: z.literal('monadbox.group-draft'),
  version: z.literal(1),
  chainId: z.literal(GROUP_CHAIN),
  asset: z.literal(GROUP_ASSET),
  data: groupDataSchema,
});
type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export type DraftErrorCode = 'UNAVAILABLE' | 'CORRUPT' | 'CONFLICT' | 'LIMIT' | 'INVALID_IMPORT';
export class DraftError extends Error {
  constructor(public code: DraftErrorCode) {
    super(code);
  }
}
export function draftKey(environment: string): string {
  if (!['local', 'test', 'preview', 'production'].includes(environment))
    throw new DraftError('UNAVAILABLE');
  return `monadbox.group-drafts.v1:${environment}:10143`;
}
export function readDrafts(store: Store, key: string): GroupDraft[] {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    throw new DraftError('UNAVAILABLE');
  }
  if (raw === null) return [];
  if (raw.length > 500_000) throw new DraftError('CORRUPT');
  try {
    return recordsSchema.parse(JSON.parse(raw));
  } catch {
    throw new DraftError('CORRUPT');
  }
}
function writeDrafts(store: Store, key: string, records: GroupDraft[]): void {
  try {
    store.setItem(key, JSON.stringify(recordsSchema.parse(records)));
  } catch {
    throw new DraftError('UNAVAILABLE');
  }
}
/** UI serializes mutations with Web Locks. Revision checks prevent stale editors overwriting newer drafts. */
export function saveDraft(
  store: Store,
  key: string,
  data: GroupData,
  previous?: Pick<GroupDraft, 'id' | 'revision'>,
): GroupDraft {
  const records = readDrafts(store, key);
  const old = previous ? records.find((r) => r.id === previous.id) : undefined;
  if (previous && (!old || old.revision !== previous.revision)) throw new DraftError('CONFLICT');
  if (!previous && records.length >= 40) throw new DraftError('LIMIT');
  const record = recordSchema.parse({
    id: previous?.id ?? crypto.randomUUID(),
    revision: (old?.revision ?? 0) + 1,
    savedAt: Date.now(),
    data,
  });
  writeDrafts(store, key, [record, ...records.filter((r) => r.id !== record.id)]);
  return record;
}
export function deleteDraft(
  store: Store,
  key: string,
  previous: Pick<GroupDraft, 'id' | 'revision'>,
): void {
  const records = readDrafts(store, key),
    old = records.find((r) => r.id === previous.id);
  if (!old || old.revision !== previous.revision) throw new DraftError('CONFLICT');
  writeDrafts(
    store,
    key,
    records.filter((r) => r.id !== previous.id),
  );
}
export function exportDraft(data: GroupData): string {
  return JSON.stringify(
    exportSchema.parse({
      format: 'monadbox.group-draft',
      version: 1,
      chainId: GROUP_CHAIN,
      asset: GROUP_ASSET,
      data,
    }),
    null,
    2,
  );
}
export function importDraft(raw: string): GroupData {
  try {
    if (new TextEncoder().encode(raw).length > 16_000) throw Error('too large');
    return exportSchema.parse(JSON.parse(raw)).data;
  } catch {
    throw new DraftError('INVALID_IMPORT');
  }
}
