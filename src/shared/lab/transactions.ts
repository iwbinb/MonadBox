import { decodeEventLog, encodeFunctionData, toHex, isHex, getAddress } from 'viem';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { TOKEN, CHAIN_ID, MAX_AMOUNT, inspectNetwork, paymentId } from './network';
import type { ChainClient } from './network';
import { probeAbi, tokenAbi, deploymentData, verifyProbe } from './artifact';
import { requireWallet, errorCode } from './wallet';
import type { InjectedProvider } from './wallet';
import { readJournal, storeOperation, unresolved } from './journal';
import type { Operation, RecoveryStorage } from './journal';
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;
export const randomNonce = (): Hex =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')}`;

export async function prepareOperation(
  client: ChainClient,
  provider: InjectedProvider,
  account: Address,
  kind: Operation['kind'],
  probe: Address | null,
  amount: bigint,
  refundId: Hex = ZERO_HASH,
): Promise<{ op: Operation; gas: bigint; gasPrice: bigint }> {
  await requireWallet(provider, account);
  await inspectNetwork(client);
  const accountCode = await client.getCode({ address: account });
  if (accountCode && accountCode !== '0x') throw Error('UNSUPPORTED_WALLET');
  if (amount <= 0n || amount > MAX_AMOUNT) throw Error('INVALID_AMOUNT');
  if (kind !== 'deploy') {
    if (!probe) throw Error('UNVERIFIED_PROBE');
    await verifyProbe(client, probe);
  }
  const nonce = randomNonce();
  let id = probe ? paymentId(probe, account, nonce) : ZERO_HASH;
  let to: Address | null = probe;
  let data: Hex;
  if (kind === 'deploy') {
    to = null;
    data = deploymentData();
  } else if (kind === 'approve') {
    to = TOKEN;
    data = encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [probe!, amount] });
  } else if (kind === 'fund') {
    const [balance, allowance] = await Promise.all([
      client.readContract({
        address: TOKEN,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [account],
      }),
      client.readContract({
        address: TOKEN,
        abi: tokenAbi,
        functionName: 'allowance',
        args: [account, probe!],
      }),
    ]);
    if (balance < amount) throw Error('INSUFFICIENT_TOKEN');
    if (allowance < amount) throw Error('ALLOWANCE_REQUIRED');
    data = encodeFunctionData({ abi: probeAbi, functionName: 'fund', args: [nonce, amount] });
  } else {
    id = refundId;
    const payment = (await client.readContract({
      address: probe!,
      abi: probeAbi,
      functionName: 'payments',
      args: [id],
    })) as readonly [Address, bigint, boolean];
    if (payment[0].toLowerCase() !== account.toLowerCase() || payment[1] === 0n || payment[2])
      throw Error('NOTHING_TO_REFUND');
    amount = payment[1];
    data = encodeFunctionData({ abi: probeAbi, functionName: 'refund', args: [id] });
  }
  const [estimate, gasPrice, balance, transactionNonce, startBlock] = await Promise.all([
    client.estimateGas({ account, ...(to ? { to } : {}), data, value: 0n }),
    client.getGasPrice(),
    client.getBalance({ address: account }),
    client.getTransactionCount({ address: account, blockTag: 'pending' }),
    client.getBlockNumber({ cacheTime: 0 }),
  ]);
  const gas = estimate + estimate / 5n;
  if (balance < gas * gasPrice) throw Error('INSUFFICIENT_GAS');
  return {
    gas,
    gasPrice,
    op: {
      version: 1,
      chainId: CHAIN_ID,
      kind,
      account,
      to,
      data,
      amount: amount.toString(),
      transactionNonce,
      paymentNonce: nonce,
      paymentId: id,
      probe,
      hash: null,
      startBlock: startBlock.toString(),
      createdAt: new Date().toISOString(),
      localId: randomNonce(),
      state: 'signing',
    },
  };
}
export class JournalAfterSendError extends Error {
  constructor(public readonly operation: Operation) {
    super('JOURNAL_AFTER_SEND');
  }
}
/// Journal is saved BEFORE prompting the wallet; unknown send results are never blindly retried.
export async function sendOperation(
  provider: InjectedProvider,
  storage: RecoveryStorage,
  prepared: Awaited<ReturnType<typeof prepareOperation>>,
): Promise<Operation> {
  const { op, gas, gasPrice } = prepared;
  if (readJournal(storage, op.account).some(unresolved)) throw Error('UNRESOLVED_TRANSACTION');
  await requireWallet(provider, op.account);
  storeOperation(storage, op);
  let updated: Operation = op;
  try {
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: op.account,
          ...(op.to ? { to: op.to } : {}),
          data: op.data,
          value: '0x0',
          chainId: toHex(CHAIN_ID),
          nonce: toHex(op.transactionNonce),
          gas: toHex(gas),
          gasPrice: toHex(gasPrice),
        },
      ],
    });
    if (typeof hash !== 'string' || !isHex(hash) || hash.length !== 66)
      throw Error('Invalid transaction hash');
    updated = { ...op, hash, state: 'broadcast' };
  } catch (e) {
    updated = { ...op, state: errorCode(e) === 4001 ? 'rejected' : 'unknown' };
    storeOperation(storage, updated);
    throw e;
  }
  try {
    storeOperation(storage, updated);
  } catch {
    // Preserve a known hash in memory even if persistence fails after signing.
    throw new JournalAfterSendError(updated);
  }
  return updated;
}

