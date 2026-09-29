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
  await page.getByRole('button', { name: 'Verify and export registration', exact: true }).click();
  const output = page.getByRole('textbox', { name: 'Verified registration JSON', exact: true });
  await expect(output).toBeVisible();
  const config = JSON.parse(await output.inputValue());
  expect(config.MODULE_DEPLOYMENTS).toHaveLength(6);
  for (const d of [
    config.GROUP_DEPLOYMENT,
    ...config.MODULE_DEPLOYMENTS.map((r: { deployment: unknown }) => r.deployment),
  ]) {
    expect(d.asset).toBe('0x0000000000000000000000000000000000000000');
    expect(d.intakeAdmin.toLowerCase()).toBe(accounts[8]!.toLowerCase());
    expect(await client.getCode({ address: d.address })).not.toBe('0x');
  }
});
