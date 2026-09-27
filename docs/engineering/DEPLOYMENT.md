# 分支、环境与Cloudflare发布

M0-A v1.0 · 当前只定义配置合同；未连接Cloudflare、未创建资源、未实际部署。

## 1. 固定流程

`dev`开发和测试 → `dev → main` PR → Bill合并 → main触发正式网站构建/部署。阶段完成后停止，不自行合并或继续下一阶段。仅维护这两条长期分支。

主干保护、必须检查、禁止强推和合并后不删dev建议在M0-B由用户授权设置。当前读取到main未保护，不把建议写成已配置事实。

## 2. 部署拓扑

采用**两个独立Workers项目**连接同一个GitHub仓库，各自只监听一个分支；这样dev的数据库、文件、队列和定时任务都可在稳定地址完整验证。不是把生产Worker的一个版本URL误当隔离环境。

| 项目拟名 | Git分支 | Wrangler环境 | 内容 | 默认链 |
| --- | --- | --- | --- | --- |
| monadbox-dev | dev | dev | 稳定开发/预览网站+API | 10143 |
| monadbox-prod | main | prod | 正式网站+API | 10143，主网单独放行 |

Cloudflare支持选择监听分支及自定义构建/部署命令；绑定并成功构建后新提交才会发布。[S05](../planning/SOURCES_AND_PROVENANCE.md) 两项目都先关闭其他分支预览，避免在不明确资源隔离时额外产生部署。未来使用原生Worker Previews需另行验证绑定隔离，不与本方案混用。

域名、Cloudflare account ID、项目名称是否可用尚未核验。不擅自声称 `monadbox.xyz` 或任何workers.dev地址已归用户所有。

## 3. M0-B 应形成的配置合同

仓库根目录构建，Vite产物由Workers Static Assets提供，API `/api/*` 必须在SPA fallback前路由。默认不存在的API返回JSON 404，不返回index.html；静态路由深链接可刷新。

拟脚本（需M0-B实际创建并验证）：

| 用途 | 预期命令/要求 |
| --- | --- |
| 安装 | 锁定pnpm版本；`pnpm install --frozen-lockfile` |
| 开发 | `pnpm dev`；本地worker及绑定模拟 |
| 质量 | `pnpm lint`、`pnpm typecheck`、`pnpm test` |
| 构建 | `pnpm build`；运行环境校验后产出静态资源/worker |
| E2E | `pnpm test:e2e`；Playwright本地/隔离预览 |
| 部署dev/prod | 对应封装脚本调用锁定Wrangler和明确 `--env dev` / `--env prod` |
| 合约测试 | `forge test`；仅工程建立后可执行 |

Cloudflare部署脚本必须检查当前branch、worker name、environment和资源ID；dev不能部署到prod，缺参数则失败，不自动回退默认环境。构建时变量和运行时secret是不同配置，不假设二者自动相通。

## 4. 环境隔离

D1、R2、Queues及死信队列必须按dev/prod分别创建，运行凭据、cookie域、钱包供应商项目和监控数据也分开。测试不能读取或清理生产资源。私有文件不经公共静态目录发布。

公开配置：APP_ENV、APP_ORIGIN、CHAIN_ID、ASSET_ALLOWLIST、CONTRACT_REGISTRY、FEATURE_FLAGS、BUILD_SHA。

运行秘密：RPC私有key、会话签名/加密材料、供应商服务端key（仅在使用时）。不得以VITE_等客户端可读前缀存秘密。链上部署私钥和用户私钥**不属于**Cloudflare环境变量。

资源ID的配置入口及类型在M0-B形成wrangler文件与 `.dev.vars.example`；示例只放说明性占位符，生产构建检测到占位符或缺少批准资源时终止。

## 5. 数据库迁移

迁移文件有顺序编号并进入PR。dev自动应用前向兼容迁移；prod初始建库在M0-B明确授权后执行。后续破坏性迁移必须独立审阅与备份，不随任意main提交自动执行。

兼容性采用先扩展后迁移最后清理：新旧前端/worker短暂共存不丢数据。应用回滚不等于D1回滚；不得用清库解决schema问题。

## 6. 合约与前后端发布分离

main更新只部署网站/API。CI、Cloudflare构建和自动脚本不得运行链上broadcast、升级、approve、资金转移或主网验证写操作。

合约部署独立执行：确认网络/版本/权限/预算→用户授权签名→记录交易和源码验证→小额测试→通过PR更新部署清单→再开放前端功能。M0-C的测试网部署也需明确授权和安全签名渠道；没有渠道就报告该验证受阻，不能导出用户私钥。

旧订单永远按原版本调用。前端主网开关、资产allowlist、合约登记缺一项即禁止新入金。正式网站可以长期提供测试网演示，不为了赶赛事截止强上主网。

## 7. M0-B 部署验收

1. dev一次实际提交只更新开发网站，prod构建hash不变。
2. 同阶段PR由用户合并后，main自动触发生产部署，展示实际buildSha。
3. dev/prod各做D1写读、R2私密访问、Queues重复消息测试；不能串用数据。
4. 深链接刷新、API404、环境标识、缺配置fail-closed、错误构建不替换工作版本。
5. 记录Cloudflare项目、URL、构建ID、hash与测试结果。首次M0-B PR只能标“dev已验收、prod待用户合并验证”，在合并后补充实际prod结果，不能预先勾全。

## 8. 回滚与事故

回滚只选择已知兼容部署，并核对ABI/DB schema。自动部署并不保证每次构建成功；失败需检查日志，不把正在构建称为上线。资金事故先关闭新入金入口，保留合约退出路径；回滚网站不能撤销链上交易。
