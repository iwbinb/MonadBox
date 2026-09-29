import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { keccak256, stringToHex } from 'viem';
import { origin, client, wallet, inject, mine, warp, connect } from '../fixtures/funds-browser';
import { login, publish, action } from '../fixtures/modules-browser';
import { calldata, groupAbi } from '../../src/shared/cloud/chain';
import { moduleAbi } from '../../src/shared/modules/terms';
import type { CloudBox } from '../../src/shared/cloud/model';

const output = 'artifacts/design-qa-native';
async function capture(page: Page, name: string) {
  const english = page.getByRole('button', { name: 'Switch to Chinese', exact: true });
  if (await english.count()) await english.click();
  await page.locator('h1').click();
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
  await page.getByRole('button', { name: '切换到英文', exact: true }).click();
}

test('verified public summaries follow transactions, private image preview and matched design states', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1487, height: 1058 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { accounts } = JSON.parse(readFileSync('artifacts/funds-test.json', 'utf8')) as {
    accounts: Address[];
  };
  const [owner, buyer, seller, guest] = accounts as [Address, Address, Address, Address];
  await inject(page, buyer);
  await page.goto(origin + '/app/modules');
  await login(page);
  let now = Number((await client.getBlock()).timestamp);
  const delivery = await publish(
    page,
    {
      tool: 'deliver',
      title: '品牌视觉设计',
      description: '交付品牌主视觉、社交头像与简短使用说明，供社区项目统一使用。',
      buyer,
      seller,
      amount: '300000000000000000',
      fundBy: now + 86400,
      workDuration: 604800,
      reviewDuration: 259200,
      disputeDuration: 604800,
    },
    buyer,
  );
  await page.goto(origin + '/box/' + delivery.publicId);
  await connect(page);
  await action(page, 'Pay full escrow');
  // A refreshed personal snapshot must update the page header and global amount too.
  await expect(page.locator('.public-heading .status-label')).toHaveText(
    'Funded; awaiting delivery',
  );
  await expect(page.locator('.public-amount-card')).toContainText('Remaining in escrow · 0.3 MON');
  await page.getByLabel('Choose a private file', { exact: true }).setInputFiles({
    name: 'brand-preview.png',
    mimeType: 'image/png',
    buffer: readFileSync('public/images/cooperation-box.png'),
  });
  await page
    .getByRole('button', { name: 'Upload this file to the private order', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Download with access check', exact: true }),
  ).toBeVisible();
  const deliveryHash = await wallet.writeContract({
    account: seller,
    address: delivery.deployment.address,
    abi: moduleAbi('deliver'),
    functionName: 'submitDelivery',
    args: [delivery.chainBoxId, keccak256(stringToHex('Brand preview shared with buyer'))],
  });
  await client.waitForTransactionReceipt({ hash: deliveryHash });
  await mine();
  await page.getByRole('button', { name: 'Read my rights', exact: true }).click();
  await expect(page.locator('.public-heading .status-label')).toHaveText('Submitted; under review');
  await page.getByRole('button', { name: 'Preview image', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.private-image-preview img')
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await capture(page, '04-deliver');
  await action(page, 'Accept and release payment');
  await expect(page.locator('.public-heading .status-label')).toHaveText(
    'Released to seller credit',
  );
  await expect(page.locator('.public-amount-card')).toContainText('Remaining in escrow · 0 MON');

  now = Number((await client.getBlock()).timestamp);
  const milestones = await publish(
    page,
    {
      tool: 'milestones',
      title: '社区网站设计与开发',
      description: '为社区设计并开发全新网站，包含品牌视觉、前端开发与基础集成。',
      buyer,
      seller,
      fundBy: now + 86400,
      disputeDuration: 604800,
      stages: [
        {
          title: '需求与线框',
          description: '完成需求梳理、信息架构与线框图，确认页面结构与核心功能。',
          amount: '300000000000000000',
          workDuration: 604800,
          reviewDuration: 259200,
        },
        {
          title: '视觉设计',
          description: '基于线框完成高保真界面设计，包含首页、社区页面与移动端适配。',
          amount: '400000000000000000',
          workDuration: 604800,
          reviewDuration: 259200,
        },
        {
          title: '开发与交付',
          description: '完成前端开发、基础集成与部署，交付源码与部署文档。',
          amount: '300000000000000000',
          workDuration: 604800,
          reviewDuration: 259200,
        },
      ],
    },
    buyer,
  );
  await page.goto(origin + '/box/' + milestones.publicId);
  await connect(page);
  await action(page, 'Pay full escrow');
  const writeStage = async (stage: number) => {
    const hash = await wallet.writeContract({
      account: seller,
      address: milestones.deployment.address,
      abi: moduleAbi('milestones'),
      functionName: 'submitDelivery',
      args: [milestones.chainBoxId, BigInt(stage), keccak256(stringToHex('Stage proof ' + stage))],
    });
    await client.waitForTransactionReceipt({ hash });
    await mine();
    await page.getByRole('button', { name: 'Read my rights', exact: true }).click();
  };
  await writeStage(0);
  await action(page, 'Accept and release payment');
  await writeStage(1);
  await expect(page.locator('.project-totals')).toContainText('0.3 MON');
  await expect(page.locator('.stage-timeline li.current h2')).toHaveText('视觉设计');
  await capture(page, '06-milestones');

  now = Number((await client.getBlock()).timestamp);
  const attend = await publish(
    page,
    {
      tool: 'attend',
      title: 'Monad 创作者小聚',
      description: '分享作品、交流进展，一起完成一次小型创作聚会。',
      deposit: '100000000000000000',
      capacity: 30,
      noShowPenaltyBps: 2000,
      checkinSigner: seller,
      penaltyBeneficiary: owner,
      registrationDeadline: now + 3600,
      eventStart: now + 7200,
      eventEnd: now + 14400,
      checkinStart: now + 6000,
      checkinDeadline: now + 15300,
      challengeDeadline: now + 101700,
      disputeDuration: 86400,
    },
    buyer,
  );
  await page.goto(origin + '/box/' + attend.publicId);
  await connect(page);
  await expect(
    page.getByRole('button', { name: 'Prepare: Register with deposit', exact: true }),
  ).toBeEnabled();
  await capture(page, '05-attend');

  now = Number((await client.getBlock()).timestamp);
  const group = await page.evaluate(
    async ({ owner, now }) => {
      const session = (await (await fetch('/api/v1/auth/session')).json()).data;
      const headers = {
        'Content-Type': 'application/json',
        'X-MonadBox-Client': 'web',
        'X-CSRF-Token': session.csrf,
        'Idempotency-Key': crypto.randomUUID(),
      };
      const saved = await fetch('/api/v1/groups', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            title: '周末创作小聚',
            description: '和同好一起创作、交流与碰撞，分享灵感，期待你的加入！',
            unitPrice: '100000000000000000',
            minimum: 3,
            capacity: 12,
            beneficiary: owner,
            startsAt: now + 600,
            fundingDeadline: now + 86400,
            settleNotBefore: now + 172800,
          },
        }),
      });
      if (!saved.ok) throw Error(await saved.text());
      const b = (await saved.json()).data;
      const prepared = await fetch(`/api/v1/groups/${b.id}/prepare`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ revision: 1 }),
      });
      if (!prepared.ok) throw Error(await prepared.text());
      return (await prepared.json()).data as CloudBox;
    },
    { owner, now },
  );
  const intent = group.publication!.intent;
  const groupHash = await wallet.sendTransaction({
    account: buyer,
    to: intent.deployment.address,
    data: calldata(intent),
    nonce: intent.nonce,
    value: 0n,
  });
  await client.waitForTransactionReceipt({ hash: groupHash });
  await mine();
  await page.evaluate(
    async ({ id, hash }) => {
      const session = (await (await fetch('/api/v1/auth/session')).json()).data;
      const r = await fetch(`/api/v1/groups/${id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MonadBox-Client': 'web',
          'X-CSRF-Token': session.csrf,
        },
        body: JSON.stringify({ hash }),
      });
      if (!r.ok) throw Error(await r.text());
    },
    { id: group.id, hash: groupHash },
  );
  await warp(now + 601);
  for (const actor of [owner, seller]) {
    const hash = await wallet.writeContract({
      account: actor,
      address: intent.deployment.address,
      abi: groupAbi,
      functionName: 'contribute',
      args: [intent.chainBoxId],
      value: 100000000000000000n,
    });
    await client.waitForTransactionReceipt({ hash });
  }
  await mine();
  await page.goto(origin + '/b/' + intent.publicId);
  await connect(page);
  await page.getByRole('button', { name: 'Prepare: Pay and join', exact: true }).click();
  await capture(page, '10-checkout');
  const mobile = await browser.newContext({
    viewport: { width: 426, height: 922 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const mp = await mobile.newPage();
    await inject(mp, guest);
    await mp.goto(origin + '/b/' + intent.publicId);
    await connect(mp);
    await mp.getByRole('button', { name: 'Prepare: Pay and join', exact: true }).click();
    await capture(mp, '11-mobile-checkout');
  } finally {
    await mobile.close();
  }
  await page.goto(origin + '/app');
  await connect(page);
  await page.getByRole('button', { name: 'Refresh balances', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh balances', exact: true })).toBeEnabled();
  await capture(page, '08-my-box');
  await page.goto(origin + '/');
  await capture(page, '01-home');
  await page.goto(origin + '/create/group');
  await page.getByLabel('Group title', { exact: true }).fill('周末创作小聚');
  await page
    .getByLabel('Description (optional)', { exact: true })
    .fill('和同好一起创作、交流与碰撞，分享灵感，期待你的加入！');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Amount per participant', { exact: true }).fill('0.1');
  await page.getByLabel('Maximum participants', { exact: true }).fill('12');
  await capture(page, '02-group');
  await page.getByRole('link', { name: 'MonadBox home', exact: true }).click();
  await page.goto(origin + '/create/split');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('创作者合作分账');
  await page.getByRole('textbox', { name: 'Recipient 1', exact: true }).fill(owner);
  await page.getByRole('textbox', { name: 'Recipient 2', exact: true }).fill(seller);
  await page.getByRole('button', { name: 'Add recipient', exact: true }).click();
  await page.getByRole('textbox', { name: 'Recipient 3', exact: true }).fill(guest);
  for (const [i, share] of ['50', '30', '20'].entries())
    await page.getByRole('textbox', { name: `Share (%) ${i + 1}`, exact: true }).fill(share);
  await capture(page, '03-split');
  await page.goto(origin + '/create/rewards');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('社区贡献奖励');
  await page
    .getByLabel('Reward list: wallet, MON amount', { exact: true })
    .fill(
      Array.from(
        { length: 6 },
        (_, i) => `0x${(i + 17).toString(16).padStart(40, '0')},0.025`,
      ).join('\n'),
    );
  await page.getByText('Import CSV or edit the address list', { exact: true }).click();
  await capture(page, '07-rewards');
  const unconnected = await browser.newContext({ viewport: { width: 1487, height: 1058 } });
  try {
    const wp = await unconnected.newPage();
    await wp.goto(origin + '/');
    const english = wp.getByRole('button', { name: 'Switch to Chinese', exact: true });
    if (await english.count()) await english.click();
    await wp.getByRole('button', { name: '连接钱包', exact: true }).click();
    await expect(wp.getByRole('dialog')).toBeVisible();
    await wp.screenshot({ path: `${output}/09-connect-wallet.png` });
  } finally {
    await unconnected.close();
  }
  expect(errors).toEqual([]);
});
