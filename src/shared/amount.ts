const MAX_UINT256 = (1n << 256n) - 1n;
function checkDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error('Invalid decimals');
}
/** Convert human input to integer smallest units; never accept floats or exponent notation. */
export function parseAmount(input: string, decimals: number): bigint {
  checkDecimals(decimals);
  if (input.length > 116 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(input))
    throw new Error('Invalid amount');
  const [whole = '', fraction = ''] = input.split('.');
  if (fraction.length > decimals) throw new Error('Too many decimal places');
  const amount =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount <= 0n || amount > MAX_UINT256) throw new Error('Amount outside uint256 range');
  return amount;
}
export function formatAmount(amount: bigint, decimals: number): string {
  checkDecimals(decimals);
  if (amount < 0n || amount > MAX_UINT256) throw new Error('Amount outside uint256 range');
  if (decimals === 0) return amount.toString();
  const digits = amount.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : '');
}
