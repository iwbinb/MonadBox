# 合约

| 源码 | 职责 | 当前边界 |
| --- | --- | --- |
| `src/GroupEscrowV1.sol` | 固定单受益人的成团、退出、取消、退款 credit、结算与提款 | 已实现和本地验证；真实测试网部署待验收，资金 UI 属于 M1-C |
| `src/SplitPaymentsV1.sol` | 固定比例的最终付款及各自提款 | 本地及CI验证，公开部署另验 |
| `src/GroupEscrowV2.sol` | 成功成团时原子分配给固定多人 | 保留V1读写与退出 |
| `src/DeliveryEscrowV1.sol` | 全额预付、交付/验收、双签分配及到期退款 | 本地完整流程验证，真实双方钱包另验 |
| `src/M0CProbe.sol` | 实验室限额入金与原地址退款 | 独立技术探针，不代替业务托管 |
| `test/MockToken.sol` | 本地资产成功/失败测试 | 仅本地 fixture |

Group 以链上规则和 credit 记账为准，提款才转出代币。探针每钱包每合约最多保留 1 个 6 位精度测试代币，退款原子转回原付款人；探针没有管理员、升级、手续费或替代收款人。该限额不代表 Group 的业务限额。

## 编译与测试

Solidity 0.8.28、EVM paris、optimizer 200、Foundry 1.8.3；OpenZeppelin 锁定在 package.json/lockfile。浏览器 ABI、字节码和不可变字段位置由源码生成，不手改。

```sh
pnpm install --frozen-lockfile
bash scripts/install-test-tools.sh  # Linux x86_64，校验固定版本的 SHA-256
pnpm build
pnpm test:contracts
pnpm test:chain-local
pnpm test:cloud-local
```

macOS 使用匹配版本的本地工具；已安装的工具可复用。测试 runner 只写固定 loopback Anvil；同 chainId 或同 token 地址的 Mock 仍是本地测试。测试、构建与 CI 不执行公开合约部署。

真实部署证据登记在 [deployments](deployments/README.md)，禁止写入私钥或助记词。Group 操作见[说明](../docs/engineering/GROUP.md)，探针操作见[实验室](../docs/engineering/TESTNET_LAB.md)，资金变更须先读[资金规则](../docs/product/FUNDS_AND_STATES.md)与[合约规格](../docs/engineering/CONTRACT_SPEC.md)。
