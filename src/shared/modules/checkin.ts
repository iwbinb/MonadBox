import { hashTypedData } from 'viem';
import type { CheckInProof, ModulePublication } from './model';
import { checkInSchema } from './model';
import type { ModuleSnapshot } from './chain';
import { checkInTerms, validatePublication } from './terms';
import { same } from '../cloud/chain';
export const checkInTypes = {
  CheckIn: [
    { name: 'schemaVersion', type: 'uint256' },
    { name: 'boxId', type: 'bytes32' },
    { name: 'termsHash', type: 'bytes32' },
    { name: 'attendee', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;
export function checkInTypedData(p: ModulePublication, proof: CheckInProof) {
  validatePublication(p);
  if (p.data.tool !== 'attend') throw Error('ACTION_UNAVAILABLE');
  return {
    domain: {
      name: 'AttendanceBondV1',
      version: '1',
      chainId: 10143,
      verifyingContract: p.deployment.address,
    },
    types: checkInTypes,
    primaryType: 'CheckIn' as const,
    message: checkInTerms(checkInSchema.parse(proof)),
  };
}
export function validateCheckIn(p: ModulePublication, s: ModuleSnapshot, input: unknown) {
  const proof = checkInSchema.parse(input),
    d = p.data;
  if (
    d.tool !== 'attend' ||
    s.cancelled ||
    s.position !== 1 ||
    !s.participant ||
    proof.boxId !== p.chainBoxId ||
    proof.termsHash !== p.termsHash ||
    !same(proof.attendee, s.participant) ||
    !same(proof.signer, d.checkinSigner) ||
    proof.nonce !== s.checkinNonce ||
    proof.issuedAt < d.checkinStart ||
    proof.issuedAt > s.timestamp ||
    proof.deadline > d.checkinDeadline ||
    proof.deadline <= s.timestamp ||
    s.timestamp < d.checkinStart ||
    s.timestamp >= d.checkinDeadline
  )
    throw Error('CHECKIN_CHANGED');
  return proof;
}
export const checkInHash = (p: ModulePublication, proof: CheckInProof) =>
  hashTypedData(checkInTypedData(p, proof));
