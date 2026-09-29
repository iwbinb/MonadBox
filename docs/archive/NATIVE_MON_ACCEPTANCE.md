# 原生 MON 与全站改造验收

日期：2026-09-29。基线：main e9bfa6fb72917159003f020b7c83391b7976c2b0。工程证据与公开测试网验收分开记录。

## 交付

- 七个业务合约支持精确原生 MON 入金与固定受益人提款；所有前端金额、API、交易 value、回执及本地记录统一18位精度。保留合约层旧 ERC20 测试，当前产品只开放 MON。
- 0005 为历史记录增加 legacy 币种标记，新 MON 草稿使用独立存储键，避免旧金额被重新解释。
- 全局钱包统一 MetaMask、Keplr、OKX，支持 EIP-6963、扩展延迟注入、断开、换账号/网络、拒签与未安装状态。
- 六工具、首页、工作台、公开规则、私密交付、付款确认与手机界面按11张已选稿重做。页面汇总跟随已核验链上状态；图片预览需授权读取并核验字节数与 SHA256。
- 新增 /setup：浏览器钱包逐笔部署七个合约；丢失响应按原 nonce 恢复，核对部署交易、最终性、runtime、资产、管理员及签名域后导出登记。
- main 直接发布 Production。2026-09-29 已通过 Cloudflare API 删除旧非 main 触发器，读回仅有 main Production 触发器。

## 实际验证

环境：macOS，Node22.16.0、pnpm10.11.1、Solidity0.8.28、Foundry1.8.3、Chrome154。测试链仅 loopback Anvil，浏览器钱包为测试注入。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 应用/API/存储/钱包/交易测试 | 396/396通过，17个测试文件 | /private/tmp/monad-native-unit-final3.log |
| Solidity | 161/161通过，其中12个原生 MON 测试 | /private/tmp/monad-native-contracts-final.log |
| Group本地链 | 18笔操作、3场景，另有4笔历史探针操作 | /private/tmp/monad-native-chain-final.log |
| 云端HTTP本地链 | 10项断言通过 | /private/tmp/monad-native-cloud-final.log |
| 格式、静态检查、类型、构建 | 通过 | /private/tmp/monad-final-{format,lint,typecheck,build}.log |
| 浏览器总回归 | 76/76场景最终均通过（分批回归） | /private/tmp/monad-final-e2e3.log（68项）、monad-final-e2e-rest.log（其余6项）、monad-final-qa-release.log（Rewards双端与设计复核） |
| 依赖漏洞检查 | 369个依赖、0已知漏洞 | /private/tmp/monad-native-dependency-audit.json |
| 源码凭据扫描、部署预检 | 通过 | /private/tmp/monad-final-{secrets,dryrun}.log |
| 设计核对 | 见根目录 design-qa.md | artifacts/design-qa-native/ |

浏览器回归增加了实际 MON 付款后顶部状态同步、交付后验收、图片授权读取与完整性核验、阶段款剩余余额，以及七个合约部署/恢复/配置导出。拒签和响应丢失已有回归覆盖，本轮修复确认页隐藏错误提示的问题。

## 公开环境边界

- D1/R2创建、5份远端迁移和ID登记：尚未执行，已提出资源授权问题。
- 七个公开 Monad 测试网部署：等待用户钱包签名，无公开部署交易证据。
- 三种真实钱包扩展及手机真实设备：尚未实测；模拟provider和Chromium视口不替代真实品牌验收。
- 公开发布、MON付款及云端附件开关保持关闭，直至各自资源与登记就绪。不能把网站上线写成公开付款已验收。
- 无主网写入、私钥收集、自动公开链广播、资源迁移或赛事提交。

源码提交对应的远端CI见 GitHub main Actions；网站实际版本由 /api/v1/health 返回。最终上线核对另记录于本地 artifacts/production-release.json。
