import { zeroAddress } from 'viem';

/** address(0) is the immutable native MON asset identity, never a recipient. */
export const NATIVE_ASSET = zeroAddress;
export const ASSET_DECIMALS = 18;
export const ASSET_SYMBOL = 'MON';
export const ASSET_LABEL = 'MON';
export const ASSET_STORAGE_VERSION = 'mon-v2';
