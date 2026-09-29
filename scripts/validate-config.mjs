import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function assertBranch(mode, branch) {
  if (mode === 'production' && branch === 'main') return;
  throw new Error('Deployment mode and Git branch do not match');
}
export function validateConfig(config, pkg) {
  if (config.name !== 'monadbox') throw new Error('Worker name must be monadbox');
  if (config.env || config.previews) throw new Error('Use one Production Worker from main');
  const version = pkg.devDependencies?.wrangler;
  if (!/^4\.\d+\.\d+$/.test(version ?? '') || Number(version.split('.')[1]) < 135)
    throw new Error('Pin Wrangler >=4.135');
  const databases = [];
  const origins = [];
  for (const [target, settings] of [['production', config]]) {
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
    if (settings.queues || settings.triggers)
      throw new Error(
        'Remote resources require a reviewed binding configuration, not placeholders',
      );
    for (const key of [
      'ATTACHMENTS_ENABLED',
      'CLOUD_ENABLED',
      'GROUP_PUBLISH_ENABLED',
      'MODULES_ENABLED',
      'MODULE_PUBLISH_ENABLED',
    ])
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
    if (settings.vars.ATTACHMENTS_ENABLED === 'true') {
      const buckets = settings.r2_buckets;
      if (
        settings.vars.MODULES_ENABLED !== 'true' ||
        !Array.isArray(buckets) ||
        buckets.length !== 1 ||
        buckets[0].binding !== 'FILES' ||
        buckets[0].bucket_name !== 'monadbox-private-files-production'
      )
        throw new Error('Attachments require the reviewed private FILES bucket and modules');
    } else if (settings.r2_buckets?.length)
      throw new Error('Unused private storage must not be bound');
    let deployment, previous, modules;
    try {
      deployment = JSON.parse(settings.vars.GROUP_DEPLOYMENT ?? 'null');
      previous = JSON.parse(settings.vars.GROUP_PREVIOUS_DEPLOYMENTS ?? '[]');
      modules = JSON.parse(settings.vars.MODULE_DEPLOYMENTS ?? '[]');
    } catch {
      throw new Error('Invalid Group deployment JSON');
    }
    if (
      !Array.isArray(modules) ||
      modules.length > 40 ||
      modules.some(
        (entry) =>
          !entry ||
          typeof entry.current !== 'boolean' ||
          !entry.deployment ||
          !['split', 'group', 'deliver', 'attend', 'milestones', 'rewards'].includes(
            entry.deployment.tool,
          ) ||
          entry.deployment.version !== (entry.deployment.tool === 'group' ? 2 : 1) ||
          entry.deployment.chainId !== 10143 ||
          entry.deployment.asset?.toLowerCase() !== '0x0000000000000000000000000000000000000000' ||
          !/^0x[0-9a-f]{40}$/i.test(entry.deployment.address) ||
          /^0x0{40}$/i.test(entry.deployment.address) ||
          !/^0x[0-9a-f]{40}$/i.test(entry.deployment.intakeAdmin) ||
          /^0x0{40}$/i.test(entry.deployment.intakeAdmin) ||
          !/^0x[0-9a-f]{64}$/i.test(entry.deployment.runtimeHash),
      )
    )
      throw new Error('Invalid module registry');
    if (
      new Set(modules.map((entry) => entry.deployment.address.toLowerCase())).size !==
        modules.length ||
      new Set(modules.filter((entry) => entry.current).map((entry) => entry.deployment.tool))
        .size !== modules.filter((entry) => entry.current).length
    )
      throw new Error('Duplicate module registration');
    if (settings.vars.MODULES_ENABLED === 'true' && settings.vars.CLOUD_ENABLED !== 'true')
      throw new Error('Modules require cloud');
    if (
      settings.vars.MODULE_PUBLISH_ENABLED === 'true' &&
      (settings.vars.MODULES_ENABLED !== 'true' || !modules.some((entry) => entry.current))
    )
      throw new Error('Module publishing requires a current deployment');
    if (
      settings.vars.NETWORK_WRITES_ENABLED === 'true' &&
      (settings.vars.CLOUD_ENABLED !== 'true' ||
        (!deployment &&
          !(settings.vars.MODULES_ENABLED === 'true' && modules.some((entry) => entry.current))))
    )
      throw new Error('Business payments require cloud and reviewed deployment');
    if (
      settings.vars.GROUP_PUBLISH_ENABLED === 'true' &&
      (settings.vars.CLOUD_ENABLED !== 'true' || !deployment)
    )
      throw new Error('Publication requires cloud and reviewed deployment');
    if (!Array.isArray(previous) || previous.length > 20)
      throw new Error('Invalid historical Group deployments');
    const deployments = [...(deployment ? [deployment] : []), ...previous];
    if (
      deployments.some(
        (entry) =>
          !entry ||
          entry.chainId !== 10143 ||
          entry.version !== 1 ||
          entry.asset?.toLowerCase() !== '0x0000000000000000000000000000000000000000' ||
          !/^0x[0-9a-f]{40}$/i.test(entry.address) ||
          /^0x0{40}$/i.test(entry.address) ||
          !/^0x[0-9a-f]{40}$/i.test(entry.intakeAdmin) ||
          /^0x0{40}$/i.test(entry.intakeAdmin) ||
          !/^0x[0-9a-f]{64}$/i.test(entry.runtimeHash),
      ) ||
      new Set(deployments.map((entry) => entry.address.toLowerCase())).size !== deployments.length
    )
      throw new Error('Unverified Group deployment structure');
  }
  if (new Set(databases).size !== databases.length || new Set(origins).size !== origins.length)
    throw new Error('Duplicate database or origin');
  if (!config.assets?.run_worker_first || config.assets.binding !== 'ASSETS')
    throw new Error('API must run before SPA fallback');
}
export async function validateDeployment() {
  validateConfig(
    JSON.parse(await readFile('wrangler.jsonc', 'utf8')),
    JSON.parse(await readFile('package.json', 'utf8')),
  );
  console.log(
    'Deployment config: main → Production, native MON on Monad Testnet, explicit browser signing.',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await validateDeployment();
