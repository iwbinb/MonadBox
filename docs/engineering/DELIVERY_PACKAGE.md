# 工程交付与演示包

本交付覆盖六工具完整本地流程；公众发布验收见[总计划](../planning/DEVELOPMENT_PLAN.md)。源码长期保留在dev，供[PR #7](https://github.com/iwbinb/MonadBox/pull/7)审阅，不自动合并。

## 1. 可复现构建

Node22.16.0、pnpm10.11.1；Solidity0.8.28、Paris、optimizer200；原生工具Foundry1.8.3与solc固定哈希见安装脚本。先安装锁文件依赖，按contracts/README准备本地原生工具与Playwright Chromium，然后执行：

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm check:secrets
pnpm typecheck
pnpm build
pnpm test
pnpm test:contracts
pnpm test:chain-local
pnpm test:cloud-local
pnpm test:e2e
pnpm deploy:dry-run
```

资金测试只使用固定loopback Anvil18745/18746、隔离Worker18889/18890，常规UI8787。端口占用时失败退出，不自动停止其他项目，也不允许覆盖为公开RPC。测试启动前确认没有其他进程使用这些端口。

构建记录源码revision和dirty状态、依赖锁SHA256、7个业务合约ABI/runtime模板与源码哈希、直接依赖许可、初始JS gzip大小。runtime模板未填部署不可变值，不能代替实际部署runtimeHash。

| 证据 | 位置与含义 |
| --- | --- |
| 编译与预算 | `artifacts/release-evidence.json`；初始首方JS预算250KiB gzip，合约runtime不超过24576bytes |
| 性能 | `artifacts/performance-{desktop,mobile}.json`；Chromium、80ms网络延迟、4Mbps下载、4倍CPU减速，LCP<=2.5秒、CLS<=0.1；视口模拟不代表真实设备或线上用户分布 |
| 金额与Gas | `artifacts/rewards-gas-*.json`；100人真实本地交易，创建/领取/回收明确调用及预算 |
| 操作截图 | `artifacts/screenshots/`；六工具桌面/手机实际流程与恢复 |
| 功能录像 | `artifacts/demo/rewards-*-LOCAL.webm`；创建者与recipient两端，永久LOCAL/Anvil/MockToken标识 |
| 源码与回归 | CI中的`source.tar`、Playwright报告、失败trace；以该run检出的SHA为准 |

上述生成产物不进Git，在本地或对应CI artifact读取。CI保留7天，需要长期保存时从最终成功run导出。录像是自动化真实操作证据，可暂停核对；演讲录制可沿用下述脚本。

## 2. 六工具演示与验收矩阵

| 工具 | 创建与正常路径 | 异常退出与恢复 | 操作说明 |
| --- | --- | --- | --- |
| Group V1 | 固定金额/人数/受益人→授权加入→截止成功→结算credit→提款 | 提前退出、未成团、取消、unknown恢复 | [Group](GROUP.md) |
| Split | 固定2–20收款人及比例→最终付款→最大余数分配→各自提款 | 错nonce/重复/转账失败拒绝；付款后不单方追回 | [支付模块](MODULES.md) |
| Group V2 | 成团成功→冻结70/30等方案原子分账 | 未成团仅退原参与者；V1旧地址继续读取和退出 | [支付模块](MODULES.md) |
| Deliver | 全额预付→双方文件→一次交付→接受或沉默释放→提款 | 未交付、主动退款、双签争议与争议超时 | [Deliver](DELIVER.md) |
| Attend | 押金报名→固定认证方临时签名→签到全退→提款 | 截止前退出、个人申诉、缺席扣款、取消及超时 | [Attend](ATTEND.md) |
| Milestones | 2–10阶段全额预存→当前阶段文件/交付→逐段释放 | 已释放不追回；争议/超时一次处理全部剩余款 | [Milestones](MILESTONES.md) |
| Rewards | CSV→排序/公开预览→准确授权→另签全额入金发布→领取/提款 | 丢失发布响应后恢复；到期回收不能收走已claim的credit | [Rewards](REWARDS.md) |

## 3. 建议演示讲稿（约5分钟）

1. 首页展示六工具与测试网边界，切中文，再进入工作台。说明草稿在浏览器，云端复制明确触发；没有虚构用户、余额或TVL。
2. 用Group演示“未成团可退”和“成功credit仍需提款”。Split补充固定比例、最终付款；GroupV2组合成功分配、失败不提前分账。
3. Deliver展示固定双方、私密附件、验收期限；用Milestones显示当前阶段、已释放与全部剩余款，强调正式争议终止余下计划。Attend说明固定签到方的信任和个人申诉窗口。
4. 播放Rewards创建者/recipient录像：100地址总额199最小单位→授权尚未发布→发布转入全部199→响应丢失/刷新恢复→领取31但未提款→到期回收168→原31依然可以提款。所有交易为本地测试。
5. 结束于实际测试报告、源码/锁定版本、隐私说明和待验收清单。切勿将本地合约地址或交易链接当作真实部署。

若要手动复现本地资金场景，先完成合约编译测试，再运行`MONADBOX_LOCAL_FUNDS_TEST=1 node scripts/cloud-test-server.mjs`。此fixture用于自动化，不提供公众钱包部署；真实钱包演示需另走部署登记和官方测试资产验收。

## 4. 故障与退出操作单

- 钱包拒签：没有发送证据时返回准备；若发送后响应丢失，保留unknown和原nonce，先核验，不能复制后立即重付。
- RPC异常/链重组：暂停展示已核验状态；保留原hash、块和原规则。恢复后核对canonical/finalized，勿凭D1手动改成paid。
- 页面/Worker停服：保留本地导出的部署、chainId、boxId、terms与交易记录。使用原源码/ABI和已核验地址，逐项读取链状态，再由用户钱包调用其已有退出动作；不要将资产直接转到合约地址。
- 工具退出：Group按窗口leave或失败creditRefund；Split只能提款既有credit；Deliver/Milestones按未交付/争议到期或双方协议；Attend按取消、签到/申诉规则逐人处理；Rewards到期仅创建者reclaimExpired。所有模块另提供`withdrawFor(boxId,beneficiary)`，受益人不可替换。
- 事故发生时停止新发布/新入金，保持旧版读取、恢复与退出入口。intakeAdmin只可暂停新增，不能搬走资金；链上已部署版本不就地修改规则。新修复必须新版本登记并保留旧权益。
- 文件泄露/资源错配：关闭附件上传入口，核查固定双方、namespace与访问记录。不得在公开issue贴附件、会话或原始签名；私密响应渠道与保留/删除安排须上线前明确。

## 5. 外部待验收清单

| 外部事项 | 需要的真实证据 |
| --- | --- |
| 资源与部署 | 用户配置/授权独立D1/R2、顺序迁移和environment marker；公开测试网合约部署、固定管理员/资产、runtime、源码验证及旧版登记 |
| 资金与设备 | 官方测试AUSD行为和最大名单Gas，桌面/手机真实EOA、签名/拒签/账户切换/恢复；Safari等实际版本 |
| 用户与安全 | 3–5位潜在创建者访谈、至少5位外部使用者记录，独立合约与运营安全复核；模拟地址不能冒充用户 |
| 数据与服务 | 私密支持渠道、实际基础设施日志期限、附件物理保留/删除策略及运营方政策复核；目前90天是API访问截止，不是物理删除承诺 |
| 赛事 | 完整官方规则、截止时区、地区/团队资格、跨项目复用与赞助奖项条件；详见来源记录。未提交、未注册或代为接受条款 |
| 主网 | G-07单独授权、安全审核、业务限制与实际资产验收；默认禁止 |

这份清单记录发布依赖，不代表已完成。代码和测试完成后可直接开展上述验收，无需再次开发六套基础流程。

## 6. 参赛简介草稿

MonadBox是一套按固定规则收款、退款与分账的六工具站点，面向社区组织者、创作者和小团队。一个共享工作台把成团、分账、交付托管、活动押金、阶段款和名单奖励的正常完成与异常退出放在一起。资金归属由版本化合约和整数规则决定，网站负责清晰预览、签名前核验与交易恢复。

本轮新增工作涵盖全部业务合约、双语界面、云端发布、权限、私密交付、签名协议和本地全流程验证。当前证据为本地/CI工程验证，真实Monad部署与用户试用待验；没有上线用户、TVL或独立审计声明。源代码见PR及其固定提交；复用及许可证状态见[来源记录](../planning/SOURCES_AND_PROVENANCE.md)。
