# MonadBox

**一个链接，按约定完成收款、退款与分账。**

面向个人、创作者、社区和小团队的Monad 测试网原生 MON 支付工具站：Group、Split、Deliver、Attend、Milestones、Rewards。

## 从这里开始

- [总目标、当前进度与分阶段任务](docs/planning/DEVELOPMENT_PLAN.md)：唯一进度入口，按授权连续完成六工具开发。
- [文档索引](docs/README.md)：按任务找规格、操作说明和历史证据。
- [交付与演示包](docs/engineering/DELIVERY_PACKAGE.md)：复现步骤、功能演示、验收矩阵和外部待办。
- [开发约定](AGENTS.md)：执行范围、Git、资金与验证规则。

六工具已实现本地草稿、SIWE登录、D1云端规则、冻结发布、正常结算/异常退出、credit提款及交易恢复，Deliver与Milestones另支持双方私密附件。按已选设计稿统一首页、六工具、工作台、钱包与付款页面，支持中英文与手机视口。钱包支持 MetaMask、Keplr、OKX；MON 使用18位精度，直接支付，无代币授权步骤。工程证据与外部验收分开：真实资源、公开合约、钱包/设备、用户试用及独立审阅后置，公众业务和主网默认关闭。

## 工程地图

| 目录 | 用途 |
| --- | --- |
| `src/app/` | 页面、工作台、本地草稿、云端、实验室 |
| `src/shared/` | 金额、规则、钱包、链上核验与恢复 |
| `src/worker/` | 同源 API、会话、权限与数据访问 |
| `contracts/` | 七个业务合约、实验探针及合约测试 |
| `migrations/` | 按顺序应用的 D1 数据库迁移 |
| `scripts/` | 编译、配置检查、部署、本地集成测试 |
| `tests/` | 单元、Worker/D1、链上场景及浏览器测试 |
| `docs/` | 规格、当前说明、总计划与历史归档 |

`node_modules/`、`dist/`、`artifacts/`、合约及 ABI 生成目录均不提交。依赖和生成产物按需要复用；ABI/runtime 由源码生成，不手改。

## 本地启动与验证

固定 Node 22.16.0、pnpm 10.11.1；依赖锁定在 lockfile。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

默认本地地址为 `http://localhost:8787`，无 HMR。完整云端测试自行启动固定 loopback Worker/D1/Anvil，不能当作真实 Monad 交易。

| 检查 | 命令 |
| --- | --- |
| 格式、代码检查、类型 | `pnpm format:check`、`pnpm lint`、`pnpm typecheck` |
| 构建、单元与运行时 | `pnpm build`、`pnpm test` |
| 合约、本地链、HTTP | `pnpm test:contracts`、`pnpm test:chain-local`、`pnpm test:cloud-local` |
| 浏览器、部署预检 | `pnpm test:e2e`、`pnpm deploy:dry-run` |

首次运行原生测试工具需按 [合约说明](contracts/README.md) 安装固定版本；浏览器测试需先安装 Playwright Chromium。开发期间按改动选择检查，阶段交付跑完整 CI，已有依赖可复用。

## 网站与链上边界

[正式站](https://monadbox.iwbinb.workers.dev/) 使用一个 `monadbox` Worker：main 直接发布至 Production，不使用 Preview，配置见[部署说明](docs/engineering/DEPLOYMENT.md)。网站 Production 不等于 Monad Mainnet。

服务器不保管钱包密钥；用户显式签名每笔操作。D1 不是资金权威；Group 成团不证明现实交付，credit 不等于钱包已到账。真实测试后置不阻塞编码，公开资金及主网放行另行验收。
