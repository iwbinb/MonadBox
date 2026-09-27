import { setTimeout } from 'node:timers';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
const binary=existsSync('tools/anvil')?'tools/anvil':'anvil';
if(!execFileSync(binary,['--version'],{encoding:'utf8'}).includes('Version: 1.8.3'))throw Error('Anvil 1.8.3 required');
// No env override: these mock operations must never reach a public RPC.
const child=spawn(binary,['--host','127.0.0.1','--port','18545','--chain-id','10143','--silent'],{stdio:'ignore'});
try{
 let ready=false;
 for(let i=0;i<40;i++){
  try{const r=await fetch('http://127.0.0.1:18545',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});if((await r.json()).result==='0x279f'){ready=true;break;}}catch{/*Starting local process.*/}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!ready)throw Error('Local Anvil unavailable');
 mkdirSync('artifacts',{recursive:true});
 await build({entryPoints:['tests/integration/lab-scenario.ts'],outfile:'artifacts/local-chain-runner.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
 execFileSync(process.execPath,['artifacts/local-chain-runner.mjs'],{stdio:'inherit'});
}finally{child.kill('SIGTERM');}
