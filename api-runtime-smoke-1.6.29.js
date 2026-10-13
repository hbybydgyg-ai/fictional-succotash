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
      if(action==='services'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{service:77,name:'Mock service',rate:5,min:1,max:1000}]));return;}
      if(action==='cancel'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({cancel:1}));return;}
      res.statusCode=422;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'unsupported mock action'}));
    }catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e.message||e)}));}
  });
  const providerPort=await listen(provider);
  const dataDir=path.join(tempDir,'data');fs.mkdirSync(dataDir,{recursive:true});
  fs.writeFileSync(path.join(dataDir,'services.json'),JSON.stringify({
    'svc-test':{fbKey:'svc-test',siteServiceId:'1001',providerId:'mock-provider',providerServiceId:'77',smmpartyId:'77',serviceId:'1001',name:'Safe mock test service',category:'Test',sellingUsd:5,providerRateUsd:2.5,min:1,max:1000,active:true,refill:false,cancel:true,type:'default'}
  }));
  fs.writeFileSync(path.join(dataDir,'providers.runtime.json'),JSON.stringify({activeProvider:'mock-provider',providers:{'mock-provider':{id:'mock-provider',name:'Mock SMM Provider',url:`http://127.0.0.1:${providerPort}`,key:'mock-provider-secret'}},deletedProviderIds:[]}));
  fs.writeFileSync(path.join(dataDir,'providers.json'),JSON.stringify({activeProvider:'',providers:{},deletedProviderIds:[]}));
  fs.writeFileSync(path.join(dataDir,'users.json'),JSON.stringify({users:{}}));
  const appPortServer=http.createServer();const appPort=await listen(appPortServer);await close(appPortServer);
  const sessionSecret='safe-test-session-secret-at-least-32-chars';
  const env={...process.env,NODE_ENV:'test',PORT:String(appPort),SADA_DATA_DIR:dataDir,FIREBASE_DATABASE_URL:`http://127.0.0.1:${dbPort}`,FIREBASE_ALLOW_UNAUTHENTICATED:'true',ALLOW_LOCAL_PROVIDER_TEST:'1',SESSION_SECRET:sessionSecret,SADA_ENCRYPTION_KEY:'safe-test-encryption-secret-at-least-32-chars',ADMIN_PASSWORD:'test-only-admin-password-long-enough'};
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
    assert.equal(health.version,'1.6.30');
    assert.equal(health.deploymentConsistent,true,'all packaged UI/server build markers must match');
    assert.equal(health.firebaseDatabaseSource,'railway-environment','explicit Firebase URL must win in production/test config resolution');
    console.log('PASS runtime: explicit database URL is the same target used by API routes');

    const create=await req('/api/user/api-key',{method:'POST',headers:{Cookie:cookie}});
    assert.equal(create.status,200,`key generation should persist in selected DB: ${JSON.stringify(create.data)}`);
    const apiKey=String(create.data.apiKey||'');assert.match(apiKey,/^sr_[A-Za-z0-9_-]{30,}$/,'new key should use expected format');
    const hash=crypto.createHash('sha256').update(apiKey).digest('hex');
    assert.equal(rootDb.apiKeys[hash]?.username,'tester','new key record should be stored at SHA-256 hash in the selected DB');
    assert.equal(rootDb.apiKeys[hash]?.keyHash,hash,'new key record should bind its hash');
    assert.equal(rootDb.apiKeys[hash]?.status,'active');assert(rootDb.apiKeys[hash]?.scopes.includes('balance'));
    console.log('PASS runtime: newly generated key is stored under the hash the validator uses, with active owner and scopes');

    const keyHeader={'X-API-Key':apiKey};
    const balance=await req('/api/v1',{method:'POST',headers:{...keyHeader,'Content-Type':'application/x-www-form-urlencoded'},body:'action=balance'});
    assert.equal(balance.status,200,`balance action should authorize the new key: ${JSON.stringify(balance.data)}`);
    assert.equal(balance.data.balance,80);assert.equal(balance.data.currency,'USD');
    console.log('PASS runtime: services/balance API authorization accepts the newly generated key');

    const services=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'services',key:apiKey}).toString()});
    assert.equal(services.status,200,`services action should authorize the same key: ${JSON.stringify(services.data)}`);
    assert(Array.isArray(services.data));assert.equal(services.data[0]?.id,'1001');assert.equal(services.data[0]?.name,'Safe mock test service');
    console.log('PASS runtime: services action returns the internal numeric ID on the same API key');

    const addBody=new URLSearchParams({action:'add',key:apiKey,service:'1001',link:'https://example.com/safe-api-smoke-test',quantity:'10',idempotency_key:'SAFE_LOCAL_SMOKE_1628'}).toString();
    const added=await req('/api/v1',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:addBody});
    assert.equal(added.status,200,`safe mocked add should succeed: ${JSON.stringify(added.data)}`);
    assert.equal(added.data.service,'1001');assert.equal(added.data.status,'pending');assert.equal(providerAddCalls,1);
    assert.equal(rootDb.orders[`API_${added.data.internal_order_id?.replace(/^API_/,'')}`]?.id,added.data.internal_order_id,'order should be persisted');
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

    const adminPayload=Buffer.from(JSON.stringify({username:'admin',role:'admin',iat:Date.now()})).toString('base64url');
    const adminSig=crypto.createHmac('sha256',sessionSecret).update(adminPayload).digest('base64url');
    const diag=await req('/api/admin/api-key-diagnostics',{headers:{Cookie:`sadairaq_sid=${adminPayload}.${adminSig}`}});
    assert.equal(diag.status,200,`admin diagnostics should be readable in test: ${JSON.stringify(diag.data)}`);
    assert.equal(diag.data.database.source,'railway-environment');assert.equal(diag.data.keys.firebaseRecordCount,1);assert.equal(diag.data.users.firebaseRecordCount,1);
    assert(!JSON.stringify(diag.data).includes(apiKey),'diagnostics must not expose the API key');
    console.log('PASS runtime: admin diagnostics confirm Firebase records without exposing key material');
  } finally {
    app.kill('SIGTERM');await Promise.race([new Promise(resolve=>app.once('exit',resolve)),wait(3000)]);if(app.exitCode===null)app.kill('SIGKILL');
    await close(provider);await close(db);fs.rmSync(tempDir,{recursive:true,force:true});
  }
  if(providerAddCalls!==1)throw new Error('Mock provider should receive exactly one add action');
  console.log(`PASS ${6} end-to-end API scenarios; mock provider actions: ${providerSeen.join(', ')}`);
}
main().catch(error=>{console.error('FAIL API runtime smoke:',error&&error.stack||error);process.exitCode=1;});
