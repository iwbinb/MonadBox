# M0-C 测试网实验室操作与恢复

2026-09-27 · 本文区分已实现功能和待实际签名的验收。入口为网站 `/lab`，独立于六个业务工具。

## 1. 当前能力

浏览器通过 EIP-6963 发现注入钱包，并兼容 window.ethereum。只有点击连接按钮才请求钱包账户授权；选择测试网、确认摘要、在钱包中批准后才会写链。服务器和 CI 不持有签名密钥。

支持路径：普通外部账户 EOA。代码非空的智能账户、已委托账户/EIP-7702 暂时禁止写入；WalletConnect、邮箱钱包、Gas 赞助和 SIWE 会话未实现。模拟钱包测试通过不等于已经在 MetaMask、硬件钱包或真实 Safari 中验证。

网络固定 Monad Testnet 10143；浏览器 RPC 固定 `https://testnet-rpc.monad.xyz`。资产固定官方测试 AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`，精度须为 6，代码和 symbol 必须可读。默认金额 **0.1 测试 AUSD**；每钱包每探针保留款最大 **1 测试 AUSD**，不是美元充值。

## 2. 准备与安全

使用只放测试资产的普通测试钱包。不要在实验室使用主网资产，不导入助记词到网页，不把私钥或助记词发送给开发者。一次只在一个标签页、同一钱包运行一条流程，不并行发送其他交易。

测试 MON 的官方入口：[Monad Faucet](https://faucet.monad.xyz)。测试 AUSD 和其水龙头地址见 [Agora 官方部署表](https://docs.agora.finance/developer/contract-deployments)。本次已只读核实水龙头代码存在，但没有领取测试币，也未确认当前资格/额度；不要假设任意 mint 函数可以调用，更不要从陌生链接购买测试资产。

在开始前确认钱包已持有足够测试 MON 支付部署和三次代币相关交易的 Gas，并持有至少本次入金数量的测试 AUSD。界面会估算 Gas，不宣称固定费用或法币价值。

## 3. 首次真实测试网验收流程

1. 在 `/lab` 选择已安装钱包，点击 **Connect wallet / 连接钱包**，再 **Switch to testnet / 切换测试网**。
2. 点击 **Check network & balances / 核实网络与余额**，查看 chainId、finalized 区块、官方资产、MON/AUSD 余额。网络或资产未核实就不继续。
3. 勾选仅使用测试资产的确认，点击 **Prepare probe deployment / 准备部署探针**，查看摘要，再在钱包中确认。等待 `deploy · finalized`，保存探针地址及部署交易哈希。
4. 保持金额 0.1，点击 **Prepare exact approval / 准备精确额度授权**，查看目标 token、页面上已验证的 spender/探针地址和额度，再确认签名。等待 `approve · finalized`。**这一步不是付款。**
5. 点击 **Prepare test payment / 准备测试入金**，确认后等待 `fund · finalized`，保存 Payment ID、入金哈希和实际合约保留款。
6. 刷新页面并重新连接相同钱包，必要时点击 **Verify bytecode / 核对合约代码**。确认历史仍在，然后在该笔入金记录上点击 **Prepare refund / 准备退款**，签名并等待 `refund · finalized`。
7. 再核对余额与保留款：本金应退回原付款地址，探针保留款应为 0；MON 因 Gas 消耗而减少。保存退款哈希，并检查剩余授权。精确授权正常消耗后不应留有超额授权；异常时不要盲目继续。

复用探针时先填已有地址并核验**本版本精确运行时代码和固定 token**。地址或合约名称看起来相似不足以获得信任。M0-C 尚无开发者认证的公开部署地址，不提供虚构地址。

这四笔真实交易都需要用户的钱包签名。本次 CI 只在固定 loopback Anvil 中完成了相同动作，没有替用户进行公开链部署、授权、付款或退款。

## 4. 回执与恢复

| 状态 | 含义与处理 |
| --- | --- |
| signing | 已保存待签意图；检查钱包，避免另开重复请求 |
| broadcast | 已取得哈希但尚未证明成功 |
| included | 已收录但未达到 finalized 条件；不显示为最终成功 |
| finalized | 交易目标、发起者、nonce、输入和事件匹配，且原区块仍 canonical、finalized 高度已覆盖 |
| rejected | 用户拒签，未按本流程发出交易；可重新准备 |
| reverted | 交易最终失败，Gas 可能已消耗；检查原因 |
| replaced | 同一账户 nonce 最终被另一笔不同操作使用；原意图没有按预期执行 |
| unknown | 超时、回执暂缺或链状态不一致；**不等于失败，不盲目重发** |

点击 **Recheck on chain** 是只读操作，不要求签名。丢失返回哈希时，程序可在最近最多 41 个区块内按账户+nonce寻找交易；超出范围，复制钱包/区块浏览器里的原哈希或替代哈希，用界面恢复入口核验。未知状态不会自动再次入金。

本地记录只保存账号、网络、意图、目标、金额、nonce、哈希和状态，没有私钥/原始签名。它是恢复提示，不是链上资金权威。记录写入失败时阻止开始新的签名；若签名后保存失败，会保留已知哈希并提示保存。建议额外记录探针地址和 Payment ID，不用“清除浏览器数据”解决未知交易。

### 没有本地历史也可退款

先核验原探针地址，使用页面底部 **Refund without browser history**，填原 Funded 事件中的 Payment ID。程序读链确认原付款人、金额和未退状态，再准备退款。合约退款永远付给原付款地址；不是当前访问页面的任意人。

正常界面要求原付款钱包参与。合约本身允许其他人支付 Gas 调用退款，但不能改变受益人。密钥丢失、代币冻结、链故障或合约漏洞不具有后台万能恢复能力。

## 5. 探针和业务规则的区别

M0CProbe 没有管理员、升级、费用、验收期、分账和活动逻辑；refund 是即时的原地址原子转账，失败时权益回滚。本探针只验证技术基础，不等同于未来 Group/Deliver 的资金托管规则。

业务全局 `NETWORK_WRITES_ENABLED=false`、`MAINNET_ENABLED=false`、空业务资产/合约登记继续生效。独立 `TESTNET_LAB_ENABLED=true` 只允许实验室请求用户显式签名；它不授权 Worker 或 CI 代签。

合约源码/ABI/字节码在构建时生成，编译不会部署。模型采用 Solidity 0.8.28、paris、optimizer200、OpenZeppelin5.7.0。网页核对代码不是区块浏览器源码验证，更不是安全审计。

## 6. 验收交接

把**探针地址、部署/授权/入金/退款的四个哈希、Payment ID、所用钱包/浏览器版本**交给项目维护者核对即可；不要提供密钥。记录真实网络的 code、receipt、日志、canonical/finalized 区块、余额变化和重复退款拒绝，才可关闭 C-T03/C-T06 的真实网络部分并继续 M1。

公共地址和哈希会暴露链上活动，只用测试钱包。没有这些证据，M0-C 始终显示“开发/本地测试完成，真实链上签名验收待完成”。

## 7. 官方依据

- [Monad 测试网与水龙头](https://docs.monad.xyz/developer-essentials/testnet)
- [Agora 官方部署表](https://docs.agora.finance/developer/contract-deployments)
- [EIP-6963 多钱包发现](https://eips.ethereum.org/EIPS/eip-6963)
- [EIP-1193 Provider API](https://eips.ethereum.org/EIPS/eip-1193)
- [OpenZeppelin ERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20)
- [实际只读 RPC 记录](../planning/M0-C_RPC_EVIDENCE.json)

公开资料核验日期为 2026-09-27；实际当前 RPC/代码以每次调用结果为准。
