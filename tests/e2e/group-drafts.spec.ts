import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const beneficiary = '0x0000000000000000000000000000000000000011';
async function captureGroupPage(page: Page, name: string) {
  // Normalize scroll before a full-page capture so off-viewport fixed controls stay off screen.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('.skip-link')).not.toBeFocused();
  expect(
    await page.locator('.skip-link').evaluate((element) => element.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: `artifacts/screenshots/${name}-${test.info().project.name}.png`,
    fullPage: true,
  });
}
async function basics(page: Page, title = 'Workshop draft') {
  await page.goto('/create/group');
  await page.getByLabel('Group title', { exact: true }).fill(title);
  await page
    .getByLabel('Description (optional)', { exact: true })
    .fill('An explicit set of public workshop terms.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}
async function finish(page: Page) {
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Beneficiary wallet address', { exact: true }).fill(beneficiary);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Draft preview', exact: true })).toBeVisible();
}
async function finishEdited(page: Page) {
  for (let i = 0; i < 3; i++)
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
}
test('Group wizard validates fields, previews exact rules and saves without requesting a wallet', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ethereum', {
      value: {
        request: () => {
          throw Error('Unexpected wallet request in draft builder');
        },
      },
    });
  });
  await page.goto('/create/group');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Group title', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByLabel('Group title', { exact: true }).fill('Weekend builders workshop');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Amount per participant', { exact: true }).fill('0.0000001');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Amount per participant', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByLabel('Amount per participant', { exact: true }).fill('30');
  await captureGroupPage(page, 'group-builder');
  await finish(page);
  await expect(page.getByText('90 test AUSD', { exact: true })).toBeVisible();
  await expect(page.getByText('600 test AUSD', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'On-chain publishing not enabled' }),
  ).toBeDisabled();
  await expect(page.locator('.group-rules')).toContainText('no unconditional participant refund');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Weekend builders workshop', exact: true }),
  ).toBeVisible();
  await captureGroupPage(page, 'group-preview');
  expect(errors).toEqual([]);
});
test('saved draft can be edited and remains an explicitly local record', async ({ page }) => {
  await basics(page);
  await finish(page);
  await page.getByRole('link', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Group title', { exact: true }).fill('Edited workshop');
  await finishEdited(page);
  await expect(page.getByText('Draft revision 2', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'All drafts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edited workshop', exact: true })).toBeVisible();
  await expect(
    page.getByText('Saved locally, not on chain or in a cloud account.', { exact: true }),
  ).toBeVisible();
});
test('export and import produce a new independent draft', async ({ page }) => {
  await basics(page);
  await finish(page);
  const original = page.url();
  const got = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await got;
  const file = await download.path();
  expect(file).toBeTruthy();
  await page.getByRole('link', { name: 'All drafts', exact: true }).click();
  await page.getByLabel('Import draft JSON', { exact: true }).setInputFiles(file!);
  await expect(page.getByRole('heading', { name: 'Draft preview', exact: true })).toBeVisible();
  expect(page.url()).not.toBe(original);
  await page.getByRole('link', { name: 'All drafts', exact: true }).click();
  await expect(page.locator('.group-draft-list>li')).toHaveCount(2);
});
test('invalid JSON import never changes saved drafts', async ({ page }) => {
  await basics(page);
  await finish(page);
  await page.getByRole('link', { name: 'All drafts', exact: true }).click();
  await page.getByLabel('Import draft JSON', { exact: true }).setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"chainId":143}'),
  });
  await expect(page.getByRole('alert')).toContainText('No draft was imported');
  await expect(page.locator('.group-draft-list>li')).toHaveCount(1);
});
test('corrupt local data is retained instead of silently reset', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('monadbox.group-drafts.v1:local:10143', 'broken'));
  await page.goto('/app/group-drafts');
  await expect(page.getByRole('alert')).toContainText('not been erased');
  expect(
    await page.evaluate(() => localStorage.getItem('monadbox.group-drafts.v1:local:10143')),
  ).toBe('broken');
});
test('storage write failure preserves the form and offers export, not success', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('monadbox.group-drafts.'))
        throw new DOMException('Quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await basics(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Beneficiary wallet address', { exact: true }).fill(beneficiary);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('storage');
  await expect(page.getByRole('button', { name: 'Export without saving' })).toBeEnabled();
  await expect(page).toHaveURL(/\/create\/group$/);
});
test('stale tab cannot overwrite a newer draft', async ({ page, context }) => {
  await basics(page);
  await finish(page);
  const url = page.url() + '/edit';
  await page.goto(url);
  const second = await context.newPage();
  await second.goto(url);
  await expect(second.getByLabel('Group title', { exact: true })).toHaveValue('Workshop draft');
  await second.getByLabel('Group title', { exact: true }).fill('Saved in another tab');
  await finishEdited(second);
  await expect(second.getByText('Draft revision 2', { exact: true })).toBeVisible();
  await page.getByLabel('Group title', { exact: true }).fill('Stale editor value');
  await finishEdited(page);
  await expect(page.getByRole('alert')).toContainText('changed in another tab');
  await second.reload();
  await expect(
    second.getByRole('heading', { name: 'Saved in another tab', exact: true }),
  ).toBeVisible();
  await second.close();
});
test('delete confirmation removes only the chosen local draft', async ({ page }) => {
  await basics(page);
  await finish(page);
  await page.getByRole('link', { name: 'All drafts', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No saved group drafts' })).toBeVisible();
});
test('draft page deep links explain local-only access', async ({ page }) => {
  await page.goto('/app/group-drafts/8eaf1c65-7d75-4180-81c9-b119ce9c24d0');
  await expect(
    page.getByRole('heading', { name: 'Draft not found in this browser' }),
  ).toBeVisible();
  await expect(
    page.getByText('Draft URLs are not public payment links.', { exact: false }),
  ).toBeVisible();
});
test('Chinese form labels, review and mobile enlarged text remain usable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to Chinese' }).click();
  await page.goto('/create/group');
  await page.getByLabel('活动标题', { exact: true }).fill('周末开发者工作坊');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByLabel('每人金额', { exact: true })).toHaveValue('30');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => {
    const elements = [
      ...document.querySelectorAll<HTMLElement>('h1,h2,p,a,button,label,input,small,li'),
    ];
    const sizes = elements.map((e) => parseFloat(getComputedStyle(e).fontSize));
    elements.forEach((e, i) => (e.style.fontSize = `${sizes[i]! * 2}px`));
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
