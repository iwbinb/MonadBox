const labels: Record<string, [string, string]> = {
  DRAFT: ['Draft', '草稿'],
  PREPARED: ['Rules frozen; publication pending', '规则已冻结，待发布'],
  UNCHECKED: ['Awaiting chain check', '待核验链上状态'],
  UNVERIFIED: ['Chain lookup unavailable', '链上查询暂不可用'],
  ACTIVE: ['Accepting payments', '可接收付款'],
  UPCOMING: ['Not started', '尚未开始'],
  OPEN: ['Open for participation', '开放参与'],
  FULL: ['All places filled', '名额已满'],
  READY: ['Group successful', '已成团'],
  REFUNDABLE: ['Refund available', '可申请退款'],
  CANCELLED: ['Cancelled', '已取消'],
  SETTLED: ['Allocated to recipients', '已归属收款人'],
  signing: ['Waiting for wallet', '等待钱包'],
  broadcast: ['Broadcast; awaiting confirmation', '已广播，待确认'],
  unknown: ['Outcome unknown; recheck', '结果未知，请核验'],
  rejected: ['Signature declined', '已拒绝签名'],
  finalized: ['Finalized', '最终确认'],
  reverted: ['Transaction reverted', '交易失败并回滚'],
  replaced: ['Transaction replaced', '交易已替换'],
};
export function statusLabel(state: string, t: (en: string, zh: string) => string) {
  return labels[state] ? t(...labels[state]) : state;
}
