# 版本化支付工具

## Split 与成团分账

从工具页进入分账，或选择“创建固定多人分账的成团”。填写标题、公开说明和2–20个不同收款地址，比例合计100%。规则预览按整数最大余数分配，余数并列按发布顺序分配。小额款也全部归属，不留下舍入余额。

保存仅写当前浏览器。导出草稿用于备份；导入会创建独立草稿。在云端页登录后主动“复制到云端”，原草稿保留。发布前可修改；冻结后标题、说明、合约版本、地址、金额、比例、时间和创建盐值均不可改。需要调整时复制为新的本地草稿。

发布只创建规则。付款时分别确认精确AUSD授权和业务付款。Split每笔付款是最终付款，付款人不能强制追回。Group V2在成团成功且到结算时间后，全部本金原子归属固定收款人；不成团或取消仅按原份额退款。已归属款需再提款才能进入钱包。

没有历史记录的另一浏览器可打开原分享链接、连接原钱包，直接读取可领取权益。旧Group V1仍使用原`/b/:id`链接和合约版本，不迁移本金。新工具使用`/box/:id`。

## 回执与恢复

浏览器按环境、账号保存原动作、nonce、开始区块及已知交易哈希。拒签可重新准备；广播后未知结果必须先核验，不能直接再次付款。可提供原交易哈希；没有哈希时使用历史账户nonce定位原交易，再核验参数、目标、事件、canonical区块及finalized。RPC失败不会抹掉已有证据。

`/app/module-activity`查看新工具记录，`/app/group-activity`保留V1恢复入口。状态与可操作项来自合约；本地记录和D1均不授予资金权利。正常提款只会转给原受益人，管理员不能替换地址。

## 配置与数据

- 默认不开放云端新工具或业务付款。`MODULES_ENABLED`依赖CLOUD及已隔离的DB；`MODULE_PUBLISH_ENABLED`另控制发布；`NETWORK_WRITES_ENABLED`控制新的业务入金。现有退款、结算和提款不受入金开关影响。
- `MODULE_DEPLOYMENTS`是数组，每项含`deployment`与`current`。deployment包含tool、chainId、version、address、asset、intakeAdmin、runtimeHash。每工具只允许一个current；退休版本保留原身份以继续核验和退出。
- Split版本1、Group V2版本2。浏览器和Worker核对生成的runtime、不可变参数、官方测试AUSD、chain10143和完整规则哈希。不能只比对地址。
- 迁移`0003_modules.sql`新增`module_schema`版本1及`module_boxes`，原cloud_schema2和Group V1数据不变。应用前仍需已有environment_guard。只在本地测试应用，远端迁移和公开登记另行验收。
- 新API位于`/api/v1/modules`，支持列表、创建、读取、修订、删除草稿、`:id/prepare`和`:id/confirm`；公开读取`/api/v1/public/modules/:publicId`。私有写入均验证origin、会话、CSRF、所有者、revision；公开响应重新核验链上发布。

## 构建与本地验证

`pnpm typecheck`和`pnpm build`从固定solc0.8.28源码生成ABI/runtime；生成文件不入库。`pnpm test:contracts`运行Foundry合约及模糊测试。`modules-desktop`和`modules-mobile`浏览器项目使用固定loopback Anvil与模拟钱包，覆盖分账发布、付款、提款及Group V2成功/失败。它们不能写公开RPC，也不代表真实钱包或真实测试AUSD已验收。
