import { addressSchema } from '../cloud/model';
import { parseAmount } from '../amount';
import { MAX_UINT256 } from './model';
export function parseRewardList(raw: string) {
  if (new TextEncoder().encode(raw).byteLength > 20000) throw Error('LIST_TOO_LARGE');
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (/^address[,\t]amount(?:_ausd)?$/i.test(lines[0] ?? '')) lines.shift();
  if (lines.length < 1 || lines.length > 100) throw Error('LIST_COUNT');
  const rows = lines.map((line, index) => {
    try {
      const values = line.split(/[,\t]/).map((v) => v.trim());
      if (values.length !== 2) throw Error();
      const address = addressSchema.parse(values[0]),
        amount = parseAmount(values[1]!, 6);
      if (amount <= 0n || amount > MAX_UINT256) throw Error();
      return { address, amount: amount.toString() };
    } catch {
      throw Error(`Invalid reward row ${index + 1} / 第${index + 1}行奖励无效`);
    }
  });
  if (new Set(rows.map((r) => r.address.toLowerCase())).size !== rows.length)
    throw Error('Duplicate reward address / 奖励地址重复');
  if (rows.reduce((sum, r) => sum + BigInt(r.amount), 0n) > MAX_UINT256)
    throw Error('TOTAL_TOO_LARGE');
  return rows.sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
}
