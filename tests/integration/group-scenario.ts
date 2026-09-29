import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, http, toHex } from 'viem';
import type { Address, Abi, Hex } from 'viem';
import { groupId, groupTerms, groupTermsHash } from '../../src/shared/group/terms';
import type { GroupData } from '../../src/shared/group/draft';
// Fixed loopback ONLY. No environment overrides, private keys, public RPC, or funding.
const endpoint = 'http://127.0.0.1:18545';
async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await r.json()) as { result?: unknown; error?: unknown };
  if (!r.ok || body.error) throw Error(JSON.stringify(body.error));
  return body.result;
}
assert.match(String(await rpc('web3_clientVersion')), /anvil/i);
assert.equal(await rpc('eth_chainId'), '0x279f');
const chain = defineChain({
  id: 10143,
  name: 'Local mock Anvil',
  nativeCurrency: { name: 'Test', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [endpoint] } },
});
const client = createPublicClient({ chain, transport: http(endpoint) });
const accounts = (await rpc('eth_accounts')) as Address[];
const [creator, alice, bob, carol, beneficiary] = accounts.slice(3, 8) as [
  Address,
  Address,
  Address,
  Address,
  Address,
];
assert(beneficiary);
const wallet = createWalletClient({ chain, transport: http(endpoint) });
const artifact = JSON.parse(readFileSync('artifacts/group/GroupEscrowV1.json', 'utf8')) as {
  abi: Abi;
  bytecode: Hex;
};
const hashes: Hex[] = [];
async function receipt(hash: Hex) {
  hashes.push(hash);
  const r = await client.waitForTransactionReceipt({ hash, pollingInterval: 20, timeout: 10000 });
  assert.equal(r.status, 'success');
  const tx = await client.getTransaction({ hash });
  // Monad charges the transaction gas limit, including on this Monad-mode local chain.
  // https://docs.monad.xyz/developer-essentials/gas-pricing
  spentGas.set(tx.from, (spentGas.get(tx.from) ?? 0n) + tx.gas * r.effectiveGasPrice);
  return r;
}
const asset = '0x0000000000000000000000000000000000000000';
const baseline = new Map(
  await Promise.all(
    [alice, bob, carol, beneficiary].map(
      async (a) => [a, await client.getBalance({ address: a })] as const,
    ),
  ),
);
const spentGas = new Map<Address, bigint>();
const groupDeploy = await receipt(
  await wallet.deployContract({
    account: creator,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [asset, creator],
  }),
);
const module = groupDeploy.contractAddress!;
async function write(functionName: string, args: readonly unknown[], account: Address = creator) {
  return receipt(
    await wallet.writeContract({
      account,
      address: module,
      abi: artifact.abi,
      functionName,
      args,
      value: functionName === 'contribute' ? 100000n : 0n,
    }),
  );
}
async function read(functionName: string, args: readonly unknown[] = []) {
  return client.readContract({ address: module, abi: artifact.abi, functionName, args });
}
const block = await client.getBlock();
const data: GroupData = {
  title: 'Local Group integration',
  description: 'Not a public deployment',
  unitPrice: '100000',
  minimum: 2,
  capacity: 3,
  beneficiary,
  startsAt: Number(block.timestamp) + 100,
  fundingDeadline: Number(block.timestamp) + 200,
  settleNotBefore: Number(block.timestamp) + 300,
};
const ids: Hex[] = [];
for (let i = 0; i < 3; i++) {
  const salt = toHex(i + 1, { size: 32 });
  await write('createGroup', [groupTerms(data), salt]);
  const id = groupId(module, creator, salt);
  ids.push(id);
  const record = (await read('getGroup', [id])) as { termsHash: Hex };
  assert.equal(record.termsHash, groupTermsHash(module, creator, salt, data, asset));
}
await rpc('evm_setNextBlockTimestamp', [data.startsAt]);
await rpc('evm_mine');
for (const [idx, account] of [
  [0, alice],
  [0, bob],
  [1, carol],
  [2, alice],
  [2, bob],
] as const)
  await write('contribute', [ids[idx]!], account);
await write('leave', [ids[2]!], alice);
await write('cancel', [ids[2]!]);
await write('creditRefund', [ids[2]!, bob], carol);
await write('withdrawFor', [ids[2]!, alice], carol);
await write('withdrawFor', [ids[2]!, bob], carol);
await rpc('evm_setNextBlockTimestamp', [data.fundingDeadline]);
await rpc('evm_mine');
await write('creditRefund', [ids[1]!, carol], alice);
assert.equal(await read('creditForBox', [ids[1]!, carol]), 100_000n);
await write('withdrawFor', [ids[1]!, carol], alice);
await assert.rejects(() =>
  client.simulateContract({
    account: alice,
    address: module,
    abi: artifact.abi,
    functionName: 'creditRefund',
    args: [ids[1]!, carol],
  }),
);
await assert.rejects(() =>
  client.simulateContract({
    account: alice,
    address: module,
    abi: artifact.abi,
    functionName: 'settle',
    args: [ids[0]!],
  }),
);
await rpc('evm_setNextBlockTimestamp', [data.settleNotBefore]);
await rpc('evm_mine');
await write('settle', [ids[0]!], carol);
assert.equal(await read('creditOf', [beneficiary]), 200_000n);
assert.equal(await client.getBalance({ address: beneficiary }), baseline.get(beneficiary));
await write('withdrawFor', [ids[0]!, beneficiary], alice);
for (const [account, delta] of [
  [alice, -100000n],
  [bob, -100000n],
  [carol, 0n],
  [beneficiary, 200000n],
] as const) {
  assert.equal(
    await client.getBalance({ address: account }),
    baseline.get(account)! + delta - (spentGas.get(account) ?? 0n),
    `Account ${account}, gas ${spentGas.get(account)}`,
  );
}
assert.equal(await client.getBalance({ address: module }), 0n);
assert.equal(await read('totalDeposited'), 500_000n);
assert.equal(await read('totalWithdrawn'), 500_000n);
assert.equal(await read('totalLocked'), 0n);
assert.equal(await read('totalCredits'), 0n);
mkdirSync('artifacts', { recursive: true });
const report = {
  mode: 'local-anvil-only',
  asset: 'native MON',
  walletBalancesIncludeGas: true,
  chainId: 10143,
  notPublicNetwork: true,
  scenarios: [
    'success -> time-lock -> credit -> withdrawal',
    'failed target -> refund credit -> withdrawal',
    'early exit + creator cancel -> independent refunds',
  ],
  hashEncodingMatches: true,
  duplicateRefundRejected: true,
  allPrincipalAccounted: true,
  operationCount: hashes.length,
  localTransactions: hashes,
};
writeFileSync('artifacts/group-local-chain.json', JSON.stringify(report, null, 2));
console.log(
  `Group: ${hashes.length} LOCAL Anvil operations passed; 3 scenarios, byte-for-byte terms hash verified. No public transaction.`,
);
