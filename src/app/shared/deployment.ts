import { encodeDeployData, getAddress, keccak256, toHex } from 'viem';
import type { Address, Hex } from 'viem';
import { z } from 'zod';
import { definitions } from '../../shared/modules/terms';
import { groupArtifact } from '../../shared/group/generated/group';
import { verifyModule } from '../../shared/modules/chain';
import { verifyDeployment } from '../../shared/cloud/chain';
import { inspectNetwork, makeClient, TOKEN } from '../../shared/network';
import type { ChainClient } from '../../shared/network';
import { recoverNonce } from '../../shared/nonce-recovery';
import { requireWallet } from '../../shared/wallet';
import type { InjectedProvider } from '../../shared/wallet';
import { requireResolvedTransactions } from './transaction-storage';
import { addressSchema, hashSchema } from '../../shared/cloud/model';
import type { Deployment } from '../../shared/cloud/model';
import type { ModuleDeployment } from '../../shared/modules/model';
export const setupKinds = [
  'group-v1',
  'split',
  'group',
  'deliver',
  'attend',
  'milestones',
  'rewards',
] as const;
export type SetupKind = (typeof setupKinds)[number];
const intentSchema = z.object({
  id: z.uuid(),
  kind: z.enum(setupKinds),
  chainId: z.literal(10143),
  actor: addressSchema,
  nonce: z.number().int().nonnegative(),
  startBlock: z.string().regex(/^\d+$/),
  expiresAt: z.number().int(),
  gas: z.string().regex(/^\d+$/),
  estimatedFee: z.string().regex(/^\d+$/),
  dataHash: hashSchema,
});
export type SetupIntent = z.infer<typeof intentSchema>;
const rowSchema = z.object({
  intent: intentSchema,
  state: z.enum([
    'signing',
    'broadcast',
    'unknown',
    'rejected',
    'reverted',
    'replaced',
    'finalized',
  ]),
  hash: hashSchema.optional(),
  address: addressSchema.optional(),
  runtimeHash: hashSchema.optional(),
});
export type SetupRow = z.infer<typeof rowSchema>;
export const setupKey = (environment: string, actor: string) =>
  `monadbox.setup.mon-v2:${environment}:10143:${actor.toLowerCase()}`;
