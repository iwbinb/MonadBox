# Contracts — M0-C test probe

`src/M0CProbe.sol` is an isolated, unaudited **testnet-only** payment/refund probe, not one of the six business tools. Constructor and funding enforce chainId 10143. Maximum outstanding per payer per probe: 1 token with 6 decimals. No administrator, upgrade, fee or alternative refund recipient.

`refund(id)` transfers atomically to the original payer; anyone may pay gas, but cannot redirect funds. Transfer failure preserves the claim. This probe deliberately has no business acceptance window or split/credit system. It must not be advertised or reused as a production escrow without the later specifications and review.

Compiler: Solidity 0.8.28; EVM: paris; optimizer: 200; Foundry: 1.8.3; OpenZeppelin dependency is pinned in package.json/lockfile. `pnpm compile:probe` generates ABI, creation bytecode and immutable-aware runtime from the exact source for the browser. The browser compares the actual runtime and official test token before approval.

```sh
pnpm install --frozen-lockfile
bash scripts/install-test-tools.sh  # Linux x86_64, hashes checked
pnpm test:contracts
pnpm compile:probe
pnpm test:chain-local
```

`test/MockToken.sol` and Anvil accounts are local test fixtures only. The integration runner fixes its RPC to 127.0.0.1; same network ID/token address in a fixture does not make it a real Monad testnet transaction.

No public probe address has been deployed or recorded by the developer in this stage. Actual deployment is an explicit user wallet action in `/lab`. CI only compiles/tests locally. Never supply a private key or seed to the app/CI. Real transaction acceptance and source verification remain pending; see [M0-C acceptance](../docs/planning/M0-C_ACCEPTANCE.md).