export function assertExpectedReceipt(op: Operation, receipt: TransactionReceipt): void {
  if (receipt.status !== 'success') throw Error('REVERTED');
  if (receipt.from.toLowerCase() !== op.account.toLowerCase()) throw Error('RECEIPT_MISMATCH');
  if ((receipt.to?.toLowerCase() ?? null) !== (op.to?.toLowerCase() ?? null))
    throw Error('RECEIPT_MISMATCH');
  if (op.kind === 'deploy') {
    if (!receipt.contractAddress) throw Error('RECEIPT_MISMATCH');
    return;
  }
  const emitter = op.kind === 'approve' ? TOKEN : op.probe!;
  const matches = receipt.logs
    .filter((log) => log.address.toLowerCase() === emitter.toLowerCase())
    .flatMap((log) => {
      try {
        return [
          decodeEventLog({
            abi: op.kind === 'approve' ? tokenAbi : probeAbi,
            data: log.data,
            topics: log.topics,
            strict: true,
          }),
        ];
      } catch {
        return [];
      }
    });
  const expected = op.kind === 'approve' ? 'Approval' : op.kind === 'fund' ? 'Funded' : 'Refunded';
  const valid = matches.filter((event) => {
    if (event.eventName !== expected) return false;
    const args = event.args as unknown as Record<string, unknown>;
    if (op.kind === 'approve')
      return (
        String(args.owner).toLowerCase() === op.account.toLowerCase() &&
        String(args.spender).toLowerCase() === op.probe!.toLowerCase() &&
        args.value === BigInt(op.amount)
      );
    return (
      args.id === op.paymentId &&
      String(args.payer).toLowerCase() === op.account.toLowerCase() &&
      args.amount === BigInt(op.amount)
    );
  });
  if (valid.length !== 1) throw Error('RECEIPT_MISMATCH');
}

export async function inspectOperation(client: ChainClient, op: Operation): Promise<Operation> {
  if ((await client.getChainId()) !== CHAIN_ID) throw Error('WRONG_RPC_CHAIN');
  let hash = op.hash;
  // Bounded recovery only; old missing hashes must be supplied from the wallet/explorer.
  if (!hash || !(await client.getTransactionReceipt({ hash }).catch(() => null))) {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const floor = head > 40n ? head - 40n : 0n;
    const start = BigInt(op.startBlock) > floor ? BigInt(op.startBlock) : floor;
    const count = await client.getTransactionCount({ address: op.account, blockTag: 'latest' });
    if (count > op.transactionNonce) {
      for (let height = head; height >= start; height--) {
        const block = await client.getBlock({ blockNumber: height, includeTransactions: true });
        const match = block.transactions.find(
          (tx) =>
            typeof tx !== 'string' &&
            tx.from.toLowerCase() === op.account.toLowerCase() &&
            tx.nonce === op.transactionNonce,
        );
        if (match && typeof match !== 'string') {
          hash = match.hash;
          break;
        }
      }
    }
  }
  if (!hash) return { ...op, state: 'unknown' };
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash }).catch(() => null),
    client.getTransaction({ hash }).catch(() => null),
  ]);
  if (!receipt || !tx) return { ...op, hash, state: 'unknown' };
  const [block, finalized] = await Promise.all([
    client.getBlock({ blockNumber: receipt.blockNumber }),
    client.getBlock({ blockTag: 'finalized' }),
  ]);
  if (block.hash !== receipt.blockHash || receipt.blockHash !== tx.blockHash)
    return { ...op, hash, state: 'unknown' };
  const isFinal = finalized.number !== null && finalized.number >= receipt.blockNumber;
  if (tx.from.toLowerCase() !== op.account.toLowerCase() || tx.nonce !== op.transactionNonce)
    throw Error('RECEIPT_MISMATCH');
  if (
    (tx.to?.toLowerCase() ?? null) !== (op.to?.toLowerCase() ?? null) ||
    tx.input.toLowerCase() !== op.data.toLowerCase() ||
    tx.value !== 0n
  ) {
    return { ...op, hash, state: isFinal ? 'replaced' : 'included' };
  }
  if (receipt.status === 'reverted')
    return { ...op, hash, state: isFinal ? 'reverted' : 'included' };
  assertExpectedReceipt(op, receipt);
  let probe = op.probe;
  if (op.kind === 'deploy') {
    probe = getAddress(receipt.contractAddress!);
    await verifyProbe(client, probe);
  }
  return { ...op, hash, probe, state: isFinal ? 'finalized' : 'included' };
}
