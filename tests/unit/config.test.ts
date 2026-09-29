import { describe, expect, it } from 'vitest';
import { readConfig, toPublicConfig, publicConfigSchema } from '../../src/shared/config';
import { tools, getTool } from '../../src/shared/tools';
import { registeredGroup } from '../../src/shared/cloud/registry';
import { deploymentSchema } from '../../src/shared/cloud/model';
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
  const deployment = deploymentSchema.parse({
    chainId: 10143,
    version: 1,
    address: '0x1111111111111111111111111111111111111111',
    asset: '0x0000000000000000000000000000000000000000',
    intakeAdmin: '0x2222222222222222222222222222222222222222',
    runtimeHash: '0x' + 'ab'.repeat(32),
  });
  it('enables explicit wallet payments only with a configured testnet deployment and cloud origin', () => {
    const input = {
      ...base,
      CLOUD_ENABLED: 'true',
      APP_ORIGIN: 'http://localhost:8790',
      GROUP_DEPLOYMENT: JSON.stringify(deployment),
      NETWORK_WRITES_ENABLED: 'true',
    };
    expect(toPublicConfig(readConfig(input), 'test').capabilities.payments).toBe(true);
    expect(() => readConfig({ ...input, CLOUD_ENABLED: 'false' })).toThrow();
    expect(() => readConfig({ ...input, GROUP_DEPLOYMENT: 'null' })).toThrow();
    expect(() =>
      readConfig({
        ...input,
        GROUP_DEPLOYMENT: JSON.stringify({ ...deployment, asset: deployment.address }),
      }),
    ).toThrow();
  });
  it('keeps historical identity exact and independent of the current deployment', () => {
    const config = readConfig({
      ...base,
      GROUP_PREVIOUS_DEPLOYMENTS: JSON.stringify([deployment]),
    });
    expect(registeredGroup(config, deployment)).toBe(true);
    expect(registeredGroup(config, { ...deployment, runtimeHash: '0x' + 'cd'.repeat(32) })).toBe(
      false,
    );
    expect(registeredGroup(config, { ...deployment, address: deployment.intakeAdmin })).toBe(false);
    expect(() =>
      readConfig({ ...base, GROUP_PREVIOUS_DEPLOYMENTS: JSON.stringify([deployment, deployment]) }),
    ).toThrow();
    expect(() =>
      readConfig({
        ...base,
        GROUP_DEPLOYMENT: JSON.stringify(deployment),
        GROUP_PREVIOUS_DEPLOYMENTS: JSON.stringify([deployment]),
      }),
    ).toThrow();
  });
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
    expect(JSON.stringify(result)).not.toMatch(/"private"|internal|STORAGE_NAMESPACE/);
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
