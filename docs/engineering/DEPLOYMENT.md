# Cloudflare 发布：一个 Worker + dev Preview

当前工程配置说明。用户在Cloudflare控制台连接GitHub，不向开发者提供管理Token或钱包密钥。原M0-A两个Worker方案不再执行。

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

沿用已建立的Worker与Git部署流程；历史构建和发布证据见[验收归档](../archive/README.md)。每次发布核对实际构建SHA，不能将旧记录当作当前发布结果。

## 2. 能力开关

顶层vars为production；previews.vars完整声明preview，不依赖隐式继承。两个环境chainId均10143，主网始终关闭。

- `TESTNET_LAB_ENABLED=true`：允许/lab展示测试网钱包操作，每笔由用户明确签名；默认缺字段时false。
- `NETWORK_WRITES_ENABLED=false`：六工具业务写入关闭；与独立实验室开关不同。
- `MAINNET_ENABLED=false`、空业务ASSET_ALLOWLIST/CONTRACT_REGISTRY：不开放真实业务资金或主网。
- `CLOUD_ENABLED=false`、`GROUP_PUBLISH_ENABLED=false`、`GROUP_DEPLOYMENT=null`：云端和Group发布未放行；按[Group说明](GROUP.md#7-d1-配置)启用时仅需D1，不依赖R2/Queues。
- `STORAGE_ENABLED=false`、`BACKGROUND_ENABLED=false`：历史通用存储/后台原语未启用，不能为D1-only云端强制打开。

`/api/v1/health`返回构建revision、stage、testnetLab及cloudGroups就绪状态；当前stage为M1-B，payments表示业务付款disabled。网站production≠Monadmainnet。用户浏览器签名的实验交易与网站部署是两件事。

## 3. 构建不做什么

build生成前端、Worker以及供浏览器核对的Group和探针ABI/bytecode，**不连接钱包、不迁移数据库、不broadcast或升级合约**。deploy脚本只发布网站/API。GitHub常驻CI只读仓库，只对固定127.0.0.1 Anvil执行合约测试交易；无用户/Cloudflare生产secret。

构建revision来自WORKERS_CI_COMMIT_SHA或GITHUB_SHA；branch来自WORKERS_CI_BRANCH。缺失配置/错误branch禁止误发布。Worker名称必须与控制台一致。/api错误返回JSON，不让SPA吞掉API404。

## 4. 本地与未来资源

wrangler.local.jsonc仅用于本地模拟，D1假ID不能用作真实绑定。db:migrate:local只操作本地资源。实验室不依赖数据库/附件/后台；云端只需D1，私密附件在M3按需求启用R2。

真实D1须production/Preview独立ID和精确origin。新库按顺序应用0001、0002迁移，并设置各自environment_guard；已有0001的库只应用0002。schema2/marker检查通过再启用CLOUD；GROUP_PUBLISH还需实际测试网部署登记。创建资源与远端迁移需用户配置或另行授权，默认不执行。

两个namespace不代表同一数据库被安全隔离；资源ID必须独立并核验environment_guard。secret不能加VITE_前缀暴露到浏览器。链上部署/用户私钥永不写Cloudflare变量。

Worker Previews不能消费Queues或自动执行Cron；本地Miniflare测试不代替远端触发。远端后台方案需另外审阅，不强制现在创建第二个完整网站Worker。破坏性迁移须备份和独立确认，不随main提交自动执行。

## 5. 验收与回滚

CI检查安装/格式/lint/types/build/unit/runtime/Foundry/Anvil/E2E/dry-run；Cloudflare实际发布状态另看check-run。记录devPreview及main正式URL、buildID、revision与能力变量；构建成功不是完整页面/签名兼容验收。

探针实际钱包验收在/lab完成，见[操作说明](TESTNET_LAB.md)。Group综合验收见[总计划M1-D](../planning/DEVELOPMENT_PLAN.md#5-m1-d真实综合验收可后置穿插)。无真实hash前不标C-T03通过。主网门禁独立，不能为了结束阶段自动打开。

回滚网站不能回滚数据库或链上交易；已有探针款仍按原合约可退。更换构建会影响精确runtime匹配，应保留原源码/版本和退出方式，不静默令旧款无入口。

## 6. 官方依据

- https://developers.cloudflare.com/workers/previews/get-started/
- https://developers.cloudflare.com/workers/previews/configuration/
- https://developers.cloudflare.com/workers/previews/resources/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

公共文档和dry-run不替代账户内运行验收；当前具体证据在阶段验收与PR中。
