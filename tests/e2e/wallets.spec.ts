import { test, expect } from '@playwright/test';
test('MetaMask, Keplr and OKX select independent providers and disconnect without a transaction', async ({
  page,
}) => {
  await page.route('https://testnet-rpc.monad.xyz/**', async (route) => {
    const q = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: q.id,
        result: q.method === 'eth_getBalance' ? '0xde0b6b3a7640000' : '0x279f',
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('monadbox.locale', 'en');
    const w = window as Window & {
      ethereum?: unknown;
      keplr?: unknown;
      okxwallet?: unknown;
      __walletCalls: string[];
    };
    w.__walletCalls = [];
    function provider(name: string, digit: string) {
      let connected = false,
        chain = name === 'okx' ? '0x1' : '0x279f';
      return {
        isMetaMask: name === 'metamask',
        request: async ({ method }: { method: string }) => {
          w.__walletCalls.push(name + ':' + method);
          if (method === 'eth_accounts') return connected ? ['0x' + digit.repeat(40)] : [];
          if (method === 'eth_requestAccounts') {
            connected = true;
            return ['0x' + digit.repeat(40)];
          }
          if (method === 'eth_chainId') return chain;
          if (method === 'wallet_switchEthereumChain') {
            chain = '0x279f';
            return null;
          }
          throw Error('No signing or transfers are allowed in the connection test');
        },
        on: () => {},
        removeListener: () => {},
      };
    }
    w.ethereum = provider('metamask', '1');
    w.keplr = { ethereum: provider('keplr', '2') };
    w.okxwallet = provider('okx', '3');
  });
  await page.goto('/');
  for (const [name, digit] of [
    ['MetaMask', '1'],
    ['Keplr', '2'],
    ['OKX', '3'],
  ]) {
    await page.locator('.wallet-trigger').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: new RegExp(name + '.*Detected') }).click();
    await expect(page.locator('.wallet-trigger')).toContainText('0x' + digit!.repeat(4));
  }
  await page.locator('.wallet-trigger').click();
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.locator('.wallet-trigger')).toHaveText('Connect wallet');
  const calls = await page.evaluate(
    () => (window as Window & { __walletCalls: string[] }).__walletCalls,
  );
  expect(calls).toContain('okx:wallet_switchEthereumChain');
  expect(calls.filter((v) => /sendTransaction|sign/i.test(v))).toEqual([]);
});
