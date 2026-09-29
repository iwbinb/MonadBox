import { ASSET_DECIMALS, ASSET_SYMBOL, NATIVE_ASSET } from './asset';
export {
  CHAIN_ID,
  RPC_URL,
  EXPLORER,
  TEST_CHAIN,
  makeClient,
  explorerTransaction,
} from './lab/network';
export type { ChainClient } from './lab/network';
import type { ChainClient } from './lab/network';
export const TOKEN = NATIVE_ASSET;
export async function inspectNetwork(client: ChainClient) {
  if ((await client.getChainId()) !== 10143) throw Error('WRONG_RPC_CHAIN');
  const [head, finalized] = await Promise.all([
    client.getBlock({ blockTag: 'latest' }),
    client.getBlock({ blockTag: 'finalized' }),
  ]);
  if (
    !head.hash ||
    !finalized.hash ||
    head.number === null ||
    finalized.number === null ||
    finalized.number > head.number
  )
    throw Error('FINALITY_UNAVAILABLE');
  return {
    chainId: 10143,
    head: head.number.toString(),
    finalized: finalized.number.toString(),
    finalizedHash: finalized.hash,
    token: TOKEN,
    decimals: ASSET_DECIMALS,
    symbol: ASSET_SYMBOL,
    checkedAt: new Date().toISOString(),
  };
}
