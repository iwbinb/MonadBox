import { describe, expect, it } from 'vitest';
import { parseAmount, formatAmount } from '../../src/shared/amount';
describe('integer money primitives (not contract tests)', () => {
  it('parses 0.000001 exactly', () => expect(parseAmount('0.000001', 6)).toBe(1n));
  it('parses large values without Number rounding', () =>
    expect(parseAmount('9007199254740993.01', 6)).toBe(9007199254740993010000n));
  it.each([
    '0',
    '-1',
    '1e6',
    ' 1',
    '1 ',
    '+1',
    '1,000',
    '1.',
    '01',
    'NaN',
    'Infinity',
    '.1',
    '1.0000001',
  ])('rejects %s', (input) => expect(() => parseAmount(input, 6)).toThrow());
  it.each([-1, 1.5, 37, NaN])('rejects invalid precision %s', (decimals) =>
    expect(() => parseAmount('1', decimals)).toThrow(),
  );
  it('handles uint256 boundary and rejects overflow', () => {
    const max = (1n << 256n) - 1n;
    expect(parseAmount(max.toString(), 0)).toBe(max);
    expect(() => parseAmount((max + 1n).toString(), 0)).toThrow();
  });
  it('formats zero and strips trailing fractional zeros', () => {
    expect(formatAmount(0n, 6)).toBe('0');
    expect(formatAmount(12340000n, 6)).toBe('12.34');
    expect(formatAmount(1n, 6)).toBe('0.000001');
  });
  it('round-trips 5000 deterministic samples', () => {
    let seed = 20260927n;
    for (let i = 0; i < 5000; i++) {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 120n) - 1n);
      const amount = seed + 1n;
      const decimals = i % 19;
      expect(parseAmount(formatAmount(amount, decimals), decimals)).toBe(amount);
    }
  });
});
