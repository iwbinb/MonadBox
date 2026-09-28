import { spawn, execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers';
import { build } from 'esbuild';
const server = spawn(process.execPath, ['scripts/cloud-test-server.mjs'], { stdio: 'inherit' });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Local cloud test server exited');
    try {
      const r = await fetch('http://127.0.0.1:8789/api/v1/health');
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Local fixture starting. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error('Local cloud fixture not ready');
  await build({
    entryPoints: ['tests/integration/cloud-http-scenario.ts'],
    outfile: 'artifacts/cloud-http-runner.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
  execFileSync(process.execPath, ['artifacts/cloud-http-runner.mjs'], { stdio: 'inherit' });
} finally {
  server.kill('SIGTERM');
  if (server.exitCode === null)
    await new Promise((resolve) => {
      server.once('exit', resolve);
      setTimeout(resolve, 5000);
    });
}
