// Local Anvil validation only. No testnet signing or broadcasting.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync,writeFileSync } from 'node:fs';
import { createPublicClient,http,parseAbi } from 'viem';
import type {Address,Hex} from 'viem';
import {TEST_CHAIN,TOKEN,inspectNetwork} from '../../src/shared/lab/network';
import {probeAbi,tokenAbi,verifyProbe} from '../../src/shared/lab/artifact';
import {prepareOperation,sendOperation,inspectOperation} from '../../src/shared/lab/transactions';
import {storeOperation} from '../../src/shared/lab/journal';
import type {Operation} from '../../src/shared/lab/journal';
import type {InjectedProvider} from '../../src/shared/lab/wallet';
const endpoint='http://127.0.0.1:18545';
const client=createPublicClient({chain:TEST_CHAIN,transport:http(endpoint,{retryCount:0})});
let id=0;
async function rpc(method:string,params:readonly unknown[]=[]):Promise<unknown>{
 const result=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}).then(r=>r.json()) as {result?:unknown;error?:{message:string}};
 if(result.error)throw Error(result.error.message);return result.result;
}
assert.equal(await client.getChainId(),10143);
const accounts=await rpc('eth_accounts') as Address[];
const account=accounts[0]!;
const mock=JSON.parse(readFileSync('contracts/out/MockToken.sol/MockToken.json','utf8')) as {deployedBytecode:{object:Hex}};
await rpc('anvil_setCode',[TOKEN,mock.deployedBytecode.object]);
const {encodeFunctionData}=await import('viem');
await rpc('eth_sendTransaction',[{from:account,to:TOKEN,data:encodeFunctionData({abi:parseAbi(['function mint(address,uint256)']),functionName:'mint',args:[account,2_000_000n]})}]);
const storageMap=new Map<string,string>();
const storage={getItem:(key:string)=>storageMap.get(key)??null,setItem:(key:string,value:string)=>{storageMap.set(key,value);}};
const provider:InjectedProvider={request:({method,params=[]})=>method==='eth_accounts'||method==='eth_requestAccounts'?Promise.resolve([account]):rpc(method,params)};
const evidence:{mode:string;endpoint:string;operations:Operation[];network?:unknown;checks:string[]}={mode:'LOCAL_ANVIL_WITH_MOCK_TOKEN_NOT_MONAD',endpoint,operations:[],checks:[]};
evidence.network=await inspectNetwork(client);
async function perform(kind:Operation['kind'],probe:Address|null,refundId?:Hex,ambiguous=false){
 const p=await prepareOperation(client,provider,account,kind,probe,100_000n,refundId);
 let sent:Operation;
 if(ambiguous){
  const uncertain:InjectedProvider={request:async(q)=>{const value=await provider.request(q);if(q.method==='eth_sendTransaction')throw Error('Simulated response lost AFTER broadcast');return value;}};
  await assert.rejects(sendOperation(uncertain,storage,p));
  const {readJournal}=await import('../../src/shared/lab/journal');sent=readJournal(storage,account).at(-1)!;
 }else sent=await sendOperation(provider,storage,p);
 await new Promise(r=>setTimeout(r,150));await rpc('evm_mine');
 let checked=await inspectOperation(client,sent);
 for(let i=0;checked.state!=='finalized'&&i<20;i++){await new Promise(r=>setTimeout(r,100));await rpc('anvil_mine',['0x41']);checked=await inspectOperation(client,checked);}
 assert.equal(checked.state,'finalized');storeOperation(storage,checked);evidence.operations.push(checked);return checked;
}
const deployed=await perform('deploy',null);const probe=deployed.probe!;
await verifyProbe(client,probe);evidence.checks.push('generated runtime equals actual deployed runtime');
await assert.rejects(verifyProbe(client,TOKEN));evidence.checks.push('arbitrary contract blocked');
await perform('approve',probe);
assert.equal(await client.readContract({address:TOKEN,abi:tokenAbi,functionName:'allowance',args:[account,probe]}),100_000n);
const funded=await perform('fund',probe,undefined,true);evidence.checks.push('unknown send recovered by account and nonce without resend');
assert.equal(await client.readContract({address:probe,abi:probeAbi,functionName:'totalLocked'}),100_000n);
await perform('refund',probe,funded.paymentId);
assert.equal(await client.readContract({address:TOKEN,abi:tokenAbi,functionName:'balanceOf',args:[account]}),2_000_000n);
assert.equal(await client.readContract({address:probe,abi:probeAbi,functionName:'totalLocked'}),0n);
await assert.rejects(prepareOperation(client,provider,account,'refund',probe,100_000n,funded.paymentId));
evidence.checks.push('principal conserved and duplicate refund rejected');
await rpc('anvil_setCode',[account,'0xef0100'+'11'.repeat(20)]);
await assert.rejects(prepareOperation(client,provider,account,'approve',probe,100_000n),/UNSUPPORTED_WALLET/);
evidence.checks.push('delegated account blocked');
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/local-chain.json',JSON.stringify(evidence,null,2));
console.log(`Local EVM: ${evidence.operations.length} operations finalized, ${evidence.checks.length} checks; NOT real Monad transactions.`);
