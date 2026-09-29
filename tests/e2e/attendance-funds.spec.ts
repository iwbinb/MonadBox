import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Address, Hex } from 'viem';
import { origin, client, wallet, inject, mine, warp, connect } from '../fixtures/funds-browser';
import { action, login, publish } from '../fixtures/modules-browser';
import { localDateInput } from '../../src/shared/group/draft';
import { attendanceDates } from '../../src/shared/modules/attendance-fields';
import { moduleAbi, checkInTerms } from '../../src/shared/modules/terms';
import { checkInHash } from '../../src/shared/modules/checkin';
import type {
  CheckInProof,
  ModuleBox,
  ModuleData,
  ModulePublication,
} from '../../src/shared/modules/model';

test('Attend signed check-in recovery, independent appeal, no-show deduction, exit and cancellation', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(20000);
  const { accounts } = JSON.parse(readFileSync('artifacts/funds-test.json', 'utf8')) as {
    accounts: Address[];
  };
  const [organizer, attendee, absent, beneficiary] = accounts as [
    Address,
    Address,
    Address,
    Address,
  ];
  const guest = await browser.newContext({ viewport: page.viewportSize() ?? undefined }),
    participant = await guest.newPage();
  participant.setDefaultTimeout(20000);
  try {
    await inject(page, organizer);
    await inject(participant, attendee);
    const start = Math.ceil(Number((await client.getBlock()).timestamp) / 60) * 60 + 86400;
    const dates = {
      registrationDeadline: start - 3600,
      eventStart: start,
      eventEnd: start + 3600,
      checkinStart: start - 900,
      checkinDeadline: start + 7200,
      challengeDeadline: start + 93600,
    };
    await page.goto(origin + '/create/attend');
    await page
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill('LOCAL Attend ' + info.project.name);
    await page
      .getByRole('textbox', { name: 'Deposit per person (MON)', exact: true })
      .fill('0.000000000000000101');
    await page.getByRole('spinbutton', { name: 'Capacity', exact: true }).fill('3');
    await page.getByRole('textbox', { name: 'Fixed check-in signer', exact: true }).fill(organizer);
    await page.getByRole('textbox', { name: 'Penalty beneficiary', exact: true }).fill(beneficiary);
    await page.getByRole('spinbutton', { name: 'Dispute hours (24–720)', exact: true }).fill('24');
    for (const [key, label] of attendanceDates)
      await page
        .getByLabel(label + ' (local time)', { exact: true })
        .fill(localDateInput(dates[key]));
    await page.getByRole('button', { name: 'Review rules', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Frozen rules preview' })).toContainText(
      'Worst no-show deduction',
    );
    await expect(page.getByRole('region', { name: 'Frozen rules preview' })).toContainText(
      'fixed signer',
    );
    await page.getByRole('button', { name: 'Save reviewed draft', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/module-drafts\//);
    await page.goto(origin + '/app/modules');
    await login(page);
    await page.getByRole('button', { name: 'Copy to cloud', exact: true }).click();
    await page.getByRole('button', { name: 'Freeze and prepare publication', exact: true }).click();
    await connect(page);
    await action(page, 'Publish fixed rules');
    await expect(
      page.getByRole('link', { name: 'Open verified public link', exact: true }),
    ).toBeVisible();
    const box = await page.evaluate(
      async () => (await (await fetch('/api/v1/modules')).json()).data[0] as ModuleBox,
    );
    let p = box.publication!.publication;
    async function go(pub: ModulePublication) {
      await page.goto(origin + '/box/' + pub.publicId);
      await connect(page);
      await participant.goto(origin + '/box/' + pub.publicId);
      await connect(participant);
    }
    async function inspect() {
      await page
        .getByRole('textbox', { name: 'Participant wallet to inspect', exact: true })
        .fill(attendee);
      await page.getByRole('button', { name: 'Inspect participant', exact: true }).click();
    }
    async function read() {
      await participant.getByRole('button', { name: 'Read my rights', exact: true }).click();
    }
    async function registerOther(pub: ModulePublication) {
      await client.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          account: absent,
          address: pub.deployment.address,
          abi: moduleAbi('attend'),
          functionName: 'register',
          value: 101n,
          args: [pub.chainBoxId],
        }),
      });
      await mine();
    }
    async function credit(pub: ModulePublication, actor: Address) {
      return client.readContract({
        address: pub.deployment.address,
        abi: moduleAbi('attend'),
        functionName: 'creditForBox',
        args: [pub.chainBoxId, actor],
      });
    }
    async function next(title: string) {
      const shift =
        Number((await client.getBlock()).timestamp) + 86400 - dates.registrationDeadline;
      const data = {
        ...p.data,
        title,
        ...Object.fromEntries(Object.entries(dates).map(([key, value]) => [key, value + shift])),
      } as ModuleData;
      const pub = await publish(page, data, organizer);
      await go(pub);
      return pub;
    }
    await go(p);

    await action(participant, 'Register with deposit');
    await warp(dates.checkinStart);
    await inspect();
    await page
      .getByRole('button', { name: 'Attest this participant and sign proof', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Check-in signature (temporary)', exact: true }),
    ).toHaveValue(/^0x[0-9a-f]{130}$/i);
    const proofRaw = await page
        .getByRole('textbox', { name: 'Check-in proof JSON', exact: true })
        .inputValue(),
      signature = await page
        .getByRole('textbox', { name: 'Check-in signature (temporary)', exact: true })
        .inputValue();
    const proof = JSON.parse(proofRaw) as CheckInProof;
    expect(
      await client.readContract({
        address: p.deployment.address,
        abi: moduleAbi('attend'),
        functionName: 'checkInDigest',
        args: [checkInTerms(proof)],
      }),
    ).toBe(checkInHash(p, proof));
    await read();
    await participant
      .getByRole('textbox', { name: 'Check-in proof JSON', exact: true })
      .fill(proofRaw);
    await participant
      .getByRole('textbox', { name: 'Check-in signature (temporary)', exact: true })
      .fill(signature);
    await participant
      .getByRole('button', { name: 'Verify check-in proof for submission', exact: true })
      .click();
    await participant.evaluate(() => {
      (window as Window & { __fundsLost: boolean }).__fundsLost = true;
    });
    await participant
      .getByRole('button', { name: 'Prepare: Submit check-in proof', exact: true })
      .click();
    await participant
      .getByRole('checkbox', {
        name: 'I have reviewed this action and its fixed recipients.',
        exact: true,
      })
      .check();
    await participant.getByRole('button', { name: 'Sign this action', exact: true }).click();
    await expect(participant.getByRole('alert')).toBeVisible();
    await participant.reload();
    await connect(participant);
    const recovery = participant.getByRole('listitem').filter({ hasText: 'Submit check-in proof' });
    await expect(recovery).toContainText('Outcome unknown');
    await recovery.getByRole('button', { name: 'Recheck transaction', exact: true }).click();
    await expect(recovery).toContainText('Finalized');
    expect(await participant.evaluate(() => JSON.stringify(localStorage))).not.toContain(signature);
    expect(await credit(p, attendee)).toBe(101n);
    await action(participant, 'Withdraw to my wallet');
    p = await next('LOCAL independent appeal');

    await action(participant, 'Register with deposit');
    await registerOther(p);
    if (p.data.tool !== 'attend') throw Error();
    await warp(p.data.checkinDeadline);
    await read();
    await participant
      .getByRole('textbox', { name: 'Appeal evidence (temporary text)', exact: true })
      .fill('Present but signer unavailable');
    await action(participant, 'Appeal missing check-in');
    await warp(p.data.challengeDeadline);
    await client.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        account: organizer,
        address: p.deployment.address,
        abi: moduleAbi('attend'),
        functionName: 'finalizeNoShow',
        args: [p.chainBoxId, absent],
      }),
    });
    await mine();
    expect(await credit(p, absent)).toBe(76n);
    expect(await credit(p, beneficiary)).toBe(25n);
    expect(await credit(p, attendee)).toBe(0n);
    await inspect();
    await action(page, 'Refund disputed participant');
    await read();
    await action(participant, 'Withdraw to my wallet');
    p = await next('LOCAL attendee and organizer agreement');

    await action(participant, 'Register with deposit');
    if (p.data.tool !== 'attend') throw Error();
    await warp(p.data.checkinDeadline);
    await read();
    await participant
      .getByRole('textbox', { name: 'Appeal evidence (temporary text)', exact: true })
      .fill('Agree a partial refund');
    await action(participant, 'Appeal missing check-in');
    await participant
      .getByRole('textbox', { name: 'Refund to participant (MON)', exact: true })
      .fill('0.000000000000000081');
    await participant
      .getByRole('button', { name: 'Review allocation proposal', exact: true })
      .click();
    await participant
      .getByRole('button', { name: 'Sign this allocation only', exact: true })
      .click();
    await expect(
      participant.getByRole('textbox', { name: 'Participant signature (temporary)', exact: true }),
    ).toHaveValue(/^0x[0-9a-f]{130}$/i);
    const rawAgreement = await participant
      .getByRole('textbox', { name: 'Proposal JSON to exchange (no signatures)', exact: true })
      .inputValue();
    await inspect();
    await page
      .getByRole('textbox', { name: 'Proposal JSON to exchange (no signatures)', exact: true })
      .fill(rawAgreement);
    await page.getByRole('button', { name: 'Review received proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Sign this allocation only', exact: true }).click();
    await expect(
      page.getByRole('textbox', { name: 'Organizer signature (temporary)', exact: true }),
    ).toHaveValue(/^0x[0-9a-f]{130}$/i);
    const second = await page
      .getByRole('textbox', { name: 'Organizer signature (temporary)', exact: true })
      .inputValue();
    await participant
      .getByRole('textbox', { name: 'Organizer signature (temporary)', exact: true })
      .fill(second);
    await participant
      .getByRole('button', { name: 'Verify both signatures for submission', exact: true })
      .click();
    await action(participant, 'Submit bilateral agreement');
    expect(await credit(p, attendee)).toBe(81n);
    expect(await credit(p, beneficiary)).toBe(20n);
    expect(await credit(p, organizer)).toBe(0n);
    await action(participant, 'Withdraw to my wallet');
    p = await next('LOCAL individual dispute timeout');

    await action(participant, 'Register with deposit');
    if (p.data.tool !== 'attend') throw Error();
    await warp(p.data.checkinDeadline);
    await read();
    await participant
      .getByRole('textbox', { name: 'Appeal evidence (temporary text)', exact: true })
      .fill('No organizer response');
    await action(participant, 'Appeal missing check-in');
    const position = (await client.readContract({
      address: p.deployment.address,
      abi: moduleAbi('attend'),
      functionName: 'getAttendance',
      args: [p.chainBoxId, attendee],
    })) as { disputeDue: bigint };
    await warp(Number(position.disputeDue));
    await read();
    await action(participant, 'Refund after dispute timeout');
    await action(participant, 'Withdraw to my wallet');
    p = await next('LOCAL voluntary exit');

    await action(participant, 'Register with deposit');
    await action(participant, 'Exit to refundable credit');
    await action(participant, 'Withdraw to my wallet');
    await expect(
      participant.getByRole('button', { name: 'Prepare: Register with deposit', exact: true }),
    ).toHaveCount(0);
    p = await next('LOCAL canceled activity');

    await action(participant, 'Register with deposit');
    await action(page, 'Cancel event');
    await read();
    await action(participant, 'Claim refund credit');
    await action(participant, 'Withdraw to my wallet');
    await participant.screenshot({
      path: `artifacts/screenshots/attendance-${info.project.name}.png`,
      fullPage: true,
    });
    expect(
      await participant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(signature as Hex).toMatch(/^0x/);
  } finally {
    await guest.close();
  }
});
