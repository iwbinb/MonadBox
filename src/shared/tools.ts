export type Locale = 'en' | 'zh';
export type ToolId = 'group' | 'split' | 'deliver' | 'attend' | 'milestones' | 'rewards';
type Copy = Record<Locale, string>;
export interface Tool {
  id: ToolId;
  name: string;
  label: Copy;
  description: Copy;
  scenario: Copy;
  caution: Copy;
  steps: [Copy, Copy, Copy];
  stage: string;
}
export const tools: Tool[] = [
  {
    id: 'group',
    name: 'Group',
    label: { en: 'Collect together', zh: '成团收款' },
    description: {
      en: 'Pool a fixed payment. Return funds if the group does not form.',
      zh: '按固定金额筹款，未成团按规则退款。',
    },
    scenario: {
      en: 'For workshops, community budgets and shared plans.',
      zh: '适用于工作坊、社区共同预算与小组计划。',
    },
    caution: {
      en: 'A successful group is not proof of real-world delivery. Exit and settlement deadlines must be agreed before payment.',
      zh: '成团不代表现实交付完成。付款前必须明确退出期限和结算时间。',
    },
    steps: [
      { en: 'Set the target and deadline', zh: '设置人数与截止时间' },
      { en: 'Share a payment link', zh: '分享付款链接' },
      { en: 'Settle or make refunds available', zh: '按规则结算或开放退款' },
    ],
    stage: 'M1',
  },
  {
    id: 'split',
    name: 'Split',
    label: { en: 'Share the proceeds', zh: '合伙分账' },
    description: {
      en: 'Define the shares once. Allocate final payments to your partners.',
      zh: '事先固定比例，向合作伙伴分配最终款项。',
    },
    scenario: {
      en: 'For collaborators, creators and small service teams.',
      zh: '适用于联合创作与小型服务团队。',
    },
    caution: {
      en: 'Split is for final payments only. Funds with an outstanding refund obligation cannot be distributed.',
      zh: '仅处理最终付款。仍有退款义务的资金不能提前分配。',
    },
    steps: [
      { en: 'Confirm recipients and shares', zh: '确认地址和分成比例' },
      { en: 'Receive a final payment', zh: '接收最终付款' },
      { en: 'Each partner claims their share', zh: '各方领取自己的份额' },
    ],
    stage: 'M2-A',
  },
  {
    id: 'deliver',
    name: 'Deliver',
    label: { en: 'Get paid for delivery', zh: '交付收款' },
    description: {
      en: 'Connect a one-off delivery to a clear review and payment process.',
      zh: '把一次性交付、验收和付款对应起来。',
    },
    scenario: {
      en: 'For design work, writing and small fixed-scope commissions.',
      zh: '适用于设计稿、文稿及小额固定范围委托。',
    },
    caution: {
      en: 'Silence after the review deadline can allow settlement. Disputes use disclosed agreement and timeout rules, not an AI verdict.',
      zh: '验收期内不提出异议可能允许结算。争议按协议与超时规则退出，不由 AI 裁决。',
    },
    steps: [
      { en: 'Agree on delivery and review terms', zh: '约定交付和验收规则' },
      { en: 'Pre-fund and submit the work', zh: '预付资金并提交成果' },
      { en: 'Accept or raise a timely dispute', zh: '接受交付或及时提出异议' },
    ],
    stage: 'M3',
  },
  {
    id: 'attend',
    name: 'Attend',
    label: { en: 'Make attendance count', zh: '报名保证金' },
    description: {
      en: 'Collect a deposit with clear check-in, refund and appeal rules.',
      zh: '收取报名押金，公开签到、退款与申诉规则。',
    },
    scenario: {
      en: 'For small meetups and community sessions; not a ticket marketplace.',
      zh: '适用于小型聚会与社区活动，不是门票交易市场。',
    },
    caution: {
      en: 'Attendance relies on an identified organizer. No-show deductions and the appeal deadline must be visible before payment.',
      zh: '签到依赖明确的组织者。付款前应显示未到场扣款规则与申诉截止时间。',
    },
    steps: [
      { en: 'Publish the deposit rules', zh: '发布押金规则' },
      { en: 'Register and check in', zh: '报名并提交签到' },
      { en: 'Claim your return or appeal', zh: '领取退款或提出申诉' },
    ],
    stage: 'M4',
  },
  {
    id: 'milestones',
    name: 'Milestones',
    label: { en: 'Pay as work progresses', zh: '分阶段付款' },
    description: {
      en: 'Agree on the full plan. Release payments one accepted stage at a time.',
      zh: '预先约定完整计划，分阶段验收和释放资金。',
    },
    scenario: {
      en: 'For projects with two to ten clearly defined stages.',
      zh: '适用于两到十个明确阶段的小型项目。',
    },
    caution: {
      en: 'Released stages cannot be forcibly refunded. Only the remaining escrow follows cancellation and dispute rules.',
      zh: '已释放阶段不可强制追回，仅剩余托管款按取消和争议规则处理。',
    },
    steps: [
      { en: 'Define stages and amounts', zh: '定义阶段和金额' },
      { en: 'Fund the agreed plan', zh: '预存约定的总款' },
      { en: 'Review each stage before release', zh: '逐阶段验收与结算' },
    ],
    stage: 'M5',
  },
  {
    id: 'rewards',
    name: 'Rewards',
    label: { en: 'Let contributors claim', zh: '奖励领取' },
    description: {
      en: 'Fund a verified address list. Let each contributor claim once.',
      zh: '按明确地址名单预存奖励，每个地址领取一次。',
    },
    scenario: {
      en: 'For community contributions, event rewards and address-based grants.',
      zh: '适用于社区贡献、活动奖励和地址名单制补贴。',
    },
    caution: {
      en: 'Recipients and amounts are public on-chain. Once funded, the list cannot be edited or reclaimed before expiry.',
      zh: '名单及金额公开上链。生效后不可编辑名单，也不可提前回收。',
    },
    steps: [
      { en: 'Check the recipient list', zh: '核对领取名单' },
      { en: 'Fund the full reward amount', zh: '全额预存奖励' },
      { en: 'Share the claim link', zh: '分享领取链接' },
    ],
    stage: 'M6',
  },
];
export const getTool = (id?: string): Tool | undefined => tools.find((tool) => tool.id === id);
