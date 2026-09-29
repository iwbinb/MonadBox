import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { inject, connect, origin, client } from '../fixtures/funds-browser';
import { setupKinds } from '../../src/app/shared/deployment';
const names = {
  'group-v1': 'Group V1',
  split: 'Split',
  group: 'Group V2',
  deliver: 'Deliver',
  attend: 'Attend',
  milestones: 'Milestones',
  rewards: 'Rewards',
};
test('seven native deployments require explicit signatures, recover a lost response, and export verified registration', async ({
  page,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const { accounts } = JSON.parse(readFileSync('artifacts/funds-test.json', 'utf8')) as {
    accounts: Address[];
  };
  await inject(page, accounts[8]!);
  await page.goto(origin + '/setup');
  await connect(page);
  for (const kind of setupKinds) {
    const article = page
      .locator('.setup-grid article')
      .filter({ has: page.getByRole('heading', { name: names[kind], exact: true }) });
    await article.getByRole('button', { name: 'Prepare deployment', exact: true }).click();
    const review = page.locator('.checkout-review');
    await expect(review).toContainText('0 MON');
    await expect(
      review.getByRole('button', { name: 'Confirm deployment in wallet' }),
    ).toBeDisabled();
    await review.getByRole('checkbox').check();
    if (kind === 'group-v1')
      await page.evaluate(() => {
        (window as Window & { __fundsLost: boolean }).__fundsLost = true;
      });
    await review.getByRole('button', { name: 'Confirm deployment in wallet', exact: true }).click();
    const history = page.locator('.setup-history li').filter({ hasText: names[kind] });
    await expect(history).toContainText(kind === 'group-v1' ? 'unknown' : 'broadcast');
    if (kind === 'group-v1') {
      await page.reload();
      await connect(page);
      await expect(
        page.locator('.setup-grid').getByRole('button', { name: 'Prepare deployment' }).first(),
      ).toBeDisabled();
    }
    await history.getByRole('button', { name: 'Recheck deployment', exact: true }).click();
    await expect(history).toContainText('finalized');
  }
  const panel = page.locator('.setup-export');
  const thirdAddress = await page
    .locator('.setup-grid article')
    .filter({ has: page.getByRole('heading', { name: 'Group V2', exact: true }) })
    .locator('code')
    .innerText();
  let failRpc = true,
    activeReceipts = 0,
    maxActiveReceipts = 0;
  await page.route('https://testnet-rpc.monad.xyz/**', async (route) => {
    const request = route.request().postDataJSON();
    if (
      failRpc &&
      request.method === 'eth_getCode' &&
      request.params[0].toLowerCase() === thirdAddress.toLowerCase()
    ) {
      await route.fulfill({ status: 429, body: 'Too many requests' });
      return;
    }
    if (request.method === 'eth_getTransactionReceipt') {
      activeReceipts++;
      maxActiveReceipts = Math.max(maxActiveReceipts, activeReceipts);
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        await route.fallback();
      } finally {
        activeReceipts--;
      }
    } else await route.fallback();
  });
  const nonceBefore = await client.getTransactionCount({ address: accounts[8]! });
  await panel.getByRole('button', { name: 'Verify and export registration', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Verifying Group V1');
  await expect(panel.getByRole('alert')).toContainText('Group V2: RPC rate limit');
  await expect(panel.getByRole('status')).toContainText('2/7');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.setup-history li')).toHaveCount(7);
  await panel.screenshot({ path: '/tmp/monadbox-setup-export-error.png' });
  failRpc = false;
  await panel.getByRole('button', { name: 'Verify and export registration', exact: true }).click();
  const output = page.getByRole('textbox', { name: 'Verified registration JSON', exact: true });
  await expect(output).toBeVisible();
  const config = JSON.parse(await output.inputValue());
  expect(config.MODULE_DEPLOYMENTS).toHaveLength(6);
  await expect(panel.getByRole('status')).toContainText('Verification complete: 7/7');
  expect(maxActiveReceipts).toBe(1);
  expect(await client.getTransactionCount({ address: accounts[8]! })).toBe(nonceBefore);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await panel.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  await expect(
    panel.getByRole('status').filter({ hasText: 'Configuration copied.' }),
  ).toBeVisible();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(config);
  const downloadEvent = page.waitForEvent('download');
  await panel.getByRole('link', { name: 'Download JSON', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('monadbox-registration.json');
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8'))).toEqual(config);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByRole('link', { name: 'Download JSON', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await panel.screenshot({ path: '/tmp/monadbox-setup-export-mobile.png' });
  for (const d of [
    config.GROUP_DEPLOYMENT,
    ...config.MODULE_DEPLOYMENTS.map((r: { deployment: unknown }) => r.deployment),
  ]) {
    expect(d.asset).toBe('0x0000000000000000000000000000000000000000');
    expect(d.intakeAdmin.toLowerCase()).toBe(accounts[8]!.toLowerCase());
    expect(await client.getCode({ address: d.address })).not.toBe('0x');
  }
  await panel.getByRole('button', { name: 'Verify and export registration', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Verifying Group V1');
  await page.evaluate((actor) => {
    (window as Window & { __fundsSwitch: (actor: string) => void }).__fundsSwitch(actor);
  }, accounts[7]!);
  await expect(panel).toContainText('0/7');
  await expect(output).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Verify and export registration', exact: true }),
  ).toBeDisabled();
});
