# 技术架构

M1-A更新 · 2026-09-27。当前代码、本地验证、公开部署和未来目标分开；证据见[M1-A验收](../planning/M1-A_ACCEPTANCE.md)。

## 1. 运行结构

React/TypeScript/Vite构建浏览器应用，Hono在同一Cloudflare Worker提供API，静态资源使用Workers Static Assets。一个monadbox项目：main正式站、dev Worker Previews；部署命令不变，不增加第二个完整网站Worker。

```text
浏览器 UI ─ 同源config/health ─ Worker + Static Assets
    ├─ /create/group ─ 当前浏览器localStorage草稿（不是订单或收款）
    ├─ /app/group-drafts ─ 编辑 / 规则预览 / JSON导入导出
    └─ /lab ─ 用户钱包显式签名 ─ Monad Testnet RPC ─ 测试探针

尚未开放：
Group公开发布/收付款 ─ 经过验收的Group部署
业务账户/云端草稿/元数据 ─ 隔离D1
私密附件 ─ R2；后台通知/索引任务 ─ Queues/Cron
```

M0-B工程和M0-C实验室保留；M1-A新增Group草稿及业务合约代码/本地测试。**已有合约源码不等于已经公开部署，已有本地草稿不等于已有云端订单。** 真实钱包验收按ADR-19后置，编码和自动测试继续。

## 2. 已实现模块

| 模块 | 当前责任 |
| --- | --- |
| src/app | 基础页面、双语、导航、状态、按路由懒加载lab/group |
| src/app/group | 四步向导、草稿列表/编辑/规则预览、导入导出与异常提示 |
| src/shared/group | 草稿schema/整数金额/日期/地址校验、本地存储、metadata/terms编码 |
| src/app/lab、src/shared/lab | EOA钱包、探针、签名前确认、交易/事件/最终性核验与恢复 |
| src/worker | config/health与内部D1/R2/Queue原语；业务HTTP写入口关闭，不签名 |
| contracts | M0CProbe、GroupEscrowV1及各自Foundry测试；真实Group部署未登记 |
| scripts | 编译探针/Group、构建、分支校验、固定loopback本地链测试 |
| migrations | 基础结构，未迁移到真实Cloudflare资源 |

Node22.16.0、pnpm10.11.1、viem2.56.9等沿用锁文件；不新增钱包供应商或运行服务。wagmi、SIWE、WalletConnect、TanStack Query、托管索引不是当前已集成能力。

## 3. 草稿与未来发布的边界

草稿使用`monadbox.group-drafts.v1:{environment}:10143`，最多40份。写操作通过Web Locks串行化，revision阻止旧编辑覆盖新版；浏览器不支持安全保存时拒绝并允许导出。损坏数据保留，不静默清空。草稿无登录身份/签名证明，不存余额或私钥。

JSON导出明确format/version/chainId/asset，导入最多16KB并严格schema校验，生成独立草稿ID。元数据使用固定顺序JSON原始UTF-8字节，哈希后不重新序列化替换。chainId、module、creator、salt域隔离Box ID，termsHash与Solidity编码在本地集成逐字节核对。

M1-B接入D1与签名发布前必须重新校验过期时间、链、资产、部署版本、收款人及元数据哈希；不能把已保存草稿中的未来时间当永远有效。明确确认后才能把本地草稿迁移到云端；导出JSON不是支付授权。

## 4. Group合约边界

单部署单资产、chainId10143、最多200份、每钱包一份且退出不能重进。固定规则、收款人和metadataHash。截止前可退出；截止后未达标可退；成功组到settleNotBefore可结算；组织者在允许状态可取消。

退款/退出/结算先把locked归属为按Box/受益人记录的credit，再由withdrawFor向固定地址转账。Checks-effects-interactions与重入保护；转账失败恢复权益；不接受转入/转出扣费造成的账务不一致。意外直接转账不产生任何可领权益。

固定intakeAdmin只有暂停/恢复新建和入金权限，不阻合法退出，不具备升级或任意提款权。没有已验证的公开Group地址，网页不允许用户随意填合约地址后立即付款。原探针的即时退款/1测试AUSD限额与Group机制分开。

## 5. 配置与签名

`NETWORK_WRITES_ENABLED=false`、`MAINNET_ENABLED=false`和空业务登记继续生效。草稿功能不受“没有云存储”阻断，但不能开启业务签名。`TESTNET_LAB_ENABLED=true`仅允许独立/lab内用户显式测试签名；health的业务payments与实验室能力分别展示。

Worker不保存密钥、不代签、不提供任意RPC代理；构建/CI不broadcast公开链。公开实验室每步重新核对钱包/10143/token/runtime并显示摘要，用户确认后才签。智能/委托账户尚未验证，保持禁写。

## 6. 编译、回执与恢复

Solidity0.8.28、paris、optimizer200、OpenZeppelin5.7.0、Foundry1.8.3。探针与Group产物从源码生成；编译不意味着部署或区块浏览器源码验证。

实验室已有：先保存意图→用户签名→hash→核对真实交易/receipt/准确事件→canonical区块与finalized高度→最终状态。拒签/revert/replaced/unknown分开，未知不重发；最多回看41块按账户nonce找回，旧交易可人工补hash，无历史退款用原Payment ID。localStorage只提供恢复线索，不赋予资金权利。

Group资金UI将复用经过验证的恢复思想，但需要加入Box ID/termsHash/固定受益人/credit状态，不把探针的方法名直接替换当完成集成。D1投影/outbox/游标和重组处理仍是后续工作。

## 7. 验证层级

M1-A Foundry覆盖Group37项及探针18项；本地Anvil对Group执行成功、失败、退出后取消三类场景25个操作，核对规则哈希和本金。Playwright覆盖草稿创建到导出/冲突/恢复；实验室模拟钱包依然仅连接本地链。

公共网络当前只有既有只读链/资产证据，真实M0-C/Group签名均待用户安排。即使Anvil使用相同chainId/资产地址，也不能称真实Monad交易。GitHub CI与Cloudflare构建成功不等于所有线上功能/资源验证通过。

## 8. 按需启用资源

M1-B：SIWE账户、D1元数据/草稿/发布记录与对象级授权；生产/Preview独立资源、namespace防护与迁移验收。M1-C：资金UI和可重建索引；实现中按实际负载决定是否需后台队列。Deliver附件再启用私有R2。Preview不消费Queue或自动运行Cron，后台另行验收。

不提前把这三项作为网站或本地草稿的必要服务，不使用共享生产数据冒充开发测试。主网仍需G-07；公开业务入金仍需相应真实网络和安全证据。

参考：[草稿操作](M1-A_GROUP.md) · [实验室与官方来源](M0-C_LAB.md) · [数据/API](DATA_AND_API.md) · [资金规格](../product/FUNDS_AND_STATES.md) · [部署](DEPLOYMENT.md) · [放行条件](../planning/DECISIONS_AND_GATES.md)。
