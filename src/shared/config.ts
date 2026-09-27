import { z } from 'zod';
export const STAGE = 'M0-C' as const;
export const TESTNET_CHAIN_ID = 10143 as const;
const falseFlag = z.literal('false');
const booleanFlag = z.enum(['false','true']).transform(value=>value==='true');
const emptyList = z.string().refine(value=>{try{const parsed:unknown=JSON.parse(value);return Array.isArray(parsed)&&parsed.length===0;}catch{return false;}},'Business tools have no verified assets or contracts.');
const schema=z.object({
 APP_ENV:z.enum(['local','test','preview','production']),CHAIN_ID:z.literal('10143'),
 STORAGE_NAMESPACE:z.string().regex(/^monadbox-(local|test|preview|production)$/),
 STORAGE_ENABLED:booleanFlag,TESTNET_LAB_ENABLED:booleanFlag.default(false),BACKGROUND_ENABLED:booleanFlag,
 NETWORK_WRITES_ENABLED:falseFlag,MAINNET_ENABLED:falseFlag,ASSET_ALLOWLIST:emptyList,CONTRACT_REGISTRY:emptyList,
}).superRefine((value,ctx)=>{
 if(value.STORAGE_NAMESPACE!==`monadbox-${value.APP_ENV}`)ctx.addIssue({code:'custom',path:['STORAGE_NAMESPACE'],message:'Environment namespace mismatch.'});
 if(value.APP_ENV==='preview'&&value.BACKGROUND_ENABLED)ctx.addIssue({code:'custom',path:['BACKGROUND_ENABLED'],message:'Preview cannot run Queue consumers or Cron.'});
 if(value.BACKGROUND_ENABLED&&!value.STORAGE_ENABLED)ctx.addIssue({code:'custom',path:['STORAGE_ENABLED'],message:'Background processing requires storage.'});
});
export type RuntimeConfig=z.infer<typeof schema>;
export function readConfig(input:unknown):RuntimeConfig{return schema.parse(input);}
export const publicConfigSchema=z.object({
 stage:z.literal(STAGE),environment:z.enum(['local','test','preview','production']),chainId:z.literal(TESTNET_CHAIN_ID),network:z.literal('Monad Testnet'),revision:z.string(),storageEnabled:z.boolean(),
 capabilities:z.object({wallets:z.boolean(),testnetLab:z.boolean(),payments:z.literal(false),drafts:z.literal(false)}),
});
export type PublicConfig=z.infer<typeof publicConfigSchema>;
export function toPublicConfig(config:RuntimeConfig,revision:string):PublicConfig{
 return {stage:STAGE,environment:config.APP_ENV,chainId:TESTNET_CHAIN_ID,network:'Monad Testnet',revision,storageEnabled:config.STORAGE_ENABLED,capabilities:{wallets:config.TESTNET_LAB_ENABLED,testnetLab:config.TESTNET_LAB_ENABLED,payments:false,drafts:false}};
}
