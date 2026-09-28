import { setTimeout } from 'node:timers';
import { createServer } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createPublicClient, createWalletClient, defineChain, http, keccak256 } from 'viem';
// Fixed loopback only. No RPC/host/private-key overrides or public broadcasts.
const funds = process.env.MONADBOX_LOCAL_FUNDS_TEST === '1';
const rpc = funds ? 'http://127.0.0.1:18746' : 'http://127.0.0.1:18745';
const origin = funds ? 'http://127.0.0.1:18890' : 'http://127.0.0.1:18889';
const token = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
const binary = existsSync('tools/anvil') ? 'tools/anvil' : 'anvil';
if (!execFileSync(binary, ['--version'], { encoding: 'utf8' }).includes('Version: 1.8.3'))
  throw Error('Anvil 1.8.3 required');
// Never attach to a leftover chain or another project's listener.
for (const port of [funds ? 18746 : 18745, funds ? 18890 : 18889])
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(
        Error(`Local test port ${port} is occupied; stop its owner before running this fixture.`),
      ),
    );
    probe.listen(port, '127.0.0.1', () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
const child = spawn(
  binary,
  ['--host', '127.0.0.1', '--port', funds ? '18746' : '18745', '--chain-id', '10143', '--silent'],
  { stdio: 'ignore' },
);
let mf;
let closed = false;
async function close() {
  if (closed) return;
  closed = true;
  child.kill('SIGTERM');
  await mf?.dispose();
}
process.on('SIGTERM', () => void close().finally(() => process.exit(0)));
process.on('SIGINT', () => void close().finally(() => process.exit(0)));
async function raw(method, params = []) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: globalThis.AbortSignal.timeout(5000),
  });
  const value = await r.json();
  if (value.error) throw Error(JSON.stringify(value.error));
  return value.result;
}
try {
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      if ((await raw('eth_chainId')) === '0x279f') {
        ready = true;
        break;
      }
    } catch {
      /* Local process starting. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (
    !ready ||
    child.exitCode !== null ||
    !/anvil/i.test(await raw('web3_clientVersion')) ||
    (await raw('eth_blockNumber')) !== '0x0'
  )
    throw Error('Local Anvil did not start');
  const accounts = await raw('eth_accounts');
  const mock = JSON.parse(readFileSync('contracts/out/MockToken.sol/MockToken.json', 'utf8'));
  await raw('anvil_setCode', [token, mock.deployedBytecode.object]);
  const artifact = JSON.parse(readFileSync('artifacts/group/GroupEscrowV1.json', 'utf8'));
  const chain = defineChain({
    id: 10143,
    name: 'Local Anvil ONLY',
    nativeCurrency: { name: 'Mock MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ chain, transport: http(rpc) });
  const hash = await wallet.deployContract({
    account: accounts[0],
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [token, accounts[0]],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress)
    throw Error('Local deployment failed');
  const address = receipt.contractAddress;
  const code = await publicClient.getCode({ address });
  const deployment = {
    chainId: 10143,
    version: 1,
    address,
    asset: token,
    intakeAdmin: accounts[0],
    runtimeHash: keccak256(code),
  };
  const modules = [];
  if (funds)
    for (const [tool, name, version] of [
      ['split', 'SplitPaymentsV1', 1],
      ['group', 'GroupEscrowV2', 2],
      ['deliver', 'DeliveryEscrowV1', 1],
      ['attend', 'AttendanceBondV1', 1],
      ['milestones', 'MilestoneEscrowV1', 1],
    ]) {
      const compiled = JSON.parse(readFileSync(`artifacts/modules/${name}.json`, 'utf8'));
      const tx = await wallet.deployContract({
        account: accounts[0],
        abi: compiled.abi,
        bytecode: compiled.bytecode,
        args: [token, accounts[0]],
      });
      const deployed = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (deployed.status !== 'success' || !deployed.contractAddress)
        throw Error('Local module deployment failed');
      const runtime = await publicClient.getCode({ address: deployed.contractAddress });
      modules.push({
        current: true,
        deployment: {
          ...deployment,
          tool,
          version,
          address: deployed.contractAddress,
          runtimeHash: keccak256(runtime),
        },
      });
    }
  await raw('anvil_mine', ['0x41']);
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    funds ? 'artifacts/funds-test.json' : 'artifacts/cloud-test.json',
    JSON.stringify(
      { mode: 'LOCAL ANVIL ONLY; NOT MONAD', origin, rpc, accounts, deployment, modules },
      null,
      2,
    ),
  );
  await build({
    entryPoints: [funds ? 'tests/fixtures/funds-worker.ts' : 'tests/fixtures/cloud-worker.ts'],
    outfile: funds ? 'artifacts/funds-worker.mjs' : 'artifacts/cloud-worker.mjs',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    define: { __BUILD_SHA__: JSON.stringify('local') },
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'monadbox-cloud-test',
      host: '127.0.0.1',
      port: funds ? 18890 : 18889,
      modules: true,
      scriptPath: funds ? 'artifacts/funds-worker.mjs' : 'artifacts/cloud-worker.mjs',
      compatibilityDate: '2026-09-18',
      compatibilityFlags: ['nodejs_compat'],
      assets: {
        directory: 'dist/client',
        binding: 'ASSETS',
        run_worker_first: true,
        routerConfig: { has_user_worker: true },
        assetConfig: { not_found_handling: 'single-page-application' },
      },
      bindings: {
        APP_ENV: 'local',
        CHAIN_ID: '10143',
        STORAGE_NAMESPACE: 'monadbox-local',
        STORAGE_ENABLED: 'false',
        BACKGROUND_ENABLED: 'false',
        NETWORK_WRITES_ENABLED: funds ? 'true' : 'false',
        MAINNET_ENABLED: 'false',
        ASSET_ALLOWLIST: '[]',
        CONTRACT_REGISTRY: '[]',
        TESTNET_LAB_ENABLED: 'true',
        CLOUD_ENABLED: 'true',
        GROUP_PUBLISH_ENABLED: 'true',
        APP_ORIGIN: origin,
        GROUP_DEPLOYMENT: JSON.stringify(deployment),
        ATTACHMENTS_ENABLED: funds ? 'true' : 'false',
        MODULES_ENABLED: funds ? 'true' : 'false',
        MODULE_PUBLISH_ENABLED: funds ? 'true' : 'false',
        MODULE_DEPLOYMENTS: JSON.stringify(modules),
      },
      d1Databases: { DB: 'cloud-e2e-only' },
      r2Buckets: { FILES: 'private-local-deliveries' },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of [
    '0001_foundation.sql',
    '0002_cloud_groups.sql',
    '0003_modules.sql',
    '0004_delivery_files.sql',
  ]) {
    const text = readFileSync('migrations/' + file, 'utf8').replace(/^--.*$/gm, '');
    for (const sql of text
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  }
  await db.prepare("INSERT INTO environment_guard(id,namespace) VALUES(1,'monadbox-local')").run();
  await (
    await mf.getR2Bucket('FILES')
  ).put('.monadbox-environment', 'local-only', { customMetadata: { namespace: 'monadbox-local' } });
  await mf.ready;
  console.log('M1-B local Worker + D1 + Anvil ready at ' + origin + '; never a public deployment.');
} catch (e) {
  await close();
  throw e;
}
