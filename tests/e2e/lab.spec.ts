import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('monadbox.locale')) localStorage.setItem('monadbox.locale', 'en');
  });
});
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { encodeFunctionData, parseAbi } from 'viem';
import type { Address } from 'viem';
const TOKEN = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
test('lab has no implicit signing and supports missing-wallet, language and mobile states', async ({
  page,
}, info) => {
  await page.goto('/lab');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Testnet payment lab');
  await expect(page.getByText('No injected wallet detected.', { exact: false })).toBeVisible();
  await expect(
    page.locator('main').getByRole('button', { name: 'Connect wallet', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Prepare probe deployment' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('artifacts/screenshots', { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/lab-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Switch to Chinese' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('测试网付款实验室');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('测试网付款实验室');
});
test('local wallet fixture: reject, deploy, exact approve, fund, refresh, refund; no real Monad writes', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const port = 19000 + info.workerIndex;
  // Endpoint is fixed to loopback. This fixture cannot broadcast to a public network.
  const endpoint = `http://127.0.0.1:${port}`;
  const anvil = spawn(
    'tools/anvil',
    ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '10143', '--silent'],
    { stdio: 'ignore' },
  );
  let requestId = 0;
  async function raw(method: string, params: readonly unknown[] = []) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
    }).then((r) => r.json()) as Promise<{ result?: unknown; error?: { message: string } }>;
  }
  async function rpc(method: string, params: readonly unknown[] = []) {
    const r = await raw(method, params);
    if (r.error) throw Error(r.error.message);
    return r.result;
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await expect
      .poll(
        async () => {
          try {
            return await rpc('eth_chainId');
          } catch {
            return null;
          }
        },
        { timeout: 10000 },
      )
      .toBe('0x279f');
    const [account] = (await rpc('eth_accounts')) as Address[];
    const mock = JSON.parse(readFileSync('contracts/out/MockToken.sol/MockToken.json', 'utf8'));
    await rpc('anvil_setCode', [TOKEN, mock.deployedBytecode.object]);
    const mint = await rpc('eth_sendTransaction', [
      {
        from: account,
        to: TOKEN,
        data: encodeFunctionData({
          abi: parseAbi(['function mint(address,uint256)']),
          functionName: 'mint',
          args: [account!, 2_000_000n],
        }),
      },
    ]);
    await expect.poll(() => rpc('eth_getTransactionReceipt', [mint])).not.toBeNull();
    await rpc('anvil_mine', ['0x41']);
    await page.route('https://testnet-rpc.monad.xyz/**', async (route) => {
      const body = route.request().postDataJSON() as {
        id: number;
        method: string;
        params: unknown[];
      };
      const result = await raw(body.method, body.params);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ...result, id: body.id, jsonrpc: '2.0' }),
      });
    });
    await page.exposeFunction('__localRpc', async (method: string, params: unknown[]) => {
      if (!['eth_sendTransaction', 'eth_getTransactionCount', 'eth_chainId'].includes(method))
        throw Error('Fixture method not allowed');
      const result = await rpc(method, params);
      if (method === 'eth_sendTransaction') {
        await expect.poll(() => rpc('eth_getTransactionReceipt', [result])).not.toBeNull();
        await rpc('anvil_mine', ['0x41']);
      }
      return result;
    });
    await page.addInitScript(
      ({ account }) => {
        type Harness = Window & {
          ethereum?: unknown;
          __rejectNext?: boolean;
          __localRpc: (method: string, params: unknown[]) => Promise<unknown>;
        };
        const w = window as Harness;
        let connected = false;
        let chain = '0x1';
        const listeners = new Map<string, Set<(v: unknown) => void>>();
        w.ethereum = {
          request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
            if (method === 'eth_accounts') return connected ? [account] : [];
            if (method === 'eth_requestAccounts') {
              connected = true;
              return [account];
            }
            if (method === 'eth_chainId') return chain;
            if (method === 'wallet_switchEthereumChain') {
              chain = '0x279f';
              listeners.get('chainChanged')?.forEach((fn) => fn(chain));
              return null;
            }
            if (method === 'eth_sendTransaction' && w.__rejectNext) {
              w.__rejectNext = false;
              throw { code: 4001 };
            }
            return w.__localRpc(method, params);
          },
          on: (event: string, fn: (v: unknown) => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(fn);
          },
          removeListener: (event: string, fn: (v: unknown) => void) =>
            listeners.get(event)?.delete(fn),
        };
      },
      { account },
    );
    await page.goto('/lab');
    await page.locator('main').getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByText('Wrong network', { exact: false })).toBeVisible();
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'Prepare probe deployment' })).toBeDisabled();
    await page.getByRole('button', { name: 'Switch to testnet', exact: true }).click();
    await page.getByRole('button', { name: 'Check network & balances' }).click();
    await expect(page.getByText('AUSD · 6 decimals')).toBeVisible();
    await page.getByRole('button', { name: 'Prepare probe deployment' }).click();
    await expect(page.getByRole('region', { name: 'Review transaction' })).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { __rejectNext: boolean }).__rejectNext = true;
    });
    await page.getByRole('button', { name: 'Confirm in wallet' }).click();
    await expect(page.getByText('deploy · rejected', { exact: true })).toBeVisible();
    async function action(prepare: string, kind: string) {
      await page.getByRole('button', { name: prepare, exact: true }).click();
      await page.getByRole('button', { name: 'Confirm in wallet', exact: true }).click();
      await expect(page.getByText(`${kind} · finalized`, { exact: true }).first()).toBeVisible({
        timeout: 20000,
      });
    }
    await action('Prepare probe deployment', 'deploy');
    await expect(page.getByText('Bytecode and test asset match this build.')).toBeVisible();
    await action('Prepare exact approval', 'approve');
    await action('Prepare test payment', 'fund');
    await page.reload();
    await page.locator('main').getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to testnet' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Verify bytecode', exact: true }).click();
    await expect(page.getByText('fund · finalized', { exact: true })).toBeVisible();
    await action('Prepare refund', 'refund');
    await page.getByRole('button', { name: 'Check network & balances' }).click();
    const balance = await rpc('eth_call', [
      {
        to: TOKEN,
        data: encodeFunctionData({
          abi: parseAbi(['function balanceOf(address) view returns(uint256)']),
          functionName: 'balanceOf',
          args: [account!],
        }),
      },
      'latest',
    ]);
    expect(BigInt(balance as string)).toBe(2_000_000n);
    await page.getByRole('button', { name: 'Prepare refund', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('No unrefunded payment found');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/screenshots/lab-completed-local-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    anvil.kill('SIGTERM');
  }
});
