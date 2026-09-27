# M0-B 工程基础验收

日期：2026-09-27。工程基础已实现并通过下列检查。**Cloudflare账户内实际部署、资源绑定与Git自动发布尚未验收，不将整个M0-B远端验收标为完成。**

## 1. 交付边界

React/TypeScript/Vite、Hono Worker、安全headers、只读配置/健康API；首页、六工具说明、工作台空态、帮助、状态、404、中英文；D1迁移、单次nonce、私密R2授权内部函数、队列去重/重试/DLQ、定时清理；整数金额和fail-closed配置；固定依赖/lockfile、只读CI；单Worker与dev Preview部署配置和防错分支脚本。

没有SIWE、钱包连接、订单业务、资金合约、链上索引、支付/退款、主网或真实余额。Foundry仅目录和待验证配置。没有公开诊断/上传写入口，远端storage/background/资金功能默认关闭。

## 2. 已执行检查

首轮完整远端运行：[GitHub Actions 36320667697](https://github.com/iwbinb/MonadBox/actions/runs/36320667697)，job 108623745027，2026-09-27 12:56–12:57 UTC，结论success。源代码31df1f8，锁文件随后由该任务提交为0aa3685。最终只读CI在本阶段PR中继续核对。

| 检查 | 实际结果 | 边界 |
| --- | --- | --- |
| pnpm install --frozen-lockfile | 通过 | Node22.16.0、pnpm10.11.1，registry实际解析并锁定 |
| pnpm format:check / lint / typecheck | 全部通过 | 前端与Worker严格类型检查 |
| pnpm build | 通过 | Vite前端与esbuild Worker；不发布 |
| pnpm test | 78/78通过 | 58单元＋20实际Miniflare/workerd运行时；含5000组整数金额往返样例 |
| pnpm deploy:dry-run | 通过 | Wrangler4.135.0解析配置并构建上传包；未上传Cloudflare |
| pnpm test:e2e | 20/20通过 | 10个场景×桌面/移动尺寸的Chromium，不是实机Safari测试 |
| 远端读回与代码对照 | 通过 | 下载CI的source.tar核对代码/配置/测试；锁文件保留远端生成版本 |
| 页面截图查看 | 已完成 | 首页与工作台的桌面/移动四张真实浏览器截图 |

CI命令均退出0；本地亦完成格式、lint、types、build、78项测试与dry-run。本地浏览器访问localhost遇到ERR_BLOCKED_BY_ADMINISTRATOR，未绕过环境策略；浏览器验收改在GitHub Actions标准Chromium执行。

运行时测试包含D1并发nonce只消费一次、到期边界、事务整体回滚、两实例数据隔离、绑定命名空间错误拒绝；R2对象所有者授权；真实本地队列消费、重复消息、冲突key、失败重试和死信接收。它们不是远端Cloudflare资源隔离证明。

## 3. 视觉与交互检查

依据已合并UX_UI_SPEC实现工程骨架，没有生成并冒充产品实机的概念图。真实截图来自上述CI的foundation-bootstrap artifact：home-desktop、home-mobile、workspace-desktop、workspace-mobile。

核对了：六工具数量和未开放文案；桌面三列/移动单列；正文与按钮层级；浅底白卡紫色强调；留白/卡片边界；工作台选中状态与空态；付款禁用横条。没有发现这些截图中的内容遮挡或横向溢出。初始页面焦点、长文本换行、200%字号支持已修正，浏览器用例通过。该检查不是完整WCAG认证，也不是未来资金页面验收。

## 4. 已知限制与警告

- React Router的use client指令与Zod的PURE注释产生非致命构建警告，构建/浏览器检查均通过；不隐瞒为零警告。
- 本轮引导CI日志出现一次workerd Broken pipe，随后所有E2E完成；真实远端稳定性仍需部署后观察，未据此声称无运行时问题。
- Node/Actions/ESLint工具链有版本生命周期提示；精确锁定是复现措施，不代表已完成依赖安全审计。Miniflare为已实测的alpha版本。资金业务上线前仍需重新评估和安全审查。
- 当前dev命令先构建再启动，没有前端HMR。无RPC调用、无链上最终性或AUSD兼容性结论。
- 新Worker Previews不消费队列、不运行Cron。远端后台测试需要另行批准的隔离方案。

## 5. 待验收事项与下一步

Bill审阅并合并工程PR后，在Cloudflare连接monadbox并填写[部署命令](../engineering/DEPLOYMENT.md)。核对生产/Preview URL、构建ID、/status环境和revision；验证dev提交只更新Preview、main合并更新生产。再按明确授权配置隔离资源，或进入M0-C的相应只读准备工作。

本次不自行合并main，不修改Cloudflare账户，不广播链上交易。无实际URL之前不编造可访问网站链接。
