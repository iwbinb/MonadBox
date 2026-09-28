import { hashTypedData } from 'viem';
import type { ModulePublication, Agreement } from './model';
import { agreementSchema } from './model';
import type { ModuleSnapshot } from './chain';
import { attendanceOrderId, signedModuleNames, agreementTerms, validatePublication } from './terms';
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
  if (p.data.tool !== 'deliver' && p.data.tool !== 'attend' && p.data.tool !== 'milestones')
    throw Error('ACTION_UNAVAILABLE');
  return {
    domain: {
      name: signedModuleNames[p.data.tool],
      version: '1',
      chainId: 10143,
      verifyingContract: p.deployment.address,
    },
    types: agreementTypes,
    primaryType: 'Agreement' as const,
    message: agreementTerms(agreementSchema.parse(a)),
  };
}
export function agreementContext(p: ModulePublication, s: ModuleSnapshot) {
  const d = p.data;
  if (d.tool === 'deliver' || d.tool === 'milestones')
    return {
      buyer: d.buyer,
      seller: d.seller,
      secondSigner: d.seller,
      remaining: s.locked,
      orderId: p.chainBoxId,
      stageIndex: d.tool === 'milestones' ? s.currentStage! : 0,
      disputed: s.state === 'DISPUTED',
    };
  if (d.tool === 'attend' && s.participant && s.positionLocked !== undefined)
    return {
      buyer: s.participant,
      seller: d.penaltyBeneficiary,
      secondSigner: p.creator,
      remaining: s.positionLocked,
      orderId: attendanceOrderId(p.chainBoxId, s.participant),
      stageIndex: 0,
      disputed: s.position === 4 && !s.cancelled,
    };
  throw Error('ACTION_UNAVAILABLE');
}
export function validateAgreement(
  p: ModulePublication,
  s: ModuleSnapshot,
  input: unknown,
): Agreement {
  const a = agreementSchema.parse(input),
    c = agreementContext(p, s);
  if (
    !c.disputed ||
    a.boxId !== p.chainBoxId ||
    a.orderId !== c.orderId ||
    a.termsHash !== p.termsHash ||
    !same(a.asset, p.deployment.asset) ||
    !same(a.buyer, c.buyer) ||
    !same(a.seller, c.seller) ||
    a.remaining !== c.remaining ||
    a.settlementNonce !== s.settlementNonce ||
    a.stageIndex !== c.stageIndex ||
    !s.disputeDue ||
    a.deadline > s.disputeDue ||
    a.deadline <= s.timestamp
  )
    throw Error('AGREEMENT_CHANGED');
  return a;
}
export const agreementHash = (p: ModulePublication, a: Agreement) =>
  hashTypedData(agreementTypedData(p, a));
