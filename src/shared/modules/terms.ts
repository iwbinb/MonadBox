import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, stringToHex } from 'viem';
import type { Abi, AbiParameter, Address, Hex } from 'viem';
import { artifact as split } from './generated/SplitPaymentsV1';
import { artifact as group } from './generated/GroupEscrowV2';
import { moduleDataSchema, modulePublicationSchema } from './model';
import type { ModuleData, ModuleIntent, ModulePublication } from './model';
import { TOKEN } from '../lab/network';
import { same } from '../cloud/chain';
export const definitions = {
  split: { artifact: split, create: 'createSplit', get: 'getSplit', version: 1 },
  group: { artifact: group, create: 'createGroup', get: 'getGroup', version: 2 },
} as const;
export function moduleAbi(tool: ModuleData['tool']): Abi {
  return definitions[tool].artifact.abi;
}
export function metadataFor(input: ModuleData): string {
  const data = moduleDataSchema.parse(input);
  return JSON.stringify({
    schema: 1,
    tool: data.tool,
    title: data.title,
    description: data.description,
  });
}
export function termsFor(data: ModuleData) {
  const shares = {
    recipients: data.recipients.map((r) => r.address),
    bps: data.recipients.map((r) => r.bps),
    metadataHash: keccak256(stringToHex(metadataFor(data))),
  };
  return data.tool === 'split'
    ? shares
    : {
        unitPrice: BigInt(data.unitPrice),
        minParticipants: data.minimum,
        capacity: data.capacity,
        startsAt: BigInt(data.startsAt),
        fundingDeadline: BigInt(data.fundingDeadline),
        settleNotBefore: BigInt(data.settleNotBefore),
        ...shares,
      };
}
export function moduleId(module: Address, creator: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }],
      [10143n, module, creator, salt],
    ),
  );
}
export function termsHashFor(
  p: Pick<ModulePublication, 'deployment' | 'creator' | 'salt' | 'data'>,
): Hex {
  const definition = definitions[p.data.tool];
  const fn = moduleAbi(p.data.tool).find(
    (f) => f.type === 'function' && f.name === definition.create,
  );
  if (!fn || fn.type !== 'function') throw Error('UNSUPPORTED_MODULE');
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        fn.inputs[0] as AbiParameter,
      ],
      [
        BigInt(definition.version),
        10143n,
        p.deployment.address,
        moduleId(p.deployment.address, p.creator, p.salt),
        TOKEN,
        p.creator,
        termsFor(p.data),
      ],
    ),
  );
}
export function validatePublication(input: ModulePublication): ModulePublication {
  const p = modulePublicationSchema.parse(input);
  if (
    p.data.tool !== p.deployment.tool ||
    !same(p.deployment.asset, TOKEN) ||
    p.metadata !== metadataFor(p.data) ||
    p.metadataHash !== keccak256(stringToHex(p.metadata)) ||
    p.chainBoxId !== moduleId(p.deployment.address, p.creator, p.salt) ||
    p.termsHash !== termsHashFor(p) ||
    p.data.recipients.some((r) => same(r.address, p.deployment.address))
  )
    throw Error('INTEGRITY_ERROR');
  return p;
}
export function moduleCall(i: ModuleIntent): { to: Address; data: Hex } {
  const p = validatePublication(i.publication),
    abi = moduleAbi(p.data.tool),
    id = p.chainBoxId;
  if (i.action === 'approve') {
    const amount = p.data.tool === 'group' ? p.data.unitPrice : i.amount;
    if (!amount) throw Error('INVALID_AMOUNT');
    return {
      to: TOKEN,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [p.deployment.address, BigInt(amount)],
      }),
    };
  }
  let name: string = i.action,
    args: readonly unknown[] = [id];
  if (i.action === 'create') {
    if (!same(i.actor, p.creator)) throw Error('WRONG_ACCOUNT');
    name = definitions[p.data.tool].create;
    args = [termsFor(p.data), p.salt];
  } else if (i.action === 'withdrawFor' || i.action === 'creditRefund') args = [id, i.actor];
  else if (i.action === 'pay') {
    if (p.data.tool !== 'split' || !i.amount || !i.paymentNonce) throw Error('INVALID_PAYMENT');
    args = [id, BigInt(i.amount), i.paymentNonce];
  } else if (p.data.tool !== 'group') throw Error('ACTION_UNAVAILABLE');
  return { to: p.deployment.address, data: encodeFunctionData({ abi, functionName: name, args }) };
}
/** Identical bounded integer allocation to SplitMath.sol; order resolves ties. */
export function allocateSplit(amount: bigint, bps: readonly number[]): bigint[] {
  if (
    amount < 0n ||
    amount > (1n << 256n) - 1n ||
    bps.length < 2 ||
    bps.length > 20 ||
    bps.some((v) => !Number.isInteger(v) || v <= 0) ||
    bps.reduce((a, b) => a + b, 0) !== 10000
  )
    throw Error('INVALID_SPLIT');
  const shares = bps.map((b) => (amount * BigInt(b)) / 10000n);
  const ranked = bps
    .map((b, index) => ({ index, remainder: (amount * BigInt(b)) % 10000n }))
    .sort((a, b) => Number(b.remainder - a.remainder) || a.index - b.index);
  const remaining = Number(amount - shares.reduce((a, b) => a + b, 0n));
  for (let n = 0; n < remaining; n++) shares[ranked[n]!.index]! += 1n;
  return shares;
}
