import { z } from 'zod';
import { addressSchema, hashSchema } from '../cloud/model';
export const MAX_UINT256 = (1n << 256n) - 1n;
export const amountSchema = z
  .string()
  .regex(/^[1-9]\d{0,77}$/)
  .refine((v) => /^[1-9]\d{0,77}$/.test(v) && BigInt(v) <= MAX_UINT256);
export const timeSchema = z.number().int().positive().max(4_102_444_799);
export const recipientsSchema = z
  .array(z.strictObject({ address: addressSchema, bps: z.number().int().min(1).max(10000) }))
  .min(2)
  .max(20)
  .superRefine((list, ctx) => {
    if (list.reduce((sum, row) => sum + row.bps, 0) !== 10000)
      ctx.addIssue({
        code: 'custom',
        message: 'Shares must add up to 10000 bps / 比例合计必须为100%',
      });
    if (new Set(list.map((row) => row.address.toLowerCase())).size !== list.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Recipient addresses must be unique / 收款地址不可重复',
      });
  });
const common = {
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000),
};
export const splitSchema = z.strictObject({
  tool: z.literal('split'),
  ...common,
  recipients: recipientsSchema,
});
export const groupV2Schema = z
  .strictObject({
    tool: z.literal('group'),
    ...common,
    recipients: recipientsSchema,
    unitPrice: amountSchema,
    minimum: z.number().int().min(2).max(200),
    capacity: z.number().int().min(2).max(200),
    startsAt: timeSchema,
    fundingDeadline: timeSchema,
    settleNotBefore: timeSchema,
  })
  .superRefine((data, ctx) => {
    if (
      data.minimum > data.capacity ||
      data.startsAt >= data.fundingDeadline ||
      data.fundingDeadline > data.settleNotBefore ||
      BigInt(data.unitPrice) * BigInt(data.capacity) > MAX_UINT256
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid group limits or times / 人数、金额或时间不合法',
      });
  });
export const deliverySchema = z
  .strictObject({
    tool: z.literal('deliver'),
    ...common,
    buyer: addressSchema,
    seller: addressSchema,
    amount: amountSchema,
    fundBy: timeSchema,
    workDuration: z
      .number()
      .int()
      .min(3600)
      .max(30 * 86400),
    reviewDuration: z
      .number()
      .int()
      .min(3600)
      .max(7 * 86400),
    disputeDuration: z
      .number()
      .int()
      .min(86400)
      .max(30 * 86400),
  })
  .refine(
    (d) => d.buyer.toLowerCase() !== d.seller.toLowerCase(),
    'Buyer and seller must differ / 客户与服务者必须不同',
  );
export const attendanceSchema = z
  .strictObject({
    tool: z.literal('attend'),
    ...common,
    deposit: amountSchema,
    capacity: z.number().int().min(1).max(200),
    registrationDeadline: timeSchema,
    eventStart: timeSchema,
    eventEnd: timeSchema,
    checkinStart: timeSchema,
    checkinDeadline: timeSchema,
    challengeDeadline: timeSchema,
    disputeDuration: z
      .number()
      .int()
      .min(86400)
      .max(30 * 86400),
    noShowPenaltyBps: z.number().int().min(0).max(10000),
    penaltyBeneficiary: addressSchema,
    checkinSigner: addressSchema,
  })
  .refine(
    (d) =>
      d.registrationDeadline <= d.eventStart &&
      d.eventStart < d.eventEnd &&
      d.checkinStart <= d.eventStart &&
      d.checkinDeadline >= d.eventEnd &&
      d.challengeDeadline > d.checkinDeadline &&
      BigInt(d.deposit) * BigInt(d.capacity) <= MAX_UINT256,
    'Invalid event dates or capacity / 活动时间或人数不合法',
  );
export const milestoneStageSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  amount: amountSchema,
  workDuration: z
    .number()
    .int()
    .min(3600)
    .max(30 * 86400),
  reviewDuration: z
    .number()
    .int()
    .min(3600)
    .max(7 * 86400),
});
export const milestonesSchema = z
  .strictObject({
    tool: z.literal('milestones'),
    ...common,
    buyer: addressSchema,
    seller: addressSchema,
    fundBy: timeSchema,
    disputeDuration: z
      .number()
      .int()
      .min(86400)
      .max(30 * 86400),
    stages: z.array(milestoneStageSchema).min(2).max(10),
  })
  .refine(
    (d) =>
      d.buyer.toLowerCase() !== d.seller.toLowerCase() &&
      d.stages.reduce((sum, s) => sum + BigInt(s.amount), 0n) <= MAX_UINT256,
    'Invalid parties or total / 双方地址或总额无效',
  );
