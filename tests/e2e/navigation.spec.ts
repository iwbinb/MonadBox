import { test, expect } from '@playwright/test';
test('home shows all six tools without fake balances or payment buttons', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.locator('.tool-card')).toHaveCount(6);
  await expect(page.getByText('Payments disabled', { exact: false }).first()).toBeVisible();
  await expect(page.locator('h1')).toContainText('One link.');
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `artifacts/screenshots/home-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test('tool details support deep-link refresh and separate drafts from payments', async ({
  page,
}) => {
  await page.goto('/tools/group');
  await expect(page.locator('h1')).toHaveText('Group');
  await expect(page.getByRole('link', { name: 'Prepare a group draft' })).toBeVisible();
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Group');
  await expect(page.locator('body')).toContainText('not proof of real-world delivery');
});
test('Chinese preference persists across refresh and navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to Chinese' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.reload();
  await page.locator('.tool-card').first().click();
  await expect(page.locator('h1')).toHaveText('成团收款');
});
test('workspace tabs change the empty state without invented balances', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'To claim', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No claim data yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'To claim', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({
    path: `artifacts/screenshots/workspace-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test('unknown API returns JSON, not an SPA shell', async ({ request }) => {
  const response = await request.get('/api/missing', { headers: { Accept: 'text/html' } });
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('application/json');
  expect((await response.json()).error.code).toBe('NOT_FOUND');
});
test('invalid page has a usable 404 view', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { name: 'This page is not here.' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to tools' }).click();
  await expect(page.locator('.tool-card')).toHaveCount(6);
});
test('configuration failure offers retry and never enables payments', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/config', (route) =>
    fail
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      : route.continue(),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.goto('/tools/split');
  await expect(page.getByRole('button', { name: 'Creation not available yet' })).toBeDisabled();
});
test('no horizontal overflow at mobile width and enlarged text', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.evaluate(() => {
    const items = [
      ...document.querySelectorAll<HTMLElement>('h1,h2,h3,p,a,button,span,dt,dd,strong'),
    ];
    const sizes = items.map((el) => parseFloat(getComputedStyle(el).fontSize));
    items.forEach((el, i) => {
      el.style.fontSize = `${sizes[i]! * 2}px`;
    });
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('help and status routes explain current limits', async ({ page }) => {
  await page.goto('/help/refunds');
  await expect(page.locator('.help-list article')).toHaveCount(6);
  await page.goto('/status');
  await expect(page.locator('.status-table')).toContainText('Disabled');
  await expect(page.locator('.status-table')).toContainText('local');
});

test('keyboard skip link reaches the main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});
