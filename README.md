# MonadBox

**一个链接，按约定完成收款、退款与分账。**

面向个人、创作者、社区和小团队的稳定币支付工具集合站。品牌独立，目标工具为Group、Split、Deliver、Attend、Milestones、Rewards。

## 当前状态：M0-B工程基础

已建立React/TypeScript/Vite前端、Hono Worker、只读配置/健康API、六工具说明页、工作台空态与中英文切换、测试和CI。**还不能创建真实Box、连接钱包、付款、退款或领取资金。** 不展示虚构余额或交易。

网站生产环境仍运行测试网标识；尚未实际部署到用户Cloudflare账户。D1/R2/Queues基础仅在本地Miniflare验证，远端资源功能默认关闭。详细边界见[M0-B验收记录](docs/planning/M0-B_ACCEPTANCE.md)。

## 本地运行

Node **22.16.0**，pnpm **10.11.1**。依赖精确锁定；不要删除pnpm-lock.yaml或使用未固定的latest替代。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

本地地址由Wrangler输出（默认8787）。`pnpm dev`会先构建，修改后重启命令即可重新生成前后端；当前不提供前端HMR。无需真实token、数据库或钱包。

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm deploy:dry-run
```

`pnpm test`运行前先build，以便Miniflare载入实际Worker产物。E2E测试自行启动本地Worker，覆盖桌面/移动尺寸Chromium。`deploy:dry-run`只生成检查产物，不上传。Foundry仅预留目录，未实现或测试资金合约。

## Cloudflare：一个Worker

连接仓库`iwbinb/MonadBox`，项目名`monadbox`，生产分支`main`，开启dev预览：

| 字段 | 命令 |
| --- | --- |
| Build | `pnpm build` |
| Deploy | `pnpm run deploy` |
| Preview | `pnpm run deploy:preview` |

脚本调用固定版本Wrangler并校验分支。**本次首次部署不需要D1、R2、Queues或秘密变量。** 后续使用资源必须隔离生产/预览并完成实测；Preview不消费队列、不运行Cron。详细说明见[部署文档](docs/engineering/DEPLOYMENT.md)。

## 工作流程

长期`dev`开发 → 测试 → `dev → main` PR → Bill手动合并 → Cloudflare正式部署。不自动合并、不删除dev、不强推、不随构建执行数据库迁移或链上交易。每阶段完成后停止。

工程结构：`src/app`页面、`src/shared`配置/金额/目录、`src/worker`后端、`migrations`数据库、`tests`检查、`contracts`待实现合约目录。所有文档从[索引](docs/README.md)开始，开发先读[AGENTS](AGENTS.md)。

## 下一阶段

完成用户账户内的首次Git部署验收后，进入M0-C Monad最小真实兼容验证；再依次实现Group、Split组合与其余工具。平台费、资金规则和真实用户需求均不因工程完成而得到实测证明。
