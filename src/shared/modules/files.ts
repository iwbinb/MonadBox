import { z } from 'zod';
export const FILE_LIMIT = 10 * 1024 * 1024;
export const fileMetaSchema = z
  .strictObject({
    name: z
      .string()
      .min(1)
      .max(120)
      .refine(
        (n) =>
          ![...n].some(
            (c) => c === '/' || c === '\\' || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
          ),
      )
      .refine((n) => !n.startsWith('.') && n === n.trim()),
    mime: z.enum(['text/plain', 'image/png', 'image/jpeg']),
    bytes: z.number().int().min(1).max(FILE_LIMIT),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    stageIndex: z.number().int().min(0).max(9).default(0),
  })
  .refine(
    (m) =>
      m.mime === 'text/plain'
        ? /\.txt$/i.test(m.name)
        : m.mime === 'image/png'
          ? /\.png$/i.test(m.name)
          : /\.jpe?g$/i.test(m.name),
    'Extension does not match the allowed file type',
  );
export type FileMeta = z.infer<typeof fileMetaSchema>;
export interface PrivateFile extends FileMeta {
  id: string;
  uploader: string;
  createdAt: number;
  expiresAt: number;
  state: 'reserved' | 'ready';
}
export async function fileDigest(data: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function validFileContent(data: ArrayBuffer, mime: FileMeta['mime']): boolean {
  const b = new Uint8Array(data);
  if (mime === 'text/plain') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b);
      return (
        !b.some((v) => (v < 32 && ![9, 10, 13].includes(v)) || v === 127) &&
        !/<\s*(?:!doctype|html|script|svg|iframe|object)\b/i.test(text)
      );
    } catch {
      return false;
    }
  }
  if (mime === 'image/png')
    return (
      b.length >= 45 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v) &&
      new TextDecoder().decode(b.slice(12, 16)) === 'IHDR' &&
      [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130].every((v, i) => b[b.length - 12 + i] === v)
    );
  return (
    b.length >= 4 &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b[b.length - 2] === 255 &&
    b[b.length - 1] === 217
  );
}
