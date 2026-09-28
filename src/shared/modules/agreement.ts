import { hashTypedData } from 'viem';
import type { ModulePublication, Agreement } from './model';
import { agreementSchema } from './model';
import type { ModuleSnapshot } from './chain';
import { agreementTerms, validatePublication } from './terms';
import { same } from '../cloud/chain';
export const agreementTypes = {
  Agreement: [
    { name: 'schemaVersion', type: 'uint256' },
    { name: 'boxId', type: 'bytes32' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'termsHash', type: 'bytes32' },
    { name: 'asset', type: 'address' },
    { name: 'remaining', type: 'uint256' },
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'buyerAmount', type: 'uint256' },
    { name: 'sellerAmount', type: 'uint256' },
    { name: 'settlementNonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
    { name: 'stageIndex', type: 'uint256' },
  ],
} as const;
export function agreementTypedData(p: ModulePublication, a: Agreement) {
  validatePublication(p);
  if (p.data.tool !== 'deliver') throw Error('ACTION_UNAVAILABLE');
  return {
    domain: {
      name: 'DeliveryEscrowV1',
      version: '1',
      chainId: 10143,
      verifyingContract: p.deployment.address,
    },
    types: agreementTypes,
    primaryType: 'Agreement' as const,
    message: agreementTerms(agreementSchema.parse(a)),
  };
}
export function validateAgreement(
  p: ModulePublication,
  s: ModuleSnapshot,
  input: unknown,
): Agreement {
  const a = agreementSchema.parse(input),
    d = p.data;
  if (
    d.tool !== 'deliver' ||
    s.state !== 'DISPUTED' ||
    a.boxId !== p.chainBoxId ||
    a.orderId !== p.chainBoxId ||
    a.termsHash !== p.termsHash ||
    !same(a.asset, p.deployment.asset) ||
    !same(a.buyer, d.buyer) ||
    !same(a.seller, d.seller) ||
    a.remaining !== s.locked ||
    a.settlementNonce !== s.settlementNonce ||
    a.stageIndex !== 0 ||
    a.deadline > s.disputeDue! ||
    a.deadline <= s.timestamp
  )
    throw Error('AGREEMENT_CHANGED');
  return a;
}
export const agreementHash = (p: ModulePublication, a: Agreement) =>
  hashTypedData(agreementTypedData(p, a));
