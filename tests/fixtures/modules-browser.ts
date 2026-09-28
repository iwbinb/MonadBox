import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Address } from 'viem';
import { client, wallet, mine } from './funds-browser';
import { moduleCall } from '../../src/shared/modules/terms';
import type { ModuleBox, ModuleData } from '../../src/shared/modules/model';
export async function login(page: Page) {
  await page.getByRole('button', { name: 'Connect and prepare sign-in', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in (no payment)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
export async function action(page: Page, name: string) {
  await page.getByRole('button', { name: 'Prepare: ' + name, exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'I have reviewed this action and its fixed recipients.',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Sign this action', exact: true }).click();
  if (name === 'Publish fixed rules') {
    await expect(
      page.getByRole('link', { name: 'Open verified public link', exact: true }),
    ).toBeVisible();
    return;
  }
  await expect(
    page.getByRole('status').filter({ hasText: 'Latest lookup: finalized' }),
  ).toBeVisible({ timeout: 20000 });
}
export async function publish(page: Page, data: ModuleData, actor: Address) {
  const prepared = await page.evaluate(async (data) => {
    const session = (await (await fetch('/api/v1/auth/session')).json()).data;
    const request = async (path: string, body: unknown) => {
      const r = await fetch('/api/v1' + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MonadBox-Client': 'web',
          'X-CSRF-Token': session.csrf,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return (await r.json()).data;
    };
    const box = await request('/modules', { data });
    return request(`/modules/${box.id}/prepare`, { revision: 1 }) as Promise<ModuleBox>;
  }, data);
  const intent = prepared.publication!,
    call = moduleCall(intent),
    hash = await wallet.sendTransaction({ account: actor, ...call, value: 0n });
  await client.waitForTransactionReceipt({ hash });
  await mine();
  await page.evaluate(
    async ({ id, hash }) => {
      const session = (await (await fetch('/api/v1/auth/session')).json()).data;
      const r = await fetch(`/api/v1/modules/${id}/confirm`, {
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
    { id: prepared.id, hash },
  );
  return intent.publication;
}
