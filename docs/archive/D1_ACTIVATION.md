# Production D1 接入记录

日期：2026-09-29。用户明确授权启用线上测试 MON 支付、启动 D1，本轮不使用 R2。

## 已执行

- 创建前按名称查询，未发现同名库；创建后核对库内没有业务表。
- 创建 `monadbox-production`，ID `37b5d014-4297-40b4-aa3c-4d1a1471dcb0`，APAC。
- 按顺序执行仓库 `0001_foundation.sql` 至 `0005_native_mon.sql`，记录到 Wrangler 兼容的 `d1_migrations`。远端时间为2026-09-29 00:35:36 UTC。
- 写入 `environment_guard` 为 `monadbox-production`；读回 cloud=3、modules=2、attachments=1；外键检查无错误，初始用户和Box计数均为0。
- Production配置绑定 DB，打开 CLOUD/MODULES，Origin固定为 `https://monadbox.iwbinb.workers.dev`。
- 不创建 R2，不绑定 FILES，附件、旧存储与后台任务开关保持关闭。Deliver/Milestones继续支持私下交换文件和链上摘要。
- 配置验证、格式检查通过；配置、部署约束及云端运行共94项测试通过，日志 `/private/tmp/monad-d1-check.log`。

## 后续依赖

用户需在 `/setup` 用浏览器钱包逐笔部署并核验7个合约，提供导出的登记JSON。核验真实地址、代码与管理员后，按本次授权继续启用测试网发布和付款；不能用空配置或本地地址提前打开开关。

本次修改的main构建、线上绑定及HTTP检查结果保存到 `artifacts/d1-activation.json`。D1接入不代表真实钱包付款已验收；主网保持关闭。
