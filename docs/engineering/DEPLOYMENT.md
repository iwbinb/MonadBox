# Cloudflare 发布：一个 Worker + dev Preview

M0-B 更新 · 2026-09-27。本文件替代 M0-A 的两个 Worker 方案。用户自行在 Cloudflare 控制台连接 GitHub；不需要把管理 API Token 或私钥发送给开发者。

## 1. 当前可部署的范围

只读网页和健康/配置 API；所有钱包、付款、主网和创建订单功能关闭。首次部署不要求 D1、R2、Queues 或 secrets。缺少未来业务资源不会伪装成可用业务服务。

`main` → monadbox 正式版本；`dev` → 同一个 Worker 的 Worker Previews。旧 `versions upload` 的版本URL不是本方案。项目名必须为 `monadbox`，仓库根目录构建。Wrangler固定4.135.0，compatibility_date固定2026-09-18。

## 2. 控制台填写

| 字段 | 值 |
| --- | --- |
| Repository | iwbinb/MonadBox |
| Project name | monadbox |
| Production branch | main |
| Build command | pnpm build |
| Deploy command | pnpm run deploy |
| Preview command | pnpm run deploy:preview |
| Root directory | 仓库根目录，保持默认 |
| Node version | 22.16.0，仓库.node-version已声明 |
| Preview Builds | 开启，并只允许dev分支（可配置时） |

必须保留 `pnpm run deploy` 中的 `run`，避免调用pnpm自身同名的工作区部署命令。

这两个部署脚本分别调用仓库已锁定的 `wrangler deploy` 和 `wrangler preview --name dev`，增加分支与配置校验。不要使用 `npx wrangler@latest`。若控制台仍保留 `npx wrangler deploy/preview` 默认值，改成上述脚本可防止将dev误发到正式站。

构建环境应识别packageManager=pnpm@10.11.1与pnpm-lock.yaml；自动安装采用lockfile，不需要手动复制node_modules。安装失败时先检查Node/pnpm版本与安装日志，不删除锁文件。

初始main只有文档，不能首次构建。须由Bill合并工程PR后才具备可构建入口。后续先dev预览测试再合并main；首次工程发布本身不启用资金操作。

## 3. 配置与安全

`wrangler.jsonc`顶层配置production，`previews.vars`完整声明Preview变量，不依赖继承。两个环境都强制10143、空资产/合约清单、所有资金操作关闭。STORAGE_NAMESPACE分别为monadbox-production/monadbox-preview。

`scripts/validate-config.mjs`拒绝错误项目名、重复环境Worker、主网、未经验证的资源和后台任务；`scripts/deploy.mjs`要求production对应main、preview对应dev。构建只生成dist，不发布、不迁移数据库、不签名。分支与构建版本读取Cloudflare官方注入的WORKERS_CI_BRANCH和WORKERS_CI_COMMIT_SHA。

`wrangler.local.jsonc`仅供本地模拟：D1假ID仅在本地使用，不能上传为真实绑定。`pnpm dev`先构建再启动本地Workers；`pnpm db:migrate:local`只应用本地迁移。业务写功能仍关闭。

## 4. 后续添加资源

Preview URL独立不等于数据自动隔离。后续在单独PR配置生产/预览各自的D1与私有R2、完整变量及secret；不同环境不得共享同一数据库或桶。命名空间校验是额外防护，不替代真实资源隔离。

迁移0001不写入环境标记；首次资源验收须给各自数据库写入唯一environment_guard（monadbox-production或monadbox-preview），再验证读写隔离。未绑定/标记错误，storage功能fail closed。仅为读文件服务时应在后续拆分所需binding校验，不能为绕过检查绑定生产队列。

新Worker Previews不能作为Queue消费者，也不运行Cron。本地Miniflare可验证消费者/重试/DLQ逻辑，但不是远端触发器验收。实际远端后台测试需单独审批隔离部署或其他测试方案，不为此现在强制创建第二个完整网站Worker。

远端迁移和资源创建不包含在本次工程基础中，不随main提交自动进行。任何破坏性迁移需审阅、备份和独立操作。

## 5. 验收与回滚

工程验收：安装、格式、lint、types、构建、单元/运行时测试、browser E2E、Wrangler dry-run。Cloudflare实际部署验收另做：记录URL、构建ID、revision、生产与Preview变量；dev提交只更新预览，main合并才更新正式站。

`/status`和`/api/v1/health`用于核对环境与buildSha，不显示虚构部署状态。任意API未知路由返回JSON404，不被SPA吞掉；私密附件没有公开诊断入口。

构建失败不得称为发布成功。应用回滚不能回滚数据库或链上交易；M0-B尚未进行任何真实资金操作。未来合约部署仍独立审批，Git/Cloudflare流水线永远不broadcast。

## 6. 官方依据

- https://developers.cloudflare.com/workers/previews/get-started/
- https://developers.cloudflare.com/workers/previews/configuration/
- https://developers.cloudflare.com/workers/previews/resources/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

公开资料核对与CLI dry-run不等于已在用户账户上实际部署。