export function setupData(kind: SetupKind, actor: Address) {
  const artifact = kind === 'group-v1' ? groupArtifact : definitions[kind].artifact;
  return encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [TOKEN, actor] });
}
export function readSetup(storage: Pick<Storage, 'getItem'>, key: string): SetupRow[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    if (raw.length > 500000) throw Error();
    return z.array(rowSchema).max(40).parse(JSON.parse(raw));
  } catch {
    throw Error(
      'Deployment history is unreadable. Keep it and recover the original transaction. / 无法读取部署记录，请保留原数据并核验原交易。',
    );
  }
}
function save(storage: Storage, key: string, row: SetupRow) {
  const rows = readSetup(storage, key);
  const next = rows.filter((r) => r.intent.id !== row.intent.id);
  if (next.length >= 40) throw Error('Deployment history limit reached / 部署记录已达上限');
  storage.setItem(key, JSON.stringify([...next, row]));
}
export async function prepareSetup(
  kind: SetupKind,
  actor: Address,
  client: ChainClient = makeClient(),
): Promise<SetupIntent> {
  await inspectNetwork(client);
  const [code, nonce, block, price, balance] = await Promise.all([
    client.getCode({ address: actor }),
    client.getTransactionCount({ address: actor, blockTag: 'pending' }),
    client.getBlock(),
    client.getGasPrice(),
    client.getBalance({ address: actor }),
  ]);
  if (code && code !== '0x')
    throw Error('Only ordinary EOA accounts can deploy / 请使用普通钱包账户部署');
  const data = setupData(kind, actor),
    estimate = await client.estimateGas({ account: actor, data, value: 0n });
  const gas = estimate + estimate / 20n; // Small explicit margin: Monad charges the gas limit.
  if (balance < gas * price * 2n)
    throw Error('MON balance cannot cover the network fee / MON 余额不足以支付网络手续费');
  return {
    id: crypto.randomUUID(),
    kind,
    chainId: 10143,
    actor: getAddress(actor),
    nonce,
    startBlock: String(block.number),
    expiresAt: Number(block.timestamp) + 600,
    gas: String(gas),
    estimatedFee: String(gas * price),
    dataHash: keccak256(data),
  };
}
export async function sendSetup(
  environment: string,
  input: SetupIntent,
  provider: InjectedProvider,
  storage: Storage = localStorage,
  client: ChainClient = makeClient(),
) {
  const i = intentSchema.parse(input),
    key = setupKey(environment, i.actor);
  if (!navigator.locks) throw Error('Safe signing is unavailable / 浏览器不支持安全签名锁');
  return navigator.locks.request(`monadbox.sign:${i.actor.toLowerCase()}`, async () => {
    requireResolvedTransactions(storage, environment, i.actor);
    await requireWallet(provider, i.actor);
    await inspectNetwork(client);
    const data = setupData(i.kind, i.actor);
    if (keccak256(data) !== i.dataHash)
      throw Error('Deployment code changed; prepare again / 部署代码已更新，请重新准备');
    const [nonce, block, code, gas, price, balance] = await Promise.all([
      client.getTransactionCount({ address: i.actor, blockTag: 'pending' }),
      client.getBlock(),
      client.getCode({ address: i.actor }),
      client.estimateGas({ account: i.actor, data, value: 0n }),
      client.getGasPrice(),
      client.getBalance({ address: i.actor }),
    ]);
    if (
      nonce !== i.nonce ||
      Number(block.timestamp) >= i.expiresAt ||
      (code && code !== '0x') ||
      gas > BigInt(i.gas)
    )
      throw Error(
        'Wallet or network state changed; prepare again / 钱包或网络状态已变化，请重新准备',
      );
    if (balance < BigInt(i.gas) * price * 2n)
      throw Error('Insufficient MON for network fees / MON 手续费余额不足');
    await requireWallet(provider, i.actor);
    save(storage, key, { intent: i, state: 'signing' });
    let hash: Hex | undefined;
    try {
      hash = hashSchema.parse(
        await provider.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: i.actor,
              data,
              value: '0x0',
              chainId: toHex(10143),
              nonce: toHex(i.nonce),
              gas: toHex(BigInt(i.gas)),
            },
          ],
        }),
      );
      save(storage, key, { intent: i, state: 'broadcast', hash });
      return hash;
    } catch (e) {
      const rejected = !!e && typeof e === 'object' && 'code' in e && e.code === 4001;
      try {
        save(storage, key, {
          intent: i,
          state: rejected ? 'rejected' : 'unknown',
          ...(hash ? { hash } : {}),
        });
      } catch {
        /* The earlier signing record continues to prevent resends. */
      }
      throw e;
    }
  });
}
export async function checkSetup(
  input: SetupRow,
  client: ChainClient = makeClient(),
): Promise<SetupRow> {
  const row = rowSchema.parse(input),
    i = row.intent;
  await inspectNetwork(client);
  const hash = row.hash ?? (await recoverNonce(client, i.actor, i.nonce, BigInt(i.startBlock)));
  if (!hash) return { ...row, state: row.state === 'rejected' ? 'rejected' : 'unknown' };
  const [tx, r] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  const [canonical, finalized] = await Promise.all([
    client.getBlock({ blockNumber: r.blockNumber }),
    client.getBlock({ blockTag: 'finalized' }),
  ]);
  if (canonical.hash !== r.blockHash || finalized.number < r.blockNumber)
    return { ...row, hash, state: 'broadcast' };
  if (
    tx.from.toLowerCase() !== i.actor.toLowerCase() ||
    tx.nonce !== i.nonce ||
    tx.chainId !== 10143 ||
    tx.to !== null ||
    tx.value !== 0n ||
    keccak256(tx.input) !== i.dataHash ||
    keccak256(setupData(i.kind, i.actor)) !== i.dataHash
  )
    return { ...row, hash, state: 'replaced' };
  if (r.status !== 'success') return { ...row, hash, state: 'reverted' };
  if (!r.contractAddress) throw Error('Contract address missing / 回执缺少合约地址');
  const runtime = await client.getCode({ address: r.contractAddress });
  if (!runtime || runtime === '0x') throw Error('Contract code missing / 合约代码不存在');
  const deployment: Deployment = {
    chainId: 10143,
    version: 1,
    address: r.contractAddress,
    asset: TOKEN,
    intakeAdmin: i.actor,
    runtimeHash: keccak256(runtime),
  };
  if (i.kind === 'group-v1') await verifyDeployment(client, deployment);
  else
    await verifyModule(client, {
      ...deployment,
      tool: i.kind,
      version: definitions[i.kind].version,
    } as ModuleDeployment);
  return {
    ...row,
    hash,
    address: r.contractAddress,
    runtimeHash: keccak256(runtime),
    state: 'finalized',
  };
}
export async function recoverSetup(
  environment: string,
  row: SetupRow,
  storage: Storage = localStorage,
  client: ChainClient = makeClient(),
  supplied?: Hex,
) {
  const key = setupKey(environment, row.intent.actor);
  const saved = readSetup(storage, key).find((item) => item.intent.id === row.intent.id);
  if (!saved || JSON.stringify(saved.intent) !== JSON.stringify(row.intent))
    throw Error('JOURNAL_UNAVAILABLE');
  const checked = await checkSetup(
    { ...saved, ...(supplied ? { hash: hashSchema.parse(supplied) } : {}) },
    client,
  );
  save(storage, key, checked);
  return checked;
}
export function setupRegistry(rows: SetupRow[]) {
  const result = setupKinds.map((kind) =>
    [...rows]
      .reverse()
      .find(
        (row) =>
          row.intent.kind === kind && row.state === 'finalized' && row.address && row.runtimeHash,
      ),
  );
  if (result.some((row) => !row))
    throw Error('Verify all seven deployments before exporting / 七个合约全部核验后才能导出');
  const deployments = result.map((row) => ({
    chainId: 10143,
    version: row!.intent.kind === 'group' ? 2 : 1,
    address: row!.address!,
    asset: TOKEN,
    intakeAdmin: row!.intent.actor,
    runtimeHash: row!.runtimeHash!,
  }));
  return {
    GROUP_DEPLOYMENT: deployments[0],
    GROUP_PREVIOUS_DEPLOYMENTS: [],
    MODULE_DEPLOYMENTS: setupKinds.slice(1).map((kind, index) => ({
      current: true,
      deployment: { ...deployments[index + 1], tool: kind },
    })),
  };
}
