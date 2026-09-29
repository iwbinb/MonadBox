import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';
import { origin, client, wallet, inject, mine, warp, connect } from '../fixtures/funds-browser';
import type { ModuleBox, ModuleData } from '../../src/shared/modules/model';
import { moduleCall, moduleAbi } from '../../src/shared/modules/terms';
import type { SessionInfo } from '../../src/shared/cloud/model';
async function action(page: Page, name: string) {
  await page.getByRole('button', { name: 'Prepare: ' + name, exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'I have reviewed this action and its fixed recipients.',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Latest lookup: finalized' }),
  ).toBeVisible({ timeout: 20000 });
}
test('Split browser publication and final payment; Group V2 successful split and failed refund', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(20000);
  const f = JSON.parse(readFileSync('artifacts/funds-test.json', 'utf8')) as {
    accounts: Address[];
  };
  const [creator, payer, second, recipient, partner] = f.accounts as [
    Address,
    Address,
    Address,
    Address,
    Address,
  ];
  const title = 'LOCAL split ' + info.project.name;
  await inject(page, creator);
  await page.goto(origin + '/create/split');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Recipient 1', exact: true }).fill(recipient);
  await page.getByRole('textbox', { name: 'Recipient 2', exact: true }).fill(partner);
  await page.getByRole('button', { name: 'Review rules', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Frozen rules preview' })).toContainText(
    '70.00% · 0.7 MON',
  );
  let copies = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/modules') && request.method() === 'POST') copies++;
  });
  await page.getByRole('button', { name: 'Save and continue to publish', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/modules\?draft=/);
  await expect(page.getByRole('heading', { name: 'Next: publish ' + title })).toBeVisible();
  expect(copies).toBe(0);
  await connect(page);
  await page.getByRole('button', { name: 'Prepare sign-in', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in (no payment)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Copy rules and prepare publication', exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/modules\//);
  expect(copies).toBe(1);
  await connect(page);
  await page.getByRole('button', { name: 'Prepare: Publish fixed rules', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'I have reviewed this action and its fixed recipients.',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
  const publicLink = page.getByRole('link', { name: 'Next: open payment page', exact: true });
  await expect(publicLink).toBeVisible({ timeout: 20000 });
  const path = (await publicLink.getAttribute('href'))!;
  const payerContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const recipientContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const payPage = await payerContext.newPage(),
      receivePage = await recipientContext.newPage();
    payPage.setDefaultTimeout(20000);
    receivePage.setDefaultTimeout(20000);
    await inject(payPage, payer);
    await inject(receivePage, recipient);
    await payPage.goto(origin + path);
    await connect(payPage);
    await expect(
      payPage
        .locator('.public-payment-rule')
        .getByText('Final payment: the payer cannot force a refund after payment.', {
          exact: false,
        }),
    ).toBeVisible();
    await payPage
      .getByRole('textbox', { name: 'Final payment (MON)', exact: true })
      .fill('0.000000000000000101');

    await action(payPage, 'Make final payment');
    await receivePage.goto(origin + path);
    await connect(receivePage);
    await expect(receivePage.getByText('Withdrawable credit', { exact: false })).toContainText(
      '0.000000000000000071 MON',
    );
    await receivePage
      .getByRole('button', { name: 'Prepare: Withdraw to my wallet', exact: true })
      .click();
    await receivePage.evaluate(
      (account) =>
        (window as unknown as { __fundsSwitch: (a: string) => void }).__fundsSwitch(account),
      partner,
    );
    await expect(
      receivePage.getByRole('button', { name: 'Sign this action', exact: true }),
    ).toHaveCount(0);
    await expect(receivePage.getByText('Withdrawable credit', { exact: false })).toHaveCount(0);
    await receivePage.evaluate(
      (account) =>
        (window as unknown as { __fundsSwitch: (a: string) => void }).__fundsSwitch(account),
      recipient,
    );
    await receivePage.goto(origin + '/app');
    await receivePage.locator('summary').filter({ hasText: 'Find a Box' }).click();
    await receivePage
      .getByRole('textbox', { name: 'Original public link', exact: true })
      .fill(path!);
    await receivePage.getByRole('button', { name: 'Verify and open', exact: true }).click();
    await expect(receivePage).toHaveURL(origin + path);
    await receivePage.goto(origin + '/app');
    await connect(receivePage);
    await receivePage.getByRole('button', { name: 'Refresh balances', exact: true }).click();
    await receivePage.getByRole('button', { name: 'To claim', exact: true }).click();
    await expect(receivePage.locator('.workspace-table tbody tr')).toContainText(
      '0.000000000000000071 MON',
    );
    await receivePage.getByRole('link', { name: 'View actions', exact: true }).click();
    await connect(receivePage);
    await action(receivePage, 'Withdraw to my wallet');
    await expect(
      receivePage.getByText('Already transferred to wallet', { exact: false }),
    ).toContainText('0.000000000000000071 MON');
    await receivePage.goto(origin + '/app');
    await connect(receivePage);
    await receivePage.getByRole('button', { name: 'Refresh balances', exact: true }).click();
    await expect(
      receivePage.getByRole('status').filter({ hasText: 'Checked 1 / 1' }),
    ).toBeVisible();
    await receivePage.getByRole('button', { name: 'To claim', exact: true }).click();
    await expect(receivePage.locator('.workspace-table tbody tr')).toHaveCount(0);
    await receivePage.getByRole('button', { name: 'History', exact: true }).click();
    await expect(receivePage.locator('.workspace-table tbody tr')).toContainText(
      '0.000000000000000071 MON',
    );
    // Two immutable V2 groups on the same isolated local chain. Publication HTTP uses the real verifier.
    const session = (await (await page.request.get(origin + '/api/v1/auth/session')).json())
      .data as SessionInfo;
    const headers = { Origin: origin, 'X-MonadBox-Client': 'web', 'X-CSRF-Token': session.csrf };
    const start = Number((await client.getBlock()).timestamp) + 600;
    const groups: ModuleBox[] = [];
    for (const outcome of ['success', 'failed']) {
      const data: ModuleData = {
        tool: 'group',
        title: 'LOCAL group split ' + outcome,
        description: 'LOCAL ONLY',
        unitPrice: '100000',
        minimum: 2,
        capacity: 3,
        startsAt: start,
        fundingDeadline: start + 3600,
        settleNotBefore: start + 7200,
        recipients: [
          { address: recipient, bps: 7000 },
          { address: partner, bps: 3000 },
        ],
      };
      const created = await page.request.post(origin + '/api/v1/modules', {
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        data: { data },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const row = (await created.json()).data as ModuleBox;
      const prepared = await page.request.post(origin + `/api/v1/modules/${row.id}/prepare`, {
        headers,
        data: { revision: 1 },
      });
      expect(prepared.ok(), await prepared.text()).toBe(true);
      const b = (await prepared.json()).data as ModuleBox,
        i = b.publication!;
      const hash = await wallet.sendTransaction({
        account: creator,
        ...moduleCall(i),
        nonce: i.nonce,
        value: 0n,
      });
      await client.waitForTransactionReceipt({ hash });
      await mine();
      const confirmed = await page.request.post(origin + `/api/v1/modules/${row.id}/confirm`, {
        headers,
        data: { hash },
      });
      expect(confirmed.ok(), await confirmed.text()).toBe(true);
      groups.push(b);
    }
    await warp(start);
    for (const b of groups) {
      await payPage.goto(origin + '/box/' + b.publicId);
      await connect(payPage);

      await action(payPage, 'Pay and join');
    }
    const success = groups[0]!,
      failed = groups[1]!,
      p = success.publication!.publication;
    for (const call of [
      {
        to: p.deployment.address,
        data: encodeFunctionData({
          abi: moduleAbi('group'),
          functionName: 'contribute',
          args: [p.chainBoxId],
        }),
      },
    ])
      await client.waitForTransactionReceipt({
        hash: await wallet.sendTransaction({ account: second, ...call, value: 100000n }),
      });
    await warp(start + 3600);
    await payPage.goto(origin + '/box/' + failed.publicId);
    await connect(payPage);
    await action(payPage, 'Claim refund credit');
    await action(payPage, 'Withdraw to my wallet');
    await warp(start + 7200);
    await payPage.goto(origin + '/box/' + success.publicId);
    await connect(payPage);
    await action(payPage, 'Settle frozen split');
    await receivePage.goto(origin + '/box/' + success.publicId);
    await connect(receivePage);
    await expect(receivePage.getByText('Withdrawable credit', { exact: false })).toContainText(
      '0.00000000000014 MON',
    );
    await action(receivePage, 'Withdraw to my wallet');
    expect(
      await client.readContract({
        address: p.deployment.address,
        abi: moduleAbi('group'),
        functionName: 'creditForBox',
        args: [p.chainBoxId, partner],
      }),
    ).toBe(60000n);
    expect(
      await receivePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await receivePage.screenshot({
      path: `artifacts/screenshots/modules-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await payerContext.close();
    await recipientContext.close();
  }
});
