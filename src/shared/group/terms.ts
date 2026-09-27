import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from 'viem';
import type { Address, Hex } from 'viem';
import { GROUP_ASSET, GROUP_CHAIN, groupDataSchema } from './draft';
import type { GroupData } from './draft';

/** Versioned, fixed-order JSON; do not replace the raw bytes after hashing. All metadata is intended to be public. */
export function groupMetadata(data: GroupData): string {
  const d = groupDataSchema.parse(data);
  return JSON.stringify({ version: 1, title: d.title, description: d.description });
}
export function groupTerms(data: GroupData) {
  const d = groupDataSchema.parse(data);
  return {
    beneficiary: d.beneficiary as Address,
    unitPrice: BigInt(d.unitPrice),
    minParticipants: d.minimum,
    capacity: d.capacity,
    startsAt: BigInt(d.startsAt),
    fundingDeadline: BigInt(d.fundingDeadline),
    settleNotBefore: BigInt(d.settleNotBefore),
    metadataHash: keccak256(stringToHex(groupMetadata(d))),
  };
}
export function groupId(module: Address, creator: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('uint256,address,address,bytes32'), [
      BigInt(GROUP_CHAIN),
      module,
      creator,
      salt,
    ]),
  );
}
export function groupTermsHash(
  module: Address,
  creator: Address,
  salt: Hex,
  data: GroupData,
  asset: Address = GROUP_ASSET,
): Hex {
  const t = groupTerms(data);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        'uint256,uint256,address,bytes32,address,address,(address beneficiary,uint256 unitPrice,uint32 minParticipants,uint32 capacity,uint64 startsAt,uint64 fundingDeadline,uint64 settleNotBefore,bytes32 metadataHash)',
      ),
      [1n, BigInt(GROUP_CHAIN), module, groupId(module, creator, salt), asset, creator, t],
    ),
  );
}
