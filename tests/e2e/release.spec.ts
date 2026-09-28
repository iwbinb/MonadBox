import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('release notices, all local builders and keyboard access work in both languages', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Direct navigation must load its own styles before any builder has been visited.
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy notice', exact: true })).toBeVisible();
  await page.screenshot({
    path: `artifacts/screenshots/privacy-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.goto('/');
  await expect(page.locator('.tool-card .status-label')).toHaveText(
    Array(6).fill('Drafts available'),
  );
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  for (const tool of ['group', 'split', 'deliver', 'attend', 'milestones', 'rewards']) {
    await page.goto('/create/' + tool);
    await expect(
      page.getByRole('textbox', { name: tool === 'group' ? 'Group title' : 'Title', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  for (const path of ['/privacy', '/terms']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('main')).toContainText('test version');
    await page.getByRole('button', { name: 'Switch to Chinese', exact: true }).click();
    await expect(page.locator('main')).toContainText(
      path === '/privacy' ? '自动物理删除尚未启用' : '平台不裁决争议',
    );
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '切换到英文', exact: true }).click();
  }
  expect(errors).toEqual([]);
});

test('public first load meets the documented local performance budget', async ({
  page,
  browser,
}, info) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 80,
    downloadThroughput: 500000,
    uploadThroughput: 125000,
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    const values = { lcp: 0, cls: 0 };
    (window as Window & { __releasePerf: typeof values }).__releasePerf = values;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) values.lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        hadRecentInput: boolean;
        value: number;
      })[])
        if (!entry.hadRecentInput) values.cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await expect(page.locator('.tool-card')).toHaveCount(6);
  await expect(page.locator('footer')).toContainText('local');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __releasePerf: { lcp: number } }).__releasePerf.lcp,
      ),
    )
    .toBeGreaterThan(0);
  const metrics = await page.evaluate(
    () => (window as Window & { __releasePerf: { lcp: number; cls: number } }).__releasePerf,
  );
  writeFileSync(
    `artifacts/performance-${info.project.name}.json`,
    JSON.stringify(
      {
        environment: 'Loopback Chromium; viewport simulation, not physical mobile or field data',
        browser: browser.version(),
        viewport: page.viewportSize(),
        throttle: { cpu: 4, latencyMs: 80, downloadBytesPerSecond: 500000, cache: false },
        metrics,
        budget: { lcp: 2500, cls: 0.1 },
      },
      null,
      2,
    ),
  );
  expect(metrics.lcp).toBeLessThanOrEqual(2500);
  expect(metrics.cls).toBeLessThanOrEqual(0.1);
});
