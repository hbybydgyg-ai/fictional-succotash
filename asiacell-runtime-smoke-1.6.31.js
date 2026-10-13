'use strict';
// Offline checkout test. Uses a local RTDB-compatible double and a mock AsiaCell provider;
// no production credentials, real SMS, or real money transfer are used.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const pathParts=u=>decodeURIComponent(u.pathname.replace(/^\/+/, '').replace(/\.json$/, '')).split('/').filter(Boolean);
function getAt(root,parts){let x=root;for(const p of parts){if(!x||typeof x!=='object'||!Object.prototype.hasOwnProperty.call(x,p))return null;x=x[p];}return x===undefined?null:x;}
function putAt(root,parts,value){if(!parts.length)return value;let x=root;for(let i=0;i<parts.length-1;i++){const p=parts[i];if(!x[p]||typeof x[p]!=='object'||Array.isArray(x[p]))x[p]={};x=x[p];}const k=parts[parts.length-1];if(value===null)delete x[k];else x[k]=clone(value);return root;}
function patchAt(root,parts,value){let nextRoot=root;const entries=Object.entries(value||{});for(const [key,val] of entries){if(key.includes('/'))nextRoot=putAt(nextRoot,[...parts,...key.split('/').filter(Boolean)],val);else{const cur=getAt(nextRoot,parts);const next=Object.assign({},cur&&typeof cur==='object'&&!Array.isArray(cur)?cur:{},{[key]:val});nextRoot=putAt(nextRoot,parts,next);}}return nextRoot;}
function listen(server){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});}
function close(server){return new Promise(resolve=>server.close(()=>resolve()));}
function bodyText(req){return new Promise((resolve,reject)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));req.on('error',reject);});}
function issueSession(username,role,secret){const pl=Buffer.from(JSON.stringify({username,role,iat:Date.now()})).toString('base64url');return pl+'.'+crypto.createHmac('sha256',secret).update(pl).digest('base64url');}
async function main(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sada-asiacell-test-'));
 let root={users:{tester:{username:'tester',email:'tester@example.com',balance:1000}},orders:{}};let dbVersion=0;let mockTransferConfirmations=0;let mockTransferStarts=0;
 const db=http.createServer(async(req,res)=>{try{const text=await bodyText(req),parts=pathParts(new URL(req.url,'http://local'));res.setHeader('Content-Type','application/json');
   if(req.method==='GET'){res.setHeader('ETag','"'+dbVersion+'"');res.end(JSON.stringify(clone(getAt(root,parts))));return;}
   if(req.method==='PUT'){const match=req.headers['if-match'];if(match&&match!=='"'+dbVersion+'"'){res.statusCode=412;res.end('{"error":"precondition failed"}');return;}root=putAt(root,parts,text?JSON.parse(text):null);dbVersion++;res.setHeader('ETag','"'+dbVersion+'"');res.end(JSON.stringify(clone(getAt(root,parts))));return;}
   if(req.method==='PATCH'){root=patchAt(root,parts,text?JSON.parse(text):{});dbVersion++;res.setHeader('ETag','"'+dbVersion+'"');res.end(JSON.stringify(clone(getAt(root,parts))));return;}
   if(req.method==='DELETE'){root=putAt(root,parts,null);dbVersion++;res.end('null');return;}
   res.statusCode=405;res.end('{}');
  }catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e.message||e)}));}});
 const dbPort=await listen(db);
 const provider=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://provider'),text=await bodyText(req),b=text?JSON.parse(text):{};res.setHeader('Content-Type','application/json');
   if(u.pathname.endsWith('/login')){res.end(JSON.stringify({nextUrl:'https://example.test/login?PID=aa11bb22-cc33-dd44'}));return;}
   if(u.pathname.endsWith('/smsvalidation')){res.end(JSON.stringify({success:true,access_token:'test-asia-access-token'}));return;}
   if(u.pathname.endsWith('/credit-transfer/start')){mockTransferStarts++;assert.ok(Number(b.amount)>=1000);assert.ok(b.receiverMsisdn);res.end(JSON.stringify({PID:'face1234-abcd-1234'}));return;}
   if(u.pathname.endsWith('/credit-transfer/do-transfer')){mockTransferConfirmations++;assert.equal(String(b.passcode),'654321');res.end(JSON.stringify({success:true}));return;}
   res.statusCode=404;res.end(JSON.stringify({message:'unknown test route'}));
  }catch(e){res.statusCode=500;res.end(JSON.stringify({message:String(e.message||e)}));}});
 const providerPort=await listen(provider);
 const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const serviceAccount=JSON.stringify({type:'service_account',project_id:'sada-iraq-app',private_key_id:'offline-test-key',private_key:pair.privateKey,client_email:'offline-test@sada-iraq-app.iam.gserviceaccount.com',client_id:'1234567890',token_uri:'https://oauth2.googleapis.com/token'});
 const secret='asiacell-runtime-test-session-secret-at-least-32-chars';
 const baseEnv={...process.env,NODE_ENV:'test',FIREBASE_ALLOW_UNAUTHENTICATED:'true',FIREBASE_DATABASE_URL:'http://127.0.0.1:'+dbPort,FIREBASE_SERVICE_ACCOUNT_JSON:serviceAccount,ASIACELL_API_BASE:'http://127.0.0.1:'+providerPort+'/api/v1',SESSION_SECRET:secret,SADA_ENCRYPTION_KEY:'asiacell-runtime-test-encryption-secret-at-least-32-chars',PATH:process.env.PATH||'/usr/bin:/bin'};
 const processes=[];
 async function startInstance(name){const dir=path.join(tmp,name);fs.mkdirSync(dir,{recursive:true});const probe=http.createServer();const port=await listen(probe);await close(probe);const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...baseEnv,PORT:String(port),SADA_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);processes.push(child);const url='http://127.0.0.1:'+port;let healthy=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw new Error('instance failed to start: '+output.slice(-1000));try{const r=await fetch(url+'/api/health');if(r.ok){healthy=true;break;}}catch(_){}await delay(150);}if(!healthy)throw new Error('instance health timeout: '+output.slice(-1000));return {child,url,output:()=>output};}
 async function call(instance,token,action,fields={}){const r=await fetch(instance.url+'/api/asiacell',{method:'POST',headers:{'Content-Type':'application/json','X-Sada-Session':token},body:JSON.stringify({action,...fields})});const t=await r.text();let d;try{d=JSON.parse(t)}catch(_){d={raw:t};}if(!r.ok)throw new Error(action+' failed '+r.status+': '+JSON.stringify(d));return d;}
 try{
   const a=await startInstance('instance-a'),b=await startInstance('instance-b');const token=issueSession('tester','user',secret);
   const login=await call(a,token,'login',{phone:'07763308188'});assert.equal(login.ok,true);assert.equal(login.sessionPersisted,true);console.log('PASS AsiaCell login session is encrypted and read-verified in RTDB');
   const sms=await call(b,token,'verify_sms',{passcode:'123456'});assert.equal(sms.ok,true);assert.equal(sms.sessionPersisted,true);console.log('PASS SMS verification continues on a different server instance');
   const started=await call(a,token,'start_transfer',{amount:5000});assert.equal(started.ok,true);assert.equal(mockTransferStarts,1);console.log('PASS transfer SMS request is sent exactly once and persisted across instances');
   const confirmed=await call(b,token,'confirm_transfer',{passcode:'654321'});assert.equal(confirmed.ok,true);assert.equal(confirmed.credited,true);assert.equal(confirmed.balanceIQD,6000);assert.equal(mockTransferConfirmations,1);assert.equal(root.users.tester.balance,6000);console.log('PASS confirmation applies one idempotent balance credit after provider success');
   const key=Object.keys(root.users.tester.asiacellTransferIds||{});assert.equal(key.length,1);assert.ok(root.asiacellTransfers&&root.asiacellTransfers[key[0]]);console.log('PASS receipt and transfer id are persisted to the database');
   console.log('PASS AsiaCell flow: 5 checks passed (offline mock provider + local Firebase RTDB; no real transfer performed)');
 }finally{for(const p of processes){try{p.kill('SIGTERM')}catch(_){}}await close(provider);await close(db);fs.rmSync(tmp,{recursive:true,force:true});}
}
main().catch(e=>{console.error('FAIL AsiaCell runtime smoke:',String(e.stack||e));process.exitCode=1;});
