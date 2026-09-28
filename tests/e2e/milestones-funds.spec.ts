import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { origin, client, wallet, inject, mine, warp, connect } from '../fixtures/funds-browser';
import { action, login, publish } from '../fixtures/modules-browser';
import { TOKEN } from '../../src/shared/lab/network';
import { localDateInput } from '../../src/shared/group/draft';
import { moduleAbi, agreementTerms } from '../../src/shared/modules/terms';
import { agreementHash } from '../../src/shared/modules/agreement';
import type {
  Agreement,
  ModuleBox,
  ModuleData,
  ModulePublication,
} from '../../src/shared/modules/model';
test('Milestones full sequence, stage files, recovery, remaining refund and bilateral termination', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(20000);
  const { accounts } = JSON.parse(readFileSync('artifacts/funds-test.json', 'utf8')) as {
    accounts: Address[];
  };
  const [admin, buyer, seller] = accounts as [Address, Address, Address],
    tokenAbi = JSON.parse(readFileSync('contracts/out/MockToken.sol/MockToken.json', 'utf8')).abi;
  await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      account: admin,
      address: TOKEN,
      abi: tokenAbi,
      functionName: 'mint',
      args: [buyer, 1000000n],
    }),
  });
  await mine();
  const sellerContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined }),
    sellPage = await sellerContext.newPage();
  sellPage.setDefaultTimeout(20000);
  try {
    await inject(page, buyer);
    await inject(sellPage, seller);
    await page.goto(origin + '/create/milestones');
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('LOCAL Milestones ' + info.project.name);
    await page.getByRole('textbox', { name: 'Buyer wallet', exact: true }).fill(buyer);
    await page.getByRole('textbox', { name: 'Seller wallet', exact: true }).fill(seller);
    await page
      .getByLabel('Fund before (local time)', { exact: true })
      .fill(localDateInput(Number((await client.getBlock()).timestamp) + 86400));
    await page.getByRole('spinbutton', { name: 'Dispute hours (24–720)', exact: true }).fill('24');
    await page.getByRole('button', { name: 'Add stage', exact: true }).click();
    for (let n = 0; n < 3; n++) {
      const group = page.getByRole('group', { name: 'Stage ' + (n + 1), exact: true });
      await group
        .getByRole('textbox', { name: 'Stage title', exact: true })
        .fill(['Design', 'Build', 'Handover'][n]!);
      await group
        .getByRole('textbox', { name: 'Acceptance criteria (public)', exact: true })
        .fill('Reviewed output ' + (n + 1));
      await group
        .getByRole('textbox', { name: 'Stage amount (AUSD)', exact: true })
        .fill(['0.000031', '0.00004', '0.00003'][n]!);
      await group
        .getByRole('spinbutton', { name: 'Delivery hours (1–720)', exact: true })
        .fill('1');
      await group.getByRole('spinbutton', { name: 'Review hours (1–168)', exact: true }).fill('1');
    }
    await page.getByRole('button', { name: 'Review rules', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Frozen rules preview' })).toContainText(
      'Released stages cannot be clawed back',
    );
    await expect(page.getByRole('region', { name: 'Frozen rules preview' })).toContainText(
      '0.000101',
    );
    await page.getByRole('button', { name: 'Save reviewed draft', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/module-drafts\//);
    await page.goto(origin + '/app/modules');
    await login(page);
    await page.getByRole('button', { name: 'Copy to cloud', exact: true }).click();
    await page.getByRole('button', { name: 'Freeze and prepare publication', exact: true }).click();
    await page.getByRole('button', { name: 'Connect funds wallet', exact: true }).click();
    await action(page, 'Publish fixed rules');
    const box = await page.evaluate(
      async () => (await (await fetch('/api/v1/modules')).json()).data[0] as ModuleBox,
    );
    let p = box.publication!.publication;
    async function go(pub: ModulePublication) {
      await page.goto(origin + '/box/' + pub.publicId);
      await connect(page);
      await sellPage.goto(origin + '/box/' + pub.publicId);
      await connect(sellPage);
    }
    async function refresh(target = page) {
      await target.getByRole('button', { name: 'Read my rights', exact: true }).click();
    }
    async function submit() {
      await refresh(sellPage);
      await sellPage
        .getByRole('textbox', {
          name: 'Delivery or dispute evidence (temporary text)',
          exact: true,
        })
        .fill('Stage proof ' + crypto.randomUUID());
      await action(sellPage, 'Submit delivery proof');
      await refresh();
    }
    async function record(pub = p) {
      return (await client.readContract({
        address: pub.deployment.address,
        abi: moduleAbi('milestones'),
        functionName: 'getOffer',
        args: [pub.chainBoxId],
      })) as {
        currentStage: bigint;
        released: bigint;
        submitDue: bigint;
        reviewDue: bigint;
        disputeDue: bigint;
      };
    }
    async function credit(actor: Address) {
      return await client.readContract({
        address: p.deployment.address,
        abi: moduleAbi('milestones'),
        functionName: 'creditForBox',
        args: [p.chainBoxId, actor],
      });
    }
    async function next(title: string) {
      const data = {
        ...p.data,
        title: 'LOCAL ' + title,
        fundBy: Number((await client.getBlock()).timestamp) + 86400,
      } as ModuleData;
      p = await publish(page, data, buyer);
      await go(p);
      await action(page, 'Approve exact amount');
      await action(page, 'Pay full escrow');
    }
    await go(p);
    await action(page, 'Approve exact amount');
    await action(page, 'Pay full escrow');
    await login(sellPage);
    const choose = sellPage.getByLabel('Choose a private file', { exact: true });
    await choose.setInputFiles({
      name: 'design.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Stage one design'),
    });
    await sellPage
      .getByRole('button', { name: 'Upload this file to the private order', exact: true })
      .click();
    await expect(
      sellPage.getByRole('link', { name: 'Download with access check', exact: true }),
    ).toBeVisible();
    await submit();
    await page.evaluate(() => {
      (window as Window & { __fundsLost: boolean }).__fundsLost = true;
    });
    await page
      .getByRole('button', { name: 'Prepare: Accept and release payment', exact: true })
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
    const recovery = page.getByRole('listitem').filter({ hasText: 'Accept and release payment' });
    await expect(recovery).toContainText('Outcome unknown');
    await recovery.getByRole('button', { name: 'Recheck transaction', exact: true }).click();
    await expect(recovery).toContainText('Finalized');
    expect((await record()).currentStage).toBe(1n);
    expect(await credit(seller)).toBe(31n);
    // New files must target the current stage; old files stay available to both parties.
    await choose.setInputFiles({
      name: 'stale-stage.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Old stage should be closed'),
    });
    await sellPage
      .getByRole('button', { name: 'Upload this file to the private order', exact: true })
      .click();
    await expect(sellPage.getByRole('alert')).toBeVisible();
    await sellPage.getByRole('combobox', { name: 'File stage', exact: true }).selectOption('1');
    await choose.setInputFiles({
      name: 'build.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Stage two build'),
    });
    await sellPage
      .getByRole('button', { name: 'Upload this file to the private order', exact: true })
      .click();
    await expect(
      sellPage.getByRole('link', { name: 'Download with access check', exact: true }),
    ).toHaveCount(2);
    const oldPath = (await sellPage
      .getByRole('listitem')
      .filter({ hasText: 'design.txt' })
      .getByRole('link', { name: 'Download with access check' })
      .getAttribute('href'))!;
    expect(await (await page.request.get(origin + oldPath)).text()).toBe('Stage one design');
    await submit();
    await warp(Number((await record()).reviewDue));
    await refresh();
    await action(page, 'Settle after review deadline');
    expect((await record()).released).toBe(71n);
    expect((await record()).currentStage).toBe(2n);
    await submit();
    await action(page, 'Accept and release payment');
    expect((await record()).released).toBe(101n);
    await refresh(sellPage);
    await action(sellPage, 'Withdraw to my wallet');
    await next('partial delivery then missing stage');
    await submit();
    await action(page, 'Accept and release payment');
    await warp(Number((await record()).submitDue));
    await refresh();
    await action(page, 'Refund missing delivery');
    expect(await credit(buyer)).toBe(70n);
    expect(await credit(seller)).toBe(31n);
    await action(page, 'Withdraw to my wallet');
    await next('remaining plan agreement');
    await submit();
    await action(page, 'Accept and release payment');
    await submit();
    await page
      .getByRole('textbox', { name: 'Delivery or dispute evidence (temporary text)', exact: true })
      .fill('Second stage dispute');
    await action(page, 'Open formal dispute');
    await page
      .getByRole('textbox', { name: 'Refund to buyer (AUSD)', exact: true })
      .fill('0.00005');
    await page.getByRole('button', { name: 'Review allocation proposal', exact: true }).click();
    await expect(
      page.getByRole('textbox', { name: 'Proposal JSON to exchange (no signatures)', exact: true }),
    ).toHaveValue(/stageIndex/);
    const proposalRaw = await page
        .getByRole('textbox', { name: 'Proposal JSON to exchange (no signatures)', exact: true })
        .inputValue(),
      proposal = JSON.parse(proposalRaw) as Agreement;
    expect(proposal.remaining).toBe('70');
    expect(proposal.stageIndex).toBe(1);
    expect(
      await client.readContract({
        address: p.deployment.address,
        abi: moduleAbi('milestones'),
        functionName: 'agreementDigest',
        args: [agreementTerms(proposal)],
      }),
    ).toBe(agreementHash(p, proposal));
    await page.getByRole('button', { name: 'Sign this allocation only', exact: true }).click();
    await expect(
      page.getByRole('textbox', { name: 'Buyer signature (temporary)', exact: true }),
    ).toHaveValue(/^0x[0-9a-f]{130}$/i);
    await refresh(sellPage);
    await sellPage
      .getByRole('textbox', { name: 'Proposal JSON to exchange (no signatures)', exact: true })
      .fill(proposalRaw);
    await sellPage.getByRole('button', { name: 'Review received proposal', exact: true }).click();
    await sellPage.getByRole('button', { name: 'Sign this allocation only', exact: true }).click();
    await expect(
      sellPage.getByRole('textbox', { name: 'Seller signature (temporary)', exact: true }),
    ).toHaveValue(/^0x[0-9a-f]{130}$/i);
    await page
      .getByRole('textbox', { name: 'Seller signature (temporary)', exact: true })
      .fill(
        await sellPage
          .getByRole('textbox', { name: 'Seller signature (temporary)', exact: true })
          .inputValue(),
      );
    await page
      .getByRole('button', { name: 'Verify both signatures for submission', exact: true })
      .click();
    await action(page, 'Submit bilateral agreement');
    expect(await credit(buyer)).toBe(50n);
    expect(await credit(seller)).toBe(51n);
    await action(page, 'Withdraw to my wallet');
    await refresh(sellPage);
    await action(sellPage, 'Withdraw to my wallet');
    await expect(
      sellPage.getByRole('button', { name: 'Prepare: Submit delivery proof', exact: true }),
    ).toHaveCount(0);
    await next('remaining plan dispute timeout');
    await submit();
    await action(page, 'Accept and release payment');
    await submit();
    await page
      .getByRole('textbox', { name: 'Delivery or dispute evidence (temporary text)', exact: true })
      .fill('Unresolved dispute');
    await action(page, 'Open formal dispute');
    await warp(Number((await record()).disputeDue));
    await refresh();
    await action(page, 'Refund after dispute timeout');
    expect(await credit(buyer)).toBe(70n);
    await action(page, 'Withdraw to my wallet');
    await page.screenshot({
      path: `artifacts/screenshots/milestones-${info.project.name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await sellerContext.close();
  }
});
