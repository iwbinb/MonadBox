import { useState } from 'react';
import { verifyTypedData } from 'viem';
import type { Address, Hex } from 'viem';
import { useApp } from '../context';
import type { ModulePublication } from '../../shared/modules/model';
import type { ModuleSnapshot, ModuleActionOptions } from '../../shared/modules/chain';
import { moduleSnapshot } from '../../shared/modules/chain';
import { checkInTypedData, validateCheckIn } from '../../shared/modules/checkin';
import { makeClient } from '../../shared/lab/network';
import { requireWallet } from '../../shared/lab/wallet';
import type { InjectedProvider } from '../../shared/lab/wallet';
export function CheckInPanel({
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
    [raw, setRaw] = useState(''),
    [signature, setSignature] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  if (p.data.tool !== 'attend' || !s.participant) return null;
  const d = p.data,
    participant = s.participant;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError(
        t(
          'Check-in proof is unavailable or invalid. Recheck the participant, time, fixed signer and signature.',
          '签到证明不可用或无效，请核对参加者、时间、固定签到方和签名。',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function fresh() {
    return moduleSnapshot(makeClient(), p, actor, participant);
  }
  return (
    <section className="cloud-card">
      <h3>{t('Signed check-in proof', '签名签到证明')}</h3>
      <p>
        {t(
          'The fixed signer attests attendance. A signature is not a submitted check-in: the proof must reach the chain before its deadline. It stays in memory until you submit or exchange it; submitted proof signatures become public on-chain.',
          '固定签到方声明到场。签名不等于已完成签到：必须在截止前将证明提交上链。提交或交换前签名只保留在内存，提交后的证明签名会在链上公开。',
        )}
      </p>
      <p>
        {t('Participant', '参加者')}：<code>{participant}</code>
      </p>
      <p>
        {t('Fixed signer', '固定签到方')}：<code>{d.checkinSigner}</code>
      </p>
      {actor.toLowerCase() === d.checkinSigner.toLowerCase() ? (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const snapshot = await fresh(),
                proof = validateCheckIn(p, snapshot, {
                  schemaVersion: 1,
                  boxId: p.chainBoxId,
                  termsHash: p.termsHash,
                  attendee: participant,
                  signer: d.checkinSigner,
                  issuedAt: snapshot.timestamp,
                  deadline: d.checkinDeadline,
                  nonce: snapshot.checkinNonce,
                });
              await requireWallet(provider, actor);
              const code = await makeClient().getCode({ address: actor });
              if (code && code !== '0x') throw Error();
              const typed = checkInTypedData(p, proof),
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
              const signed = await provider.request({
                method: 'eth_signTypedData_v4',
                params: [
                  actor,
                  JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
                ],
              });
              await requireWallet(provider, actor);
              if (
                typeof signed !== 'string' ||
                !/^0x[0-9a-f]{130}$/i.test(signed) ||
                !(await verifyTypedData({
                  ...typed,
                  address: d.checkinSigner,
                  signature: signed as Hex,
                }))
              )
                throw Error();
              setRaw(JSON.stringify(proof, null, 2));
              setSignature(signed);
              onChange({});
            })
          }
        >
          {t('Attest this participant and sign proof', '确认此参加者到场并签署证明')}
        </button>
      ) : null}
      <label>
        {t('Check-in proof JSON', '签到证明 JSON')}
        <textarea
          rows={5}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            onChange({});
          }}
        />
      </label>
      <label>
        {t('Check-in signature (temporary)', '签到签名（临时）')}
        <textarea
          autoComplete="off"
          spellCheck={false}
          value={signature}
          onChange={(e) => {
            setSignature(e.target.value);
            onChange({});
          }}
        />
      </label>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            if (raw.length > 8000 || !/^0x[0-9a-f]{130}$/i.test(signature)) throw Error();
            const proof = validateCheckIn(p, await fresh(), JSON.parse(raw));
            if (
              !(await verifyTypedData({
                ...checkInTypedData(p, proof),
                address: d.checkinSigner,
                signature: signature as Hex,
              }))
            )
              throw Error();
            onChange({ checkIn: proof, signatures: { checkIn: signature as Hex }, participant });
          })
        }
      >
        {t('Verify check-in proof for submission', '核验签到证明以便提交')}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
