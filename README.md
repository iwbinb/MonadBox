# MonadBox

**一个链接，按约定完成收款、退款与分账。**

面向个人、创作者、社区和小团队的稳定币支付工具集合站。目标为 Group、Split、Deliver、Attend、Milestones、Rewards；六工具业务功能尚未开放。

## 当前状态：M0-C 开发与本地验证

已实现独立的 `/lab` 测试网钱包实验室：浏览器钱包发现、连接/切链、官方测试资产检查、用户签名部署最小探针、精确额度授权、限额入金、退款、回执核验和刷新恢复。

**真实 Monad 测试网的部署、授权、入金和退款交易仍待用户钱包签名验收。** 本地 Anvil/Mock 测试不算真实测试网交易；没有已验证的公开探针地址，没有主网部署或资金操作。代码可用不等于 C-T03 已通过。

M0-B 正式站已部署到 `https://monadbox.iwbinb.workers.dev/`；用户提供的健康响应为生产环境、10143、版本 e2e2430。M0-C 仍在 dev，须经 PR 和用户合并后才更新正式站。D1/R2/Queues 远端仍关闭，不需要为实验室创建这些资源。

详细状态见 [全阶段计划](docs/planning/DEVELOPMENT_PLAN.md)、[M0-C 验收](docs/planning/M0-C_ACCEPTANCE.md)、[实验室操作说明](docs/engineering/M0-C_LAB.md)。

## 本地运行

Node **22.16.0**、pnpm **10.11.1**；所有直接依赖及 lockfile 固定版本。Solidity **0.8.28**、EVM target **paris**、optimizer **200**；Foundry **1.8.3**。ABI 和字节码在构建时由源码生成，不手工维护或从服务器任意下载。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

默认本地端口 8787，修改后重启上述命令；当前不提供前端 HMR。打开 `/lab` 不会自动连接钱包或请求签名；访问账户/网络只读信息与实际交易分开。

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
# Linux x86_64：下载固定版本的官方测试工具并验证 SHA-256。
bash scripts/install-test-tools.sh
pnpm test:contracts
pnpm test:chain-local
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
pnpm deploy:dry-run
```

非 Linux x86_64 环境自行安装 Foundry 1.8.3；原生合约测试脚本可使用 PATH 中的 forge。当前完整浏览器测试用到 `tools/anvil`，其已验证环境为 Linux CI；不要把它称为已验证的 Mac/Safari 测试。CI 下载工具只用于本地链测试，**不广播 Monad 交易**。

`pnpm test` 前先 build；运行 lab 的完整浏览器测试前先完成合约测试，生成本地 MockToken 产物。局部只看页面可用 `pnpm dev`。MockToken、Anvil 默认账户和测试哈希不能用于真实网络。

## Cloudflare：一个 Worker

仓库 `iwbinb/MonadBox`，Worker 名称 `monadbox`。`main` 生产；`dev` 使用 Worker Previews。

| 字段 | 命令 |
| --- | --- |
| Build | `pnpm build` |
| Deploy | `pnpm run deploy` |
| Preview | `pnpm run deploy:preview` |

脚本只部署网站/API，不部署合约、不迁移数据库、不签名。M0-C 使用单独的 `TESTNET_LAB_ENABLED` 开关；业务 `NETWORK_WRITES_ENABLED` 与主网开关仍为 false。用户在 `/lab` 显式确认后，才由其浏览器钱包签署测试网交易。见 [部署说明](docs/engineering/DEPLOYMENT.md)。

## 工作流程与风险

长期 dev 开发 → 测试 → dev→main PR → Bill 手动合并 → Cloudflare 正式发布。不开启自动合并、不删除 dev、不强推。每阶段停止等待确认。

探针是测试用的即时原地址退款合约，不是已经完成的成团/交付/分账业务合约。每钱包每探针最多保留 **1 测试 AUSD**，默认测试 0.1；不使用主网资产。钱包私钥、助记词、生产凭据不得交给网站、CI、仓库或开发者。测试通过不代表已经安全审计。
