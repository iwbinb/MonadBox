# M0-C 验收记录

> 历史验收记录：保留当时结论与未完成项，不作为当前执行指令。最新状态与后续顺序见[总计划](../planning/DEVELOPMENT_PLAN.md)。

2026-09-27 · **开发与本地自动验证已交付；真实 Monad 测试网签名交易尚未完成。** 不把完整 M0-C、C-T03 或实际钱包兼容性标为通过。

## 1. 本次交付

独立 `/lab` 页面；EIP-6963/legacy 注入钱包发现、显式连接和切换10143；RPC和官方测试AUSD metadata检查；用户签名部署限额探针、精确approve、fund、refund；精确代码检查；交易状态/最终确认/替换/未知回执恢复；刷新后恢复记录；无历史时通过Payment ID恢复退款；本地链和浏览器验证；更新阶段文档。

六个业务工具、SIWE、业务订单、主网、远端存储/后台仍未开放。没有使用任何用户私钥、没有后台代签或公开链广播。探针是独立技术实验，不是生产资金模块。

## 2. 实际公共网络只读验证

执行来源：[CI 36322782982](https://github.com/iwbinb/MonadBox/actions/runs/36322782982)，UTC 2026-09-27T13:33:26.313Z；摘要见 [RPC evidence](M0-C_RPC_EVIDENCE.json)。

| 检查 | 实际结果 | 边界 |
| --- | --- | --- |
| eth_chainId | 0x279f = 10143 | 实际RPC，不只是配置值 |
| 区块和Gas | eth_blockNumber / eth_gasPrice 返回成功 | 不保证后续价格/限流不变 |
| finalized / safe | 实际返回区块高度和hash | 顺序读取非同一瞬间；不是自造确认延时 |
| 官方测试AUSD | 代码5937字节，decimals=6、symbol=AUSD | 未执行真实transfer/approve |
| 官方AUSD faucet | 代码1200字节 | 没有领取，不证明当前资格/额度 |
| 公开交易 | **0笔** | 部署、approve、fund、refund均待用户签名 |

原始准备包artifact10933625103的SHA-256为0c84ab202ae4dee940d0715d1e40e3a43f8b867c20dbdc2d16be17fa05e520da。代码哈希/区块/时间已保存仓库摘要，避免仅依赖会过期的artifact。

## 3. 自动验证

首轮完整 [CI 36324193088](https://github.com/iwbinb/MonadBox/actions/runs/36324193088)，job108633666587，结论success。输入提交76a6d9f；该任务生成锁文件与格式化提交a98d047，随后测试该工作区并生成source.tar；最终清理/文档提交另有只读CI，结果在PR中核对。

| 项目 | 结果 | 测试类型 |
| --- | --- | --- |
| 安装、格式、lint、typecheck、build | 通过 | 锁定依赖，前端/Worker分别检查 |
| Vitest | **112/112** | 原78＋新34，包含实际本地Miniflare、金额、配置、钱包接口、持久化失败、回执、重放 |
| Foundry | **18/18** | 其中2项fuzz各512 runs；原地址退款、重复/超额/错链、失败回滚、转账扣费与重入边界 |
| Local Anvil integration | **4个操作、5项检查通过** | 部署→approve→fund→refund；丢失响应后不重发恢复；代码匹配/余额守恒/重复退款/委托账户拒绝 |
| Playwright Chromium | **24/24** | 12场景×桌面/手机尺寸；无真实扩展、无实际Safari |
| Wrangler dry-run | 通过 | 只检查可发布产物，没有签名/链上部署 |
| 源码读回 | 已完成 | 下载source.tar核对远端格式化源码与lockfile |

所有上述CI步骤退出0。浏览器报告stats为total24/expected24/unexpected0/flaky0/skipped0。校验包artifact10933058389的SHA-256为bc33041a1bb97ed95fed2d8562e283107a089cae226747d1a443f8c4d14ed405。

**Local Anvil即使使用10143与官方token地址，也是loopback节点和MockToken，不是Monad。** 测试脚本无公网写入RPC开关，CI不会领取测试币或部署公开合约。fixture哈希/探针地址不得写进公开部署登记。

## 4. 页面验证

复用M0-B的白卡、浅底、紫色强调和系统字体；新增实验室不重做首页。Browser插件不可用，使用GitHub Actions中的Playwright Chromium。

实际流程：页面无钱包→按钮禁用；显式连接→错链提示→切链；用户拒签；再次准备→部署→精确授权→入金；刷新重连→回执恢复→退款；第二次退款被拒绝。完整有钱包流程的RPC被测试框架重定向到本地Anvil，不能作为真实扩展/公网验收。

已查看lab-desktop、lab-mobile及lab-completed-local-desktop截图；检查标题/导航、步骤层级、按钮可用状态、网络和限额提示、长地址换行、桌面两列/手机单列。未将模拟余额/哈希当真实使用数据。浏览器用例还检查控制台pageerror、深链接、中英文、放大文字、键盘跳转和横向溢出。

## 5. C-T门槛状态

| ID | 状态 |
| --- | --- |
| C-T01 正确网络识别/拒绝错链 | 公网只读＋本地错误路径通过 |
| C-T02 官方资产实际调用 | code/decimals/symbol只读通过；真实授权/转账仍待签名 |
| C-T03 真实钱包→合约→退款 | **待完成**；未获取测试资金签名权限，未广播公网交易 |
| C-T04 Approve不误判为Funded | 本地单元/链/浏览器通过；公网回执待补 |
| C-T05 拒签/revert/未知回执不报成功 | 自动测试通过；真实钱包品牌兼容性待补 |
| C-T06 重复退款与本金守恒 | Foundry/Anvil通过；公网完整资金路径待补 |
| C-T07 事件重放/乱序/重组 | 本地fixture通过；不是已部署的生产索引器 |

G-03/G-04尚未完全关闭。Smart account/EIP-1271、7702委托账户写入未验收，因此被阻止；无WalletConnect和SIWE。Solidity/paris能在本地EVM编译和执行，实际Monad部署兼容性仍待C-T03。

## 6. M0-B之后的部署证据补记

M0-B PR#2已合并为e2e2430。先前GitHub返回Cloudflare生产构建aa42b9d8-7133-4f69-81fa-4df39dadaa52、dev Preview构建9af05c74-b14a-4791-8290-331428084bae均success。

用户贴出的生产health：service monadbox、stage M0-B、status ok、revision e2e2430caba74fa62c05ce5921bfe22db90a4821、environment production、chainId10143、storage/background/payments disabled。此项是**用户提供响应**，不冒称本次浏览器已独立读过生产页面。

远端D1/R2/Queues仍未创建/启用，Preview运行态变量和完整交互尚未独立核实。M0-C新提交的CI/Cloudflare状态在其PR中核对，不用M0-B部署成功替代M0-C验收。

## 7. 限制、警告与下一步

未进行独立安全审计、公开源码验证或真实钱包/真实设备测试。公网RPC速率/浏览器CORS/资产冻结风险仍需真实测试；只有测试资产才可进入探针。恢复扫描最多41近期区块；更旧的未知交易需用户提供hash，不能盲目清记录重发。一次只用一个测试标签页，不宣称跨浏览器互斥锁。

首次准备任务遇到官方solc下载403，改用官方GitHub镜像并验证固定SHA-256后成功；首个主CI因锁文件未更新失败，生成精确lock后完整验证通过。一次性带写权限的lock/format workflow已删除，常驻CI只读且不自动发布合约。已有工具链生命周期/第三方构建警告不构成安全审计。

下一步由Bill审阅本阶段PR；部署实验室后，用普通测试钱包完成[操作说明](../engineering/TESTNET_LAB.md)的四笔签名交易并提供哈希。核实真实本金退回、余额和回执后再关闭M0-C，随后单独确认进入M1。本次不自动合并或开发M1。
