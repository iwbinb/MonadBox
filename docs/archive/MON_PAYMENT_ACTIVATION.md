# 测试 MON 合约登记与付款启用

日期：2026-09-29。按用户已授权的 main → Production 流程接入其钱包导出的登记配置。

## 公开链核验

- 网络 Monad Testnet 10143，原生 MON，18 位小数，资产标识 address(0)。
- 管理员 `0x2f8994025fEd7E527479ac38071F69fA7d9Bdb14`；该账户 nonce 0–6 分别创建七个合约。
- 在 finalized 区块 `66563687`（`0x85ee3816e9749496d16c9e89679ca448afb2de5db2ed758ec084064b3bf192cf`）核验七份运行时代码与构建匹配、runtimeHash与导出一致、asset及intakeAdmin一致、全部intakePaused=false；带签名模块的domainNameHash匹配。
- 独立追溯每笔原始部署交易，核对发送者、nonce、chainId、to=null、value=0、完整部署输入、成功回执、创建地址与canonical/finalized区块。
- 全部操作为只读；没有使用私钥或广播交易。结构化证据见 [MON_DEPLOYMENTS.json](MON_DEPLOYMENTS.json)。

| 合约 | 地址 | 已核验部署交易 |
| --- | --- | --- |
| Group V1 | `0x015881D56f553d2eE52DBED6F237844c8fCFaC42` | [nonce 0](https://testnet.monadscan.com/tx/0xf676bfe3db32e840597524e7005cf94b687fdafdd27dd75c5698843bed11dccf) |
| Split | `0x7C4705BFd2030E0b3F85f7ec1BC622cc0fbc6b67` | [nonce 1](https://testnet.monadscan.com/tx/0x18ec8ba93b6f3b69705696eaeb0582514b2da90ebd2872dd078d12d3d3b24e69) |
| Group V2 | `0xe1A18de584Cf2920F69f4B0634B351104A9C266a` | [nonce 2](https://testnet.monadscan.com/tx/0xf6ace88ec3b0b8add4c8525d2bab665b43895f04057a5069d6fdea1d78ddb63d) |
| Deliver | `0x0788bDf95504F2B7E34Ba401a341B76dbA029025` | [nonce 3](https://testnet.monadscan.com/tx/0xde9c73c79b54157026ae48ded781ea8ef9e11de203d9f76858e72f838612fe2a) |
| Attend | `0x002310Bbc7A700DC9e1cCcC28B9d9253C2404C86` | [nonce 4](https://testnet.monadscan.com/tx/0x30b0786665cce4ef109d349d06b616824d647b6b3c9118fbf78c4aa07b505bde) |
| Milestones | `0xa8DC1049a5924506100fAdC8629000E4417580c5` | [nonce 5](https://testnet.monadscan.com/tx/0xce807a273e390ba74d6d197a2e2c0186fe957b0e22b0ce00b909f39eeab86f83) |
| Rewards | `0x4ab83D4959cA433EAf284aA08f8A395702a2B212` | [nonce 6](https://testnet.monadscan.com/tx/0x2852fb100f702d0bd5c03ef4d0d772709d75c4a2d81fcf65963a9c082221c02a) |

## 配置与数据

- 将七个实际部署登记到 wrangler.jsonc；GROUP_PREVIOUS_DEPLOYMENTS为空，现有Group V1和V2分别保留独立身份。
- 启用 NETWORK_WRITES_ENABLED、GROUP_PUBLISH_ENABLED、MODULE_PUBLISH_ENABLED。
- D1仍为 monadbox-production，读回namespace正确、cloud=3/modules=2/attachments=1、0001–0005迁移齐全，外键检查无错误。本次未修改数据库数据。
- 不启用R2；ATTACHMENTS、MAINNET、旧STORAGE、BACKGROUND与实验室保持关闭。
- 配置与部署约束38项测试、格式检查和部署预检通过；完整回归由本提交的 main CI 执行。

## 验收边界

合约部署已在真实测试网核验。真实钱包创建业务订单、支付、到账、退款/领取，以及三钱包和手机验收仍待用户签名后确认。发布配置不代表这些业务交易已经发生。

部署后的Cloudflare构建、绑定、版本及HTTP检查结果另存本轮交付证据；无法访问网站时不得把控制面部署成功当成浏览器或HTTP验收通过。