export const moduleDataSchema = z.discriminatedUnion('tool', [
  splitSchema,
  groupV2Schema,
  deliverySchema,
  attendanceSchema,
  milestonesSchema,
]);
export type ModuleData = z.infer<typeof moduleDataSchema>;
export const moduleDeploymentSchema = z
  .strictObject({
    tool: z.enum(['split', 'group', 'deliver', 'attend', 'milestones']),
    chainId: z.literal(10143),
    version: z.number().int(),
    address: addressSchema,
    asset: addressSchema,
    intakeAdmin: addressSchema,
    runtimeHash: hashSchema,
  })
  .refine((d) => d.version === (d.tool === 'group' ? 2 : 1), 'Unsupported contract version');
export type ModuleDeployment = z.infer<typeof moduleDeploymentSchema>;
export const moduleRegistrationSchema = z.strictObject({
  deployment: moduleDeploymentSchema,
  current: z.boolean(),
});
export const modulePublicationSchema = z.strictObject({
  id: z.string().uuid(),
  publicId: z.string().uuid(),
  creator: addressSchema,
  data: moduleDataSchema,
  deployment: moduleDeploymentSchema,
  salt: hashSchema,
  chainBoxId: hashSchema,
  termsHash: hashSchema,
  metadata: z.string().max(16000),
  metadataHash: hashSchema,
});
export type ModulePublication = z.infer<typeof modulePublicationSchema>;
export const moduleActionSchema = z.enum([
  'create',
  'approve',
  'pay',
  'contribute',
  'leave',
  'finalize',
  'cancel',
  'creditRefund',
  'settle',
  'withdrawFor',
  'register',
  'checkIn',
  'cancelEvent',
  'challengeNoShow',
  'finalizeNoShow',
  'refundDispute',
  'fund',
  'cancelOffer',
  'submitDelivery',
  'accept',
  'dispute',
  'refundBySeller',
  'settleAfterReview',
  'refundAfterMissingDelivery',
  'resolveByAgreement',
  'refundAfterDisputeTimeout',
]);
export type ModuleAction = z.infer<typeof moduleActionSchema>;
export const uintSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,77})$/)
  .refine((v) => /^(0|[1-9]\d{0,77})$/.test(v) && BigInt(v) <= MAX_UINT256);
export const agreementSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    boxId: hashSchema,
    orderId: hashSchema,
    termsHash: hashSchema,
    asset: addressSchema,
    remaining: amountSchema,
    buyer: addressSchema,
    seller: addressSchema,
    buyerAmount: uintSchema,
    sellerAmount: uintSchema,
    settlementNonce: uintSchema,
    deadline: timeSchema,
    stageIndex: z.number().int().min(0).max(9),
  })
  .refine(
    (a) => BigInt(a.buyerAmount) + BigInt(a.sellerAmount) === BigInt(a.remaining),
    'Agreement must allocate the entire remaining amount / 协议须分配全部剩余款',
  );
export type Agreement = z.infer<typeof agreementSchema>;
export interface AgreementSignatures {
  first: `0x${string}`;
  second: `0x${string}`;
}
export type ModuleSignatures = Partial<AgreementSignatures> & { checkIn?: `0x${string}` };
export const checkInSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    boxId: hashSchema,
    termsHash: hashSchema,
    attendee: addressSchema,
    signer: addressSchema,
    issuedAt: timeSchema,
    deadline: timeSchema,
    nonce: uintSchema,
  })
  .refine((p) => p.issuedAt < p.deadline, 'Invalid check-in expiry');
export type CheckInProof = z.infer<typeof checkInSchema>;
export const moduleIntentSchema = z.strictObject({
  id: z.string().uuid(),
  publication: modulePublicationSchema,
  actor: addressSchema,
  action: moduleActionSchema,
  amount: amountSchema.optional(),
  paymentNonce: hashSchema.optional(),
  evidenceHash: hashSchema.optional(),
  participant: addressSchema.optional(),
  checkIn: checkInSchema.optional(),
  agreement: agreementSchema.optional(),
  calldataHash: hashSchema.optional(),
  stageIndex: z.number().int().min(0).max(9).optional(),
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  startBlock: z.string().regex(/^\d+$/),
  expiresAt: timeSchema,
});
export type ModuleIntent = z.infer<typeof moduleIntentSchema>;
export interface ModuleBox {
  id: string;
  publicId: string;
  owner: string;
  revision: number;
  data: ModuleData;
  metadata: string;
  state: 'draft' | 'prepared' | 'published';
  publication: ModuleIntent | null;
  receipt: {
    state: 'prepared' | 'unknown' | 'finalized' | 'reverted' | 'replaced';
    hash?: `0x${string}`;
    block?: string;
    blockHash?: `0x${string}`;
  } | null;
}
