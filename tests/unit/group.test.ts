import { describe, it, expect } from 'vitest';
import {
  newGroupFields,
  validateGroupFields,
  groupDataSchema,
  parseLocalDate,
  fieldsFromData,
  draftKey,
  readDrafts,
  saveDraft,
  deleteDraft,
  exportDraft,
  importDraft,
  GROUP_ASSET,
} from '../../src/shared/group/draft';
import { groupId, groupMetadata, groupTerms, groupTermsHash } from '../../src/shared/group/terms';
import type { GroupData, GroupField } from '../../src/shared/group/draft';
const NOW = Date.UTC(2026, 8, 27, 0, 0);
const ADDRESS = '0x0000000000000000000000000000000000000011';
const MODULE = '0x0000000000000000000000000000000000000022';
const SALT = `0x${'11'.repeat(32)}` as const;
const base = () => ({
  ...newGroupFields(NOW),
  title: 'Weekend workshop',
  description: 'Public test terms',
  beneficiary: ADDRESS,
});
const data = (): GroupData => validateGroupFields(base(), NOW).data!;
class Memory {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}
const key = draftKey('test');
describe('Group input and exact money', () => {
  it('normalizes to integer units and round-trips dates', () => {
    const d = data();
    expect(d.unitPrice).toBe('100000000000000000');
    expect(fieldsFromData(d)).toEqual(base());
  });
  it.each([
    '0',
    '-1',
    '1e6',
    '0.0000000000000000001',
    '1,000',
    'Infinity',
    'NaN',
    ' 2',
    '1.',
    '01',
    '1'.repeat(117),
  ])('rejects ambiguous amount %s', (amount) =>
    expect(validateGroupFields({ ...base(), amount }, NOW).errors.amount).toBeDefined(),
  );
  it('accepts one smallest unit and exact 18 decimals', () =>
    expect(
      validateGroupFields({ ...base(), amount: '0.000000000000000001' }, NOW).data?.unitPrice,
    ).toBe('1'));
  it.each([
    ['minimum', '1'],
    ['minimum', '2.1'],
    ['minimum', '201'],
    ['minimum', '2e1'],
    ['capacity', '2'],
    ['capacity', '-3'],
    ['capacity', '0'],
  ] as const)('rejects invalid %s=%s', (field, value) =>
    expect(validateGroupFields({ ...base(), [field]: value }, NOW).errors[field]).toBeDefined(),
  );
  it('rejects price times capacity overflow', () =>
    expect(
      validateGroupFields({ ...base(), amount: ((1n << 256n) - 1n).toString() }, NOW).errors.amount,
    ).toBeDefined());
  it.each(['', '0x0000000000000000000000000000000000000000', '0x123', 'somebody.eth'])(
    'rejects invalid beneficiary %s',
    (beneficiary) =>
      expect(validateGroupFields({ ...base(), beneficiary }, NOW).errors.beneficiary).toBeDefined(),
  );
  it('rejects empty and oversized title/description', () => {
    expect(validateGroupFields({ ...base(), title: '   ' }, NOW).errors.title).toBeDefined();
    expect(
      validateGroupFields({ ...base(), title: 'x'.repeat(81), description: 'x'.repeat(2001) }, NOW)
        .errors,
    ).toMatchObject({ title: expect.any(Object), description: expect.any(Object) });
  });
  it.each([
    '2026-02-30T12:00',
    'not a date',
    '2026-09-27T24:01',
    '2026-09-27T01:01:01',
    '2026-09-27T01:01Z',
  ])('rejects normalized or ambiguous date %s', (s) => expect(parseLocalDate(s)).toBeNull());
  it('rejects deadline equality, premature settlement and elapsed start', () => {
    const f = base();
    expect(
      validateGroupFields({ ...f, fundingDeadline: f.startsAt }, NOW).errors.fundingDeadline,
    ).toBeDefined();
    expect(
      validateGroupFields({ ...f, settleNotBefore: f.startsAt }, NOW).errors.settleNotBefore,
    ).toBeDefined();
    expect(validateGroupFields(f, NOW + 3600_000).errors.startsAt).toBeDefined();
  });
  it('accepts settlement at deadline', () => {
    const f = base();
    expect(
      validateGroupFields({ ...f, settleNotBefore: f.fundingDeadline }, NOW).data,
    ).toBeDefined();
  });
  it.each(['startsAt', 'fundingDeadline', 'settleNotBefore'] as GroupField[])(
    'rejects missing %s',
    (field) =>
      expect(validateGroupFields({ ...base(), [field]: '' }, NOW).errors[field]).toBeDefined(),
  );
  it('malformed persisted amounts or zero capacity fail schema rather than arithmetic', () => {
    for (const patch of [
      { unitPrice: 'bad' },
      { unitPrice: '0' },
      { capacity: 0 },
      { capacity: 2.5 },
    ])
      expect(groupDataSchema.safeParse({ ...data(), ...patch }).success).toBe(false);
  });
});
describe('Local draft persistence is not an order or proof of payment', () => {
  it('saves, reads, edits and deletes one draft', () => {
    const s = new Memory(),
      first = saveDraft(s, key, data());
    expect(first.revision).toBe(1);
    expect(readDrafts(s, key)).toHaveLength(1);
    const second = saveDraft(s, key, { ...first.data, title: 'Edited' }, first);
    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(2);
    deleteDraft(s, key, second);
    expect(readDrafts(s, key)).toEqual([]);
  });
  it('refuses stale update and stale delete', () => {
    const s = new Memory(),
      first = saveDraft(s, key, data());
    saveDraft(s, key, { ...first.data, title: 'Other tab' }, first);
    expect(() => saveDraft(s, key, data(), first)).toThrow('CONFLICT');
    expect(() => deleteDraft(s, key, first)).toThrow('CONFLICT');
    expect(readDrafts(s, key)[0]?.data.title).toBe('Other tab');
  });
  it('does not resurrect a deleted draft', () => {
    const s = new Memory(),
      d = saveDraft(s, key, data());
    deleteDraft(s, key, d);
    expect(() => saveDraft(s, key, data(), d)).toThrow('CONFLICT');
  });
  it('separates environment keys and rejects unknown environment', () => {
    const s = new Memory();
    saveDraft(s, draftKey('production'), data());
    expect(readDrafts(s, draftKey('preview'))).toHaveLength(0);
    expect(() => draftKey('untrusted')).toThrow('UNAVAILABLE');
  });
  it('does not replace corrupt data', () => {
    const s = new Memory();
    s.setItem(key, 'not-json');
    expect(() => readDrafts(s, key)).toThrow('CORRUPT');
    expect(() => saveDraft(s, key, data())).toThrow('CORRUPT');
    expect(s.getItem(key)).toBe('not-json');
  });
  it('does not pretend quota failures were saved', () => {
    const s = {
      getItem: () => null,
      setItem: () => {
        throw Error('quota');
      },
    };
    expect(() => saveDraft(s, key, data())).toThrow('UNAVAILABLE');
  });
  it('reports storage read errors', () => {
    expect(() =>
      readDrafts(
        {
          getItem: () => {
            throw Error();
          },
          setItem: () => {},
        },
        key,
      ),
    ).toThrow('UNAVAILABLE');
  });
  it('limits local drafts without deleting old ones', () => {
    const s = new Memory();
    for (let i = 0; i < 40; i++) saveDraft(s, key, data());
    expect(() => saveDraft(s, key, data())).toThrow('LIMIT');
    expect(readDrafts(s, key)).toHaveLength(40);
  });
  it('rejects duplicate stored IDs', () => {
    const s = new Memory(),
      r = saveDraft(s, key, data());
    s.setItem(key, JSON.stringify([r, r]));
    expect(() => readDrafts(s, key)).toThrow('CORRUPT');
  });
  it('round-trips export with exact network and token but no identity or signing data', () => {
    const raw = exportDraft(data());
    expect(importDraft(raw)).toEqual(data());
    expect(JSON.parse(raw)).toMatchObject({ chainId: 10143, asset: GROUP_ASSET });
    expect(raw).not.toContain('privateKey');
    expect(raw).not.toContain('revision');
  });
  it.each([
    { chainId: 143 },
    { version: 1 },
    { asset: ADDRESS },
    { privateKey: 'not-accepted' },
    { format: 'other' },
  ])('rejects hostile import envelope %s', (patch) => {
    const value = { ...JSON.parse(exportDraft(data())), ...patch };
    expect(() => importDraft(JSON.stringify(value))).toThrow('INVALID_IMPORT');
  });
  it('rejects oversized file and unknown fields inside data', () => {
    expect(() => importDraft(' '.repeat(16001))).toThrow('INVALID_IMPORT');
    const value = JSON.parse(exportDraft(data()));
    value.data.payable = true;
    expect(() => importDraft(JSON.stringify(value))).toThrow('INVALID_IMPORT');
  });
  it('allows reading expired drafts but requires updated dates to save edits', () => {
    const s = new Memory(),
      d = saveDraft(s, key, data());
    expect(readDrafts(s, key)).toHaveLength(1);
    expect(validateGroupFields(fieldsFromData(d.data), Date.UTC(2027, 0, 1)).data).toBeUndefined();
  });
});
describe('Fixed encoding domain', () => {
  it('metadata bytes have fixed order independent of input property ordering', () => {
    const d = data();
    expect(groupMetadata(d)).toBe(groupMetadata({ ...d, title: d.title }));
  });
  it('changing metadata or beneficiary changes termsHash', () => {
    expect(groupTermsHash(MODULE, ADDRESS, SALT, data())).not.toBe(
      groupTermsHash(MODULE, ADDRESS, SALT, { ...data(), title: 'Changed' }),
    );
    expect(groupTerms(data()).unitPrice).toBe(100000000000000000n);
  });
  it('box identity is separated by module and creator', () => {
    expect(groupId(MODULE, ADDRESS, SALT)).not.toBe(groupId(ADDRESS, MODULE, SALT));
  });
});
