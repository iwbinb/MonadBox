import { getAddress, toHex } from 'viem';
import type { Address } from 'viem';
import { CHAIN_ID, RPC_URL, EXPLORER } from './network';
export interface InjectedProvider {
 request(input:{method:string;params?:readonly unknown[]}):Promise<unknown>;
 on?(event:string,listener:(value:unknown)=>void):void;
 removeListener?(event:string,listener:(value:unknown)=>void):void;
}
export interface WalletOption { id:string;name:string;provider:InjectedProvider }
export function discoverWallets(target:EventTarget & {ethereum?:InjectedProvider},onChange:(wallets:WalletOption[])=>void):()=>void {
 const known=new Map<string,WalletOption>();
 const listener=(event:Event)=>{
  const detail=(event as CustomEvent<unknown>).detail;
  if(!detail||typeof detail!=='object'||!('info' in detail)||!('provider' in detail)) return;
  const {info,provider}=detail;
  if(!info||typeof info!=='object'||!('uuid' in info)||!('name' in info)||typeof info.uuid!=='string'||typeof info.name!=='string') return;
  if(!provider||typeof provider!=='object'||!('request' in provider)||typeof provider.request!=='function'||known.size>=20) return;
  known.delete('legacy');
  if(!known.has(info.uuid)) known.set(info.uuid,{id:info.uuid,name:info.name.slice(0,64),provider:provider as InjectedProvider});
  onChange([...known.values()]);
 };
 target.addEventListener('eip6963:announceProvider',listener);
 const legacy=target.ethereum;
 if(legacy && typeof legacy.request==='function') {known.set('legacy',{id:'legacy',name:'Browser wallet',provider:legacy});onChange([...known.values()]);}
 target.dispatchEvent(new Event('eip6963:requestProvider'));
 return ()=>target.removeEventListener('eip6963:announceProvider',listener);
}
export async function walletState(provider:InjectedProvider,requestAccess=false):Promise<{account:Address|null;chainId:number}> {
 const [accounts,chain]=await Promise.all([provider.request({method:requestAccess?'eth_requestAccounts':'eth_accounts'}),provider.request({method:'eth_chainId'})]);
 if(!Array.isArray(accounts)||typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain)) throw Error('INVALID_WALLET');
 const account=typeof accounts[0]==='string'?getAddress(accounts[0]):null;
 const chainId=Number(BigInt(chain));
 if(!Number.isSafeInteger(chainId)) throw Error('INVALID_WALLET');
 return {account,chainId};
}
export async function requireWallet(provider:InjectedProvider,account:Address) {
 const state=await walletState(provider);
 if(state.chainId!==CHAIN_ID) throw Error('WRONG_WALLET_CHAIN');
 if(state.account?.toLowerCase()!==account.toLowerCase()) throw Error('ACCOUNT_CHANGED');
}
export async function switchTestnet(provider:InjectedProvider) {
 try {await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:toHex(CHAIN_ID)}]});}
 catch(e){
  if(errorCode(e)!==4902) throw e;
  await provider.request({method:'wallet_addEthereumChain',params:[{chainId:toHex(CHAIN_ID),chainName:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:[RPC_URL],blockExplorerUrls:[EXPLORER]}]});
  await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:toHex(CHAIN_ID)}]});
 }
 const state=await walletState(provider);
 if(state.chainId!==CHAIN_ID) throw Error('WRONG_WALLET_CHAIN');
 return state;
}
export function errorCode(error:unknown):number|undefined {
 if(error&&typeof error==='object'&&'code' in error&&typeof error.code==='number')return error.code;
 return undefined;
}
export function userError(error:unknown):string {
 if(errorCode(error)===4001) return 'Signature rejected / 已取消签名';
 if(errorCode(error)===-32002) return 'Check the pending wallet request / 请先处理钱包中的请求';
 const text=error instanceof Error?error.message:'';
 const messages:Record<string,string>={WRONG_WALLET_CHAIN:'Switch to Monad Testnet / 请切换到 Monad 测试网',WRONG_RPC_CHAIN:'RPC returned a different network / RPC 网络不匹配',ACCOUNT_CHANGED:'Wallet account changed; review again / 钱包账号已变化，请重新核对',TOKEN_NOT_VERIFIED:'Official test asset could not be verified / 尚未核实官方测试资产',FINALITY_UNAVAILABLE:'Finalized block unavailable; do not send again / 无法确认最终区块，请勿重复发送',UNVERIFIED_PROBE:'Probe bytecode does not match this build / 探针代码不匹配，操作已阻止',UNSUPPORTED_WALLET:'Only a standard EOA is supported for this probe / 此探针暂仅支持普通外部账户',INSUFFICIENT_GAS:'Not enough test MON for the estimated gas / 测试 MON 不足以支付预估 Gas',INSUFFICIENT_TOKEN:'Not enough test AUSD / 测试 AUSD 不足',ALLOWANCE_REQUIRED:'Approve only the displayed amount first / 请先授权所显示的额度',JOURNAL_UNAVAILABLE:'Recovery storage failed. Check your wallet before any new send / 恢复记录保存失败，请先检查钱包，勿重复发送',UNRESOLVED_TRANSACTION:'Resolve the earlier transaction before sending another / 请先核实前一笔交易',INVALID_AMOUNT:'Use an amount greater than 0 and at most 1 test AUSD / 金额须大于0且不超过1测试AUSD',NOTHING_TO_REFUND:'No unrefunded payment found / 未发现可退的入金',INVALID_WALLET:'Invalid wallet response / 钱包响应无效'};
 return messages[text]??'Unable to complete the check. A pending transaction may still exist; inspect its hash before retrying. / 操作或检查未完成；已提交交易可能仍在处理，请先核对原交易。';
}
