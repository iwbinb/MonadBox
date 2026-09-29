import { encodeFunctionData, keccak256, stringToHex } from 'viem';
import type { Address, Hex } from 'viem';
import { makeClient, TOKEN, inspectNetwork } from '../network';
import type { ChainClient } from '../network';
import { recoverNonce } from '../nonce-recovery';
import { groupArtifact } from '../group/generated/group';
import { groupMetadata, groupTerms, groupTermsHash, groupId } from '../group/terms';
import type { Deployment, PublishIntent, ChainSnapshot } from './model';
export const groupAbi = groupArtifact.abi;
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function calldata(intent: PublishIntent): Hex {
  if (
    !same(intent.deployment.asset, TOKEN) ||
    !same(intent.chainBoxId, groupId(intent.deployment.address, intent.creator, intent.salt)) ||
    !same(
      intent.termsHash,
      groupTermsHash(intent.deployment.address, intent.creator, intent.salt, intent.data),
    ) ||
    !same(intent.metadataHash, keccak256(stringToHex(groupMetadata(intent.data))))
  )
    throw Error('INTEGRITY_ERROR');
  return encodeFunctionData({
    abi: groupAbi,
    functionName: 'createGroup',
    args: [groupTerms(intent.data), intent.salt],
  });
}
/** Compare all non-immutable bytes to this build, then verify immutable getters and a pinned runtime hash. */
export function runtimeMatches(code: Hex): boolean {
  if (code.length !== groupArtifact.runtime.length) return false;
  let normalized: string = code.toLowerCase();
  for (const entries of Object.values(groupArtifact.immutableReferences))
    for (const { start, length } of entries) {
      const a = 2 + start * 2,
        b = a + length * 2;
      normalized = normalized.slice(0, a) + groupArtifact.runtime.slice(a, b) + normalized.slice(b);
    }
  return normalized === groupArtifact.runtime.toLowerCase();
}
export async function verifyDeployment(client: ChainClient, deployment: Deployment) {
  if (
    deployment.chainId !== 10143 ||
    !same(deployment.asset, TOKEN) ||
    (await client.getChainId()) !== 10143
  )
    throw Error('WRONG_CHAIN');
  const [code, token, admin] = await Promise.all([
    client.getCode({ address: deployment.address }),
    client.readContract({ address: deployment.address, abi: groupAbi, functionName: 'asset' }),
    client.readContract({
      address: deployment.address,
      abi: groupAbi,
      functionName: 'intakeAdmin',
    }),
  ]);
  if (
    !code ||
    !runtimeMatches(code) ||
    !same(keccak256(code), deployment.runtimeHash) ||
    !same(token, TOKEN) ||
    !same(admin, deployment.intakeAdmin)
  )
    throw Error('UNVERIFIED_CONTRACT');
}
export type ReceiptResult = {
  state: 'unknown' | 'reverted' | 'replaced' | 'finalized';
  hash?: Hex;
  block?: string;
  blockHash?: Hex;
};
export interface CloudChain {
  eoa(address: Address): Promise<boolean>;
  prepare(
    deployment: Deployment,
    creator: Address,
  ): Promise<{ timestamp: number; block: string; nonce: number }>;
  confirm(intent: PublishIntent, hash?: Hex): Promise<ReceiptResult>;
  snapshot(intent: PublishIntent): Promise<ChainSnapshot>;
}
export function makeCloudChain(client: ChainClient = makeClient()): CloudChain {
  async function snapshot(i: PublishIntent): Promise<ChainSnapshot> {
    await verifyDeployment(client, i.deployment);
    const block = await client.getBlock({ blockTag: 'finalized' });
    if (!block.hash || block.number === null) throw Error('FINALITY_UNAVAILABLE');
    const g = await client.readContract({
      address: i.deployment.address,
      abi: groupAbi,
      functionName: 'getGroup',
      args: [i.chainBoxId],
      blockNumber: block.number,
    });
    if (
      !same(g.creator, i.creator) ||
      !same(g.termsHash, i.termsHash) ||
      !same(g.terms.metadataHash, i.metadataHash)
    )
      throw Error('INTEGRITY_ERROR');
    const names = ['NONE', 'OPEN', 'READY', 'REFUNDABLE', 'CANCELLED', 'SETTLED'] as const;
    let state: string = names[g.state] ?? 'NONE';
    if (state === 'OPEN')
      state =
        block.timestamp < g.terms.startsAt
          ? 'UPCOMING'
          : block.timestamp >= g.terms.fundingDeadline
            ? g.activeCount >= g.terms.minParticipants
              ? 'READY'
              : 'REFUNDABLE'
            : g.activeCount >= g.terms.capacity
              ? 'FULL'
              : 'OPEN';
    if (state === 'NONE') throw Error('INTEGRITY_ERROR');
    // Recheck canonical block after historical state reads.
    if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash)
      throw Error('FINALITY_UNAVAILABLE');
    return {
      state: state as ChainSnapshot['state'],
      activeCount: g.activeCount,
      locked: g.locked.toString(),
      blockNumber: block.number.toString(),
      blockHash: block.hash,
      timestamp: Number(block.timestamp),
    };
  }
  return {
    async eoa(address) {
      if ((await client.getChainId()) !== 10143) throw Error('WRONG_CHAIN');
      const code = await client.getCode({ address });
      return !code || code === '0x';
    },
    async prepare(deployment, creator) {
      await verifyDeployment(client, deployment);
      await inspectNetwork(client);
      const [block, nonce, paused, code] = await Promise.all([
        client.getBlock({ blockTag: 'latest' }),
        client.getTransactionCount({ address: creator, blockTag: 'pending' }),
        client.readContract({
          address: deployment.address,
          abi: groupAbi,
          functionName: 'intakePaused',
        }),
        client.getCode({ address: creator }),
      ]);
      if (paused || (code && code !== '0x')) throw Error('PUBLISH_BLOCKED');
      return { timestamp: Number(block.timestamp), block: block.number.toString(), nonce };
    },
    async confirm(i, supplied) {
      await verifyDeployment(client, i.deployment);
      let hash = supplied;
      if (!hash) {
        hash = await recoverNonce(client, i.creator, i.nonce, BigInt(i.startBlock));
      }
      if (!hash) return { state: 'unknown' };
      let tx, receipt;
      try {
        [tx, receipt] = await Promise.all([
          client.getTransaction({ hash }),
          client.getTransactionReceipt({ hash }),
        ]);
      } catch {
        return { state: 'unknown', hash };
      }
      if (!same(tx.from, i.creator) || tx.nonce !== i.nonce) throw Error('TRANSACTION_MISMATCH');
      // Matching call fields do not exclude a delegation installed by the transaction itself.
      if (!['legacy', 'eip2930', 'eip1559'].includes(tx.type) || tx.authorizationList != null)
        throw Error('UNSUPPORTED_TRANSACTION');
      const [canonical, finalized] = await Promise.all([
        client.getBlock({ blockNumber: receipt.blockNumber }),
        client.getBlock({ blockTag: 'finalized' }),
      ]);
      if (
        canonical.hash !== receipt.blockHash ||
        finalized.number < receipt.blockNumber ||
        tx.blockHash !== receipt.blockHash
      )
        return { state: 'unknown', hash };
      const result = { hash, block: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
      if (receipt.status !== 'success') return { ...result, state: 'reverted' };
      if (
        !tx.to ||
        !same(tx.to, i.deployment.address) ||
        tx.value !== 0n ||
        !same(tx.input, calldata(i))
      )
        return { ...result, state: 'replaced' };
      const { decodeEventLog } = await import('viem');
      const created = receipt.logs.some((log) => {
        if (!same(log.address, i.deployment.address)) return false;
        try {
          const e = decodeEventLog({
            abi: groupAbi,
            eventName: 'BoxCreated',
            topics: log.topics,
            data: log.data,
          });
          return (
            same(e.args.boxId, i.chainBoxId) &&
            same(e.args.creator, i.creator) &&
            same(e.args.asset, TOKEN) &&
            same(e.args.beneficiary, i.data.beneficiary) &&
            same(e.args.termsHash, i.termsHash) &&
            same(e.args.metadataHash, i.metadataHash)
          );
        } catch {
          return false;
        }
      });
      if (!created) throw Error('TRANSACTION_MISMATCH');
      await snapshot(i);
      return { ...result, state: 'finalized' };
    },
    snapshot,
  };
}
