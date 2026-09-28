# M1-A 验收记录：成团草稿与合约基础

> 历史验收记录：保留当时结论与未完成项，不作为当前执行指令。最新状态与后续顺序见[总计划](../planning/DEVELOPMENT_PLAN.md)。

2026-09-27 · 本批代码与本地验证已交付，等待用户审阅PR。完整M1、公开Group收款、真实钱包签名和安全审计尚未完成。

## 1. 范围和最新决定

用户明确真实钱包测试以后再做、继续开发功能。本批继续编码/自动测试，不要求先完成M0-C四笔签名；C-T03仍待验收，不被删除或勾为通过。见ADR-19/20。

交付四步成团向导、字段校验、规则摘要、本地保存/编辑/删除/导入导出、跨标签冲突和损坏数据保护，以及GroupEscrowV1和Foundry/Anvil测试。草稿不是云端订单，网页业务链上发布/付款仍关闭。

业务代码基线为`7656282cf2214d0fd3e1da3426c3b0587cef5523`；截图采集修正为`5457b7903fd604bf834733839d5a24b0f704daa1`。之后收尾提交只更新文档，不更改资金权限。

## 2. 已完成的执行核验

两轮完整CI均通过：

- [原始功能验证36329183224](https://github.com/iwbinb/MonadBox/actions/runs/36329183224)，job108647716555，提交7656282：已读回步骤与完整日志。
- [截图修正复测36330652192](https://github.com/iwbinb/MonadBox/actions/runs/36330652192)，job108651793960，提交5457b79：全部步骤success，已下载产物并查看新的桌面/手机创建与预览截图。

| 命令/检查 | 结果 | 范围 |
| --- | --- | --- |
| pnpm install --frozen-lockfile | 成功 | 固定lockfile，无本轮依赖升级 |
| pnpm format:check / lint / typecheck | 成功 | CI中实际执行 |
| pnpm build | 成功 | 生成前端/Worker/合约产物，不broadcast |
| pnpm test | 169/169通过 | 含57项Group；其余为既有实验室/运行时/配置回归 |
| pnpm test:contracts | 55/55通过 | Group37、探针18；各有2项每项512次fuzz；不是审计 |
| pnpm test:chain-local | 成功 | Group三场景25个本地操作；探针4操作另5项检查 |
| pnpm test:e2e | 44/44通过 | 10个Group任务×2视口=20项，其余实验室/基础页面回归 |
| pnpm deploy:dry-run | 成功 | 部署预检，不发布合约或签名 |
| 真实M0-C/Group交易 | 未执行 | 按用户决定后置；不能用本地hash代替 |

原始产物10934489864，ZIP SHA-256为`be9b45b6f3eb377e77b9009f9c3c478ecde5465af0fd23f2a73e0a89ae2aee3a`。复测产物10935442969，SHA-256为`552de0d1674a650314104a8a0cd824582f088ab7d017bf6ef1dde5df5ac7d0fd`；本轮下载后核对匹配。复测`dist/build.json`的stage=M1-A、revision=5457b7903fd604bf834733839d5a24b0f704daa1。`group-local-chain.json`明确mode=local-anvil-only、notPublicNetwork=true。

最后文档提交及本批PR的精确head CI/Preview结论另在PR附录记录，不将旧commit的成功自动算到新commit上。

## 3. 合约与本地集成覆盖

三条Group集成路径：成功→时间锁→credit→固定受益人提款；未达标→退款credit→原参与者提款；提前退出后取消→各方独立退款。TypeScript/Solidity条款哈希逐字节一致，重复退款拒绝，本金保持守恒。

Foundry覆盖时间边界、容量/重复加入、退出后不可重进、取消/结算互斥、重复finalize、跨Box隔离、同人多角色、意外转入、转账失败回滚、扣费代币拒绝、重入、固定暂停权限及暂停不阻合法退出。随机测试不是对所有执行序列的证明，也不是独立审计。

## 4. 浏览器检查与截图修正

本会话无Browser插件，采用现有GitHub Actions Playwright/Chromium测试。当前容器git clone因无法解析github.com退出128；未绕过限制，也不声称在本容器完整克隆并重跑了所有测试。

测试流程：`/create/group`→填写/校验→保存→本地预览→编辑/导入导出。视口为Desktop Chrome和模拟iPhone 13的Chromium配置，另测360px及放大文字；不是物理iPhone或Safari。

原创建页长截图带入了位于当时视口之外的固定Skip to content链接。提交5457b79把全页截图前scrollY固定为0，并断言链接未获得焦点且位于视口外。没有删除无障碍入口或改变应用样式。复测通过，已查看新的四张Group截图，确认该采集伪影消失。

| 核对项 | 结果/边界 |
| --- | --- |
| 标题、步骤和表单 | 页面内容可见，顺序正确，无空白或框架错误覆盖 |
| 金额/地址/时间 | 单位与未收款提示明确，长字段可读；目标90与上限600仅是测试输入的计算结果 |
| 状态和权限 | 本地草稿提示可见，公开发布按钮禁用，保存不调用钱包 |
| 桌面/手机布局 | 双列变单列；本次截图未见剪裁/横向溢出，手机首屏后需正常滚动 |
| 草稿交互 | 保存/刷新/编辑/导入导出/冲突/失败回退有自动测试 |
| Console范围 | 创建主流程监听pageerror且为空；不宣称所有线上页面和外部钱包console已验收 |

复测截图在CI产物`artifacts/screenshots/group-builder-{desktop,mobile}.png`及`group-preview-{desktop,mobile}.png`。它们是实际本地浏览器渲染，不是生成效果图或真实链上收款证据。

构建日志有第三方use-client/注释处理和旧Actions runtime迁移警告，不能称零警告。没有改变首屏产品文案或重新设计页面。

## 5. Git、部署和未启用能力

本批前main为a940ab008de9a58b9305b2c88655aaeeec59f814。全部变更只写dev，等待Bill手动合并；不删dev、不自动合并。Cloudflare成功构建只证明该次构建/发布状态，不能代替线上完整交互或数据资源隔离测试。

发布命令不变：pnpm build / pnpm run deploy / pnpm run deploy:preview。没有新增Worker、绑定远端D1/R2/Queues、迁移远端数据、签名或广播公开链交易。/lab既有显式测试签名能力保留，Group业务发布/支付仍禁用。

## 6. 下一批

M1-B：SIWE和D1元数据/发布记录、公开分享页及发布意图；M1-C：参与/退出/退款/结算/提款UI和恢复；M1-D：用户安排时补齐真实网络、钱包、资源验收及M0-C待验项。

M1-A完成不等于完整M1或六工具完成。真实钱包测试后置不再阻止编码；公开资金启用、主网批准和最终验收仍各需实际证据。
