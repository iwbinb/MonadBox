import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { origin, client, wallet, inject, mine, warp, connect } from '../fixtures/funds-browser';
import { localDateInput } from '../../src/shared/group/draft';
import { moduleAbi, moduleCall, agreementTerms } from '../../src/shared/modules/terms';
import { agreementHash } from '../../src/shared/modules/agreement';
import type { Agreement, ModuleBox, ModuleData } from '../../src/shared/modules/model';
import type { SessionInfo } from '../../src/shared/cloud/model';
async function login(page: Page) {
  await connect(page);
  await page.getByRole('button', { name: 'Prepare sign-in', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in (no payment)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
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
test('Deliver normal acceptance, private files, missing delivery, silent review, bilateral dispute and timeout', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(20000);
  const f = JSON.parse(readFileSync('artifacts/funds-test.json', 'utf8')) as {
    accounts: Address[];
  };
  const [, buyer, seller] = f.accounts as [Address, Address, Address];
  const sellerContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined }),
    sellPage = await sellerContext.newPage();
  sellPage.setDefaultTimeout(20000);
  try {
    await inject(page, buyer);
    await inject(sellPage, seller);
    await page.goto(origin + '/create/deliver');
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('LOCAL Delivery ' + info.project.name);
    await page.getByRole('textbox', { name: 'Buyer wallet', exact: true }).fill(buyer);
    await page.getByRole('textbox', { name: 'Seller wallet', exact: true }).fill(seller);
    await page
      .getByRole('textbox', { name: 'Full prepayment (MON)', exact: true })
      .fill('0.000000000000000101');
    await page
      .getByLabel('Fund before (local time)', { exact: true })
      .fill(localDateInput(Number((await client.getBlock()).timestamp) + 86400));
    await page.getByRole('spinbutton', { name: 'Delivery hours (1–720)', exact: true }).fill('1');
    await page.getByRole('spinbutton', { name: 'Review hours (1–168)', exact: true }).fill('1');
    await page.getByRole('spinbutton', { name: 'Dispute hours (24–720)', exact: true }).fill('24');
    await page.getByRole('button', { name: 'Review rules', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Frozen rules preview' })).toContainText(
      'silence until the review deadline',
    );
    await page.getByRole('button', { name: 'Save reviewed draft', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/module-drafts\//);
    await page.goto(origin + '/app/modules');
    await login(page);
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
    const link = page.getByRole('link', { name: 'Open verified public link', exact: true });
    await expect(link).toBeVisible();
    const path = (await link.getAttribute('href'))!;
    const session = await page.evaluate(
      async () => (await (await fetch('/api/v1/auth/session')).json()).data as SessionInfo,
    );
    const firstBox = await page.evaluate(
      async () => (await (await fetch('/api/v1/modules')).json()).data[0] as ModuleBox,
    );
    const p = firstBox.publication!.publication;
    async function go(path: string) {
      await page.goto(origin + path);
      await connect(page);
      await sellPage.goto(origin + path);
      await connect(sellPage);
    }
    await go(path);

    await action(page, 'Pay full escrow');
    await sellPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await login(sellPage);
    await sellPage.getByLabel('Choose a private file', { exact: true }).setInputFiles({
      name: 'delivery.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Verified private delivery note'),
    });
    await sellPage
      .getByRole('button', { name: 'Upload this file to the private order', exact: true })
      .click();
    await expect(
      sellPage.getByRole('link', { name: 'Download with access check', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Refresh file list', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Download with access check', exact: true }),
    ).toBeVisible();
    const downloadPath = (await page
      .getByRole('link', { name: 'Download with access check', exact: true })
      .getAttribute('href'))!;
    expect(await (await page.request.get(origin + downloadPath)).text()).toBe(
      'Verified private delivery note',
    );
    await sellPage
      .getByRole('textbox', { name: 'Delivery or dispute evidence (temporary text)', exact: true })
      .fill('Private delivery note provided to buyer.');
    await action(sellPage, 'Submit delivery proof');
    await page.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await action(page, 'Accept and release payment');
    await sellPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await action(sellPage, 'Withdraw to my wallet');
    const create = async (name: string) => {
      const data = {
        ...p.data,
        title: 'LOCAL ' + name + ' ' + info.project.name,
        fundBy: Number((await client.getBlock()).timestamp) + 86400,
      } as ModuleData;
      const prepared = await page.evaluate(
        async ({ data, csrf }) => {
          const request = async (path: string, body: unknown) => {
            const r = await fetch('/api/v1' + path, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-MonadBox-Client': 'web',
                'X-CSRF-Token': csrf,
                'Idempotency-Key': crypto.randomUUID(),
              },
              body: JSON.stringify(body),
            });
            const result = await r.json();
            if (!r.ok) throw Error(JSON.stringify(result));
            return result.data;
          };
          const box = await request('/modules', { data });
          return request(`/modules/${box.id}/prepare`, { revision: 1 }) as Promise<ModuleBox>;
        },
        { data, csrf: session.csrf },
      );
      const intent = prepared.publication!,
        call = moduleCall(intent),
        hash = await wallet.sendTransaction({ account: buyer, ...call, value: 0n });
      await client.waitForTransactionReceipt({ hash });
      await mine();
      await page.evaluate(
        async ({ id, hash, csrf }) => {
          const r = await fetch(`/api/v1/modules/${id}/confirm`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-MonadBox-Client': 'web',
              'X-CSRF-Token': csrf,
            },
            body: JSON.stringify({ hash }),
          });
          if (!r.ok) throw Error(await r.text());
        },
        { id: prepared.id, hash, csrf: session.csrf },
      );
      await go('/box/' + prepared.publicId);

      await action(page, 'Pay full escrow');
      return intent.publication;
    };
    const record = async (pub: typeof p) =>
      (await client.readContract({
        address: pub.deployment.address,
        abi: moduleAbi('deliver'),
        functionName: 'getOffer',
        args: [pub.chainBoxId],
      })) as { submitDue: bigint; reviewDue: bigint; disputeDue: bigint };
    let current = await create('missing delivery');
    await warp(Number((await record(current)).submitDue));
    await page.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await action(page, 'Refund missing delivery');
    await action(page, 'Withdraw to my wallet');
    current = await create('silent review');
    await sellPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await sellPage
      .getByRole('textbox', { name: 'Delivery or dispute evidence (temporary text)', exact: true })
      .fill('Delivery for review');
    await action(sellPage, 'Submit delivery proof');
    await warp(Number((await record(current)).reviewDue));
    await sellPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await action(sellPage, 'Settle after review deadline');
    await action(sellPage, 'Withdraw to my wallet');
    current = await create('bilateral settlement');
    await sellPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await sellPage
      .getByRole('textbox', { name: 'Delivery or dispute evidence (temporary text)', exact: true })
      .fill('Delivery under disagreement');
    await action(sellPage, 'Submit delivery proof');
    await page.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Delivery or dispute evidence (temporary text)', exact: true })
      .fill('Missing agreed feature');
    await action(page, 'Open formal dispute');
    await page
      .getByRole('textbox', { name: 'Refund to buyer (MON)', exact: true })
      .fill('0.000000000000000031');
    await page.getByRole('button', { name: 'Review allocation proposal', exact: true }).click();
    await expect(
      page.getByRole('textbox', { name: 'Proposal JSON to exchange (no signatures)', exact: true }),
    ).toHaveValue(/schemaVersion/);
    const raw = await page
        .getByRole('textbox', { name: 'Proposal JSON to exchange (no signatures)', exact: true })
        .inputValue(),
      proposal = JSON.parse(raw) as Agreement;
    expect(
      await client.readContract({
        address: current.deployment.address,
        abi: moduleAbi('deliver'),
        functionName: 'agreementDigest',
        args: [agreementTerms(proposal)],
      }),
    ).toBe(agreementHash(current, proposal));
    await page.getByRole('button', { name: 'Sign this allocation only', exact: true }).click();
    await expect(
      page.getByRole('textbox', { name: 'Buyer signature (temporary)', exact: true }),
    ).toHaveValue(/^0x[0-9a-f]{130}$/i);
    const first = await page
      .getByRole('textbox', { name: 'Buyer signature (temporary)', exact: true })
      .inputValue();
    expect(first).toMatch(/^0x[0-9a-f]{130}$/i);
    await sellPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await sellPage
      .getByRole('textbox', { name: 'Proposal JSON to exchange (no signatures)', exact: true })
      .fill(raw);
    await sellPage.getByRole('button', { name: 'Review received proposal', exact: true }).click();
    await sellPage.getByRole('button', { name: 'Sign this allocation only', exact: true }).click();
    await expect(
      sellPage.getByRole('textbox', { name: 'Seller signature (temporary)', exact: true }),
    ).toHaveValue(/^0x[0-9a-f]{130}$/i);
    const second = await sellPage
      .getByRole('textbox', { name: 'Seller signature (temporary)', exact: true })
      .inputValue();
    expect(second).toMatch(/^0x[0-9a-f]{130}$/i);
    await page
      .getByRole('textbox', { name: 'Seller signature (temporary)', exact: true })
      .fill(second);
    await page
      .getByRole('button', { name: 'Verify both signatures for submission', exact: true })
      .click();
    await page.evaluate(() => {
      (window as Window & { __fundsLost: boolean }).__fundsLost = true;
    });
    await page
      .getByRole('button', { name: 'Prepare: Submit bilateral agreement', exact: true })
      .click();
    await page
      .getByRole('checkbox', {
        name: 'I have reviewed this action and its fixed recipients.',
        exact: true,
      })
      .check();
    await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.reload();
    await connect(page);
    const recovery = page.getByRole('listitem').filter({ hasText: 'Submit bilateral agreement' });
    await expect(recovery).toContainText('Outcome unknown');
    await recovery.getByRole('button', { name: 'Recheck transaction', exact: true }).click();
    await expect(recovery).toContainText('Finalized');
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain(first);
    expect(stored).not.toContain(second);
    expect(
      await client.readContract({
        address: current.deployment.address,
        abi: moduleAbi('deliver'),
        functionName: 'creditForBox',
        args: [current.chainBoxId, buyer],
      }),
    ).toBe(31n);
    expect(
      await client.readContract({
        address: current.deployment.address,
        abi: moduleAbi('deliver'),
        functionName: 'creditForBox',
        args: [current.chainBoxId, seller],
      }),
    ).toBe(70n);
    await action(page, 'Withdraw to my wallet');
    await sellPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await action(sellPage, 'Withdraw to my wallet');
    current = await create('dispute timeout');
    await sellPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await sellPage
      .getByRole('textbox', { name: 'Delivery or dispute evidence (temporary text)', exact: true })
      .fill('Delivery');
    await action(sellPage, 'Submit delivery proof');
    await page.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Delivery or dispute evidence (temporary text)', exact: true })
      .fill('Formal dispute');
    await action(page, 'Open formal dispute');
    await warp(Number((await record(current)).disputeDue));
    await page.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await action(page, 'Refund after dispute timeout');
    await action(page, 'Withdraw to my wallet');
    await page.screenshot({
      path: `artifacts/screenshots/delivery-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await sellerContext.close();
  }
});
