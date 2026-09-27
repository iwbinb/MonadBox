# Cloudflare 发布：一个 Worker + dev Preview

M0-C更新 · 2026-09-27。用户在Cloudflare控制台连接GitHub，不向开发者提供管理Token或钱包密钥。原M0-A两个Worker方案不再执行。

## 1. 控制台

| 字段 | 值 |
| --- | --- |
| Repository | iwbinb/MonadBox |
| Project name | monadbox |
| Production branch | main |
| Build command | pnpm build |
| Deploy command | pnpm run deploy |
| Preview command | pnpm run deploy:preview |
| Root directory | 仓库根目录 |
| Node version | 22.16.0（.node-version） |
| Preview Builds | 开启，仅dev |

保留deploy中的`run`，避免误调用pnpm自身同名命令。脚本调用已锁Wrangler4.135.0并校验production/main、preview/dev；Preview调用`wrangler preview --name dev`，不是旧的versions upload。pnpm10.11.1与lockfile用于可重复安装，不删除lock。

M0-B工程PR#2已经合并并有生产/Preview构建成功及用户提供的productionhealth证据；不再要求用户重新建Worker。M0-C只需当前dev验证后由用户合并main，使用原自动部署流程。

## 2. M0-C能力开关

顶层vars为production；previews.vars完整声明preview，不依赖隐式继承。两个环境chainId均10143，主网始终关闭。

- `TESTNET_LAB_ENABLED=true`：允许/lab展示测试网钱包操作，每笔由用户明确签名；默认缺字段时false。
- `NETWORK_WRITES_ENABLED=false`：六工具业务写入关闭；与独立实验室开关不同。
- `MAINNET_ENABLED=false`、空业务ASSET_ALLOWLIST/CONTRACT_REGISTRY：不开放真实业务资金或主网。
- `STORAGE_ENABLED=false`、`BACKGROUND_ENABLED=false`：当前不需要真实D1/R2/Queues/秘密变量。

`/api/v1/health`新增stageM0-C和testnetLab字段；payments仍表示业务付款disabled。网站production≠Monadmainnet。用户浏览器签名的实验交易与网站部署是两件事。

## 3. 构建不做什么

build生成前端、Worker以及供浏览器核对的探针ABI/bytecode，**不连接钱包、不迁移数据库、不broadcast或升级合约**。deploy脚本只发布网站/API。GitHub常驻CI只读仓库，只对固定127.0.0.1 Anvil执行合约测试交易；无用户/Cloudflare生产secret。

构建revision来自WORKERS_CI_COMMIT_SHA或GITHUB_SHA；branch来自WORKERS_CI_BRANCH。缺失配置/错误branch禁止误发布。Worker名称必须与控制台一致。/api错误返回JSON，不让SPA吞掉API404。

## 4. 本地与未来资源

wrangler.local.jsonc仅用于本地模拟，D1假ID不能用作真实绑定。db:migrate:local只操作本地资源。实验室不依赖数据库/附件/后台；实际业务需要时再按PR绑定隔离的生产/Preview D1、R2。

两个namespace不代表同一数据库被安全隔离；资源ID必须独立并核验environment_guard。secret不能加VITE_前缀暴露到浏览器。链上部署/用户私钥永不写Cloudflare变量。

Worker Previews不能消费Queues或自动执行Cron；本地Miniflare测试不代替远端触发。远端后台方案需另外审阅，不强制现在创建第二个完整网站Worker。破坏性迁移须备份和独立确认，不随main提交自动执行。

## 5. 验收与回滚

CI检查安装/格式/lint/types/build/unit/runtime/Foundry/Anvil/E2E/dry-run；Cloudflare实际发布状态另看check-run。记录devPreview及main正式URL、buildID、revision与能力变量；构建成功不是完整页面/签名兼容验收。

M0-C实际钱包验收在/lab完成，见[操作说明](M0-C_LAB.md)。无真实hash前不标C-T03通过。主网门禁独立，不能为了结束阶段自动打开。

回滚网站不能回滚数据库或链上交易；已有探针款仍按原合约可退。更换构建会影响精确runtime匹配，应保留原源码/版本和退出方式，不静默令旧款无入口。

## 6. 官方依据

- https://developers.cloudflare.com/workers/previews/get-started/
- https://developers.cloudflare.com/workers/previews/configuration/
- https://developers.cloudflare.com/workers/previews/resources/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

公共文档和dry-run不替代账户内运行验收；当前具体证据在阶段验收与PR中。
