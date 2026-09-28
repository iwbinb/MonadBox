import { z } from 'zod';
import { isAddress, getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { groupDataSchema } from '../group/draft';
export const addressSchema = z
  .string()
  .refine((x) => isAddress(x) && !/^0x0{40}$/i.test(x))
  .transform((x) => getAddress(x));
export const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((x) => x.toLowerCase() as Hex);
export const deploymentSchema = z.strictObject({
  chainId: z.literal(10143),
  version: z.literal(1),
  address: addressSchema,
  asset: addressSchema,
  intakeAdmin: addressSchema,
  runtimeHash: hashSchema,
});
export type Deployment = z.infer<typeof deploymentSchema>;
export const intentSchema = z.strictObject({
  id: z.string().uuid(),
  boxId: z.string().uuid(),
  publicId: z.string().uuid(),
  deployment: deploymentSchema,
  creator: addressSchema,
  salt: hashSchema,
  chainBoxId: hashSchema,
  termsHash: hashSchema,
  metadataHash: hashSchema,
  data: groupDataSchema,
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  startBlock: z.string().regex(/^\d+$/),
  expiresAt: z.number().int().positive(),
});
export type PublishIntent = z.infer<typeof intentSchema>;
export type PublicationState = 'prepared' | 'unknown' | 'finalized' | 'reverted' | 'replaced';
export interface CloudBox {
  id: string;
  publicId: string;
  revision: number;
  owner: Address;
  state: 'draft' | 'prepared' | 'published';
  data: z.infer<typeof groupDataSchema>;
  metadata: string;
  metadataHash: Hex;
  publication: null | { intent: PublishIntent; state: PublicationState; hash: Hex | null };
}
export interface SessionInfo {
  address: Address;
  csrf: string;
  expiresAt: number;
}
export interface ChainSnapshot {
  state: 'UPCOMING' | 'OPEN' | 'FULL' | 'READY' | 'REFUNDABLE' | 'CANCELLED' | 'SETTLED';
  activeCount: number;
  locked: string;
  blockNumber: string;
  blockHash: Hex;
  timestamp: number;
}
export interface PublicGroup {
  publicId: string;
  creator: Address;
  data: z.infer<typeof groupDataSchema>;
  metadata: string;
  metadataHash: Hex;
  termsHash: Hex;
  module: Address;
  chainBoxId: Hex;
  transactionHash: Hex;
  snapshot: ChainSnapshot;
  paymentsEnabled: boolean;
  intent: PublishIntent;
}
export const LOGIN_STATEMENT =
  'Sign in to MonadBox to manage group drafts. This does not authorize payments or token approvals.';
