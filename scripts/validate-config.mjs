import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function assertBranch(mode,branch){
 if(mode==='production'&&branch==='main')return;
 if(mode==='preview'&&branch==='dev')return;
 throw new Error('Deployment mode and Git branch do not match');
}
export function validateConfig(config,pkg){
 if(config.name!=='monadbox')throw new Error('Worker name must be monadbox');
 if(config.env)throw new Error('Use one Worker and previews, not env-specific Workers');
 const version=pkg.devDependencies?.wrangler;
 if(!/^4\.\d+\.\d+$/.test(version??'')||Number(version.split('.')[1])<135)throw new Error('Pin Wrangler >=4.135 for Worker Previews');
 for(const [target,settings] of [['production',config],['preview',config.previews]]){
  if(!settings||settings.vars?.APP_ENV!==target)throw new Error(`Invalid ${target} environment`);
  if(settings.vars.CHAIN_ID!=='10143'||settings.vars.MAINNET_ENABLED!=='false'||settings.vars.NETWORK_WRITES_ENABLED!=='false')throw new Error('Business payments remain disabled; testnet lab is a separate explicit wallet action');
  if(!['true','false'].includes(settings.vars.TESTNET_LAB_ENABLED??'false'))throw new Error('Invalid testnet lab flag');
  if(settings.vars.ASSET_ALLOWLIST!=='[]'||settings.vars.CONTRACT_REGISTRY!=='[]')throw new Error('Unverified asset or contract');
  if(settings.vars.STORAGE_NAMESPACE!==`monadbox-${target}`)throw new Error('Invalid namespace');
  if(settings.vars.STORAGE_ENABLED!=='false'||settings.vars.BACKGROUND_ENABLED!=='false')throw new Error('Remote bindings not yet accepted; keep them disabled');
  if(settings.d1_databases?.length||settings.r2_buckets?.length||settings.queues||settings.triggers)throw new Error('Remote resources require a reviewed binding configuration, not placeholders');
 }
 if(!config.assets?.run_worker_first||config.assets.binding!=='ASSETS')throw new Error('API must run before SPA fallback');
 if(config.previews.routes||config.previews.triggers||config.previews.queues?.consumers)throw new Error('Unsupported Preview event routing');
}
export async function validateDeployment(){
 validateConfig(JSON.parse(await readFile('wrangler.jsonc','utf8')),JSON.parse(await readFile('package.json','utf8')));
 console.log('Deployment config: one Worker, isolated Preview vars, no server-side signing or remote resource writes.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await validateDeployment();
