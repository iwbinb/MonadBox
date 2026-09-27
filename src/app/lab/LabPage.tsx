import { useCallback,useEffect,useRef,useState } from 'react';
import { formatEther,formatUnits,getAddress,isAddress,isHex } from 'viem';
import type { Address,Hex } from 'viem';
import { useApp } from '../context';
import { discoverWallets,walletState,switchTestnet,userError } from '../../shared/lab/wallet';
import type { WalletOption } from '../../shared/lab/wallet';
import { TOKEN,CHAIN_ID,makeClient,inspectNetwork,EXPLORER,explorerTransaction } from '../../shared/lab/network';
import type { Inspection } from '../../shared/lab/network';
import { verifyProbe,tokenAbi,probeAbi } from '../../shared/lab/artifact';
import { parseAmount } from '../../shared/amount';
import { prepareOperation,sendOperation,inspectOperation,JournalAfterSendError } from '../../shared/lab/transactions';
import { readJournal,storeOperation,unresolved } from '../../shared/lab/journal';
import type { Operation } from '../../shared/lab/journal';
import './lab.css';
const client=makeClient();
type Prepared=Awaited<ReturnType<typeof prepareOperation>>;

export default function LabPage() {
 const {t,state:appState}=useApp();
 const [wallets,setWallets]=useState<WalletOption[]>([]);
 const [selected,setSelected]=useState('');
 const [account,setAccount]=useState<Address|null>(null);
 const [chainId,setChainId]=useState<number|null>(null);
 const [inspection,setInspection]=useState<Inspection|null>(null);
 const [probeText,setProbeText]=useState('');
 const [probe,setProbe]=useState<Address|null>(null);
 const [amount,setAmount]=useState('0.1');
 const [refundId,setRefundId]=useState('');
 const [balances,setBalances]=useState<{mon:string;ausd:string;locked:string}|null>(null);
 const [records,setRecords]=useState<Operation[]>([]);
 const [prepared,setPrepared]=useState<Prepared|null>(null);
 const [consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const generation=useRef(0);
 const running=useRef(false);
 const invalidate=useCallback(()=>{generation.current+=1;},[]);
 const selectedWallet=wallets.find(w=>w.id===selected);
 const enabled=appState.status==='ready'&&appState.config.capabilities.testnetLab;
 const sessionRef=useRef({account,selected,chainId,enabled});
 sessionRef.current={account,selected,chainId,enabled};
 useEffect(()=>discoverWallets(window,setWallets),[]);
 useEffect(()=>{if(!wallets.some(w=>w.id===selected)&&wallets[0])setSelected(wallets[0].id);},[wallets,selected]);
 const refreshAccount=useCallback(async()=>{
  if(!selectedWallet)return;
  const token=++generation.current;
  try{
   const next=await walletState(selectedWallet.provider);
   if(generation.current!==token)return;
   setAccount(next.account);setChainId(next.chainId);setPrepared(null);setBalances(null);
  }catch{if(generation.current===token){setAccount(null);setChainId(null);setPrepared(null);}}
 },[selectedWallet]);
 useEffect(()=>{
  setAccount(null);setChainId(null);setPrepared(null);setBalances(null);
  if(!selectedWallet)return;
  void refreshAccount();
  const change=()=>{void refreshAccount();};
  selectedWallet.provider.on?.('accountsChanged',change);selectedWallet.provider.on?.('chainChanged',change);selectedWallet.provider.on?.('disconnect',change);
  return ()=>{invalidate();selectedWallet.provider.removeListener?.('accountsChanged',change);selectedWallet.provider.removeListener?.('chainChanged',change);selectedWallet.provider.removeListener?.('disconnect',change);};
 },[selectedWallet,refreshAccount,invalidate]);
 useEffect(()=>{
  setRecords([]);setProbe(null);setProbeText('');setPrepared(null);
  if(!account)return;
  try{
   const history=readJournal(localStorage,account);setRecords(history);
   const previous=[...history].reverse().find(r=>r.probe&&r.state==='finalized');
   if(previous?.probe)setProbeText(previous.probe);
  }catch{setError('Recovery records are unreadable; do not send new transactions. / 恢复记录不可读，请勿发送新交易。');}
 },[account]);
 const perform=async(action:()=>Promise<void>)=>{
  if(running.current)return;
  running.current=true;setBusy(true);setError('');
  try{await action();}catch(e){setError(userError(e));}
  finally{running.current=false;setBusy(false);}
 };
 const connect=()=>perform(async()=>{
  if(!selectedWallet)return;
  const version=++generation.current;
  const next=await walletState(selectedWallet.provider,true);
  if(version===generation.current){setAccount(next.account);setChainId(next.chainId);}
 });
 const refresh=()=>perform(async()=>{
  const snapshot=account;
  const result=await inspectNetwork(client);setInspection(result);
  if(snapshot){
   const [mon,ausd]=await Promise.all([client.getBalance({address:snapshot}),client.readContract({address:TOKEN,abi:tokenAbi,functionName:'balanceOf',args:[snapshot]})]);
   let locked=0n;
   if(probe){await verifyProbe(client,probe);locked=await client.readContract({address:probe,abi:probeAbi,functionName:'lockedBy',args:[snapshot]}) as bigint;}
   if(sessionRef.current.account===snapshot)setBalances({mon:formatEther(mon),ausd:formatUnits(ausd,6),locked:formatUnits(locked,6)});
  }
 });
 const validateProbe=()=>perform(async()=>{
  setProbe(null);setPrepared(null);
  if(!isAddress(probeText))throw Error('UNVERIFIED_PROBE');
  const address=getAddress(probeText);await verifyProbe(client,address);setProbe(address);
 });
 const prepare=(kind:Operation['kind'],record?:Operation)=>perform(async()=>{
  setPrepared(null);
  if(!enabled||!selectedWallet||!account||chainId!==CHAIN_ID||!consent)return;
  const snapshot={...sessionRef.current};
  if(readJournal(localStorage,account).some(unresolved))throw Error('UNRESOLVED_TRANSACTION');
  const raw=record?BigInt(record.amount):(kind==='refund'||kind==='deploy'?1n:parseAmount(amount,6));
  const id=record?.paymentId ?? (kind==='refund' ? (isHex(refundId)&&refundId.length===66?refundId:(()=>{throw Error('NOTHING_TO_REFUND');})()) : undefined);
  const result=await prepareOperation(client,selectedWallet.provider,account,kind,record?.probe??probe,raw,id);
  const current=sessionRef.current;
  if(current.account!==snapshot.account||current.selected!==snapshot.selected||current.chainId!==snapshot.chainId||!current.enabled)throw Error('ACCOUNT_CHANGED');
  setPrepared(result);
 });
 const submit=()=>perform(async()=>{
  if(!prepared||!selectedWallet||!account||!consent||!enabled)return;
  const current=prepared;setPrepared(null);
  try{
   const sent=await sendOperation(selectedWallet.provider,localStorage,current);
   const checked=await inspectOperation(client,sent).catch(()=>sent);
   storeOperation(localStorage,checked);
   if(checked.kind==='deploy'&&checked.state==='finalized'&&checked.probe&&sessionRef.current.account===account){setProbeText(checked.probe);setProbe(checked.probe);}
  }catch(e){
   if(e instanceof JournalAfterSendError){
    if(sessionRef.current.account===account)setRecords(prev=>[...prev.filter(r=>r.localId!==e.operation.localId),e.operation]);
    setError(`Transaction sent: ${e.operation.hash}. Recovery storage failed. Save this hash; do not resend. / 交易已发送但本地保存失败，请保存哈希，勿重发。`);return;
   }
   if(sessionRef.current.account===account)setRecords(readJournal(localStorage,account));
   throw e;
  }
  if(sessionRef.current.account===account)setRecords(readJournal(localStorage,account));
 });
 const recheck=(record:Operation)=>perform(async()=>{
  const checked=await inspectOperation(client,record);storeOperation(localStorage,checked);
  if(sessionRef.current.account===record.account){setRecords(readJournal(localStorage,record.account));if(checked.kind==='deploy'&&checked.state==='finalized'&&checked.probe){setProbeText(checked.probe);setProbe(checked.probe);}}
 });
 const [recoveryHash,setRecoveryHash]=useState('');
 const recover=(record:Operation)=>perform(async()=>{
  if(!isHex(recoveryHash)||recoveryHash.length!==66)throw Error('Invalid hash');
  const checked=await inspectOperation(client,{...record,hash:recoveryHash as Hex});storeOperation(localStorage,checked);
  if(sessionRef.current.account===record.account)setRecords(readJournal(localStorage,record.account));
  setRecoveryHash('');
 });
 const pending=records.some(unresolved);
 const canPrepare=enabled&&account!==null&&chainId===CHAIN_ID&&consent&&!busy&&!pending;
 return (
  <div className="container lab-page">
   <div className="page-heading"><h1>{t('Testnet payment lab','测试网付款实验室')}</h1><p>{t('Connect, verify, fund and refund. This is a capped technical probe, not a live Box.','连接钱包、核实网络、测试入金和退款。这是限额技术探针，不是真实业务 Box。')}</p></div>
   <div className="notice lab-warning">{t('Test assets only. Every write requires your wallet signature. Maximum outstanding: 1 test AUSD per wallet per probe. No audit or real-money protection is claimed.','仅使用测试资产。每次写操作均需你的钱包签名；每个钱包在每个探针中最多保留1测试AUSD。未审计，不提供真实资金保障。')}</div>
   {!enabled?<div className="notice" role="status">{t('Configuration unavailable or lab disabled. Signing is blocked.','配置不可用或实验室关闭，已阻止签名。')}</div>:null}
   {error?<div className="notice danger" role="alert">{error}</div>:null}
   <div className="lab-grid">
    <section className="lab-panel"><h2>{t('1. Wallet & network','1. 钱包与网络')}</h2>
     <label htmlFor="lab-wallet">{t('Wallet','钱包')}</label><select id="lab-wallet" value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setPrepared(null);}}>{wallets.map(w=><option value={w.id} key={w.id}>{w.name}</option>)}</select>
     {!wallets.length?<p>{t('No injected wallet detected. Open this page in a wallet-enabled browser. WalletConnect is not integrated yet.','未检测到浏览器钱包。请在装有钱包扩展的浏览器或钱包内置浏览器打开；尚未接入 WalletConnect。')}</p>:null}
     <div className="lab-actions"><button className="button primary" disabled={busy||!selectedWallet||!enabled} onClick={connect}>{t('Connect wallet','连接钱包')}</button><button className="button secondary" disabled={busy||!selectedWallet||!enabled} onClick={()=>perform(async()=>{if(selectedWallet){await switchTestnet(selectedWallet.provider);await refreshAccount();}})}>{t('Switch to testnet','切换测试网')}</button></div>
     <dl className="lab-facts"><dt>{t('Account','地址')}</dt><dd>{account??t('Not connected','尚未连接')}</dd><dt>Chain ID</dt><dd>{chainId??'—'}{chainId&&chainId!==CHAIN_ID?` · ${t('Wrong network','网络不匹配')}`:''}</dd></dl>
     <button className="button secondary" disabled={busy||!enabled} onClick={refresh}>{t('Check network & balances','核实网络与余额')}</button>
     {inspection?<dl className="lab-facts"><dt>{t('Finalized block','最终确认区块')}</dt><dd>{inspection.finalized}</dd><dt>{t('Test asset','测试资产')}</dt><dd>AUSD · 6 decimals<br/>{TOKEN}</dd></dl>:<p>{t('Network and asset have not been checked in this session.','当前会话尚未核实网络和资产。')}</p>}
     {balances?<dl className="lab-facts"><dt>MON</dt><dd>{balances.mon}</dd><dt>{t('Test AUSD','测试AUSD')}</dt><dd>{balances.ausd}</dd><dt>{t('Probe locked','探针保留款')}</dt><dd>{balances.locked}</dd></dl>:null}
     <p><a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">{t('Official MON faucet','官方 MON 水龙头')}</a>{' · '}<a href="https://docs.agora.finance/developer/contract-deployments" target="_blank" rel="noreferrer">{t('Official AUSD test assets','官方 AUSD 测试资产说明')}</a></p>
    </section>
    <section className="lab-panel"><h2>{t('2. Verify the probe','2. 核实探针')}</h2><p>{t('Deploy this build’s probe using your wallet, or verify an existing address. Matching bytecode is required before any approval.','通过钱包部署本版本探针，或核实已有地址。只有代码匹配，才允许代币授权。')}</p>
     <label className="lab-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>{setConsent(e.target.checked);setPrepared(null);}}/>{t('I will only use testnet assets and understand each transaction costs test MON.','我仅使用测试网资产，并理解每笔交易会消耗测试 MON。')}</label>
     <button className="button secondary" disabled={!canPrepare} onClick={()=>prepare('deploy')}>{t('Prepare probe deployment','准备部署探针')}</button>
     <label htmlFor="probe-address">{t('Probe address','探针地址')}</label><input id="probe-address" placeholder="0x…" value={probeText} disabled={busy} onChange={e=>{setProbeText(e.target.value);setProbe(null);setPrepared(null);}} autoComplete="off" spellCheck={false}/>
     <button className="button secondary" disabled={busy||!enabled} onClick={validateProbe}>{t('Verify bytecode','核对合约代码')}</button>
     <p role="status">{probe?t('Bytecode and test asset match this build.','代码和测试资产与本版本匹配。'):t('No verified probe selected.','尚未选择已核验探针。')}</p>
    </section>
    <section className="lab-panel"><h2>{t('3. Approve & fund','3. 授权与入金')}</h2><label htmlFor="lab-amount">{t('Test AUSD amount (maximum 1)','测试 AUSD 金额（最多1）')}</label><input id="lab-amount" inputMode="decimal" value={amount} disabled={busy} onChange={e=>{setAmount(e.target.value);setPrepared(null);}}/>
     <div className="lab-actions"><button className="button secondary" disabled={!canPrepare||!probe} onClick={()=>prepare('approve')}>{t('Prepare exact approval','准备精确额度授权')}</button><button className="button primary" disabled={!canPrepare||!probe} onClick={()=>prepare('fund')}>{t('Prepare test payment','准备测试入金')}</button></div>
     <p>{t('Approval is not payment. Funds can only return to the original payer, with no administrator taking custody of your keys.','授权不是付款。退款只能回到原付款地址，管理员不会持有你的私钥。')}</p>
    </section>
   </div>
   {prepared?<section className="lab-panel lab-review" aria-label={t('Review transaction','核对交易')}><h2>{t('Review before signing','签名前核对')}</h2><dl className="lab-facts"><dt>{t('Action','操作')}</dt><dd>{prepared.op.kind}</dd><dt>{t('Network','网络')}</dt><dd>Monad Testnet · 10143</dd><dt>{t('Target','目标')}</dt><dd>{prepared.op.to??t('Deploy new probe','部署新探针')}</dd><dt>{t('Amount','金额')}</dt><dd>{prepared.op.kind==='deploy'?'0 MON':`${formatUnits(BigInt(prepared.op.amount),6)} test AUSD`}</dd><dt>{t('Gas budget','Gas 预算')}</dt><dd>{formatEther(prepared.gas*prepared.gasPrice)} test MON</dd></dl><button className="button primary" disabled={busy||!enabled||!consent} onClick={submit}>{t('Confirm in wallet','在钱包中确认')}</button>{' '}<button className="button secondary" disabled={busy} onClick={()=>setPrepared(null)}>{t('Cancel','取消')}</button></section>:null}
   <section className="lab-panel lab-history"><h2>{t('4. Verify receipts & refund','4. 核对回执与退款')}</h2><p>{t('Saved records are recovery hints, not proof of payment. Recheck reads the chain without requesting a signature.','保存记录仅用于恢复，不是付款证明。重新核验只读取链，不请求签名。')}</p>
    {pending?<div className="notice">{t('Resolve the pending transaction before creating another. Timeout does not mean failure.','请先核实未确定的交易，再创建下一笔；超时不代表失败。')}</div>:null}
    {!records.length?<p>{t('No transactions in this browser for the connected account.','此浏览器中没有该账号的交易记录。')}</p>:null}
    {[...records].reverse().map(r=><article className="lab-record" key={r.localId}><div><strong>{r.kind} · {r.state}</strong><p>{r.hash?<a href={explorerTransaction(r.hash)} target="_blank" rel="noreferrer">{r.hash}</a>:t('No transaction hash yet; do not blindly resend.','尚无交易哈希，请勿盲目重发。')}</p>{r.kind==='fund'?<p>{t('Payment ID','入金编号')}: {r.paymentId}</p>:null}</div><div className="lab-actions"><button className="button secondary" disabled={busy||r.state==='rejected'} onClick={()=>recheck(r)}>{t('Recheck on chain','重新链上核验')}</button>{r.kind==='fund'&&r.state==='finalized'?<button className="button secondary" disabled={!canPrepare} onClick={()=>prepare('refund',r)}>{t('Prepare refund','准备退款')}</button>:null}</div>{unresolved(r)?<div className="lab-recover"><label htmlFor={`recover-${r.localId}`}>{t('Replacement / missing hash from your wallet','钱包中的替代／缺失交易哈希')}</label><input id={`recover-${r.localId}`} value={recoveryHash} onChange={e=>setRecoveryHash(e.target.value)} placeholder="0x…"/><button className="button secondary" disabled={busy||!recoveryHash} onClick={()=>recover(r)}>{t('Verify supplied hash','核实该哈希')}</button></div>:null}</article>)}
   </section>
   <section className="lab-panel"><h2>{t('Refund without browser history','无浏览器历史记录的退款')}</h2><p>{t('Verify the original probe above, then paste the Payment ID from its Funded event. The contract always returns funds to the original payer.','先在上方核验原探针地址，再粘贴 Funded 事件中的 Payment ID；资金只会退回原付款地址。')}</p><label htmlFor="lab-refund-id">Payment ID</label><input id="lab-refund-id" value={refundId} onChange={e=>{setRefundId(e.target.value);setPrepared(null);}} placeholder="0x…"/><button className="button secondary" disabled={!canPrepare||!probe||!isHex(refundId)||refundId.length!==66} onClick={()=>prepare('refund')}>{t('Prepare recovered refund','准备恢复退款')}</button></section>
   <p className="lab-footnote">{t('Only standard external accounts are enabled. Deployed smart accounts and delegated accounts are blocked until their write paths are separately verified. No SIWE session, real orders or production payments are enabled.','当前仅开放普通外部账户；已部署智能账户与委托账户的写入路径尚未单独验证，因此保持阻止。尚未开放 SIWE 会话、真实订单或业务付款。')} <a href={`${EXPLORER}/address/${TOKEN}`} target="_blank" rel="noreferrer">{t('Test token contract','测试代币合约')}</a></p>
  </div>
 );
}
