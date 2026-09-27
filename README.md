# MonadBox

**一个链接，按约定完成收款、退款与分账。**

面向个人、创作者、社区和小团队的稳定币支付工具集合站。目标为 Group、Split、Deliver、Attend、Milestones、Rewards；当前仅开放成团草稿和独立测试实验室，六工具公开收付款尚未开放。

## 当前批次：M1-A 成团草稿与合约基础

已实现四步创建向导、整数金额/人数/时间/收款地址校验、规则预览、本地保存/编辑/删除、JSON导入导出，以及跨标签revision冲突和损坏数据保护。保存草稿不要求钱包、不发送交易。

| 路径 | 当前用途 |
| --- | --- |
| `/create/group` | 创建本地成团草稿 |
| `/app/group-drafts` | 当前浏览器的草稿列表 |
| `/app/group-drafts/:draftId` | 本地草稿预览，**不是公开收款链接** |
| `/lab` | M0-C独立测试网钱包实验室 |

`GroupEscrowV1`已实现参与、截止前退出、成败判定、取消、退款归属、结算、固定地址提款及暂停新业务。已进行Foundry与本地Anvil验证，但**尚无经过真实测试网验收的Group部署，网页链上发布/收款按钮仍关闭**。草稿目标金额不等于已收款；credit不等于钱包到账。

用户已决定把真实钱包测试后置：继续功能开发和本地测试，不再把C-T03作为编码前置条件；公开资金功能启用和完整阶段验收仍需真实证据。见[全阶段计划](docs/planning/DEVELOPMENT_PLAN.md)、[M1-A验收](docs/planning/M1-A_ACCEPTANCE.md)、[成团草稿说明](docs/engineering/M1-A_GROUP.md)。

## 已发布版本与资源

正式网站：`https://monadbox.iwbinb.workers.dev/`。PR #1、#2、#3已合并；本批合并前main为`a940ab0`（M0-C），M1-A在dev等待PR审阅。合并后以实际构建revision核验上线，不把PR创建等同正式发布。

远端D1/R2/Queues和后台任务仍关闭，当前草稿不用这些资源。草稿不会自动跨设备、跨域名或从Preview同步到production；需要时导出JSON再导入。不要在本地草稿填写秘密资料。

## 本地运行与检查

Node **22.16.0**、pnpm **10.11.1**、Solidity **0.8.28**、paris、optimizer **200**、Foundry **1.8.3**；依赖和lockfile固定。ABI/bytecode从源码生成，不手工维护另一份接口。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

默认端口8787，修改后重启；当前没有前端HMR。打开页面不会自动连接钱包，草稿保存与实验室签名完全分开。

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
# Linux x86_64：下载固定版本官方工具并核对SHA-256。
bash scripts/install-test-tools.sh
pnpm test:contracts
pnpm test:chain-local
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
pnpm deploy:dry-run
```

`pnpm test`前先build；完整实验室浏览器测试前先运行合约测试生成MockToken产物。Anvil默认账户、测试token和本地hash不得用于公开网络。非Linux x86_64需自行安装匹配工具；完整验证环境为Linux CI和Chromium，不宣称真实Mac/Safari已验收。

## Cloudflare：一个Worker

仓库`iwbinb/MonadBox`，Worker名`monadbox`；main正式发布，dev Worker Previews。

| 字段 | 命令 |
| --- | --- |
| Build | `pnpm build` |
| Deploy | `pnpm run deploy` |
| Preview | `pnpm run deploy:preview` |

脚本只发布网站/API，不部署合约、不迁移数据库、不代签。`NETWORK_WRITES_ENABLED`与主网开关保持false；`TESTNET_LAB_ENABLED`仅允许用户在独立`/lab`中主动签名测试交易。见[部署说明](docs/engineering/DEPLOYMENT.md)。

## 开发流程与风险

长期dev开发 → 本批测试 → dev→main PR → Bill手动合并 → 核验Cloudflare正式构建。不开启自动合并、不删dev、不强推；每批结束停止。

探针每钱包每探针最多保留1测试AUSD，默认0.1；这些限额不代表未来Group业务限额已经确定。真实M0-C部署/授权/入金/退款仍待验收；当前没有自动启用任何Group资金操作。不要提供私钥、助记词或生产凭据。测试通过不代表经过独立安全审计。
