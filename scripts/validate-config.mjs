import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function assertBranch(mode, branch) {
  if (mode === 'production' && branch === 'main') return;
  if (mode === 'preview' && branch === 'dev') return;
  throw new Error('Deployment mode and Git branch do not match');
}
export function validateConfig(config, pkg) {
  if (config.name !== 'monadbox') throw new Error('Worker name must be monadbox');
  if (config.env) throw new Error('Use one Worker and previews, not env-specific Workers');
  const version = pkg.devDependencies?.wrangler;
  if (!/^4\.\d+\.\d+$/.test(version ?? '') || Number(version.split('.')[1]) < 135)
    throw new Error('Pin Wrangler >=4.135 for Worker Previews');
  const databases = [];
  const origins = [];
  for (const [target, settings] of [
    ['production', config],
    ['preview', config.previews],
  ]) {
    if (!settings || settings.vars?.APP_ENV !== target)
      throw new Error(`Invalid ${target} environment`);
    if (
      settings.vars.CHAIN_ID !== '10143' ||
      settings.vars.MAINNET_ENABLED !== 'false' ||
      !['true', 'false'].includes(settings.vars.NETWORK_WRITES_ENABLED)
    )
      throw new Error('Only explicit testnet configuration is supported');
    if (!['true', 'false'].includes(settings.vars.TESTNET_LAB_ENABLED ?? 'false'))
      throw new Error('Invalid testnet lab flag');
    if (settings.vars.ASSET_ALLOWLIST !== '[]' || settings.vars.CONTRACT_REGISTRY !== '[]')
      throw new Error('Unverified asset or contract');
    if (settings.vars.STORAGE_NAMESPACE !== `monadbox-${target}`)
      throw new Error('Invalid namespace');
    if (settings.vars.STORAGE_ENABLED !== 'false' || settings.vars.BACKGROUND_ENABLED !== 'false')
      throw new Error('Remote bindings not yet accepted; keep them disabled');
    if (settings.r2_buckets?.length || settings.queues || settings.triggers)
      throw new Error(
        'Remote resources require a reviewed binding configuration, not placeholders',
      );
    for (const key of ['CLOUD_ENABLED', 'GROUP_PUBLISH_ENABLED'])
      if (!['true', 'false'].includes(settings.vars[key] ?? 'false'))
        throw new Error('Invalid cloud feature flag');
    if (settings.vars.CLOUD_ENABLED === 'true') {
      const origin = new URL(settings.vars.APP_ORIGIN);
      if (origin.protocol !== 'https:' || origin.origin !== settings.vars.APP_ORIGIN)
        throw new Error('Cloud origin must be exact HTTPS');
      origins.push(origin.origin);
      const db = settings.d1_databases;
      if (
        !Array.isArray(db) ||
        db.length !== 1 ||
        db[0].binding !== 'DB' ||
        !/^[a-f0-9-]{36}$/i.test(db[0].database_id) ||
        /^00000000-/i.test(db[0].database_id)
      )
        throw new Error('Cloud needs exactly one real reviewed D1 binding');
      databases.push(db[0].database_id.toLowerCase());
    } else if (settings.d1_databases?.length)
      throw new Error('Unused remote database must not be bound');
    let deployment;
    try {
      deployment = JSON.parse(settings.vars.GROUP_DEPLOYMENT ?? 'null');
    } catch {
      throw new Error('Invalid Group deployment JSON');
    }
    if (
      settings.vars.NETWORK_WRITES_ENABLED === 'true' &&
      (settings.vars.CLOUD_ENABLED !== 'true' || !deployment)
    )
      throw new Error('Business payments require cloud and reviewed deployment');
    if (
      settings.vars.GROUP_PUBLISH_ENABLED === 'true' &&
      (settings.vars.CLOUD_ENABLED !== 'true' || !deployment)
    )
      throw new Error('Publication requires cloud and reviewed deployment');
    if (
      deployment &&
      (deployment.chainId !== 10143 ||
        deployment.version !== 1 ||
        deployment.asset?.toLowerCase() !== '0xa9012a055bd4e0edff8ce09f960291c09d5322dc' ||
        !/^0x[0-9a-f]{40}$/i.test(deployment.address) ||
        !/^0x[0-9a-f]{40}$/i.test(deployment.intakeAdmin) ||
        !/^0x[0-9a-f]{64}$/i.test(deployment.runtimeHash))
    )
      throw new Error('Unverified Group deployment structure');
  }
  if (new Set(databases).size !== databases.length || new Set(origins).size !== origins.length)
    throw new Error('Production and Preview must use different origins and databases');
  if (!config.assets?.run_worker_first || config.assets.binding !== 'ASSETS')
    throw new Error('API must run before SPA fallback');
  if (config.previews.routes || config.previews.triggers || config.previews.queues?.consumers)
    throw new Error('Unsupported Preview event routing');
}
export async function validateDeployment() {
  validateConfig(
    JSON.parse(await readFile('wrangler.jsonc', 'utf8')),
    JSON.parse(await readFile('package.json', 'utf8')),
  );
  console.log(
    'Deployment config: one Worker, isolated Preview vars, no server-side signing or resource provisioning.',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await validateDeployment();
