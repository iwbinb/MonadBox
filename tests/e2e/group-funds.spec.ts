import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  encodeFunctionData,
} from 'viem';
import type { Address, Hex } from 'viem';
import { calldata, groupAbi } from '../../src/shared/cloud/chain';
import { TEST_CHAIN, TOKEN } from '../../src/shared/lab/network';
import type { CloudBox, PublishIntent, SessionInfo } from '../../src/shared/cloud/model';
const origin = 'http://127.0.0.1:8790',
  rpc = 'http://127.0.0.1:18746';
const client = createPublicClient({ chain: TEST_CHAIN, transport: http(rpc) });
const wallet = createWalletClient({ chain: TEST_CHAIN, transport: http(rpc) });
async function raw(method: string, params: unknown[] = []) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const d = (await r.json()) as { result: unknown; error?: unknown };
  if (d.error) throw Error(JSON.stringify(d.error));
  return d.result;
}
async function mine() {
  await raw('anvil_mine', ['0x41']);
}
async function warp(time: number) {
  await raw('evm_setNextBlockTimestamp', [time]);
  await raw('evm_mine');
  await mine();
}
async function inject(page: Page, actor: Address) {
  await page.route('https://testnet-rpc.monad.xyz/**', async (route) => {
    const q = route.request().postDataJSON() as { id: number; method: string; params: unknown[] };
    try {
      const result = await raw(q.method, q.params);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: q.id, result }),
      });
    } catch {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: q.id,
          error: { code: -32000, message: 'local error' },
        }),
      });
    }
  });
  await page.exposeFunction('__fundsRpc', async (method: string, params: unknown[]) => {
    if (method !== 'eth_sendTransaction') throw Error('Only explicit local sends');
    const hash = (await raw(method, params)) as Hex;
    await client.waitForTransactionReceipt({ hash });
    await mine();
    return hash;
  });
  await page.addInitScript(
    ({ actor }) => {
      const w = window as Window & {
        ethereum?: unknown;
        __fundsActor: string;
        __fundsReject?: boolean;
        __fundsLost?: boolean;
        __fundsRpc: (m: string, p: unknown[]) => Promise<unknown>;
      };
      let connected = false;
      w.__fundsActor = actor;
      w.ethereum = {
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_accounts') return connected ? [w.__fundsActor] : [];
          if (method === 'eth_requestAccounts') {
            connected = true;
            return [w.__fundsActor];
          }
          if (method === 'eth_chainId') return '0x279f';
          if (method === 'wallet_switchEthereumChain') return null;
          if (w.__fundsReject) {
            w.__fundsReject = false;
            throw { code: 4001 };
          }
          const result = await w.__fundsRpc(method, params);
          if (w.__fundsLost) {
            w.__fundsLost = false;
            throw Error('Response lost after local broadcast');
          }
          return result;
        },
        on: () => {},
        removeListener: () => {},
      };
    },
    { actor },
  );
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect funds wallet', exact: true }).click();
  await expect(page.getByText('Snapshot block', { exact: false })).toBeVisible();
}
async function action(page: Page, name: string) {
  await page.getByRole('button', { name: 'Prepare: ' + name, exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'I have reviewed this action and its fixed recipients.' })
    .check();
  await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Latest lookup: finalized' }),
  ).toBeVisible({ timeout: 20000 });
}

