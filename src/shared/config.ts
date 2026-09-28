import { z } from 'zod';
import { deploymentSchema } from './cloud/model';
import { GROUP_ASSET } from './group/draft';
import { moduleRegistrationSchema } from './modules/model';
export const STAGE = 'M2-A' as const;
export const TESTNET_CHAIN_ID = 10143 as const;
const falseFlag = z.literal('false');
const booleanFlag = z.enum(['false', 'true']).transform((value) => value === 'true');
const emptyList = z.string().refine((value) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}, 'Business tools have no verified assets or contracts.');
const schema = z
  .object({
    CLOUD_ENABLED: booleanFlag.default(false),
    MODULES_ENABLED: booleanFlag.default(false),
    MODULE_PUBLISH_ENABLED: booleanFlag.default(false),
    MODULE_DEPLOYMENTS: z
      .string()
      .default('[]')
      .transform((s, ctx) => {
        try {
          return moduleRegistrationSchema.array().max(40).parse(JSON.parse(s));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Invalid module registry' });
          return z.NEVER;
        }
      }),
    GROUP_PUBLISH_ENABLED: booleanFlag.default(false),
    GROUP_PREVIOUS_DEPLOYMENTS: z
      .string()
      .default('[]')
      .transform((s, ctx) => {
        try {
          return deploymentSchema.array().max(20).parse(JSON.parse(s));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Invalid historical Group deployments' });
          return z.NEVER;
        }
      }),
    APP_ORIGIN: z.string().default(''),
    GROUP_DEPLOYMENT: z
      .string()
      .default('null')
      .transform((s, ctx) => {
        try {
          return deploymentSchema.nullable().parse(JSON.parse(s));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Invalid Group deployment' });
          return z.NEVER;
        }
      }),
    APP_ENV: z.enum(['local', 'test', 'preview', 'production']),
    CHAIN_ID: z.literal('10143'),
    STORAGE_NAMESPACE: z.string().regex(/^monadbox-(local|test|preview|production)$/),
    STORAGE_ENABLED: booleanFlag,
    TESTNET_LAB_ENABLED: booleanFlag.default(false),
    BACKGROUND_ENABLED: booleanFlag,
    NETWORK_WRITES_ENABLED: booleanFlag,
    MAINNET_ENABLED: falseFlag,
    ASSET_ALLOWLIST: emptyList,
    CONTRACT_REGISTRY: emptyList,
  })
  .superRefine((value, ctx) => {
    const modules = value.MODULE_DEPLOYMENTS;
    if (
      new Set(modules.map((entry) => entry.deployment.address.toLowerCase())).size !==
        modules.length ||
      new Set(modules.filter((entry) => entry.current).map((entry) => entry.deployment.tool))
        .size !== modules.filter((entry) => entry.current).length ||
      modules.some((entry) => entry.deployment.asset.toLowerCase() !== GROUP_ASSET.toLowerCase())
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Module addresses must be unique with one current deployment per tool',
      });
    if (value.MODULES_ENABLED && !value.CLOUD_ENABLED)
      ctx.addIssue({ code: 'custom', message: 'Modules require cloud' });
    if (
      value.MODULE_PUBLISH_ENABLED &&
      (!value.MODULES_ENABLED || !modules.some((entry) => entry.current))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Module publishing requires modules and a current deployment',
      });
    const deployments = [value.GROUP_DEPLOYMENT, ...value.GROUP_PREVIOUS_DEPLOYMENTS].filter(
      (entry) => entry !== null,
    );
    if (
      new Set(deployments.map((entry) => entry.address.toLowerCase())).size !==
        deployments.length ||
      deployments.some((entry) => entry.asset.toLowerCase() !== GROUP_ASSET.toLowerCase())
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Deployment addresses must be unique and use the official test asset',
      });
    if (value.CLOUD_ENABLED) {
      try {
        const u = new URL(value.APP_ORIGIN);
        if (
          u.origin !== value.APP_ORIGIN ||
          (u.protocol !== 'https:' &&
            !(
              ['local', 'test'].includes(value.APP_ENV) &&
              ['localhost', '127.0.0.1'].includes(u.hostname)
            ))
        )
          throw Error();
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['APP_ORIGIN'],
          message: 'Exact HTTPS origin required',
        });
      }
    }
    if (
      value.GROUP_PUBLISH_ENABLED &&
      (!value.CLOUD_ENABLED ||
        !value.GROUP_DEPLOYMENT ||
        value.GROUP_DEPLOYMENT.asset.toLowerCase() !== GROUP_ASSET.toLowerCase())
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Publishing requires cloud and official testnet deployment',
      });
    if (
      value.NETWORK_WRITES_ENABLED &&
      (!value.CLOUD_ENABLED ||
        (!value.GROUP_DEPLOYMENT &&
          !(value.MODULES_ENABLED && modules.some((entry) => entry.current))))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Funds actions require cloud and verified Group deployment',
      });
    if (value.STORAGE_NAMESPACE !== `monadbox-${value.APP_ENV}`)
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_NAMESPACE'],
        message: 'Environment namespace mismatch.',
      });
    if (value.APP_ENV === 'preview' && value.BACKGROUND_ENABLED)
      ctx.addIssue({
        code: 'custom',
        path: ['BACKGROUND_ENABLED'],
        message: 'Preview cannot run Queue consumers or Cron.',
      });
    if (value.BACKGROUND_ENABLED && !value.STORAGE_ENABLED)
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_ENABLED'],
        message: 'Background processing requires storage.',
      });
  });
export type RuntimeConfig = z.infer<typeof schema>;
export function readConfig(input: unknown): RuntimeConfig {
  return schema.parse(input);
}
export const publicConfigSchema = z.object({
  stage: z.literal(STAGE),
  environment: z.enum(['local', 'test', 'preview', 'production']),
  chainId: z.literal(TESTNET_CHAIN_ID),
  network: z.literal('Monad Testnet'),
  revision: z.string(),
  storageEnabled: z.boolean(),
  capabilities: z.object({
    wallets: z.boolean(),
    testnetLab: z.boolean(),
    payments: z.boolean(),
    drafts: z.boolean(),
    cloudGroups: z.boolean().default(false),
    groupPublishing: z.boolean().default(false),
    cloudModules: z.boolean().default(false),
    modulePublishing: z.boolean().default(false),
    localGroupDrafts: z.literal(true),
  }),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
export function toPublicConfig(config: RuntimeConfig, revision: string): PublicConfig {
  return {
    stage: STAGE,
    environment: config.APP_ENV,
    chainId: TESTNET_CHAIN_ID,
    network: 'Monad Testnet',
    revision,
    storageEnabled: config.STORAGE_ENABLED,
    capabilities: {
      wallets: config.TESTNET_LAB_ENABLED,
      testnetLab: config.TESTNET_LAB_ENABLED,
      payments: config.NETWORK_WRITES_ENABLED,
      drafts: config.CLOUD_ENABLED,
      cloudGroups: config.CLOUD_ENABLED,
      groupPublishing: config.GROUP_PUBLISH_ENABLED,
      cloudModules: config.MODULES_ENABLED,
      modulePublishing: config.MODULE_PUBLISH_ENABLED,
      localGroupDrafts: true,
    },
  };
}
