# 历史验收与证据

这些记录描述各批次交付时的状态、命令、测试结果和未完成项。保留原结论，仅更新搬迁后的链接；其中“下一批”“停止”等交接文字不作为当前指令。当前进度与执行方式见[总计划](../planning/DEVELOPMENT_PLAN.md)。

| 记录 | 内容 |
| --- | --- |
| [M0-A](M0-A_ACCEPTANCE.md) | 产品与工程规格基线 |
| [M0-B](M0-B_ACCEPTANCE.md) | 工程骨架、CI、网站与部署 |
| [M0-C](M0-C_ACCEPTANCE.md) | 钱包探针、本地链与真实交易待验收项 |
| [M0-C RPC 证据](M0-C_RPC_EVIDENCE.json) | 当次公开测试网只读结果，非当前实时状态 |
| [M1-A](M1-A_ACCEPTANCE.md) | 本地 Group 草稿和合约基础 |
| [M1-B](M1-B_ACCEPTANCE.md) | SIWE、云端发布、分享及 PR #6 修复的测试证据 |
| [M1-C](M1-C_ACCEPTANCE.md) | Group资金动作、回执恢复与完整CI检查点 |
| [M2-A](M2-A_ACCEPTANCE.md) | Split、Group V2、版本化发布和52项浏览器回归 |
| [M2-B](M2-B_ACCEPTANCE.md) | 共用工作台、恢复组件、换账号及60项浏览器回归 |
| [M3](M3_ACCEPTANCE.md) | Deliver五条资金路径、双签恢复、私密附件与62项浏览器回归 |
| [M4](M4_ACCEPTANCE.md) | Attend签到、独立争议、无签名持久化恢复与64项浏览器回归 |
| [M5](M5_ACCEPTANCE.md) | 逐阶段释放、剩余款终止、阶段附件与66项浏览器回归 |

## 2026-09-28 文件整理

- 五份阶段验收与一份 RPC 记录从 planning 移到本目录；测试数字和当时未完成项保留。
- 两份 Group 阶段说明合并为 [Group 操作说明](../engineering/GROUP.md)，实验室说明改为按用途命名。
- 删除已有源码/测试目录中的两个空 `.gitkeep`。
- 删除本地忽略目录内的三份提交导入临时文件、五份已被 final 日志替代的检查日志，以及可重新生成的 Worker dry-run 输出。
- 保留源码、全部测试、迁移、锁文件和部署登记说明；源码引用检查没有发现可整文件删除的孤立模块。已安装依赖、正在使用的 ABI/编译产物和修复证据日志保留，避免重复下载或丢失证据。

本轮整理不改业务代码、合约、数据库迁移或远端资源开关。
