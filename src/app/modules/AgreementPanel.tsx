import { useState } from 'react';
import { formatUnits, verifyTypedData } from 'viem';
import type { Address, Hex } from 'viem';
import { useApp } from '../context';
import { parseAmount } from '../../shared/amount';
import { localDateInput, parseLocalDate } from '../../shared/group/draft';
import {
  agreementContext,
  agreementTypedData,
  agreementHash,
  validateAgreement,
} from '../../shared/modules/agreement';
import type { Agreement, ModulePublication } from '../../shared/modules/model';
import type { ModuleActionOptions, ModuleSnapshot } from '../../shared/modules/chain';
import { makeClient } from '../../shared/lab/network';
import { moduleSnapshot } from '../../shared/modules/chain';
import { requireWallet } from '../../shared/lab/wallet';
import type { InjectedProvider } from '../../shared/lab/wallet';
export function AgreementPanel({
  publication: p,
  snapshot: s,
  actor,
  provider,
  onChange,
}: {
  publication: ModulePublication;
  snapshot: ModuleSnapshot;
  actor: Address;
  provider: InjectedProvider;
  onChange: (options: ModuleActionOptions) => void;
}) {
  const { t } = useApp(),
    c = agreementContext(p, s);
  const [buyerAmount, setBuyerAmount] = useState(formatUnits(BigInt(c.remaining), 6)),
    [deadline, setDeadline] = useState(
      localDateInput(Math.min(s.disputeDue!, s.timestamp + 86400)),
    ),
    [proposal, setProposal] = useState<Agreement | null>(null),
    [raw, setRaw] = useState(''),
    [first, setFirst] = useState(''),
    [second, setSecond] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attendance = p.data.tool === 'attend';
  const firstRole = attendance ? t('Participant', '参加者') : t('Buyer', '客户'),
    secondRole = attendance ? t('Organizer', '组织者') : t('Seller', '服务者');
  function clear() {
    setProposal(null);
    setFirst('');
    setSecond('');
    onChange({});
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError(
        t(
          'Agreement could not be verified. Check the proposal, current dispute state, wallet and signatures.',
          '协议无法核验，请检查条款、当前争议状态、钱包和签名。',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function fresh(a: Agreement) {
    return validateAgreement(p, await moduleSnapshot(makeClient(), p, actor, s.participant), a);
  }
  return (
    <section className="cloud-card">
      <h3>{t('Bilateral settlement agreement', '双方争议结算协议')}</h3>
      <p className="notice">
        {t(
          'Signing authorizes the exact allocation below. Anyone with both signatures may submit it before expiry. There is no unilateral revocation. Before submission, signatures stay only in this page. Submitted signatures are public on-chain. Exchange them directly with the other party and keep a private copy before leaving.',
          '签名授权以下精确分配。持有双方签名的人可在到期前提交，无法单方撤销。提交前签名仅保留在当前页面，提交后会在链上公开。请直接与对方交换，离开前自行保管。',
        )}
      </p>
      <p>
        {t('All remaining funds', '全部剩余款')}：{formatUnits(BigInt(c.remaining), 6)} AUSD
      </p>
      <label>
        {attendance
          ? t('Refund to participant (AUSD)', '退参加者（AUSD）')
          : t('Refund to buyer (AUSD)', '退客户（AUSD）')}
        <input
          inputMode="decimal"
          value={buyerAmount}
          onChange={(e) => {
            setBuyerAmount(e.target.value);
            clear();
          }}
        />
      </label>
      <label>
        {t('Agreement expiry (local time)', '协议到期（本地时间）')}
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => {
            setDeadline(e.target.value);
            clear();
          }}
        />
      </label>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const b = parseAmount(buyerAmount, 6),
              a = validateAgreement(p, s, {
                schemaVersion: 1,
                boxId: p.chainBoxId,
                orderId: c.orderId,
                termsHash: p.termsHash,
                asset: p.deployment.asset,
                remaining: c.remaining,
                buyer: c.buyer,
                seller: c.seller,
                buyerAmount: b.toString(),
                sellerAmount: (BigInt(c.remaining) - b).toString(),
                settlementNonce: s.settlementNonce,
                deadline: parseLocalDate(deadline),
                stageIndex: c.stageIndex,
              });
            await fresh(a);
            clear();
            setProposal(a);
            setRaw(JSON.stringify(a, null, 2));
          })
        }
      >
        {t('Review allocation proposal', '核对分配提案')}
      </button>
      <label>
        {t('Proposal JSON to exchange (no signatures)', '交换的提案 JSON（不含签名）')}
        <textarea
          rows={6}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            clear();
          }}
        />
      </label>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            if (raw.length > 8000) throw Error();
            const a = await fresh(JSON.parse(raw));
            clear();
            setProposal(a);
          })
        }
      >
        {t('Review received proposal', '核对收到的提案')}
      </button>
      {proposal ? (
        <>
          <p>
            <code>{agreementHash(p, proposal)}</code>
          </p>
          <p>
            {firstRole} {t('receives', '收取')} {formatUnits(BigInt(proposal.buyerAmount), 6)} AUSD
            · <code>{proposal.buyer}</code>
          </p>
          <p>
            {attendance
              ? t('Penalty beneficiary receives', '罚款受益人收取')
              : t('Seller receives', '服务者收取')}{' '}
            {formatUnits(BigInt(proposal.sellerAmount), 6)} AUSD · <code>{proposal.seller}</code>
          </p>
          <p>
            {t('Expires', '到期')}：{new Date(proposal.deadline * 1000).toLocaleString()} · nonce{' '}
            {proposal.settlementNonce}
          </p>
          <button
            className="button secondary"
            disabled={
              busy ||
              ![c.buyer.toLowerCase(), c.secondSigner.toLowerCase()].includes(actor.toLowerCase())
            }
            onClick={() =>
              void run(async () => {
                await fresh(proposal);
                await requireWallet(provider, actor);
                const code = await makeClient().getCode({ address: actor });
                if (code && code !== '0x') throw Error();
                const typed = agreementTypedData(p, proposal),
                  payload = {
                    ...typed,
                    types: {
                      ...typed.types,
                      EIP712Domain: [
                        { name: 'name', type: 'string' },
                        { name: 'version', type: 'string' },
                        { name: 'chainId', type: 'uint256' },
                        { name: 'verifyingContract', type: 'address' },
                      ],
                    },
                  };
                const signature = await provider.request({
                  method: 'eth_signTypedData_v4',
                  params: [
                    actor,
                    JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
                  ],
                });
                await requireWallet(provider, actor);
                if (
                  typeof signature !== 'string' ||
                  !/^0x[0-9a-f]{130}$/i.test(signature) ||
                  !(await verifyTypedData({
                    ...typed,
                    address: actor,
                    signature: signature as Hex,
                  }))
                )
                  throw Error();
                if (actor.toLowerCase() === c.buyer.toLowerCase()) setFirst(signature);
                if (actor.toLowerCase() === c.secondSigner.toLowerCase()) setSecond(signature);
                onChange({});
              })
            }
          >
            {t('Sign this allocation only', '仅签署此分配协议')}
          </button>
          <label>
            {firstRole} {t('signature (temporary)', '签名（临时）')}
            <textarea
              autoComplete="off"
              spellCheck={false}
              value={first}
              onChange={(e) => {
                setFirst(e.target.value);
                onChange({});
              }}
            />
          </label>
          <label>
            {secondRole} {t('signature (temporary)', '签名（临时）')}
            <textarea
              autoComplete="off"
              spellCheck={false}
              value={second}
              onChange={(e) => {
                setSecond(e.target.value);
                onChange({});
              }}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await fresh(proposal);
                const typed = agreementTypedData(p, proposal);
                if (
                  !/^0x[0-9a-f]{130}$/i.test(first) ||
                  !/^0x[0-9a-f]{130}$/i.test(second) ||
                  !(await verifyTypedData({
                    ...typed,
                    address: c.buyer,
                    signature: first as Hex,
                  })) ||
                  !(await verifyTypedData({
                    ...typed,
                    address: c.secondSigner,
                    signature: second as Hex,
                  }))
                )
                  throw Error();
                onChange({
                  agreement: proposal,
                  signatures: { first: first as Hex, second: second as Hex },
                });
              })
            }
          >
            {t('Verify both signatures for submission', '核验双方签名以便提交')}
          </button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
