import { describe, expect, it } from 'vitest';
import { readConfig, toPublicConfig, publicConfigSchema } from '../../src/shared/config';
import { tools, getTool } from '../../src/shared/tools';
export const base = {
  APP_ENV: 'test',
  CHAIN_ID: '10143',
  STORAGE_NAMESPACE: 'monadbox-test',
  STORAGE_ENABLED: 'false',
  BACKGROUND_ENABLED: 'false',
  NETWORK_WRITES_ENABLED: 'false',
  MAINNET_ENABLED: 'false',
  ASSET_ALLOWLIST: '[]',
  CONTRACT_REGISTRY: '[]',
};
describe('fail-closed configuration', () => {
  it('accepts an explicitly read-only testnet environment', () =>
    expect(readConfig(base).CHAIN_ID).toBe('10143'));
  it.each(Object.keys(base))('rejects missing %s', (key) => {
    const copy: Record<string, string> = { ...base };
    delete copy[key];
    expect(() => readConfig(copy)).toThrow();
  });
  it.each([
    ['CHAIN_ID', '143'],
    ['APP_ENV', 'staging'],
    ['MAINNET_ENABLED', 'true'],
    ['NETWORK_WRITES_ENABLED', 'true'],
    ['STORAGE_NAMESPACE', 'monadbox-production'],
    ['ASSET_ALLOWLIST', '[{"symbol":"AUSD"}]'],
    ['CONTRACT_REGISTRY', '["0x0000"]'],
    ['BACKGROUND_ENABLED', 'true'],
    ['STORAGE_ENABLED', 'yes'],
  ])('rejects dangerous or ambiguous %s', (key, value) =>
    expect(() => readConfig({ ...base, [key]: value })).toThrow(),
  );
  it('does not permit Preview background processing', () =>
    expect(() =>
      readConfig({
        ...base,
        APP_ENV: 'preview',
        STORAGE_NAMESPACE: 'monadbox-preview',
        STORAGE_ENABLED: 'true',
        BACKGROUND_ENABLED: 'true',
      }),
    ).toThrow());
  it('never publishes internal secrets or bindings', () => {
    const result = toPublicConfig(
      readConfig({ ...base, SECRET: 'private', DB: 'internal' }),
      'local',
    );
    expect(publicConfigSchema.parse(result).capabilities.payments).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private|internal|STORAGE_NAMESPACE/);
  });
  it('rejects a forged response that enables payments', () =>
    expect(() =>
      publicConfigSchema.parse({
        ...toPublicConfig(readConfig(base), 'local'),
        capabilities: { wallets: true, payments: true, drafts: true },
      }),
    ).toThrow());
});
describe('six-tool catalogue', () => {
  it('has exactly six distinct tools and bilingual content', () => {
    expect(new Set(tools.map((x) => x.id)).size).toBe(6);
    for (const tool of tools) {
      expect(tool.description.en.length).toBeGreaterThan(10);
      expect(tool.description.zh.length).toBeGreaterThan(5);
      expect(tool.steps).toHaveLength(3);
    }
  });
  it('does not invent unknown tools', () => expect(getTool('arbitrary-contract')).toBeUndefined());
});
