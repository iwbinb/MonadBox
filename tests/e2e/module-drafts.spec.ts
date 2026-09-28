import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const a = '0x1111111111111111111111111111111111111111',
  b = '0x2222222222222222222222222222222222222222';
async function fields(page: Page) {
  await page.goto('/create/split');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Shared local split');
  await page.getByRole('textbox', { name: 'Recipient 1', exact: true }).fill(a);
  await page.getByRole('textbox', { name: 'Recipient 2', exact: true }).fill(b);
}
test('split validation explains duplicate addresses and exact percentage totals', async ({
  page,
}) => {
  await fields(page);
  await page.getByRole('textbox', { name: 'Recipient 2', exact: true }).fill(a);
  await page.getByRole('button', { name: 'Review rules', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Correct the marked fields');
  await expect(page.locator('input[aria-invalid="true"]')).toHaveCount(1);
  await page.getByRole('textbox', { name: /^Recipient 2/ }).fill(b);
  await page.getByRole('textbox', { name: 'Share (%) 2', exact: true }).fill('29.999');
  await page.getByRole('button', { name: 'Review rules', exact: true }).click();
  await expect(
    page.getByText('Use a positive percentage with at most two decimals.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save reviewed draft', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('textbox', { name: /^Share \(%\) 2/ }).fill('30');
  await page.getByRole('button', { name: 'Review rules', exact: true }).click();
  await page.getByRole('button', { name: 'Save reviewed draft', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/module-drafts\//);
  await page.goto('/app');
  await expect(page.locator('.workspace-grid article')).toContainText('Shared local split');
  await expect(page.locator('.workspace-grid article')).toContainText('Local draft');
  await expect(page.locator('.workspace-grid article')).not.toContainText('AUSD');
});
test('quota failure retains reviewed rules for export without claiming save', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('monadbox.module-drafts.'))
        throw new DOMException('Quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await fields(page);
  await page.getByRole('button', { name: 'Review rules', exact: true }).click();
  await page.getByRole('button', { name: 'Save reviewed draft', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/create\/split$/);
  await page.getByText('Export reviewed rules without saving', { exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Reviewed rules JSON', exact: true }),
  ).toContainText('Shared local split');
  await expect(page.getByText('Saved in this browser.', { exact: true })).toHaveCount(0);
});
test('workspace rejects another origin without sending a request there', async ({ page }) => {
  let requests = 0;
  await page.route('https://example.invalid/**', (route) => {
    requests++;
    return route.abort();
  });
  await page.goto('/app');
  await page
    .getByRole('textbox', { name: 'Restore from an original public link', exact: true })
    .fill('https://example.invalid/box/11111111-1111-4111-8111-111111111111');
  await page.getByRole('button', { name: 'Verify and open link', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('this environment');
  expect(requests).toBe(0);
});
test('Chinese workspace supports narrow screens and enlarged text', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Switch to Chinese', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole('button', { name: '可领取', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '暂无符合条件的记录', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const elements = [
      ...document.querySelectorAll<HTMLElement>('h1,h2,p,a,button,label,input,span'),
    ];
    const sizes = elements.map((e) => parseFloat(getComputedStyle(e).fontSize));
    elements.forEach((e, i) => (e.style.fontSize = `${sizes[i]! * 2}px`));
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `artifacts/screenshots/workspace-zh-${test.info().project.name}.png`,
    fullPage: true,
  });
});
