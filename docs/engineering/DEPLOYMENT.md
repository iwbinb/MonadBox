# main → Production：Monad 测试网 MON

## 1. 唯一发布流程

| 项目 | 配置 |
| --- | --- |
| 仓库 / Worker | iwbinb/MonadBox / monadbox |
| 分支 | main |
| 构建 | pnpm build |
| 发布 | pnpm run deploy |
| 网站 | https://monadbox.iwbinb.workers.dev |
| Node / pnpm | 22.16.0 / 10.11.1 |
| 网络 / 币种 | Monad Testnet，10143，原生 MON，18 位小数 |

2026-09-29 已删除非 main 分支的 Preview 构建触发器，Cloudflare 仅保留 main 的 Production 触发器。网站 Production 与区块链主网无关。构建只生成网站、ABI 和字节码；部署脚本只发布网站。数据库迁移和合约交易均为独立操作。

## 2. 已完成的上线准备

- 七个业务合约接受原生 MON，精确核验交易 value；退款和领取均回到固定收款人。
- 全站统一 MetaMask、Keplr、OKX；签名前复核账户、网络、序号与本金及 Gas 余额。
- `/setup` 为项目部署入口：准备 → 核对 → 钱包确认 → 核验原交易 → 导出登记配置。
- 部署返回丢失后，根据原账户和 nonce 恢复，禁止自动重发。核验原始交易、确认区块、代码、资产、管理员和签名域后才输出地址及 runtimeHash。
- 0005 迁移将旧记录保留为 legacy；新记录标记 MON。旧 6 位金额不转换为 18 位 MON。

## 3. 待启用资源清单

2026-09-28 通过 Cloudflare API 核验：monadbox 的云端与业务付款开关关闭，没有 D1 绑定；同名 D1 查询没有现存数据库。以下清单用于实际启用，不使用本地测试地址或占位 ID。

| 资源 | 名称 / 值 | 用途 |
| --- | --- | --- |
| D1 | monadbox-production | 登录会话、公开规则、草稿、交易索引、私密附件元数据 |
| D1 binding | DB | 唯一 Production 数据库，ID由创建结果填入 |
| 私有 R2 | monadbox-private-files-production | Deliver / Milestones 的双方附件 |
| R2 binding | FILES | 桶保持私有，无公开域名 |
| Origin | https://monadbox.iwbinb.workers.dev | 精确同源校验 |
| Namespace | monadbox-production | 数据库和附件环境核验 |

资源创建和远端迁移遵守仓库 AGENTS 的授权边界。无需 Queue 或 Cron。

### D1 顺序

1. 新库按顺序应用 migrations/0001 至 0005；已有库仅应用尚未执行的迁移。
2. 写入 `environment_guard` 的唯一行 `(id=1, namespace='monadbox-production')`。若已有不同 namespace，停止并核对资源，不能覆盖。
3. 核验 `cloud_schema=3`、`module_schema=2`、`attachment_schema=1`。
4. 将实际 database_id 写入 wrangler.jsonc 的 DB 绑定。

### R2 顺序

1. 创建私有桶并绑定 FILES。
2. 写入对象 `.monadbox-environment`，正文 `monadbox-production`，自定义元数据 `namespace=monadbox-production`。
3. 核验桶名与 marker 后启用 ATTACHMENTS_ENABLED。它独立于旧 STORAGE_ENABLED，不要求打开旧存储或后台功能。

## 4. 用户钱包部署

1. 打开 `/setup`，连接持有测试 MON 的 MetaMask、Keplr 或 OKX。
2. 核对管理员地址；该地址只控制新收款开关，不能更换收款人或提走他人余额。
3. 对 Group V1、Split、Group V2、Deliver、Attend、Milestones、Rewards，分别准备和确认部署。
4. 每笔点击“核验部署”。结果未知时继续核验原交易，不重新发送。
5. 七笔均核验完成后点击“核验并导出登记配置”。由真实交易得到 GROUP_DEPLOYMENT 和 MODULE_DEPLOYMENTS。
6. 将导出值登记到 Production。所有 asset 值为原生币标识 `0x0000000000000000000000000000000000000000`，合约 address 必须是实际部署地址。

Monad 按交易设置的 Gas 上限收费，页面提供预计费用，最终由钱包确认。[官方 Gas 说明](https://docs.monad.xyz/developer-essentials/gas-pricing)。不要提供私钥、助记词或原始签名。

## 5. 分两步启用

数据库就绪后可启用 `CLOUD_ENABLED` 与 `MODULES_ENABLED`。完成原生 MON 合约登记后，启用 `GROUP_PUBLISH_ENABLED`、`MODULE_PUBLISH_ENABLED`。完成真实钱包小额流程检查后再启用 `NETWORK_WRITES_ENABLED`。

私有桶就绪后启用 `ATTACHMENTS_ENABLED`。始终保持 `MAINNET_ENABLED=false`、`TESTNET_LAB_ENABLED=false`、`STORAGE_ENABLED=false`、`BACKGROUND_ENABLED=false`；旧 ASSET_ALLOWLIST/CONTRACT_REGISTRY 保持空值。

运行配置检查、构建、部署预检，再通过 main 发布。核对 `/api/v1/health` 与 `/api/v1/config` 的 revision、环境、链、合约和开关。

## 6. 线上验收

- 三种真实钱包分别连接、拒绝请求、换账号、换网络、刷新和重新进入。
- 创建、登录、发布、分享；另一浏览器能打开同一规则。
- 每种工具完成一笔小额 MON 正常流程和一笔适用的退款/取消流程；记录真实交易链接和到账。
- Deliver / Milestones 附件仅双方可读取，匿名访问被拒绝。
- 手机检查连接、付款确认、等待、恢复与领取。

本地 Anvil、模拟钱包、数据库和浏览器回归属于工程验证。真实钱包、公开部署与线上到账单独验收。

## 7. 回滚

网站回滚不能撤销链上交易。保留原合约配置与源码，保证已付款 Box 的退款、领取和恢复入口；先停新收款，再处理已有权益。0005 只增加币种区分，不删除旧记录，也不能把 legacy 数据改标为 MON。
