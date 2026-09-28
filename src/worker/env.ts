export interface Env {
  CLOUD_ENABLED?: string;
  ATTACHMENTS_ENABLED?: string;
  MODULES_ENABLED?: string;
  MODULE_PUBLISH_ENABLED?: string;
  MODULE_DEPLOYMENTS?: string;
  GROUP_PUBLISH_ENABLED?: string;
  GROUP_DEPLOYMENT?: string;
  GROUP_PREVIOUS_DEPLOYMENTS?: string;
  APP_ORIGIN?: string;
  APP_ENV?: string;
  TESTNET_LAB_ENABLED?: string;
  CHAIN_ID?: string;
  STORAGE_NAMESPACE?: string;
  STORAGE_ENABLED?: string;
  BACKGROUND_ENABLED?: string;
  NETWORK_WRITES_ENABLED?: string;
  MAINNET_ENABLED?: string;
  ASSET_ALLOWLIST?: string;
  CONTRACT_REGISTRY?: string;
  ASSETS?: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  JOBS?: Queue;
  DLQ?: Queue;
}
