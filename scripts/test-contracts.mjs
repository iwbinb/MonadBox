import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const forge = existsSync('tools/forge') ? 'tools/forge' : 'forge';
const solc = existsSync('tools/solc')
  ? new URL('../tools/solc', import.meta.url).pathname
  : undefined;
const version = execFileSync(forge, ['--version'], { encoding: 'utf8' });
if (!version.includes('Version: 1.8.3')) throw Error('Foundry 1.8.3 required');
execFileSync(forge, ['test', '--root', 'contracts', ...(solc ? ['--use', solc] : []), '-vv'], {
  stdio: 'inherit',
});
