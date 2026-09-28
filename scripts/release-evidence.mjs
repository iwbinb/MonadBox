import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const manifest = JSON.parse(readFileSync('dist/client/.vite/manifest.json', 'utf8'));
const initial = new Set();
function visit(key) {
  const item = manifest[key];
  if (!item || initial.has(item.file)) return;
  initial.add(item.file);
  for (const child of item.imports ?? []) visit(child);
}
for (const [key, item] of Object.entries(manifest)) if (item.isEntry) visit(key);
const scripts = [...initial]
  .filter((f) => f.endsWith('.js'))
  .map((file) => {
    const bytes = readFileSync(path.join('dist/client', file));
    return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: sha(bytes) };
  });
const initialGzipBytes = scripts.reduce((sum, f) => sum + f.gzipBytes, 0);
if (initialGzipBytes > 250 * 1024) throw Error('Public initial JavaScript exceeds 250 KiB gzip');
const artifacts = [
  'artifacts/group/GroupEscrowV1.json',
  ...readdirSync('artifacts/modules')
    .filter((f) => f.endsWith('.json'))
    .map((f) => 'artifacts/modules/' + f),
];
const contracts = artifacts.map((file) => {
  const a = JSON.parse(readFileSync(file, 'utf8'));
  const runtimeBytes = (a.runtime.length - 2) / 2;
  if (runtimeBytes > 24576) throw Error('EIP-170 runtime limit exceeded: ' + file);
  return {
    name: path.basename(file, '.json'),
    compiler: a.compiler,
    evmVersion: a.evmVersion,
    optimizerRuns: a.optimizerRuns,
    sourceSha256: a.sourceSha256,
    runtimeTemplateSha256: sha(a.runtime),
    runtimeBytes,
    abiSha256: sha(JSON.stringify(a.abi)),
  };
});
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const dependencies = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).map(
  ([name, version]) => {
    const installed = JSON.parse(
      readFileSync(path.join('node_modules', name, 'package.json'), 'utf8'),
    );
    return {
      name,
      version,
      license: installed.license ?? 'review required',
      development: !!pkg.devDependencies[name],
    };
  },
);
const sourceFiles = execFileSync('git', ['ls-files', 'contracts/src'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((file) => ({ file, sha256: sha(readFileSync(file)) }));
const revision = JSON.parse(readFileSync('dist/build.json', 'utf8'));
const dirty =
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/release-evidence.json',
  JSON.stringify(
    {
      ...revision,
      dirty,
      environment: 'local build; no public deployment or audit assertion',
      initialGzipBytes,
      budgetGzipBytes: 250 * 1024,
      scripts,
      contracts,
      sourceFiles,
      dependencies,
      lockSha256: sha(readFileSync('pnpm-lock.yaml')),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Release evidence: initial JavaScript ${initialGzipBytes} bytes gzip; ${contracts.length} business contract runtimes within EIP-170.`,
);
