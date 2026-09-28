# MonadBox

**一个链接，按约定完成收款、退款与分账。**

面向个人、创作者、社区和小团队的稳定币支付工具集合站。目标保留 Group、Split、Deliver、Attend、Milestones、Rewards。

## 当前批次：M1-B 云端成团与发布

已实现钱包SIWE登录、D1云端草稿与不可变元数据、成团发布意图/显式钱包签名/回执核验，以及无需登录的公开分享页。**代码与本地集成验证不等于已开启线上云端或公开收款。** 当前发布配置仍关闭CLOUD与GROUP_PUBLISH；真实D1绑定、Group测试网部署和真实钱包验收后置。

| 路径 | 能力与边界 |
| --- | --- |
| `/create/group`、`/app/group-drafts` | 可用的本地草稿；不是云同步或付款链接 |
| `/app/groups` | 云端登录/记录入口；未配置D1时明确显示尚未启用 |
| `/app/groups/:id` | 账号授权、云端草稿编辑、冻结发布和查链恢复 |
| `/b/:id` | 只展示已核验发布的规则；付款按钮仍关闭 |
| `/lab` | M0-C独立测试网钱包实验室，不是业务托管 |

主流程为：本地草稿 → 显式登录/上传 → 准备固定规则 → 用户钱包签名createGroup → 核验finalized事件 → 匿名分享页。登录不批准代币；创建Group不代表已收款。付款/退出/退款/结算/提款界面属于M1-C。

[全阶段计划](docs/planning/DEVELOPMENT_PLAN.md) · [M1-B操作与配置](docs/engineering/M1-B_GROUP.md) · [M1-B验收](docs/planning/M1-B_ACCEPTANCE.md) · [全部文档](docs/README.md)

## Git 与部署

正式站：`https://monadbox.iwbinb.workers.dev/`。PR #1–#4已合并；M1-B从`4ee923b`继续在dev开发，等待本批PR由Bill合并。一个`monadbox` Worker：main正式发布，dev Worker Previews。不自动合并、不强推、不删除dev。

| Cloudflare字段 | 命令 |
| --- | --- |
| Build | `pnpm build` |
| Deploy | `pnpm run deploy` |
| Preview | `pnpm run deploy:preview` |

当前默认部署不需要新资源。**后续开启云端仅需独立D1，不要求R2/Queues。** 两环境数据库和精确origin分别配置，schema/环境标记校验后启用。合约部署和业务放行独立审阅，Git合并/CI/Cloudflare不自动广播交易或迁移远端数据库。

## 本地工程

Node22.16.0、pnpm10.11.1；Solidity0.8.28、paris、optimizer200、Foundry1.8.3。依赖与lockfile锁定；ABI/字节码从源码生成。

```sh
pnpm install --frozen-lockfile
pnpm dev
# 验证顺序
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
# 以下固定版本工具安装脚本面向Linux x86_64，核对SHA-256
bash scripts/install-test-tools.sh
pnpm test:contracts
pnpm test:chain-local
pnpm test:cloud-local
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
pnpm deploy:dry-run
```

`pnpm dev`默认8787，无HMR。云端完整本地fixture使用8789/Anvil18745，测试脚本自行启动并关闭；不是公开部署。浏览器E2E使用模拟注入钱包与本地链，不能称真实钱包/Safari验收。CI只读并保存测试证据，不持有用户密钥。

## 风险边界

用户决定真实签名测试后置，不阻塞继续编码，但所有真实验收项仍保留；不虚构地址、交易、用户或审计。服务器不持有私钥/助记词。D1与localStorage均不是资金权威。固定规则以链上合约为准，成团不证明现实服务交付。主网仍禁止；当前不是可接受公众资金的完整产品。
