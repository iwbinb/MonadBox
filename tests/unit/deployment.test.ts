import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertBranch, validateConfig } from '../../scripts/validate-config.mjs';
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
describe('deployment guards (no publishing)', () => {
  it('accepts Production from main only', () => {
    expect(() => assertBranch('production', 'main')).not.toThrow();
    expect(() => assertBranch('preview', 'dev')).toThrow();
  });
  it.each([
    ['production', 'dev'],
    ['preview', 'main'],
    ['preview', 'feature'],
    ['unknown', 'main'],
    ['production', ''],
  ])('rejects %s on %s', (mode, branch) => expect(() => assertBranch(mode, branch)).toThrow());
  it('accepts the read-only one-Worker configuration', () =>
    expect(() => validateConfig(config, pkg)).not.toThrow());
  it('rejects a wrong Worker name', () =>
    expect(() => validateConfig({ ...config, name: 'monadbox-prod' }, pkg)).toThrow());
  it('rejects Preview attached to production namespace', () =>
    expect(() =>
      validateConfig(
        {
          ...config,
          previews: { vars: { ...config.vars, STORAGE_NAMESPACE: 'monadbox-production' } },
        },
        pkg,
      ),
    ).toThrow());
  it('rejects unreviewed remote storage', () =>
    expect(() =>
      validateConfig(
        { ...config, d1_databases: [{ binding: 'DB', database_id: 'placeholder' }] },
        pkg,
      ),
    ).toThrow());
  it('rejects mainnet activation', () =>
    expect(() =>
      validateConfig({ ...config, vars: { ...config.vars, MAINNET_ENABLED: 'true' } }, pkg),
    ).toThrow());
  it('rejects an unpinned Wrangler version', () =>
    expect(() =>
      validateConfig(config, {
        ...pkg,
        devDependencies: { ...pkg.devDependencies, wrangler: '^4.135.0' },
      }),
    ).toThrow());
});
