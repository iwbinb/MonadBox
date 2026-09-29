import { spawnSync, execFileSync } from 'node:child_process';
import { assertBranch, validateDeployment } from './validate-config.mjs';
const mode = process.argv[2];
if (mode !== 'production') throw new Error('Only Production deployment from main is supported');
const branch =
  process.env.WORKERS_CI_BRANCH ??
  process.env.GITHUB_REF_NAME ??
  execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
assertBranch(mode, branch);
await validateDeployment();
const command = ['deploy'];
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...command], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