test('Group complete funds flows and lost-response recovery on isolated LOCAL chain', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = JSON.parse(readFileSync('artifacts/funds-test.json', 'utf8')) as {
    accounts: Address[];
  };
  const [creator, alice, bob, beneficiary] = f.accounts as [Address, Address, Address, Address];
  const headers = {
    Origin: origin,
    'X-MonadBox-Client': 'web',
    'Content-Type': 'application/json',
  };
  const challenge = await page.request.post(origin + '/api/v1/auth/nonce', {
    headers,
    data: { address: creator },
  });
  const ch = (await challenge.json()).data as { id: string; message: string };
  const signature = await wallet.signMessage({ account: creator, message: ch.message });
  const login = await page.request.post(origin + '/api/v1/auth/verify', {
    headers,
    data: { ...ch, signature },
  });
  expect(login.ok()).toBe(true);
  const session = (await login.json()).data as SessionInfo;
  const auth = { ...headers, 'X-CSRF-Token': session.csrf };
  const intents: PublishIntent[] = [];
  const now = Number((await client.getBlock()).timestamp) + 600;
  for (const name of ['success', 'failed', 'cancelled', 'exit']) {
    const data = {
      title: 'LOCAL funds ' + name,
      description: 'Test fixture, not Monad.',
      unitPrice: '100000',
      minimum: 2,
      capacity: 3,
      beneficiary,
      startsAt: now,
      fundingDeadline: now + 3600,
      settleNotBefore: now + 7200,
    };
    const saved = await page.request.post(origin + '/api/v1/groups', {
      headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
      data: { data },
    });
    expect(saved.ok()).toBe(true);
    const b = (await saved.json()).data as CloudBox;
    const prepared = await page.request.post(origin + `/api/v1/groups/${b.id}/prepare`, {
      headers: auth,
      data: { revision: 1 },
    });
    expect(prepared.ok()).toBe(true);
    const i = ((await prepared.json()).data as CloudBox).publication!.intent;
    intents.push(i);
    const hash = await wallet.sendTransaction({
      account: creator,
      to: i.deployment.address,
      data: calldata(i),
      nonce: i.nonce,
      value: 0n,
    });
    await client.waitForTransactionReceipt({ hash });
    await mine();
    const result = await page.request.post(origin + `/api/v1/groups/${b.id}/confirm`, {
      headers: auth,
      data: { hash },
    });
    expect(result.ok()).toBe(true);
  }
  const mock = JSON.parse(readFileSync('contracts/out/MockToken.sol/MockToken.json', 'utf8'));
  for (const actor of [alice, bob]) {
    const hash = await wallet.writeContract({
      account: creator,
      address: TOKEN,
      abi: mock.abi,
      functionName: 'mint',
      args: [actor, 1000000n],
    });
    await client.waitForTransactionReceipt({ hash });
  }
  await warp(now);
  await inject(page, alice);
  const [success, failed, cancelled, exit] = intents as [
    PublishIntent,
    PublishIntent,
    PublishIntent,
    PublishIntent,
  ];
  async function open(i: PublishIntent) {
    await page.goto(origin + '/b/' + i.publicId);
    await connect(page);
  }
  await open(exit);
  // Explicit rejection does not transfer, and loss of the return value does not trigger a resend.
  await page.getByRole('button', { name: 'Prepare: Approve exact amount', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.evaluate(() => {
    (window as Window & { __fundsReject: boolean }).__fundsReject = true;
  });
  await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Signature rejected');
  await action(page, 'Approve exact amount');
  await page.getByRole('button', { name: 'Prepare: Pay and join', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.evaluate(() => {
    (window as Window & { __fundsLost: boolean }).__fundsLost = true;
  });
  await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await connect(page);
  await page
    .locator('.cloud-list li')
    .filter({ hasText: 'Pay and join' })
    .getByRole('button', { name: 'Recheck transaction' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Latest lookup: finalized' }),
  ).toBeVisible({ timeout: 20000 });
  await action(page, 'Exit to refundable credit');
  await action(page, 'Withdraw to my wallet');
  await expect(page.getByRole('button', { name: 'Prepare: Pay and join' })).toHaveCount(0);
  for (const i of [success, failed, cancelled]) {
    await open(i);
    await action(page, 'Approve exact amount');
    await action(page, 'Pay and join');
  }
  // Another payer uses the same exact ABI on the local chain.
  for (const i of [success]) {
    for (const [to, data] of [
      [
        TOKEN,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [i.deployment.address, 100000n],
        }),
      ],
      [
        i.deployment.address,
        encodeFunctionData({ abi: groupAbi, functionName: 'contribute', args: [i.chainBoxId] }),
      ],
    ] as const) {
      const hash = await wallet.sendTransaction({ account: bob, to, data, value: 0n });
      await client.waitForTransactionReceipt({ hash });
    }
  }
  const cancelledHash = await wallet.writeContract({
    account: creator,
    address: cancelled.deployment.address,
    abi: groupAbi,
    functionName: 'cancel',
    args: [cancelled.chainBoxId],
  });
  await client.waitForTransactionReceipt({ hash: cancelledHash });
  await mine();
  await open(cancelled);
  await action(page, 'Claim refund credit');
  await action(page, 'Withdraw to my wallet');
  await warp(now + 3600);
  await open(failed);
  await action(page, 'Claim refund credit');
  await action(page, 'Withdraw to my wallet');
  await open(success);
  await expect(
    page.getByRole('button', { name: 'Prepare: Exit to refundable credit' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Prepare: Settle to beneficiary credit' }),
  ).toHaveCount(0);
  await warp(now + 7200);
  await page.getByRole('button', { name: 'Read my rights', exact: true }).click();
  await action(page, 'Settle to beneficiary credit');
  const fresh = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const recipient = await fresh.newPage();
  await inject(recipient, beneficiary);
  await recipient.goto(origin + '/b/' + success.publicId);
  await connect(recipient);
  await expect(recipient.getByText('Withdrawable credit', { exact: false })).toContainText(
    '0.2 AUSD',
  );
  await action(recipient, 'Withdraw to my wallet');
  expect(
    await client.readContract({
      address: success.deployment.address,
      abi: groupAbi,
      functionName: 'creditForBox',
      args: [success.chainBoxId, beneficiary],
    }),
  ).toBe(0n);
  await expect(
    recipient.getByText('Already transferred to wallet', { exact: false }),
  ).toContainText('0.2 AUSD');
  expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await recipient.screenshot({
    path: `artifacts/screenshots/group-funds-${info.project.name}.png`,
    fullPage: true,
  });
  await fresh.close();
  await page.goto(origin + '/app/group-activity');
  await page.getByRole('button', { name: 'Connect funds wallet' }).click();
  await expect(page.locator('.cloud-list')).toContainText('LOCAL funds success');
});
