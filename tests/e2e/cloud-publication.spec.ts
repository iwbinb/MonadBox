import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import type { CloudBox } from '../../src/shared/cloud/model';
const origin = 'http://127.0.0.1:8789';
const endpoint = 'http://127.0.0.1:18745';
const TOKEN = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';
test('disabled remote cloud has no implicit login or fake cloud records', async ({ page }) => {
  await page.goto('/app/groups');
  await expect(page.getByRole('heading', { name: 'Cloud groups', exact: true })).toBeVisible();
  await expect(
    page.getByText('Cloud features are ready for configuration', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in (no payment)' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Use local drafts' }).click();
  await expect(page).toHaveURL(/\/app\/group-drafts$/);
});
test('SIWE -> D1 draft -> wallet-signed LOCAL publication -> fresh anonymous public page', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const f = JSON.parse(readFileSync('artifacts/cloud-test.json', 'utf8')) as {
    accounts: Address[];
  };
  const account = f.accounts[info.project.name === 'mobile' ? 5 : 4]!;
  const beneficiary = f.accounts[9]!;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  async function raw(method: string, params: unknown[] = []) {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (await r.json()) as { result?: unknown; error?: { message: string } };
  }
  async function rpc(method: string, params: unknown[] = []) {
    const r = await raw(method, params);
    if (r.error) throw Error(r.error.message);
    return r.result;
  }
  await page.route('https://testnet-rpc.monad.xyz/**', async (route) => {
    const req = route.request().postDataJSON() as { id: number; method: string; params: unknown[] };
    const r = await raw(req.method, req.params);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...r, id: req.id, jsonrpc: '2.0' }),
    });
  });
  let signCount = 0,
    txCount = 0;
  await page.exposeFunction('__cloudRpc', async (method: string, params: unknown[]) => {
    if (!['personal_sign', 'eth_sendTransaction'].includes(method))
      throw Error('Fixture method forbidden');
    if (method === 'personal_sign') signCount++;
    const r = await rpc(method, params);
    if (method === 'eth_sendTransaction') {
      txCount++;
      await expect.poll(() => rpc('eth_getTransactionReceipt', [r])).not.toBeNull();
      await rpc('anvil_mine', ['0x41']);
    }
    return r;
  });
  await page.addInitScript(
    ({ account }) => {
      type W = Window & {
        ethereum?: unknown;
        __rejectCloud?: boolean;
        __cloudRpc: (m: string, p: unknown[]) => Promise<unknown>;
      };
      const w = window as W;
      let connected = false;
      w.ethereum = {
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_accounts') return connected ? [account] : [];
          if (method === 'eth_requestAccounts') {
            connected = true;
            return [account];
          }
          if (method === 'eth_chainId') return '0x279f';
          if (method === 'wallet_switchEthereumChain') return null;
          if (w.__rejectCloud && ['personal_sign', 'eth_sendTransaction'].includes(method)) {
            w.__rejectCloud = false;
            throw { code: 4001 };
          }
          return w.__cloudRpc(method, params);
        },
        on: () => {},
        removeListener: () => {},
      };
    },
    { account },
  );
  await page.goto(origin + '/app/groups');
  await expect(page.getByRole('button', { name: 'Connect and prepare sign-in' })).toBeVisible();
  expect(signCount).toBe(0);
  expect(txCount).toBe(0);
  await page.getByRole('button', { name: 'Connect and prepare sign-in' }).click();
  await expect(page.locator('.cloud-message')).toContainText('does not authorize payments');
  await page.evaluate(() => {
    (window as Window & { __rejectCloud: boolean }).__rejectCloud = true;
  });
  await page.getByRole('button', { name: 'Sign in (no payment)' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in (no payment)' }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  expect(signCount).toBe(1);
  expect(txCount).toBe(0);
  const t = Math.floor(Date.now() / 1000);
  const title = `LOCAL ${info.project.name} workshop`;
  const data = {
    title,
    description: 'LOCAL mock chain only. Not a real Monad transaction. <script>evil()</script>',
    unitPrice: '100000',
    minimum: 2,
    capacity: 3,
    beneficiary,
    startsAt: t + 3600,
    fundingDeadline: t + 7200,
    settleNotBefore: t + 10800,
  };
  await page.getByLabel('Import Group JSON', { exact: true }).setInputFiles({
    name: 'group.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'monadbox.group-draft',
        version: 1,
        chainId: 10143,
        asset: TOKEN,
        data,
      }),
    ),
  });
  const got = page.waitForResponse(
    (r) => r.url() === origin + '/api/v1/groups' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save to cloud', exact: true }).click();
  const saved = (await (await got).json()) as { data: CloudBox };
  await expect(page.locator('.cloud-list')).toContainText(title);
  await page.locator('.cloud-list a').filter({ hasText: title }).click();
  await expect(page.getByRole('heading', { name: 'Manage group publication' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit cloud draft', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title + ' edited');
  await page.getByRole('button', { name: 'Save cloud changes', exact: true }).click();
  await expect(page.getByText('Cloud revision 2', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: title + ' edited', exact: true })).toBeVisible();
  expect(signCount).toBe(1);
  const publicPath = origin + '/b/' + saved.data.publicId;
  const visitor = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    baseURL: origin,
  });
  const anonymous = await visitor.newPage();
  await anonymous.goto(publicPath);
  await expect(
    anonymous.getByRole('heading', { name: 'Not found or not published' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Prepare publication', exact: true }).click();
  await expect(page.getByText(/Publication status.*prepared/)).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/screenshots/cloud-publication-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sign publication', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open public page' })).toBeVisible({
    timeout: 25000,
  });
  expect(txCount).toBe(1);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open public page' })).toBeVisible();
  expect(txCount).toBe(1);
  await anonymous.reload();
  await expect(
    anonymous.getByRole('heading', { name: title + ' edited', exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(anonymous.getByText('Not started', { exact: true })).toBeVisible();
  await expect(
    anonymous.getByRole('button', { name: 'Payments are not enabled yet' }),
  ).toBeDisabled();
  await expect(anonymous.getByText('<script>evil()</script>', { exact: false })).toBeVisible();
  await anonymous.getByRole('button', { name: 'Refresh chain state' }).click();
  await expect(
    anonymous.getByRole('heading', { name: title + ' edited', exact: true }),
  ).toBeVisible();
  expect(await anonymous.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await anonymous.screenshot({
    path: `artifacts/screenshots/cloud-public-local-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect and prepare sign-in' })).toBeVisible();
  expect((await page.request.get(origin + '/api/v1/groups')).status()).toBe(401);
  await visitor.close();
});
