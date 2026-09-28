import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { encodeFunctionData, erc20Abi } from 'viem';
import { origin, client, wallet, inject, mine, warp } from '../fixtures/funds-browser';
import { TOKEN } from '../../src/shared/lab/network';
import type { ModuleBox, ModuleData } from '../../src/shared/modules/model';
import { moduleCall, moduleAbi } from '../../src/shared/modules/terms';
import type { SessionInfo } from '../../src/shared/cloud/model';
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect funds wallet', exact: true }).click();
}
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
    '70.00% · 0.7 AUSD',
  );
  await page.getByRole('button', { name: 'Save reviewed draft', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/module-drafts\//);
  await page.goto(origin + '/app/modules');
  await page.getByRole('button', { name: 'Connect and prepare sign-in', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in (no payment)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy to cloud', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/modules\//);
  await page.getByRole('button', { name: 'Freeze and prepare publication', exact: true }).click();
  await connect(page);
  await page.getByRole('button', { name: 'Prepare: Publish fixed rules', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'I have reviewed this action and its fixed recipients.',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
  const publicLink = page.getByRole('link', { name: 'Open verified public link', exact: true });
  await expect(publicLink).toBeVisible({ timeout: 20000 });
  const path = (await publicLink.getAttribute('href'))!;
  const mock = JSON.parse(readFileSync('contracts/out/MockToken.sol/MockToken.json', 'utf8'));
  for (const actor of [payer, second])
    await client.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        account: creator,
        address: TOKEN,
        abi: mock.abi,
        functionName: 'mint',
        args: [actor, 1000000n],
      }),
    });
  await mine();
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
      payPage.getByText('Final payment: the payer cannot force a refund after payment.', {
        exact: false,
      }),
    ).toBeVisible();
    await payPage
      .getByRole('textbox', { name: 'Final payment (AUSD)', exact: true })
      .fill('0.000101');
    await action(payPage, 'Approve exact amount');
    await action(payPage, 'Make final payment');
    await receivePage.goto(origin + path);
    await connect(receivePage);
    await expect(receivePage.getByText('Withdrawable credit', { exact: false })).toContainText(
      '0.000071 AUSD',
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
    await receivePage
      .getByRole('textbox', { name: 'Restore from an original public link', exact: true })
      .fill(path!);
    await receivePage.getByRole('button', { name: 'Verify and open link', exact: true }).click();
    await expect(receivePage).toHaveURL(origin + path);
    await receivePage.goto(origin + '/app');
    await connect(receivePage);
    await receivePage.getByRole('button', { name: 'Check chain rights', exact: true }).click();
    await receivePage.getByRole('button', { name: 'To claim', exact: true }).click();
    await expect(receivePage.locator('.workspace-grid article')).toContainText('0.000071 AUSD');
    await receivePage.getByRole('link', { name: 'Open rules and actions', exact: true }).click();
    await connect(receivePage);
    await action(receivePage, 'Withdraw to my wallet');
    await expect(
      receivePage.getByText('Already transferred to wallet', { exact: false }),
    ).toContainText('0.000071 AUSD');
    await receivePage.goto(origin + '/app');
    await connect(receivePage);
    await receivePage.getByRole('button', { name: 'Check chain rights', exact: true }).click();
    await expect(
      receivePage.getByRole('status').filter({ hasText: 'Checked 1 / 1' }),
    ).toBeVisible();
    await receivePage.getByRole('button', { name: 'To claim', exact: true }).click();
    await expect(receivePage.locator('.workspace-grid article')).toHaveCount(0);
    await receivePage.getByRole('button', { name: 'History', exact: true }).click();
    await expect(receivePage.locator('.workspace-grid article')).toContainText('0.000071 AUSD');
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
      await action(payPage, 'Approve exact amount');
      await action(payPage, 'Pay and join');
    }
    const success = groups[0]!,
      failed = groups[1]!,
      p = success.publication!.publication;
    for (const call of [
      {
        to: TOKEN,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [p.deployment.address, 100000n],
        }),
      },
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
        hash: await wallet.sendTransaction({ account: second, ...call, value: 0n }),
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
      '0.14 AUSD',
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
