import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import './compile-probe.mjs';
import './compile-group.mjs';
import './compile-modules.mjs';
import { validateDeployment } from './validate-config.mjs';
await validateDeployment();
let revision = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA;
if (!revision) {
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    revision = 'local';
  }
}
if (revision !== 'local' && !/^[a-f0-9]{40}$/.test(revision))
  throw new Error('Invalid build revision');
await viteBuild();
await esbuild({
  entryPoints: ['src/worker/index.ts'],
  outdir: 'dist/worker',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  minify: true,
  define: { __BUILD_SHA__: JSON.stringify(revision) },
});
await mkdir('dist', { recursive: true });
await writeFile('dist/build.json', JSON.stringify({ revision, stage: 'M6' }, null, 2));
console.log(`Built M6 ${revision}; no deployment or chain writes performed.`);
