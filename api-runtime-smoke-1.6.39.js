'use strict';
// Safe end-to-end API smoke test: the app runs against a local Firebase RTDB-compatible
// test double and a local mock SMM provider. No production Firebase or paid provider is touched.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');

function listen(server){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve(server.address().port);});});}
function close(server){return new Promise(resolve=>{if(!server||!server.listening)return resolve();server.close(()=>resolve());});}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function readBody(req){return new Promise((resolve,reject)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>resolve(body));req.on('error',reject);});}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function pathParts(url){return decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/\.json$/,'')).split('/').filter(Boolean);}
function getAt(root,parts){let x=root;for(const part of parts){if(!x||typeof x!=='object'||!Object.prototype.hasOwnProperty.call(x,part))return null;x=x[part];}return x===undefined?null:x;}
function setAt(root,parts,value){if(!parts.length)throw new Error('root mutation not expected');let x=root;for(const part of parts.slice(0,-1)){if(!x[part]||typeof x[part]!=='object'||Array.isArray(x[part]))x[part]={};x=x[part];}const last=parts[parts.length-1];if(value===null)delete x[last];else x[last]=clone(value);}
async function requestJson(url,opts={}){const response=await fetch(url,opts);const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{data={raw:text};}return {status:response.status,data,headers:response.headers};}
async function main(){
  const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'sada-api-smoke-'));
  const rootDb={users:{tester:{username:'tester',email:'tester@example.com',balance:100000,discountPct:0}},orders:{},apiKeys:{}};
  let dbVersion=1;let providerAddCalls=0;let providerSeen=[];
  const db=http.createServer(async(req,res)=>{
    try{
      const bodyText=await readBody(req);const parts=pathParts(new URL(req.url,'http://127.0.0.1'));const method=req.method||'GET';
      if(method==='GET'){
        res.statusCode=200;res.setHeader('Content-Type','application/json');res.setHeader('ETag',`"${dbVersion}"`);res.end(JSON.stringify(clone(getAt(rootDb,parts))));return;
      }
      if(method==='PUT'){
        const match=req.headers['if-match'];if(match&&match!==`"${dbVersion}"`){res.statusCode=412;res.end(JSON.stringify({error:'precondition failed'}));return;}
        const value=bodyText?JSON.parse(bodyText):null;setAt(rootDb,parts,value);dbVersion++;res.statusCode=200;res.setHeader('Content-Type','application/json');res.setHeader('ETag',`"${dbVersion}"`);res.end(JSON.stringify(value));return;
      }
      if(method==='PATCH'){
        const value=bodyText?JSON.parse(bodyText):{};const current=getAt(rootDb,parts)||{};const next={...current,...value};setAt(rootDb,parts,next);dbVersion++;res.statusCode=200;res.setHeader('Content-Type','application/json');res.setHeader('ETag',`"${dbVersion}"`);res.end(JSON.stringify(next));return;
      }
      if(method==='DELETE'){setAt(rootDb,parts,null);dbVersion++;res.statusCode=200;res.end('null');return;}
      res.statusCode=405;res.end('{}');
    }catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e.message||e)}));}
  });
  const dbPort=await listen(db);
  const provider=http.createServer(async(req,res)=>{
    try{
      const text=await readBody(req);const params=new URLSearchParams(text);const key=params.get('key');const action=params.get('action');
      if(key!=='mock-provider-secret'){res.statusCode=401;res.end(JSON.stringify({error:'bad mock provider key'}));return;}
      providerSeen.push(action);
      if(action==='add'){providerAddCalls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({order:'MOCK-90001'}));return;}
      if(action==='status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'Pending',start_count:0,remains:10,charge:'0.05'}));return;}
      if(action==='balance'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({balance:123.45}));return;}
      if(action==='services'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{service:77,name:'Mock service',rate:5,min:1,max:1000},{service:78,name:'New imported mock service',rate:3,min:1,max:2000}]));return;}
      if(action==='cancel'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({cancel:1}));return;}
      res.statusCode=422;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'unsupported mock action'}));
    }catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e.message||e)}));}
  });
  const providerPort=await listen(provider);
  const dataDir=path.join(tempDir,'data');fs.mkdirSync(dataDir,{recursive:true});
  fs.writeFileSync(path.join(dataDir,'services.json'),JSON.stringify({
    'svc-test':{fbKey:'svc-test',siteServiceId:'1001',providerId:'mock-provider',providerServiceId:'77',smmpartyId:'77',serviceId:'1001',name:'Safe mock test service',category:'Test',sellingUsd:5,providerRateUsd:2.5,markupPct:100,min:1,max:1000,active:true,refill:false,cancel:true,type:'default'},
    'svc-removed':{fbKey:'svc-removed',siteServiceId:'1002',providerId:'mock-provider',providerServiceId:'88',smmpartyId:'88',serviceId:'1002',name:'Previously hidden by unsafe auto-check',category:'Test',sellingUsd:4,providerRateUsd:2,min:1,max:1000,active:true,providerAvailable:false,availabilityStatus:'unavailable',providerAvailabilityReason:'not_found_in_live_supplier_catalog',refill:false,cancel:true,type:'default'},
    'svc-admin-disabled':{fbKey:'svc-admin-disabled',siteServiceId:'1003',providerId:'mock-provider',providerServiceId:'77',smmpartyId:'77',serviceId:'1003',name:'Manually disabled by site admin',category:'ManualDisableTest',sellingUsd:4,providerRateUsd:2,min:1,max:1000,active:false,providerAvailable:false,availabilityStatus:'unavailable',providerAvailabilityReason:'not_found_in_live_supplier_catalog',refill:false,cancel:true,type:'default'}
  }));
  fs.writeFileSync(path.join(dataDir,'providers.runtime.json'),JSON.stringify({activeProvider:'mock-provider',providers:{'mock-provider':{id:'mock-provider',name:'Mock SMM Provider',url:`http://127.0.0.1:${providerPort}`,key:'mock-provider-secret'}},deletedProviderIds:[]}));
  fs.writeFileSync(path.join(dataDir,'providers.json'),JSON.stringify({activeProvider:'',providers:{},deletedProviderIds:[]}));
  fs.writeFileSync(path.join(dataDir,'users.json'),JSON.stringify({users:{}}));
  const appPortServer=http.createServer();const appPort=await listen(appPortServer);await close(appPortServer);
  const sessionSecret='safe-test-session-secret-at-least-32-chars';
  const env={...process.env,NODE_ENV:'test',PORT:String(appPort),SADA_DATA_DIR:dataDir,FIREBASE_DATABASE_URL:`http://127.0.0.1:${dbPort}`,FIREBASE_ALLOW_UNAUTHENTICATED:'true',ALLOW_LOCAL_PROVIDER_TEST:'1',SESSION_SECRET:sessionSecret,SADA_ENCRYPTION_KEY:'safe-test-encryption-secret-at-least-32-chars',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'test-only-admin-password-long-enough'};
  delete env.FIREBASE_SERVICE_ACCOUNT_JSON;delete env.FIREBASE_SERVICE_ACCOUNT_BASE64;delete env.GOOGLE_SERVICE_ACCOUNT_JSON;delete env.FIREBASE_DATABASE_SECRET;
  const app=spawn(process.execPath,['server.js'],{cwd:__dirname,env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';app.stdout.on('data',d=>stdout+=d.toString());app.stderr.on('data',d=>stderr+=d.toString());
  const base=`http://127.0.0.1:${appPort}`;
  async function req(pathname,opts={}){return requestJson(base+pathname,opts);}
  const payload=Buffer.from(JSON.stringify({username:'tester',role:'user',iat:Date.now()})).toString('base64url');
  const signature=crypto.createHmac('sha256',sessionSecret).update(payload).digest('base64url');
  const cookie=`sadairaq_sid=${payload}.${signature}`;
  try{
    let healthy=false;let health;
    for(let i=0;i<100;i++){
      if(app.exitCode!==null)throw new Error(`Application exited early: ${stdout}\n${stderr}`);
      try{const r=await req('/api/health');if(r.status===200){healthy=true;health=r.data;break;}}catch{}
      await wait(100);
    }
    assert.equal(healthy,true,'application should start against the explicitly configured local RTDB');
    assert.equal(health.version,'1.6.39');
    assert.equal(health.deploymentConsistent,true,'all packaged UI/server build markers must match');
    assert.equal(health.firebaseDatabaseSource,'railway-environment','explicit Firebase URL must win in production/test config resolution');
    console.log('PASS runtime: explicit database URL is the same target used by API routes');

    async function loginAsAdmin(password){
      const challenge=await req('/api/auth/captcha');
      assert.equal(challenge.status,200,`admin login captcha should issue: ${JSON.stringify(challenge.data)}`);
      const match=String(challenge.data.question||'').match(/(\d+)\s*\+\s*(\d+)/);
      assert(match,'math captcha should contain two operands');
      return req('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin@example.test',password,captchaId:challenge.data.captchaId,captchaAnswer:String(Number(match[1])+Number(match[2]))})});
    }
    const badAdminLogin=await loginAsAdmin('wrong-test-password');
    assert.equal(badAdminLogin.status,401,`wrong admin password should be rejected explicitly: ${JSON.stringify(badAdminLogin.data)}`);
    assert.equal(badAdminLogin.data.code,'invalid_admin_credentials');
    const goodAdminLogin=await loginAsAdmin('test-only-admin-password-long-enough');
    assert.equal(goodAdminLogin.status,200,`configured admin should be able to log in: ${JSON.stringify(goodAdminLogin.data)}`);
    assert.equal(goodAdminLogin.data.role,'admin');
    console.log('PASS runtime: configured administrator login succeeds and an incorrect admin password is explicitly rejected');

    const create=await req('/api/user/api-key',{method:'POST',headers:{Cookie:cookie}});
    assert.equal(create.status,200,`key generation should persist in selected DB: ${JSON.stringify(create.data)}`);
    const apiKey=String(create.data.apiKey||'');assert.match(apiKey,/^sr_[A-Za-z0-9_-]{30,}$/,'new key should use expected format');
    const hash=crypto.createHash('sha256').update(apiKey).digest('hex');
    assert.equal(rootDb.apiKeys[hash]?.username,'tester','new key record should be stored at SHA-256 hash in the selected DB');
    assert.equal(rootDb.apiKeys[hash]?.keyHash,hash,'new key record should bind its hash');
    assert.equal(rootDb.apiKeys[hash]?.status,'pending');assert.equal(rootDb.apiKeys[hash]?.activationState,'pending');assert(rootDb.apiKeys[hash]?.scopes.includes('balance'));assert(rootDb.apiKeys[hash]?.unusedExpiresAt);
    console.log('PASS runtime: new API key is stored pending first use with a 24-hour expiry');

    const keyHeader={'X-API-Key':apiKey};
    const balance=await req('/api/v1',{method:'POST',headers:{...keyHeader,'Content-Type':'application/x-www-form-urlencoded'},body:'action=balance'});
    assert.equal(balance.status,200,`balance action should authorize the new key: ${JSON.stringify(balance.data)}`);
    assert.equal(balance.data.balance,80);assert.equal(balance.data.currency,'USD');assert.equal(rootDb.apiKeys[hash]?.status,'active');assert(rootDb.apiKeys[hash]?.activatedAt);
    console.log('PASS runtime: first valid API request activates the pending key and authorizes balance');
    const staleRaw='sr_'+('Z'.repeat(38)),staleHash=crypto.createHash('sha256').update(staleRaw).digest('hex');
    rootDb.apiKeys[staleHash]={username:'tester',createdAt:new Date(Date.now()-26*60*60*1000).toISOString(),unusedExpiresAt:new Date(Date.now()-2*60*60*1000).toISOString(),masked:'sr_stale…ZZZZ',keyHash:staleHash,status:'pending',activationState:'pending',scopes:['balance'],version:3};
    const stale=await req('/api/v1',{method:'POST',headers:{'X-API-Key':staleRaw,'Content-Type':'application/x-www-form-urlencoded'},body:'action=balance'});
    assert.equal(stale.status,401,'expired unused key must be rejected');assert.equal(rootDb.apiKeys[staleHash],undefined,'expired unused key should be deleted from Firebase');
    console.log('PASS runtime: unused API key expires after 24 hours and is removed automatically');


    const services=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'services',key:apiKey}).toString()});
    assert.equal(services.status,200,`services action should authorize the same key: ${JSON.stringify(services.data)}`);
    assert(Array.isArray(services.data));assert.equal(services.data[0]?.id,'1001');assert.equal(services.data[0]?.name,'Safe mock test service');
    console.log('PASS runtime: services action returns the internal numeric ID on the same API key');

    const addBody=new URLSearchParams({action:'add',key:apiKey,service:'1001',link:'https://example.com/safe-api-smoke-test',quantity:'10',idempotency_key:'SAFE_LOCAL_SMOKE_1628'}).toString();
    const added=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:addBody});
    assert.equal(added.status,200,`safe mocked add should succeed: ${JSON.stringify(added.data)}`);
    assert.equal(added.data.service,'1001');assert.equal(added.data.status,'pending');assert.equal(providerAddCalls,1);
    assert.equal(rootDb.orders[`API_${added.data.internal_order_id?.replace(/^API_/, '')}`]?.id,added.data.internal_order_id,'order should be persisted');
    const apiOrderRowsAfterAdd=JSON.parse(fs.readFileSync(path.join(dataDir,'orders.json'),'utf8'));
    const apiFinancialOrder=apiOrderRowsAfterAdd.find(o=>String(o.id)===String(added.data.internal_order_id));
    assert(apiFinancialOrder,'API order must persist as an order record');
    assert.equal(apiFinancialOrder.providerRateUsd,5);assert.equal(apiFinancialOrder.providerCostUsd,0.05);assert.equal(apiFinancialOrder.chargeUsd,0.1);assert.equal(apiFinancialOrder.grossProfitUsd,0.05);assert.equal(apiFinancialOrder.actualMarkupPct,100);assert.equal(apiFinancialOrder.profitMarginPct,50);
    assert(Number(rootDb.users.tester.balance)<100000,'test wallet should be reserved exactly once');
    const afterFirstBalance=Number(rootDb.users.tester.balance);
    const duplicate=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:addBody});
    assert.equal(duplicate.status,200,`idempotent retry should reuse prior order: ${JSON.stringify(duplicate.data)}`);
    assert.equal(duplicate.data.idempotent,true);assert.equal(providerAddCalls,1,'idempotent retry must not hit provider twice');assert.equal(Number(rootDb.users.tester.balance),afterFirstBalance,'idempotent retry must not charge twice');
    console.log('PASS runtime: safe API add was sent once to a local mock provider, persisted, and duplicate retry charged/sent zero extra times');

    const status=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'status',key:apiKey,order:String(added.data.order)}).toString()});
    assert.equal(status.status,200,`status check should work with the same key: ${JSON.stringify(status.data)}`);
    assert.equal(status.data.status,'pending');console.log('PASS runtime: status endpoint uses the same validated key and provider mapping');

    const revoked=await req('/api/user/api-key/revoke',{method:'POST',headers:{Cookie:cookie}});
    assert.equal(revoked.status,200,`revoke should persist: ${JSON.stringify(revoked.data)}`);
    const bad=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'balance',key:apiKey}).toString()});
    assert.equal(bad.status,401,'revoked key must be rejected immediately');
    console.log('PASS runtime: revocation updates selected Firebase DB and the same key is rejected with 401');

    const adminPayload=Buffer.from(JSON.stringify({username:'admin@example.test',role:'admin',iat:Date.now()})).toString('base64url');
    const adminSig=crypto.createHmac('sha256',sessionSecret).update(adminPayload).digest('base64url');
    const adminCookie={Cookie:`sadairaq_sid=${adminPayload}.${adminSig}`};
    const sync=await req('/api/admin/pricing/sync',{method:'POST',headers:adminCookie});
    assert.equal(sync.status,200,`manual provider service sync should run: ${JSON.stringify(sync.data)}`);
    assert.equal(sync.data.ok,true,`provider catalog sync should succeed: ${JSON.stringify(sync.data)}`);
    assert(sync.data.updated>=1,'existing services should receive current supplier prices');
    assert(sync.data.imported>=1,'new provider service should be imported');
    assert.equal(sync.data.unavailable,0,'a missing ID alone must not disable a catalog service');assert(sync.data.unverified>=1,'missing provider IDs should be reported as unverified');assert(sync.data.recovered>=1,'services hidden by the old auto-check reason should be recovered');
    const syncedCatalog=JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'));
    assert.equal(syncedCatalog['svc-test'].providerRateUsd,5,'service provider cost must update to the live mock rate');
    assert.equal(syncedCatalog['svc-test'].sellingUsd,10,'100 percent markup means sale price is twice live provider cost');
    assert.equal(syncedCatalog['svc-removed'].providerAvailable,true,"old transient auto-hidden flag should be recovered without overriding the site's active flag");assert.equal(syncedCatalog['svc-removed'].availabilityStatus,'available');assert.equal(syncedCatalog['svc-admin-disabled'].active,false,'explicit site admin disable flag must be preserved');assert.equal(syncedCatalog['svc-admin-disabled'].providerAvailable,false,'recovery must not override an explicitly disabled service');
    const importedKey=Object.keys(syncedCatalog).find(k=>syncedCatalog[k]?.providerServiceId==='78');
    assert(importedKey,'new service should be imported');assert.equal(syncedCatalog[importedKey].providerRateUsd,3);assert.equal(syncedCatalog[importedKey].sellingUsd,6);
    const freshKeyResponse=await req('/api/user/api-key',{method:'POST',headers:{Cookie:cookie}});
    assert.equal(freshKeyResponse.status,200,`a fresh test key is needed after revocation: ${JSON.stringify(freshKeyResponse.data)}`);
    const freshKey=String(freshKeyResponse.data.apiKey||'');assert.match(freshKey,/^sr_[A-Za-z0-9_-]{30,}$/);
    const beforeApiDiscountBalance=Number(rootDb.users.tester.balance);const beforeApiDiscountProviderCalls=providerAddCalls;rootDb.users.tester.discountPct=10;
    const apiDiscountAttempt=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'add',key:freshKey,service:'1001',link:'https://example.com/discount-api-test',quantity:'10',idempotency_key:'DISCOUNT_BELOW_MARKUP_TEST'}).toString()});
    assert.equal(apiDiscountAttempt.status,422,`API sale below required 100% markup must be blocked: ${JSON.stringify(apiDiscountAttempt.data)}`);
    assert.equal(apiDiscountAttempt.data.stage,'sale_below_required_markup');assert.equal(Number(rootDb.users.tester.balance),beforeApiDiscountBalance);assert.equal(providerAddCalls,beforeApiDiscountProviderCalls);
    rootDb.users.tester.discountPct=0;
    const beforeWebsiteDiscountBalance=Number(rootDb.users.tester.balance);const beforeWebsiteDiscountProviderCalls=providerAddCalls;rootDb.users.tester.discountPct=10;
    const websiteDiscountAttempt=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:'1001',providerServiceId:'77',firebaseServiceKey:'svc-test',link:'https://example.com/discount-site-test',quantity:100,localId:'discount-below-markup-site-test'})});
    assert.equal(websiteDiscountAttempt.status,422,`website sale below required 100% markup must be blocked: ${JSON.stringify(websiteDiscountAttempt.data)}`);
    assert.equal(websiteDiscountAttempt.data.stage,'sale_below_provider_cost');assert.equal(Number(rootDb.users.tester.balance),beforeWebsiteDiscountBalance);assert.equal(providerAddCalls,beforeWebsiteDiscountProviderCalls);
    rootDb.users.tester.discountPct=0;
    console.log('PASS runtime: discounts that would reduce real markup below 100% are rejected before wallet debit/provider dispatch for both API and website orders');
    const beforeWebsiteOrderBalance=Number(rootDb.users.tester.balance);const beforeWebsiteOrderProviderCalls=providerAddCalls;
    const websiteOrder=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:'1001',providerServiceId:'77',firebaseServiceKey:'svc-test',link:'https://example.com/mock-post',quantity:100,localId:'website-order-profit-test'})});
    assert.equal(websiteOrder.status,200,`a correctly priced website order should succeed in mock environment: ${JSON.stringify(websiteOrder.data)}`);
    assert.equal(websiteOrder.data.ok,true);assert.equal(websiteOrder.data.chargeUsd,1);
    assert.equal(providerAddCalls,beforeWebsiteOrderProviderCalls+1,'a valid website order should dispatch exactly once');
    const websiteOrderRows=JSON.parse(fs.readFileSync(path.join(dataDir,'orders.json'),'utf8'));
    const orderWithProfit=websiteOrderRows.find(o=>String(o.id)==='website-order-profit-test');assert(orderWithProfit,'financial order must be persisted locally');
    assert.equal(orderWithProfit.providerRateUsd,5);assert.equal(orderWithProfit.providerCostUsd,0.5);assert.equal(orderWithProfit.chargeUsd,1);assert.equal(orderWithProfit.grossProfitUsd,0.5);assert.equal(orderWithProfit.actualMarkupPct,100);assert.equal(orderWithProfit.profitMarginPct,50);
    assert(Number(rootDb.users.tester.balance)<beforeWebsiteOrderBalance,'valid website order should reserve the actual customer charge');
    console.log('PASS runtime: website order persisted live supplier cost, charged sale, gross profit, 100% markup and 50% margin');
    const syncedServices=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'services',key:freshKey}).toString()});
    assert.equal(syncedServices.status,200);assert(syncedServices.data.some(x=>x.id==='1002'),'catalog service must not disappear just because provider sync omitted it');
    const apiRemovedBalance=Number(rootDb.users.tester.balance),apiRemovedCalls=providerAddCalls;
    const apiRemovedOrder=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'add',key:freshKey,service:'1002',link:'https://example.com/removed-api-service',quantity:'10',idempotency_key:'REMOVED_PROVIDER_SERVICE_TEST'}).toString()});
    assert.equal(apiRemovedOrder.status,409,`an unverified service should fail closed for this order: ${JSON.stringify(apiRemovedOrder.data)}`);assert.equal(apiRemovedOrder.data.stage,'provider_service_unavailable');
    assert.equal(Number(rootDb.users.tester.balance),apiRemovedBalance,'unverified API service must not reserve funds');assert.equal(providerAddCalls,apiRemovedCalls,'unverified API service must not be dispatched');assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'))['svc-removed'].providerAvailable,true,'order-time provider mismatch must not persist a hidden flag');
    console.log('PASS runtime: missing service ID remains visible, but orders fail closed without debiting or dispatching');
    const balanceBeforeBlockedOrder=Number(rootDb.users.tester.balance);const providerCallsBeforeBlockedOrder=providerAddCalls;
    const blockedOrder=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:'1002',providerServiceId:'88',firebaseServiceKey:'svc-removed',link:'https://example.com/post',quantity:100,localId:'blocked-removed-service-test'})});
    assert.equal(blockedOrder.status,409,`order for an unverified supplier service must be rejected: ${JSON.stringify(blockedOrder.data)}`);
    assert.equal(blockedOrder.data.stage,'provider_service_unavailable');
    assert.equal(Number(rootDb.users.tester.balance),balanceBeforeBlockedOrder,'unavailable-service rejection must not debit the wallet');
    assert.equal(providerAddCalls,providerCallsBeforeBlockedOrder,'unavailable-service rejection must not dispatch an order to provider');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'))['svc-removed'].providerAvailable,true,'website order failure must not turn the persistent service off');console.log('PASS runtime: a temporarily missing supplier ID fails closed per order without disabling the saved service');
    console.log('PASS runtime: live mock sync refreshes prices, imports new services, and keeps unmatched services enabled while blocking unverified orders');

    const diag=await req('/api/admin/api-key-diagnostics',{headers:adminCookie});
    assert.equal(diag.status,200,`admin diagnostics should be readable in test: ${JSON.stringify(diag.data)}`);
    assert.equal(diag.data.database.source,'railway-environment');assert.equal(diag.data.keys.firebaseRecordCount,2);assert.equal(diag.data.users.firebaseRecordCount,1);
    assert(!JSON.stringify(diag.data).includes(apiKey),'diagnostics must not expose the API key');
    console.log('PASS runtime: admin diagnostics confirm Firebase records without exposing key material');

    rootDb.orders['summary-completed']={id:'summary-completed',user:'tester',status:'completed',totalIQD:2500,createdAt:'2026-10-13T10:00:00.000Z'};
    rootDb.orders['summary-pending']={id:'summary-pending',user:'tester',status:'pending',total:1000,createdAt:'2026-10-13T10:01:00.000Z'};
    const summary=await req('/api/user/summary',{headers:{Cookie:cookie}});
    assert.equal(summary.status,200,`user summary should load: ${JSON.stringify(summary.data)}`);
    assert(summary.data.orders>=2,'summary should count actual owned Firebase orders');
    assert(summary.data.completedOrders>=1,'summary should normalize completed status');
    assert(summary.data.spentIQD>=3500,'summary should sum actual stored order charge values');
    console.log('PASS runtime: user summary calculates real order, completed-order and spend values from Firebase');

    const channel=await req('/api/admin/site-links',{headers:{Cookie:`sadairaq_sid=${adminPayload}.${adminSig}`}});
    assert.equal(channel.status,200,`admin channel setting should read: ${JSON.stringify(channel.data)}`);
    const savedChannel=await req('/api/admin/site-links',{method:'POST',headers:{Cookie:`sadairaq_sid=${adminPayload}.${adminSig}`,'Content-Type':'application/json'},body:JSON.stringify({telegramChannelUrl:'https://t.me/sada_test_channel'})});
    assert.equal(savedChannel.status,200,`channel URL should persist and verify: ${JSON.stringify(savedChannel.data)}`);
    assert.equal(savedChannel.data.telegramChannelUrl,'https://t.me/sada_test_channel');
    assert.equal(rootDb.config.telegramChannelUrl,'https://t.me/sada_test_channel');
    console.log('PASS runtime: Telegram sidebar channel URL is editable and read-verified in Firebase');

    const apiAdminHash=crypto.createHash('sha256').update('sr_mock_admin_listing_key_value').digest('hex');
    rootDb.apiKeys[apiAdminHash]={username:'tester',createdAt:'2026-10-13T10:02:00.000Z',masked:'sr_mock…alue',keyHash:apiAdminHash,status:'active',scopes:['services','balance'],encrypted:'secret-must-never-be-returned'};
    const apiAdmin=await req('/api/admin/api-users',{headers:{Cookie:`sadairaq_sid=${adminPayload}.${adminSig}`}});
    assert.equal(apiAdmin.status,200,`admin API key list should load: ${JSON.stringify(apiAdmin.data)}`);
    const row=apiAdmin.data.keys.find(x=>x.keyHash===apiAdminHash);assert(row);assert.equal(row.username,'tester');assert.equal(row.status,'active');
    assert(!JSON.stringify(apiAdmin.data).includes('secret-must-never-be-returned'),'admin listing must not expose encrypted API secret');
    const apiRevoke=await req('/api/admin/api-users/revoke',{method:'POST',headers:{Cookie:`sadairaq_sid=${adminPayload}.${adminSig}`,'Content-Type':'application/json'},body:JSON.stringify({keyHash:apiAdminHash})});
    assert.equal(apiRevoke.status,200,`admin revoke should verify in Firebase: ${JSON.stringify(apiRevoke.data)}`);assert.equal(rootDb.apiKeys[apiAdminHash].status,'revoked');assert(rootDb.apiKeys[apiAdminHash].revokedAt);
    console.log('PASS runtime: admin API developer section lists safe key metadata and verifies revocation in Firebase');
  } finally {
    app.kill('SIGTERM');await Promise.race([new Promise(resolve=>app.once('exit',resolve)),wait(3000)]);if(app.exitCode===null)app.kill('SIGKILL');
    await close(provider);await close(db);fs.rmSync(tempDir,{recursive:true,force:true});
  }
  if(providerAddCalls!==2)throw new Error('Mock provider should receive exactly two add actions total: one API test and one verified site order');
  console.log(`PASS end-to-end API runtime checks including summary, Telegram URL, admin API listing/revocation; mock provider actions: ${providerSeen.join(', ')}`);
}
main().catch(error=>{console.error('FAIL API runtime smoke:',error&&error.stack||error);process.exitCode=1;});
