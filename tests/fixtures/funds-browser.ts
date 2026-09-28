import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createPublicClient, createWalletClient, http } from 'viem';
import type { Address, Hex } from 'viem';
import { TEST_CHAIN } from '../../src/shared/lab/network';
export const origin = 'http://127.0.0.1:18890',
  rpc = 'http://127.0.0.1:18746';
export const client = createPublicClient({
  chain: TEST_CHAIN,
  transport: http(rpc),
  pollingInterval: 50,
});
export const wallet = createWalletClient({ chain: TEST_CHAIN, transport: http(rpc) });
export async function raw(method: string, params: unknown[] = []) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const d = (await r.json()) as { result: unknown; error?: unknown };
  if (d.error) throw Error(JSON.stringify(d.error));
  return d.result;
}
export async function mine() {
  await raw('anvil_mine', ['0x41']);
}
export async function warp(time: number) {
  await raw('evm_setNextBlockTimestamp', [time]);
  await raw('evm_mine');
  await mine();
}
export async function inject(page: Page, actor: Address) {
  await page.route('https://testnet-rpc.monad.xyz/**', async (route) => {
    const q = route.request().postDataJSON() as { id: number; method: string; params: unknown[] };
    try {
      const result = await raw(q.method, q.params);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }),
      });
    } catch {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: q.id,
          error: { code: -32000, message: 'local error' },
        }),
      });
    }
  });
  await page.exposeFunction('__fundsRpc', async (method: string, params: unknown[]) => {
    if (!['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4'].includes(method))
      throw Error('Only explicit local sends and login');
    if (method === 'personal_sign' || method === 'eth_signTypedData_v4') return raw(method, params);
    const hash = (await raw(method, params)) as Hex;
    await client.waitForTransactionReceipt({ hash });
    await mine();
    return hash;
  });
  await page.addInitScript(
    ({ actor }) => {
      const w = window as Window & {
        ethereum?: unknown;
        __fundsActor: string;
        __fundsSwitch: (actor: string) => void;
        __fundsReject?: boolean;
        __fundsLost?: boolean;
        __fundsRpc: (m: string, p: unknown[]) => Promise<unknown>;
      };
      let connected = false;
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      w.__fundsSwitch = (next) => {
        w.__fundsActor = next;
        for (const listener of listeners.get('accountsChanged') ?? []) listener([next]);
      };
      w.__fundsActor = actor;
      w.ethereum = {
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_accounts') return connected ? [w.__fundsActor] : [];
          if (method === 'eth_requestAccounts') {
            connected = true;
            return [w.__fundsActor];
          }
          if (method === 'eth_chainId') return '0x279f';
          if (method === 'wallet_switchEthereumChain') return null;
          if (w.__fundsReject) {
            w.__fundsReject = false;
            throw { code: 4001 };
          }
          const result = await w.__fundsRpc(method, params);
          if (w.__fundsLost) {
            w.__fundsLost = false;
            throw Error('Response lost after local broadcast');
          }
          return result;
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const group = listeners.get(event) ?? new Set();
          group.add(listener);
          listeners.set(event, group);
        },
        removeListener: (event: string, listener: (...args: unknown[]) => void) => {
          listeners.get(event)?.delete(listener);
        },
      };
    },
    { actor },
  );
}
export async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect funds wallet', exact: true }).click();
  await expect(page.getByText('Snapshot block', { exact: false })).toBeVisible();
}
