import { encodeDeployData, keccak256, pad, erc20Abi } from 'viem';
import type { Abi, Address, Hex } from 'viem';
import artifact from './generated/probe.json';
import { TOKEN, CHAIN_ID } from './network';
import type { ChainClient } from './network';
export const probeAbi = artifact.abi as Abi;
export const tokenAbi = erc20Abi;
export function deploymentData(): Hex {
  return encodeDeployData({ abi: probeAbi, bytecode: artifact.bytecode as Hex, args: [TOKEN] });
}
export function expectedRuntime(): Hex {
  let code = artifact.runtime.slice(2);
  const refs = Object.values(artifact.immutableReferences).flat() as { start: number; length: number }[];
  if (!refs.length) throw Error('Invalid artifact: immutable token missing');
  for (const ref of refs) {
    if (ref.length !== 32) throw Error('Invalid immutable size');
    const start = ref.start * 2;
    code = code.slice(0, start) + pad(TOKEN, { size: 32 }).slice(2) + code.slice(start + 64);
  }
  return `0x${code}`;
}
export async function verifyProbe(client: ChainClient, probe: Address): Promise<void> {
  if ((await client.getChainId()) !== CHAIN_ID) throw Error('WRONG_RPC_CHAIN');
  const code = await client.getCode({ address: probe });
  if (!code || keccak256(code) !== keccak256(expectedRuntime())) throw Error('UNVERIFIED_PROBE');
  const token = await client.readContract({ address: probe, abi: probeAbi, functionName: 'token' });
  if (typeof token !== 'string' || token.toLowerCase() !== TOKEN.toLowerCase()) throw Error('TOKEN_NOT_VERIFIED');
}
