import { Hono } from 'hono';
import { readConfig, toPublicConfig, STAGE } from '../shared/config';
import { requireStorage } from './storage';
import { handleQueue, handleScheduled } from './jobs';
import type { Env } from './env';
declare const __BUILD_SHA__: string;
const revision=typeof __BUILD_SHA__==='undefined'?'local':__BUILD_SHA__;
const app=new Hono<{Bindings:Env;Variables:{requestId:string}}>();
const csp="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://testnet-rpc.monad.xyz; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
app.use('*',async(c,next)=>{
 c.set('requestId',crypto.randomUUID());await next();
 c.header('X-Request-Id',c.get('requestId'));c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');c.header('X-Frame-Options','DENY');c.header('Content-Security-Policy',csp);c.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 if(new URL(c.req.url).pathname.startsWith('/api'))c.header('Cache-Control','no-store');
});
app.get('/api/v1/config',c=>{
 try{return c.json({data:toPublicConfig(readConfig(c.env),revision),requestId:c.get('requestId')});}
 catch{return c.json({error:{code:'CONFIG_INVALID',message:'Configuration is unavailable. All writes are disabled.',retryable:false},requestId:c.get('requestId')},503);}
});
app.get('/api/v1/health',async c=>{
 try{
  const config=readConfig(c.env);if(config.STORAGE_ENABLED)await requireStorage(c.env);
  return c.json({data:{service:'monadbox',stage:STAGE,testnetLab:config.TESTNET_LAB_ENABLED?'wallet-signed-only':'disabled',status:'ok',revision,environment:config.APP_ENV,chainId:10143,storage:config.STORAGE_ENABLED?'bound-and-checked':'disabled',background:config.BACKGROUND_ENABLED?'enabled':'disabled',payments:'disabled'},requestId:c.get('requestId')});
 }catch{return c.json({error:{code:'NOT_READY',message:'A required configuration or binding is unavailable.',retryable:true},requestId:c.get('requestId')},503);}
});
app.all('/api/v1/boxes',c=>c.json({error:{code:'FEATURE_UNAVAILABLE',message:'Box creation is not enabled in the foundation release.',retryable:false},requestId:c.get('requestId')},503));
app.all('/api/v1/config',c=>{c.header('Allow','GET, HEAD');return c.json({error:{code:'METHOD_NOT_ALLOWED',message:'Use GET.',retryable:false},requestId:c.get('requestId')},405);});
app.all('/api/v1/health',c=>{c.header('Allow','GET, HEAD');return c.json({error:{code:'METHOD_NOT_ALLOWED',message:'Use GET.',retryable:false},requestId:c.get('requestId')},405);});
app.all('/api/*',c=>c.json({error:{code:'NOT_FOUND',message:'API route not found.',retryable:false},requestId:c.get('requestId')},404));
app.all('/api',c=>c.json({error:{code:'NOT_FOUND',message:'API route not found.',retryable:false},requestId:c.get('requestId')},404));
app.all('*',async c=>{
 if(c.req.method!=='GET'&&c.req.method!=='HEAD')return c.text('Method not allowed',405);
 if(!c.env.ASSETS)return c.text('Static assets are unavailable',503);
 return c.env.ASSETS.fetch(c.req.raw);
});
app.onError((_err,c)=>c.json({error:{code:'INTERNAL_ERROR',message:'The request could not be completed.',retryable:true},requestId:c.get('requestId')},500));
export default {fetch:app.fetch,queue:handleQueue,scheduled:(_controller:ScheduledController,env:Env,ctx:ExecutionContext)=>{ctx.waitUntil(handleScheduled(env));}} satisfies ExportedHandler<Env>;
