import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodeFunctionData, toHex } from 'viem';
import type { Address, Hex } from 'viem';
import { origin, client, wallet, inject, mine, warp, connect } from '../fixtures/funds-browser';
import { action, login } from '../fixtures/modules-browser';
import { TOKEN } from '../../src/shared/lab/network';
import { localDateInput } from '../../src/shared/group/draft';
import { moduleAbi } from '../../src/shared/modules/terms';
import type { ModuleBox } from '../../src/shared/modules/model';
test.use({ video: 'on' });
test.afterEach(async ({ page }, info) => {
  if (info.status !== 'passed') return;
  const video = page.video();
  await page.close();
  if (video) {
    mkdirSync('artifacts/demo', { recursive: true });
    await video.saveAs(`artifacts/demo/rewards-${info.project.name}-LOCAL.webm`);
  }
});

test('100 rewards: exact funding, two-step recovery, fixed claims and expiry preserve credit', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(20000);
  const { accounts } = JSON.parse(readFileSync('artifacts/funds-test.json', 'utf8')) as {
    accounts: Address[];
  };
  const [admin, creator, recipient, other] = accounts as [Address, Address, Address, Address];
  const tokenAbi = JSON.parse(
    readFileSync('contracts/out/MockToken.sol/MockToken.json', 'utf8'),
  ).abi;
  await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      account: admin,
      address: TOKEN,
      abi: tokenAbi,
      functionName: 'mint',
      args: [creator, 1000000n],
    }),
  });
  await mine();
  const context = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
    recordVideo: { dir: 'test-results/rewards-recipient-' + info.project.name },
  });
  const claimPage = await context.newPage();
  let finished = false;
  claimPage.setDefaultTimeout(20000);
  try {
    for (const target of [page, claimPage])
      await target.addInitScript(() => {
        addEventListener('DOMContentLoaded', () => {
          const label = document.createElement('div');
          label.textContent = 'LOCAL DEMO · Anvil / MockToken · simulated wallet';
          label.style.cssText =
            'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px;background:#111;color:white;font:12px sans-serif;text-align:center;pointer-events:none';
          document.body.append(label);
        });
      });
    await inject(page, creator);
    await inject(claimPage, recipient);
    await page.goto(origin + '/create/rewards');
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('LOCAL Rewards 100 ' + info.project.name);
    const start = Math.ceil(Number((await client.getBlock()).timestamp) / 60) * 60 + 3600;
    await page.getByLabel('Claims open (local time)', { exact: true }).fill(localDateInput(start));
    await page
      .getByLabel('Claim deadline (local time)', { exact: true })
      .fill(localDateInput(start + 3600));
    const csv = [
      'address,amount',
      `${recipient},0.000031`,
      `${other},0.000070`,
      ...Array.from({ length: 98 }, (_, n) => `${toHex(n + 100, { size: 20 })},0.000001`),
    ].join('\n');
    await page
      .getByLabel('Import a local reward CSV', { exact: true })
      .setInputFiles({ name: 'rewards.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(
      page.getByRole('textbox', { name: 'Reward list: wallet, AUSD amount', exact: true }),
    ).toHaveValue(csv);
    await page.getByRole('button', { name: 'Review rules', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Frozen rules preview', exact: true });
    await expect(preview).toContainText('0.000199');
    await expect(preview).toContainText('become public');
    await expect(preview.getByRole('listitem')).toHaveCount(100);
    await page.getByRole('button', { name: 'Save reviewed draft', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/module-drafts\//);
    await page.goto(origin + '/app/modules');
    await login(page);
    await page.getByRole('button', { name: 'Copy to cloud', exact: true }).click();
    await page.getByRole('button', { name: 'Freeze and prepare publication', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Connect funds wallet', exact: true }),
    ).toBeVisible();
    async function box() {
      return page.evaluate(
        async () =>
          (
            await (
              await fetch('/api/v1/modules' + location.pathname.slice('/app/modules'.length))
            ).json()
          ).data as ModuleBox,
      );
    }
    const first = await box();
    const p = first.publication!.publication;
    const read = async (name: string, args: unknown[]) =>
      client.readContract({
        address: p.deployment.address,
        abi: moduleAbi('rewards'),
        functionName: name,
        args,
      });
    const credit = (who: Address) => read('creditForBox', [p.chainBoxId, who]);
    await page.getByRole('button', { name: 'Connect funds wallet', exact: true }).click();
    async function sign(name: string) {
      await page.getByRole('button', { name: 'Prepare: ' + name, exact: true }).click();
      await page
        .getByRole('checkbox', {
          name: 'I have reviewed this action and its fixed recipients.',
          exact: true,
        })
        .check();
      await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
    }
    await sign('Approve exact amount');
    await expect(
      page.getByRole('button', { name: 'Prepare funded publication', exact: true }),
    ).toBeVisible();
    const approved = await box();
    expect(approved.state).toBe('prepared');
    expect(approved.publication!.action).toBe('approve');
    expect(
      await page.evaluate(
        async (id) => (await fetch('/api/v1/public/modules/' + id)).status,
        p.publicId,
      ),
    ).toBe(404);
    await expect(read('getBatch', [p.chainBoxId])).rejects.toThrow();
    // A separate explicit local transaction proves creation must refresh the nonce.
    await client.waitForTransactionReceipt({
      hash: await wallet.sendTransaction({ account: creator, to: creator, value: 0n }),
    });
    await mine();
    await page.getByRole('button', { name: 'Prepare funded publication', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Connect funds wallet', exact: true }),
    ).toBeVisible();
    const prepared = await box();
    expect(prepared.publication!.nonce).toBe(approved.publication!.nonce + 2);
    expect(prepared.publication!.publication).toEqual(p);
    expect(prepared.publication!.fundingApproval?.hash).toBe(approved.receipt!.hash);
    await page.getByRole('button', { name: 'Connect funds wallet', exact: true }).click();
    await page.evaluate(() => {
      (window as Window & { __fundsLost: boolean }).__fundsLost = true;
    });
    await sign('Publish and fund full reward list');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Connect funds wallet', exact: true }).click();
    const history = page
      .getByRole('listitem')
      .filter({ hasText: 'Publish and fund full reward list' });
    await expect(history).toContainText('Outcome unknown');
    await history.getByRole('button', { name: 'Recheck transaction', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Open verified public link', exact: true }),
    ).toBeVisible();
    const published = await box();
    const creation = await client.getTransactionReceipt({ hash: published.receipt!.hash! });
    expect(await read('locked', [p.chainBoxId])).toBe(199n);
    const balance = (who: Address) =>
      client.readContract({
        address: TOKEN,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [who],
      }) as Promise<bigint>;
    const before = await balance(recipient),
      beforeCreator = await balance(creator);
    await claimPage.goto(origin + '/box/' + p.publicId);
    await connect(claimPage);
    await expect(
      claimPage.getByRole('button', { name: 'Prepare: Claim my reward credit', exact: true }),
    ).toHaveCount(0);
    await warp(start);
    await claimPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await action(claimPage, 'Claim my reward credit');
    expect(await credit(recipient)).toBe(31n);
    expect(await balance(recipient)).toBe(before);
    await expect(
      claimPage.getByRole('button', { name: 'Prepare: Claim my reward credit', exact: true }),
    ).toHaveCount(0);
    await claimPage.screenshot({
      path: `artifacts/screenshots/rewards-${info.project.name}.png`,
      fullPage: true,
    });
    expect(await claimPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await warp(start + 3600);
    await page.goto(origin + '/box/' + p.publicId);
    await connect(page);
    await action(page, 'Reclaim unclaimed rewards');
    expect(await credit(creator)).toBe(168n);
    expect(await credit(recipient)).toBe(31n);
    expect(await read('locked', [p.chainBoxId])).toBe(0n);
    await action(page, 'Withdraw to my wallet');
    expect(await balance(creator)).toBe(beforeCreator + 168n);
    await claimPage.getByRole('button', { name: 'Read my rights', exact: true }).click();
    await action(claimPage, 'Withdraw to my wallet');
    expect(await balance(recipient)).toBe(before + 31n);
    const events = await client.getLogs({
      address: p.deployment.address,
      fromBlock: creation.blockNumber,
      toBlock: 'latest',
    });
    const hashes = [...new Set(events.map((e) => e.transactionHash))] as Hex[];
    const receipts = await Promise.all(
      hashes.map((hash) => client.getTransactionReceipt({ hash })),
    );
    expect(creation.gasUsed).toBeLessThan(10000000n);
    const transactions = await Promise.all(
      receipts.map(async (r) => {
        const tx = await client.getTransaction({ hash: r.transactionHash });
        const operation = decodeFunctionData({
          abi: moduleAbi('rewards'),
          data: tx.input,
        }).functionName;
        if (operation === 'claimFor') expect(r.gasUsed).toBeLessThan(250000n);
        if (operation === 'reclaimExpired') expect(r.gasUsed).toBeLessThan(200000n);
        return { operation, hash: r.transactionHash, gasUsed: r.gasUsed.toString() };
      }),
    );
    writeFileSync(
      `artifacts/rewards-gas-${info.project.name}.json`,
      JSON.stringify(
        {
          environment: 'LOOPBACK Anvil only; not Monad gas verification',
          recipients: 100,
          total: '199',
          publication: creation.gasUsed.toString(),
          transactions,
          budget: 10000000,
        },
        null,
        2,
      ),
    );
    finished = true;
  } finally {
    await context.close();
    if (finished) {
      mkdirSync('artifacts/demo', { recursive: true });
      await claimPage
        .video()
        ?.saveAs(`artifacts/demo/rewards-${info.project.name}-recipient-LOCAL.webm`);
    }
  }
});
