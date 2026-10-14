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
function setAt(root,parts,value){if(!parts.length){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('root must remain an object');for(const key of Object.keys(root))delete root[key];Object.assign(root,clone(value));return;}let x=root;for(const part of parts.slice(0,-1)){if(!x[part]||typeof x[part]!=='object'||Array.isArray(x[part]))x[part]={};x=x[part];}const last=parts[parts.length-1];if(value===null)delete x[last];else x[last]=clone(value);}
async function requestJson(url,opts={}){const response=await fetch(url,opts);const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{data={raw:text};}return {status:response.status,data,headers:response.headers};}
async function main(){
  const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'sada-api-smoke-'));
  const rootDb={users:{tester:{username:'tester',email:'tester@example.com',balance:100000,discountPct:0}},orders:{},apiKeys:{},categoryMeta:{'RemoteOnlyCategory':{name:'Provider Ghost Category',image:'provider-generated.png'}}};
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
        const value=bodyText?JSON.parse(bodyText):{};
        if(parts.length===0){for(const [patchPath,patchValue] of Object.entries(value)){const relative=patchPath.split('/').filter(Boolean);if(relative.length)setAt(rootDb,relative,patchValue);else if(patchValue===null)delete rootDb[patchPath];else rootDb[patchPath]=clone(patchValue);}dbVersion++;res.statusCode=200;res.setHeader('Content-Type','application/json');res.setHeader('ETag',`"${dbVersion}"`);res.end(JSON.stringify(clone(rootDb)));return;}
        const current=getAt(rootDb,parts)||{};const next={...current,...value};setAt(rootDb,parts,next);dbVersion++;res.statusCode=200;res.setHeader('Content-Type','application/json');res.setHeader('ETag',`"${dbVersion}"`);res.end(JSON.stringify(next));return;
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
  const initialServices={
    'svc-test':{fbKey:'svc-test',siteServiceId:'1001',providerId:'mock-provider',providerServiceId:'77',smmpartyId:'77',serviceId:'1001',name:'Safe mock test service',category:'Test',sellingUsd:5,providerRateUsd:2.5,markupPct:100,min:1,max:1000,active:true,refill:false,cancel:true,type:'default'},
    'svc-removed':{fbKey:'svc-removed',siteServiceId:'1002',providerId:'mock-provider',providerServiceId:'88',smmpartyId:'88',serviceId:'1002',name:'Previously hidden by unsafe auto-check',category:'Test',sellingUsd:4,providerRateUsd:2,min:1,max:1000,active:true,providerAvailable:false,availabilityStatus:'unavailable',providerAvailabilityReason:'not_found_in_live_supplier_catalog',refill:false,cancel:true,type:'default'},
    'svc-admin-disabled':{fbKey:'svc-admin-disabled',siteServiceId:'1003',providerId:'mock-provider',providerServiceId:'77',smmpartyId:'77',serviceId:'1003',name:'Manually disabled by site admin',category:'ManualDisableTest',sellingUsd:4,providerRateUsd:2,min:1,max:1000,active:false,providerAvailable:false,availabilityStatus:'unavailable',providerAvailabilityReason:'not_found_in_live_supplier_catalog',refill:false,cancel:true,type:'default'},
    'svc_auto_unapproved_test':{fbKey:'svc_auto_unapproved_test',siteServiceId:'1004',providerId:'mock-provider',providerServiceId:'79',smmpartyId:'79',serviceId:'1004',name:'Unapproved automatic import test',category:'MustStayHidden',sellingUsd:6,providerRateUsd:3,min:1,max:1000,active:true,source:'provider-live-sync',providerAvailable:true,availabilityStatus:'available',refill:false,cancel:true,type:'default'}
  };
  // Simulate a legacy release that accidentally filled the active catalog with a provider's entire list.
  for(let i=0;i<1200;i++){const k='svc_auto_bulk_'+i;initialServices[k]={fbKey:k,providerId:'mock-provider',providerServiceId:String(10000+i),smmpartyId:String(10000+i),serviceId:String(10000+i),name:'Legacy bulk service '+i,category:'Bulk provider section',groups:['Bulk provider section'],sellingUsd:1,providerRateUsd:.5,min:1,max:1000,active:true,source:'provider-live-sync',providerAvailable:true,availabilityStatus:'available'};}
  fs.writeFileSync(path.join(dataDir,'services.json'),JSON.stringify(initialServices));
  // This legacy compatibility mirror must never be promoted into the active service catalog on read.
  fs.writeFileSync(path.join(dataDir,'api_services.json'),JSON.stringify([{fbKey:'legacy-api-only',providerId:'mock-provider',providerServiceId:'666',smmpartyId:'666',siteServiceId:'6666',serviceId:'6666',name:'Legacy mirror only',category:'MustNotAutoImport',sellingUsd:1,providerRateUsd:0.5,source:'legacy-api-cache',active:true}]));
  fs.writeFileSync(path.join(dataDir,'category_meta.json'),JSON.stringify({
    'Test':{name:'Test',description:'Locally managed section'},
    'MustStayHidden':{name:'MustStayHidden',image:'sadairaq-logo.jpg',serviceKeys:['svc_auto_unapproved_test']},
    'BulkProviderSection':{name:'Bulk provider section',image:'sadairaq-logo.jpg',serviceKeys:Array.from({length:1200},(_,i)=>'svc_auto_bulk_'+i)}
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
    assert.equal(health.version,'1.6.41');
    assert.equal(health.deploymentConsistent,true,'all packaged UI/server build markers must match');
    assert.equal(health.firebaseDatabaseSource,'railway-environment','explicit Firebase URL must win in production/test config resolution');
    console.log('PASS runtime: explicit database URL is the same target used by API routes');

    async function loginAsAdmin(password){
      const challenge=await req('/api/auth/captcha');
      assert.equal(challenge.status,200,`admin login captcha should issue: ${JSON.stringify(challenge.data)}`);
      const match=String(challenge.data.question||'').match(/(\d+)\s*\+\s*(\d+)/);
      assert(match,'math captcha should contain two operands');
      return req('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:JSON.parse(fs.readFileSync(path.join(__dirname,'admin-auth.json'),'utf8')).email,password,captchaId:challenge.data.captchaId,captchaAnswer:String(Number(match[1])+Number(match[2]))})});
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
    assert(Array.isArray(services.data));const safeApiService=services.data.find(x=>String(x.id)==='1001');assert(safeApiService,'canonical active service ID 1001 must remain in the API list even with many pre-existing services');assert.equal(safeApiService.name,'Safe mock test service');
    assert(!services.data.some(x=>String(x.id)==='6666'||String(x.name)==='Legacy mirror only'),'API read must not automatically import rows that exist only in api_services.json');
    assert(!Object.values(JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'))).some(x=>String(x?.providerServiceId||'')==='666'||String(x?.name)==='Legacy mirror only'),'legacy API mirror must not be copied into the active website catalog');
    console.log('PASS runtime: services action returns canonical IDs and never imports api_services.json-only rows automatically');

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
    const freeServiceList=await req('/api/admin/free-services',{headers:adminCookie});
    assert.equal(freeServiceList.status,200,`admin free-service manager must load instead of failing when providerStore returns a Set: ${JSON.stringify(freeServiceList.data)}`);
    assert.equal(freeServiceList.data.ok,true);
    assert(freeServiceList.data.providers.some(p=>p.id==='mock-provider'&&p.configured===true),'configured supplier must appear in the custom free-service dropdown');
    assert(Array.isArray(freeServiceList.data.services),'custom free-service manager must return an empty or populated list');
    console.log('PASS runtime: admin free-services GET returns providers and records without Set/includes crash');
    const manualServiceListBefore=await req('/api/admin/manual-services',{headers:adminCookie});
    assert.equal(manualServiceListBefore.status,200,`manual-support services manager should load independently: ${JSON.stringify(manualServiceListBefore.data)}`);
    assert(Array.isArray(manualServiceListBefore.data.services),'manual-support administration must return an array');
    console.log('PASS runtime: admin manual-service API loads without requiring or exposing supplier credentials');
    const sync=await req('/api/admin/pricing/sync',{method:'POST',headers:adminCookie});
    assert.equal(sync.status,200,`manual provider service sync should run: ${JSON.stringify(sync.data)}`);
    assert.equal(sync.data.ok,true,`provider catalog sync should succeed: ${JSON.stringify(sync.data)}`);
    assert(sync.data.updated>=1,'existing services should receive current supplier prices');
    assert.equal(sync.data.imported,0,'automatic price sync must never import any provider service');
    assert(sync.data.newServicesRequireApproval>=1,'new provider services must be counted as awaiting explicit administrator approval');
    assert.equal(sync.data.unavailable,0,'a missing ID alone must not disable a catalog service');assert(sync.data.unverified>=1,'missing provider IDs should be reported as unverified');assert(sync.data.recovered>=1,'services hidden by the old auto-check reason should be recovered');
    const syncedCatalog=JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'));
    assert.equal(syncedCatalog['svc-test'].providerRateUsd,5,'service provider cost must update to the live mock rate');
    assert.equal(syncedCatalog['svc-test'].sellingUsd,10,'100 percent markup means sale price is twice live provider cost');
    assert.equal(syncedCatalog['svc-removed'].providerAvailable,true,"old transient auto-hidden flag should be recovered without overriding the site's active flag");assert.equal(syncedCatalog['svc-removed'].availabilityStatus,'available');assert.equal(syncedCatalog['svc-admin-disabled'].active,false,'explicit site admin disable flag must be preserved');assert.equal(syncedCatalog['svc-admin-disabled'].providerAvailable,false,'recovery must not override an explicitly disabled service');
    assert.equal(Object.keys(syncedCatalog).some(k=>String(syncedCatalog[k]?.providerServiceId)==='78'),false,'a new provider service must not be added by automatic price sync');
    assert(syncedCatalog['svc_auto_unapproved_test'],'legacy provider rows must not be deleted automatically during startup or price sync');
    assert.equal(Object.keys(syncedCatalog).filter(k=>k.startsWith('svc_auto_bulk_')).length,1200,'all 1200 existing provider rows must remain in the live catalog');
    const quarantinedArchive=fs.existsSync(path.join(dataDir,'quarantined_provider_services.json'))?JSON.parse(fs.readFileSync(path.join(dataDir,'quarantined_provider_services.json'),'utf8')):{};
    assert.equal(Object.keys(quarantinedArchive).length,0,'ordinary startup, catalog reads, and automatic sync must not move existing rows into an archive');
    const catalogSettings=fs.existsSync(path.join(dataDir,'catalog_settings.json'))?JSON.parse(fs.readFileSync(path.join(dataDir,'catalog_settings.json'),'utf8')):{};
    assert.equal(catalogSettings.providerAutoImportQuarantineVersion,undefined,'non-destructive release must not mark destructive quarantine as completed');
    const cleanedMeta=JSON.parse(fs.readFileSync(path.join(dataDir,'category_meta.json'),'utf8'));
    assert(cleanedMeta.MustStayHidden,'existing category metadata must be retained when provider rows are not imported or deleted');
    assert(cleanedMeta.BulkProviderSection,'large existing provider category must remain available instead of being pruned automatically');
    assert.equal(cleanedMeta.Test.name,'Test','user-managed section metadata must be preserved');
    const defaultCatalog=await req('/api/catalog?path=services',{headers:adminCookie});
    assert.equal(defaultCatalog.status,200);assert(defaultCatalog.data.value?.svc_auto_unapproved_test,'default catalog should retain the previously saved provider service without a background migration');
    const inspectQuarantine=await req('/api/catalog?path=services&includeUnapprovedAutoImports=1',{headers:adminCookie});
    assert.equal(inspectQuarantine.status,200);assert(inspectQuarantine.data.value?.svc_auto_unapproved_test,'administrator catalogue reads should remain non-destructive regardless of archive-inspection flag');
    const sectionMeta=await req('/api/catalog?path=categoryMeta',{headers:adminCookie});
    assert.equal(sectionMeta.status,200);assert.equal(sectionMeta.data.value?.RemoteOnlyCategory,undefined,'legacy Firebase-only category metadata must not create phantom sections');assert.equal(sectionMeta.data.value?.Test?.name,'Test','local category metadata must remain available');
    const beforeServiceSyncCount=Object.keys(syncedCatalog).length;
    const unapprovedSync=await req('/api/admin/service-sync',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({services:[{fbKey:'should-not-auto-add',id:'90',providerId:'mock-provider',providerServiceId:'90',name:'Must not auto add',sellingUsd:2}]})});
    assert.equal(unapprovedSync.status,200);assert.equal(unapprovedSync.data.skippedUnapprovedNew,1,'legacy catalog refresh must skip new rows unless explicitly added through the selected-service importer');
    const afterServiceSyncCatalog=JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'));
    assert.equal(Object.keys(afterServiceSyncCatalog).length,beforeServiceSyncCount,'background/compat catalog refresh must not grow the service catalog');assert.equal(Object.values(afterServiceSyncCatalog).some(v=>String(v?.providerServiceId)==='90'),false);
    const explicitImport=await req('/api/admin/services/import',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({destination:'Test',categoryKey:'Test',categoryMeta:{name:'Test'},services:[{data:{providerId:'mock-provider',providerServiceId:'99',smmpartyId:'99',name:'Manually approved mock service',sellingUsd:2,category:'Test',groups:['Test'],min:1,max:1000}}]})});
    assert.equal(explicitImport.status,200,`explicit selected-service import should still work: ${JSON.stringify(explicitImport.data)}`);assert.equal(explicitImport.data.added,1);
    const afterExplicitImport=JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'));
    const importedEntry=Object.entries(afterExplicitImport).find(([,v])=>String(v?.providerServiceId||'')==='99'&&v.name==='Manually approved mock service');
    assert(importedEntry,'explicit admin import must remain available');
    assert(rootDb.services?.[importedEntry[0]],'every manually imported service must be written into Firebase services before the endpoint returns success');
    assert(rootDb.categoryMeta?.Test?.name==='Test','section metadata associated with the manually imported service must be stored in Firebase');
    console.log('PASS runtime: manual service import is persisted and visible in Firebase before returning success');
    const deleteImported=await req('/api/admin/catalog',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({path:'services/'+importedEntry[0],mode:'remove'})});
    assert.equal(deleteImported.status,200,`manual service deletion should be Firebase-verified: ${JSON.stringify(deleteImported.data)}`);
    assert.equal(rootDb.services?.[importedEntry[0]],undefined,'deleting a service must remove its exact record from Firebase services');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'))[importedEntry[0]],undefined,'deleted service must also be removed from the server cache');
    console.log('PASS runtime: deleting a service removes the Firebase record and the local cache row');
    const sectionName='Firebase Section Deletion Smoke',sectionKey='firebase_section_deletion_smoke';
    const madeSection=await req('/api/admin/catalog/sections',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'create',sections:[{name:sectionName,platforms:['Instagram']}]})});
    assert.equal(madeSection.status,200,`section creation must be persisted to Firebase: ${JSON.stringify(madeSection.data)}`);
    assert.equal(rootDb.categoryMeta?.[sectionKey]?.name,sectionName,'new sections must be stored in Firebase categoryMeta');
    assert((rootDb.settings?.catalogOrder?.categories||[]).includes(sectionName),'new sections must be stored in Firebase catalog order');
    const sectionService=await req('/api/admin/services/import',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({destination:sectionName,categoryKey:sectionKey,categoryMeta:{name:sectionName},services:[{data:{providerId:'mock-provider',providerServiceId:'98',smmpartyId:'98',name:'Firebase section deletion test service',sellingUsd:2,category:sectionName,groups:[sectionName],min:1,max:1000}}]})});
    assert.equal(sectionService.status,200,`service for deletion test must be saved to Firebase: ${JSON.stringify(sectionService.data)}`);
    const sectionServiceEntry=Object.entries(rootDb.services||{}).find(([,v])=>String(v?.providerServiceId||'')==='98');
    assert(sectionServiceEntry,'service associated with the new section must exist in Firebase before deletion');
    const deletedSection=await req('/api/admin/catalog/sections',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'delete',name:sectionName,confirmation:'DELETE_SECTION'})});
    assert.equal(deletedSection.status,200,`section deletion must be Firebase-verified: ${JSON.stringify(deletedSection.data)}`);
    assert.equal(rootDb.categoryMeta?.[sectionKey],undefined,'deleted section metadata must be removed from Firebase');
    assert.equal(rootDb.services?.[sectionServiceEntry[0]],undefined,'service belonging exclusively to deleted section must be removed from Firebase');
    assert(!(rootDb.settings?.catalogOrder?.categories||[]).includes(sectionName),'deleted section must be removed from Firebase category ordering');
    console.log('PASS runtime: section creation, service import and section deletion update Firebase metadata, service rows and order');
    const restoreArchived=await req('/api/admin/services/import',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({destination:'Test',categoryKey:'Test',categoryMeta:{name:'Test'},services:[{data:{providerId:'mock-provider',providerServiceId:'79',smmpartyId:'79',name:'Admin reapproved archived service',sellingUsd:6,category:'Test',groups:['Test'],min:1,max:1000}}]})});
    assert.equal(restoreArchived.status,200,`explicit import should be able to restore a quarantined service: ${JSON.stringify(restoreArchived.data)}`);assert.equal(restoreArchived.data.updated,1,'manual selection upgrades the existing legacy row in-place');assert.equal(restoreArchived.data.restoredArchived,0,'no archive should be created by automatic migration');
    const afterRestore=JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'));
    assert.equal(Object.values(afterRestore).some(v=>String(v?.providerServiceId)==='79'&&v.explicitlyApprovedAt&&v.unapprovedAutoImport!==true),true,'explicit admin selection should restore the archived row without auto-import');
    assert.equal(afterRestore['svc_auto_unapproved_test'].explicitlyApprovedAt?true:false,true,'manually selected legacy rows are explicitly approved in-place');assert.equal(fs.existsSync(path.join(dataDir,'quarantined_provider_services.json')),false,'no archive is generated by automatic catalog cleanup');
    console.log('PASS runtime: no provider auto-import or automatic catalog deletion; previous rows/categories stay stable and explicit selected import works');
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

    // Administrator-funded free offers live in a separate store; supplier-free/paid catalog services remain unchanged.
    const addFreeService=await req('/api/admin/free-services',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'save',providerId:'mock-provider',providerServiceId:'77',name:'Admin funded free mock',category:'Test',platform:'Instagram',min:10,max:20,perAccountLimit:2,description:'Free to users; supplier cost paid by site.'})});
    assert.equal(addFreeService.status,200,`admin should be able to save an admin-funded free service: ${JSON.stringify(addFreeService.data)}`);
    assert.equal(addFreeService.data.service.adminFreeService,true);assert.equal(addFreeService.data.service.sellingUsd,0);assert.equal(addFreeService.data.service.providerRateUsd,5);assert.equal(addFreeService.data.service.perAccountLimit,2);
    const customFree=addFreeService.data.service,customFreeKey=String(customFree.key),customSiteId=String(customFree.siteServiceId);assert.match(customSiteId,/^\d{4}$/,'admin-funded free service uses a four-digit internal Sada Iraq ID');assert.equal(String(customFree.providerServiceId),'77','original provider service ID remains unchanged');
    const publicCatalog=await req('/api/catalog?path=services',{headers:{Cookie:cookie}});assert.equal(publicCatalog.status,200);
    const publicFree=publicCatalog.data.value[customFreeKey];assert(publicFree,'admin-funded free offer should appear in the website catalog');assert.equal(publicFree.adminFreeService,true);assert.equal(publicFree.sellingUsd,0);assert.equal(publicFree.providerRateUsd,undefined,'supplier USD rate must not leak to public catalog');assert.equal(publicFree.basePrice,undefined,'supplier converted cost must not leak to public catalog');
    const callsBeforeInvalidFree=providerAddCalls;
    const invalidFreeQty=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:customSiteId,providerServiceId:'77',firebaseServiceKey:customSiteId,link:'https://example.com/free-min-invalid',quantity:9,localId:'free-min-invalid'})});
    assert.equal(invalidFreeQty.status,422,'a custom free service must enforce its own minimum quantity');assert.equal(providerAddCalls,callsBeforeInvalidFree,'invalid free quantity must not reach provider');
    const freeBalanceBefore=Number(rootDb.users.tester.balance),freeCallsBefore=providerAddCalls;
    const freeOrder1=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:customSiteId,providerServiceId:'77',firebaseServiceKey:customSiteId,link:'https://example.com/free-order-1',quantity:10,localId:'admin-free-order-1'})});
    assert.equal(freeOrder1.status,200,`first admin-funded free order should succeed: ${JSON.stringify(freeOrder1.data)}`);assert.equal(freeOrder1.data.chargeUsd,0);assert.equal(freeOrder1.data.providerServiceId,'77');assert.equal(Number(rootDb.users.tester.balance),freeBalanceBefore,'admin-funded free order must not debit the member');assert.equal(providerAddCalls,freeCallsBefore+1,'free offer still must call the upstream supplier');
    const freeOrder2=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:customSiteId,providerServiceId:'77',firebaseServiceKey:customSiteId,link:'https://example.com/free-order-2',quantity:20,localId:'admin-free-order-2'})});
    assert.equal(freeOrder2.status,200,`second admin-funded free order should still be allowed within the limit: ${JSON.stringify(freeOrder2.data)}`);assert.equal(freeOrder2.data.chargeUsd,0);assert.equal(providerAddCalls,freeCallsBefore+2);
    const limitedFree=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:customSiteId,providerServiceId:'77',firebaseServiceKey:customSiteId,link:'https://example.com/free-order-3',quantity:10,localId:'admin-free-order-3'})});
    assert.equal(limitedFree.status,429,`third order should be limited for this specific service within 24 hours: ${JSON.stringify(limitedFree.data)}`);assert.equal(limitedFree.data.stage,'free_service_limit');assert.equal(providerAddCalls,freeCallsBefore+2,'over-limit request must never reach the provider');
    const freeOrderRows=JSON.parse(fs.readFileSync(path.join(dataDir,'orders.json'),'utf8'));const savedFreeOrder=freeOrderRows.find(o=>String(o.id)==='admin-free-order-1');assert(savedFreeOrder);assert.equal(savedFreeOrder.serviceKind,'admin_funded_free');assert.equal(savedFreeOrder.providerRateUsd,5);assert.equal(savedFreeOrder.providerCostUsd,0.05);assert.equal(savedFreeOrder.chargeUsd,0);assert.equal(savedFreeOrder.providerServiceId,'77');
    assert(Array.isArray(rootDb.users.tester.sadaAdminFreeServiceUsage?.[crypto.createHash('sha256').update(customFreeKey).digest('hex').slice(0,40)]),'per-account service usage must be stored atomically on that account in Firebase');
    console.log('PASS runtime: admin-funded free service sends paid provider orders, charges users zero, hides supplier cost and enforces its own Firebase-backed 24-hour limit');

    const afterFreeBalance=Number(rootDb.users.tester.balance),callsBeforePaidAfterFree=providerAddCalls;
    const paidAfterFree=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:'1001',providerServiceId:'77',firebaseServiceKey:'svc-test',link:'https://example.com/paid-after-free',quantity:100,localId:'paid-after-free-test'})});
    assert.equal(paidAfterFree.status,200,`ordinary paid service must still work after setting up a separate free offer: ${JSON.stringify(paidAfterFree.data)}`);assert.equal(paidAfterFree.data.chargeUsd,1);assert.equal(providerAddCalls,callsBeforePaidAfterFree+1);assert(Number(rootDb.users.tester.balance)<afterFreeBalance,'ordinary paid service still debits the user according to its normal price');
    const deleteFree=await req('/api/admin/free-services',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'delete',key:customFreeKey})});assert.equal(deleteFree.status,200);
    const callsBeforeStaleFree=providerAddCalls;
    const staleFreeOrder=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:customSiteId,providerServiceId:'77',firebaseServiceKey:customSiteId,link:'https://example.com/stale-deleted-free-offer',quantity:10,localId:'deleted-free-stale-test'})});
    assert.equal(staleFreeOrder.status,409,'a stale deleted free-service listing must not fall through to a same-provider paid catalog service');assert.equal(providerAddCalls,callsBeforeStaleFree,'deleted service stale request must not be forwarded');
    console.log('PASS runtime: deleting custom free offer does not delete or redirect the matching normal provider service');

    // Manually fulfilled services use a separate store, charge the site customer according to the configured rate,
    // create a normal public order number/support message, and never make an upstream supplier call.
    const addManual=await req('/api/admin/manual-services',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'save',name:'Manual TikTok support mock',description:'Send the request message to support.',platform:'Tiktok',category:'خدمات خاصة',sellingUsd:10,min:1,max:100,perAccountLimit:1,enabled:true})});
    assert.equal(addManual.status,200,`manual-support service should save: ${JSON.stringify(addManual.data)}`);
    const manual=addManual.data.service,manualKey=String(manual.key),manualSiteId=String(manual.siteServiceId);
    assert.match(manualKey,/^manual_[a-f0-9]{24}$/);assert.match(manualSiteId,/^\d{4}$/,'manual service uses a four-digit internal ID');assert.equal(manual.serviceKind,'manual_support');assert.equal(manual.providerId,'manual-support');assert.equal(manual.sellingUsd,10);
    const manualCatalog=await req('/api/catalog?path=services',{headers:{Cookie:cookie}});
    assert.equal(manualCatalog.status,200);const catalogManual=manualCatalog.data.value[manualKey];assert(catalogManual,'manual-support service must appear in the selected site section');assert.equal(catalogManual.adminManualService,true);assert.equal(catalogManual.category,'خدمات خاصة');assert.equal(catalogManual.providerRateUsd,undefined,'manual service must not leak a supplier cost');
    const manualDetail=await req('/api/catalog?path=services/'+encodeURIComponent(manualKey),{headers:{Cookie:cookie}});assert.equal(manualDetail.status,200);assert.equal(manualDetail.data.value.siteServiceId,manualSiteId);
    const providerCallsBeforeManual=providerAddCalls,balanceBeforeManual=Number(rootDb.users.tester.balance);
    const manualRequestBody={providerId:'manual-support',serviceKind:'manual_support',manualService:true,manualServiceKey:manualKey,siteServiceId:manualSiteId,serviceId:manualSiteId,link:'https://tiktok.com/@sample-account',quantity:100,localId:'manual-support-order-1'};
    const manualOrder=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(manualRequestBody)});
    assert.equal(manualOrder.status,200,`manual order should be created without supplier integration: ${JSON.stringify(manualOrder.data)}`);
    assert.equal(manualOrder.data.ok,true);assert.match(String(manualOrder.data.publicOrderNo),/^\d{4,}$/);assert.equal(manualOrder.data.chargeUsd,1);assert.equal(manualOrder.data.totalIQD,1250);assert.equal(providerAddCalls,providerCallsBeforeManual,'manual-support order must never call provider API');assert.equal(Number(rootDb.users.tester.balance),balanceBeforeManual-1250,'manual service fee should be charged to user wallet once');
    const supportMessage=String(manualOrder.data.supportMessage||'');assert(supportMessage.includes('#'+manualOrder.data.publicOrderNo));assert(supportMessage.includes('Manual TikTok support mock'));assert(supportMessage.includes('https://tiktok.com/@sample-account'));assert(supportMessage.includes('💵 السعر: $1.00'));assert(supportMessage.includes('أرسل هذه الرسالة كاملة للدعم الفني'));
    const savedManualOrder=rootDb.orders['manual-support-order-1'];assert(savedManualOrder,'manual order must be written and read-verified in Firebase');assert.equal(savedManualOrder.serviceKind,'manual_support');assert.equal(savedManualOrder.manualSupportStatus,'awaiting_contact');assert.equal(savedManualOrder.providerOrderId,'');assert.equal(savedManualOrder.supportMessage,supportMessage);
    const manualBalanceAfterFirst=Number(rootDb.users.tester.balance);
    const manualDuplicate=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(manualRequestBody)});
    assert.equal(manualDuplicate.status,200,`duplicate manual submit should return the existing order: ${JSON.stringify(manualDuplicate.data)}`);assert.equal(manualDuplicate.data.idempotent,true);assert.equal(manualDuplicate.data.publicOrderNo,manualOrder.data.publicOrderNo);assert.equal(Number(rootDb.users.tester.balance),manualBalanceAfterFirst);assert.equal(providerAddCalls,providerCallsBeforeManual);
    const thirdManual=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({...manualRequestBody,link:'https://tiktok.com/@other',localId:'manual-support-order-2'})});
    assert.equal(thirdManual.status,429,`per-service manual limit should be enforced in Firebase: ${JSON.stringify(thirdManual.data)}`);assert.equal(thirdManual.data.stage,'manual_service_limit');assert.equal(Number(rootDb.users.tester.balance),manualBalanceAfterFirst);assert.equal(providerAddCalls,providerCallsBeforeManual);
    assert(Array.isArray(rootDb.users.tester.sadaManualSupportUsage?.[crypto.createHash('sha256').update(manualKey).digest('hex').slice(0,40)]),'manual service quota must be atomically recorded in the Firebase user record');
    const manualUserOrders=await req('/api/user/orders',{headers:{Cookie:cookie}});assert.equal(manualUserOrders.status,200);const listedManual=manualUserOrders.data.orders.find(o=>String(o.id)==='manual-support-order-1');assert(listedManual,'manual order should be visible in the user order history');assert.equal(listedManual.supportMessage,supportMessage);
    const turnManualOff=await req('/api/admin/manual-services',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'toggle',key:manualKey,enabled:false})});assert.equal(turnManualOff.status,200);
    const callsBeforeStaleManual=providerAddCalls,balanceBeforeStaleManual=Number(rootDb.users.tester.balance);
    const staleManual=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({...manualRequestBody,localId:'manual-support-stale-order',link:'https://tiktok.com/@stale'})});
    assert.equal(staleManual.status,409,'disabled manual service listing must fail closed');assert.equal(staleManual.data.stage,'manual_service_lookup');assert.equal(providerAddCalls,callsBeforeStaleManual);assert.equal(Number(rootDb.users.tester.balance),balanceBeforeStaleManual);
    const disabledManualDetail=await req('/api/catalog?path=services/'+encodeURIComponent(manualKey),{headers:{Cookie:cookie}});assert.equal(disabledManualDetail.status,200);assert.equal(disabledManualDetail.data.value,null,'disabled manual service must disappear from active catalogue reads');
    console.log('PASS runtime: manual-support services are priced and persisted as real public orders, charge exactly once, provide a copyable support message, enforce a Firebase 24-hour limit, and never call suppliers');
    console.log('PASS runtime: disabled manual-support services fail closed without a debit or supplier call');

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
    const secondSync=await req('/api/admin/pricing/sync',{method:'POST',headers:adminCookie});
    assert.equal(secondSync.status,200,`second provider sync should run: ${JSON.stringify(secondSync.data)}`);assert.equal(secondSync.data.ok,true,`second provider sync should succeed: ${JSON.stringify(secondSync.data)}`);
    const afterSecondSync=JSON.parse(fs.readFileSync(path.join(dataDir,'services.json'),'utf8'));
    assert.equal(afterSecondSync['svc-removed'].providerAvailable,true,'two provider misses must not change storefront availability automatically');
    assert.notEqual(afterSecondSync['svc-removed'].providerAvailabilityReason,'provider_confirmed_removed','provider absence alone must not mark a saved site service as deleted');
    assert.equal(afterSecondSync['svc-removed'].providerMissingChecks,2,'absence count may be recorded for diagnosis without changing visibility');
    assert(afterSecondSync['svc-removed'],'service record remains intact for browsing and historical orders');
    const secondMissCatalog=await req('/api/catalog?path=services',{headers:{Cookie:cookie}});assert(secondMissCatalog.data.value?.['svc-removed'],'saved service must stay visible after repeated provider misses');
    console.log('PASS runtime: repeated provider misses stay visible; actual order validation fails closed without debiting or dispatching');
    console.log('PASS runtime: live mock sync refreshes approved prices, never auto-imports, removes, or hides existing service rows');

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

    // Simulate a pre-2.4 catalog row carrying a Date.now()-style internal ID.
    // Migration must reassign a 4-digit Sada ID, preserve the provider ID, and still resolve a stale order form.
    const legacySiteId='1791935390347';
    const legacySeed=await req('/api/admin/catalog',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({path:'services/legacy-long-id-test',mode:'set',value:{id:legacySiteId,siteServiceId:legacySiteId,internalServiceId:legacySiteId,providerId:'mock-provider',providerServiceId:'77',smmpartyId:'77',serviceId:'77',name:'Legacy four-digit migration test',category:'Test',groups:['Test'],sellingUsd:10,rateUsd:10,providerRateUsd:5,min:1,max:100,active:true,enabled:true,providerAvailable:true}})});
    assert.equal(legacySeed.status,200,`legacy catalog fixture should save: ${JSON.stringify(legacySeed.data)}`);
    const migratedCatalog=await req('/api/catalog?path=services/legacy-long-id-test',{headers:{Cookie:cookie}});
    assert.equal(migratedCatalog.status,200);const migratedRow=migratedCatalog.data.value;assert(migratedRow);
    const migratedSiteId=String(migratedRow.siteServiceId||'');assert.match(migratedSiteId,/^\d{4}$/,'legacy long ID must be rewritten to a four-digit internal ID');
    assert.equal(String(migratedRow.providerServiceId),'77','provider service ID must remain the original provider ID');
    assert(Array.isArray(migratedRow.legacySiteServiceIds)&&migratedRow.legacySiteServiceIds.includes(legacySiteId),'unambiguous old ID must remain as a compatibility alias');
    const oldFormOrder=await req('/api/order/create',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({providerId:'mock-provider',siteServiceId:legacySiteId,providerServiceId:'77',firebaseServiceKey:legacySiteId,link:'https://example.com/legacy-long-id-compat',quantity:10,localId:'legacy-four-digit-compat-order'})});
    assert.equal(oldFormOrder.status,200,`stale form using old internal ID should resolve through the safe alias: ${JSON.stringify(oldFormOrder.data)}`);
    assert.equal(String(oldFormOrder.data.order?.siteServiceId||oldFormOrder.data.siteServiceId||''),migratedSiteId,'new order must persist the canonical 4-digit site ID');
    assert.equal(String(oldFormOrder.data.order?.providerServiceId||oldFormOrder.data.providerServiceId||''),'77','legacy form must still route to the original provider service');
    console.log('PASS runtime: legacy long IDs migrate to four-digit site IDs while stale order forms still resolve the same provider service');
    const beforeLegacyApiCalls=providerAddCalls;
    const legacyApiOrder=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'add',key:freshKey,service:legacySiteId,link:'https://example.com/legacy-api-four-digit-compat',quantity:'10',idempotency_key:'LEGACY_FOUR_DIGIT_API_TEST'}).toString()});
    assert.equal(legacyApiOrder.status,200,`legacy API ID should resolve through compatibility alias: ${JSON.stringify(legacyApiOrder.data)}`);
    const apiLegacyRow=JSON.parse(fs.readFileSync(path.join(dataDir,'orders.json'),'utf8')).find(o=>String(o.id)===String(legacyApiOrder.data.internal_order_id));
    assert(apiLegacyRow,'legacy API order must be persisted');assert.equal(String(apiLegacyRow.siteServiceId),migratedSiteId,'API order must store canonical four-digit site ID');assert.equal(String(apiLegacyRow.providerServiceId),'77','API order must preserve original provider ID');assert.equal(providerAddCalls,beforeLegacyApiCalls+1,'legacy API ID must dispatch one mock provider order');
    console.log('PASS runtime: legacy API clients can use an old site ID but all new orders persist the canonical four-digit ID');
    const activity=await req('/api/admin/api-users/activity?username=tester',{headers:adminCookie});
    assert.equal(activity.status,200,`API user activity should load account and orders: ${JSON.stringify(activity.data)}`);
    assert.equal(activity.data.account.username,'tester');assert(activity.data.account.balanceDisplay);assert(Array.isArray(activity.data.orders));assert(activity.data.summary.orderCount>=1,'activity should list real mock orders for the API user');
    assert(!JSON.stringify(activity.data).includes('secret-must-never-be-returned'),'activity response must not expose encrypted API material');
    console.log('PASS runtime: API activity view returns safe account profile, balance, order list and summary');
    const blockTester=await req('/api/admin/api-users/block',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({username:'tester',blocked:true})});
    assert.equal(blockTester.status,200,`admin API-only block should persist: ${JSON.stringify(blockTester.data)}`);assert.equal(blockTester.data.blocked,true);assert.equal(rootDb.apiKeyBlocks[crypto.createHash('sha256').update('tester').digest('hex')].blocked,true);
    const blockedApiCall=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'balance',key:freshKey}).toString()});
    assert.equal(blockedApiCall.status,401,'central API block must stop every API key for the selected username');
    const websiteStillWorks=await req('/api/user/summary',{headers:{Cookie:cookie}});assert.equal(websiteStillWorks.status,200,'API block must not block normal website login/session');
    const unblockTester=await req('/api/admin/api-users/block',{method:'POST',headers:{...adminCookie,'Content-Type':'application/json'},body:JSON.stringify({username:'tester',blocked:false})});
    assert.equal(unblockTester.status,200);assert.equal(unblockTester.data.blocked,false);
    const apiAfterUnblock=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'balance',key:freshKey}).toString()});
    assert.equal(apiAfterUnblock.status,200,`lifting API-only block should restore a still-valid key: ${JSON.stringify(apiAfterUnblock.data)}`);
    console.log('PASS runtime: API-only block/unblock is persisted and enforced without affecting the user website session');
  } finally {
    app.kill('SIGTERM');await Promise.race([new Promise(resolve=>app.once('exit',resolve)),wait(3000)]);if(app.exitCode===null)app.kill('SIGKILL');
    await close(provider);await close(db);fs.rmSync(tempDir,{recursive:true,force:true});
  }
  if(providerAddCalls!==7)throw new Error('Mock provider should receive seven add actions total, including safe website/API orders using a legacy site ID');
  console.log(`PASS end-to-end API runtime checks including summary, Telegram URL, admin API listing/revocation; mock provider actions: ${providerSeen.join(', ')}`);
}
main().catch(error=>{console.error('FAIL API runtime smoke:',error&&error.stack||error);process.exitCode=1;});
