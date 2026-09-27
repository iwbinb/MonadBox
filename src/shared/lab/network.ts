import {
  createPublicClient,
  defineChain,
  http,
  erc20Abi,
  keccak256,
  encodeAbiParameters,
  getAddress,
} from 'viem';
import type { Address, Hex } from 'viem';
export const CHAIN_ID = 10143 as const;
export const RPC_URL = 'https://testnet-rpc.monad.xyz';
export const EXPLORER = 'https://testnet.monadscan.com';
export const TOKEN = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' as const;
export const MAX_AMOUNT = 1_000_000n;
export const TEST_CHAIN = defineChain({
  id: CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Monadscan', url: EXPLORER } },
  testnet: true,
});
export const makeClient = () =>
  createPublicClient({
    chain: TEST_CHAIN,
    transport: http(RPC_URL, { timeout: 12000, retryCount: 1, batch: false }),
  });
export type ChainClient = ReturnType<typeof makeClient>;
export function paymentId(probe: Address, payer: Address, nonce: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }],
      [BigInt(CHAIN_ID), probe, payer, nonce],
    ),
  );
}
export function address(value: string): Address {
  return getAddress(value);
}
export function explorerTransaction(hash: Hex): string {
  return `${EXPLORER}/tx/${hash}`;
}
export async function inspectNetwork(client: ChainClient) {
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw Error('WRONG_RPC_CHAIN');
  const finalized = await client.getBlock({ blockTag: 'finalized' });
  const [head, code, decimals, symbol] = await Promise.all([
    client.getBlock({ blockTag: 'latest' }),
    client.getCode({ address: TOKEN }),
    client.readContract({ address: TOKEN, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: TOKEN, abi: erc20Abi, functionName: 'symbol' }),
  ]);
  if (!code || code === '0x' || decimals !== 6 || symbol !== 'AUSD')
    throw Error('TOKEN_NOT_VERIFIED');
  if (
    !head.hash ||
    !finalized.hash ||
    head.number === null ||
    finalized.number === null ||
    finalized.number > head.number
  )
    throw Error('FINALITY_UNAVAILABLE');
  return {
    chainId,
    head: head.number.toString(),
    finalized: finalized.number.toString(),
    finalizedHash: finalized.hash,
    token: TOKEN,
    decimals,
    symbol,
    tokenCodeHash: keccak256(code),
    checkedAt: new Date().toISOString(),
  };
}
export type Inspection = Awaited<ReturnType<typeof inspectNetwork>>;
