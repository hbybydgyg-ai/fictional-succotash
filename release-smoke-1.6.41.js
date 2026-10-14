'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const s=fs.readFileSync(__dirname+'/server.js','utf8');
const h=fs.readFileSync(__dirname+'/index.html','utf8');
const adminAuth=JSON.parse(fs.readFileSync(__dirname+'/admin-auth.json','utf8'));
const checks=[
 ['AsiaCell is a sequential four-step full-screen wizard with readable Western-digit amounts',h.includes('sada1637-asiacell-wizard-and-order-polish')&&h.includes('data-stage=\"1\"')&&h.includes('data-stage=\"2\"')&&h.includes('data-stage=\"3\"')&&h.includes('data-stage=\"4\"')&&h.includes("String(amount)")&&h.includes('selected=')&&h.includes('showStep(4)')],
 ['global API bridge fixes window.api access and refreshes stale session tokens',h.includes('installSadaPublicApiBridge')&&h.includes('window.api = async function(path, options={})')&&h.includes("fetch('/api/session'")&&h.includes("window.api('/api/user/summary')")],
 ['service order quantity presets and link hint are part of the premium responsive order UI',h.includes('sada1637-qty-presets')&&h.includes('sada1637-order-hint')&&h.includes('#pg-order #order-qty')&&h.includes('order-qty')],
 ['exchange-rate information is a compact card at the bottom of wallet with no blocking modal',h.includes('sada1636-rate-card')&&h.includes('معلومات سعر الصرف للشحن')&&h.includes('1 دولار = 1,250 دينار')&&h.includes('1,000 دينار')&&h.includes('$0.80')&&h.includes('$4.00')&&h.includes('root.appendChild(card)')&&!h.includes('sessionStorage.getItem(KEY)')],
 ['AsiaCell amount selector defaults to minimum 1,000 IQD and server enforces 1,000 increments',h.includes("b.className='ac-amt'+(a===1000?' on':'')")&&h.includes('window.__acAmount=1000;')&&s.includes('amount<1000')&&s.includes('amount%1000!==0')],
 ['administrator login restores the owner account through a bundled scrypt hash and keeps admin-only routing',s.includes('function adminPasswordConfigured()')&&s.includes('BUNDLED_ADMIN_AUTH.passwordHash')&&s.includes('admin_password_not_configured')&&s.includes('const isBundledOwner=!!bundledOwnerEmail&&submittedEmail===bundledOwnerEmail;')&&s.includes('const bundledOwnerValid=isBundledOwner&&settings.adminPasswordOverride!==true')&&adminAuth.email==='hsydgyg5@gmail.com'&&adminAuth.passwordHash.startsWith('scrypt$')],
 ['admin password is not stored in plaintext and the hash file is not served publicly',s.includes("const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();")&&!/\bADMIN_PASSWORD\s*=\s*String\(process\.env\.ADMIN_PASSWORD\s*\|\|\s*['"][^'"]{8,}['"]/.test(s)&&s.includes("'admin-auth.json'")&&adminAuth.passwordHash.startsWith('scrypt$')],
 ['session recovery accepts a valid cookie when localStorage token is stale',s.includes('for(const token of [...new Set(candidates)])')&&s.includes('parseCookies(req)[SESSION_COOKIE]')],
 ['supplier rate must be present before being treated as a real zero price',s.includes('ratePresent')&&s.includes('if(s&&s.ratePresent===false)return null')],
 ['provider sync imports new services but does not mass-disable unmatched or unverified rows',s.includes("source:'provider-live-sync'")&&s.includes('result.imported')&&s.includes('result.unverified')&&s.includes('recoverTransientlyHiddenServices')&&!s.includes("appendServicePricePatch(allPatches,key,{providerAvailable:false,availabilityStatus:'unavailable',providerCheckedAt:nowISO(),providerAvailabilityReason:'not_found_in_live_supplier_catalog'})")],
 ['provider removal requires two complete catalogs and preserves history',s.includes('providerCatalogLooksComplete')&&s.includes('providerMissingChecks')&&s.includes('provider_confirmed_removed')&&s.includes('Keep the row for historical orders')],
 ['provider catalog and price sync interval is configurable from 5 to 60 minutes',s.includes('intervalMinutes:[5,10,15,30,60]')&&s.includes('p.intervalMinutes')&&h.includes('value=\"10\" selected>10 دقائق')],
 ['an unverified provider service blocks an order transiently without mutating catalog availability',s.includes("stage:'provider_service_unavailable'")&&s.includes('transientProviderCheckFailure')&&s.includes('the shared catalog, because it would hide entire categories')],
 ['explicitly disabled site services remain disabled during automatic recovery and provider sync',s.includes('function hasExplicitSiteServiceDisable')&&s.includes('hasExplicitSiteServiceDisable(row)')&&s.includes('!hasExplicitSiteServiceDisable(svc)')&&s.includes('!hasExplicitSiteServiceDisable(a)')],
 ['every website order is rejected if actual sale price after discount is below provider cost',s.includes("stage:'sale_below_provider_cost'")&&s.includes('const grossProfitUsd=Number((chargeUsd-providerCostUsd).toFixed(6))')],
 ['supplier price guard fails closed per order without persisting transient provider errors into catalog state',s.includes("'provider_catalog_unverified'")&&s.includes("'live_price_check_failed'")&&s.includes("'live_price_guard_disabled'")&&s.includes('transientProviderCheckFailure')],
 ['API and website orders apply the 100 percent markup floor after account discounts',s.includes("stage:'sale_below_required_markup'")&&s.includes('minimumChargeUsd')&&s.includes("notifyTelegramNewOrder(order,{source:'public-api'})")],
 ['public API orders persist actual supplier costs and profit figures before Telegram notification',s.includes('const grossProfitUsd=Number((total-providerCostUsd).toFixed(6))')&&s.includes('providerCostIQD:Number((providerCostUsd*FIXED_RATE).toFixed(4))')&&s.includes("notifyTelegramNewOrder(order,{source:'public-api'})")],
 ['Telegram order message is clean and distinguishes in-app/API/provider origins',s.includes('📍 من داخل التطبيق')&&s.includes('🌐 عبر API / رابط الربط الخارجي')&&s.includes('🏢 طلب مباشر من رابط المزود')&&s.includes('رقم الطلب داخل التطبيق:')&&s.includes('طلب المزود:')&&s.includes('function telegramOrderReplyMarkup')],
 ['global pricing enforces at least 100 percent markup on the provider cost',s.includes('DEFAULT_GLOBAL_PRICING={markupPct:100')&&s.includes('Math.max(100,Math.min(1000,pct))')],

 ['AsiaCell checkout state is encrypted and verified in Firebase',s.includes("const ASIACELL_SESSION_NODE = 'asiacellSessions'")&&s.includes('async function loadAsiacellSession(stateKey)')&&s.includes('async function saveAsiacellSession(stateKey,value)')&&s.includes('encryptSecret(JSON.stringify(value))')&&s.includes("check.encrypted!==encrypted")&&s.includes("firebaseGetJson(ASIACELL_SESSION_NODE+'/'+stateKey")],
 ['AsiaCell transfer confirmation is guarded against blind duplicate submission',(()=>{const a=s.indexOf('async function apiAsiacell('),b=s.indexOf('async function apiSmm(',a),f=s.slice(a,b);return f.includes("if(s.step==='confirming_transfer')return json(res,409")&&f.includes("s.step='confirming_transfer'")&&f.includes("s.step='provider_confirmed'")&&f.includes("acquireAsiacellOperationLock(stateKey,'transfer')")&&f.includes('releaseAsiacellOperationLock(operationLock)')&&f.includes('firebaseTransaction(s.firebaseUserPath')&&f.includes('asiacellTransferIds')&&f.includes('await deleteAsiacellSession(stateKey)')})()],
 ['Site statistic uses assigned public numbers rather than internal IDs',(()=>{const a=s.indexOf("if(p==='/api/public/site-order-count'"),b=s.indexOf("if(p==='/api/admin/users-directory'",a),f=s.slice(a,b);return f.includes('latestPublicOrderNo')&&f.includes('totalOrders:rows.length')&&!f.includes('numeric(o?.id)')})()],
 ['Notification details open on click and are marked read only after opening',(()=>{const a=h.indexOf('async function loadUserNotifications67()'),b=h.indexOf('async function refreshNotifications67()',a),f=h.slice(a,b);return f.includes('const markOpened=async n=>')&&f.includes('const openDetails=async()=>')&&f.includes("await markOpened(n)")&&!f.includes("items.filter(x=>!x.read).map")})()],
 ['Telegram channel is accessible from the sidebar and uses the configured Telegram URL',h.includes('snav-telegram-channel')&&h.includes('window.openTG=')&&s.includes("telegramChannelUrl='https://t.me/jgkhfcvn'")&&s.includes('normalizeTelegramChannelUrl')&&s.includes("config/telegramChannelUrl")],
 ['Image halo styles provide strong glow behind image cards',h.includes('sada130-image-halo-and-notification-interaction')&&h.includes('drop-shadow(0 0 18px rgba(65,139,255,.3))')&&h.includes('.card:has(img:not(.no-sada-glow))')],
 ['All primary frontend health-check constants use the current release marker',!h.includes("const SADA_VERSION='1.6.29'")&&!h.includes('SADA-1.6.29-FULL-API-WALLET-IDEMPOTENCY-20261013')&&h.includes("const SADA_VERSION='1.6.41'")],
 ['public number allocator ignores internal request IDs',(()=>{const a=s.indexOf('async function nextPublicOrderNumber(){'),b=s.indexOf('\nfunction siteOrderById',a),f=s.slice(a,b);return /const maxPersistedPublic=Math\.max\(2999,usedLocal,usedRemote\)/.test(f)&&/const n=previous\+1/.test(f)&&/numeric\(o\?\.publicOrderNo\)/.test(f)&&!/numeric\(o\?\.id\)/.test(f)})()],
 ['Firebase public order maximum is considered',/const usedRemote=remoteRows\.reduce/.test(s)],
 ['user order listing assigns permanent public numbers to legacy records',/const needsNumber=mergedRows\.filter/.test(s)&&/order\.publicOrderNo=number/.test(s)],
 ['Telegram send requests are serialized',/TELEGRAM_ORDER_SENDS_IN_FLIGHT/.test(s)],
 ['Telegram duplicate-send guard includes fallback deliveries',s.includes('function telegramOrderWasDelivered(entry)')&&/if\(telegramOrderWasDelivered\(previous\)\)/.test(s)&&/adminFallbackDelivered===true/.test(s)&&/const delivered=!!\(result\.primaryOk\|\|result\.delivered/.test(s)],
 ['Telegram monitor uses canonical order identity',/telegramOrderIdentity\(\{\.\.\.row,id:row\.siteOrderId/.test(s)],
 ['Telegram order audit normalization preserves source and member metadata for retries',s.includes("orderSource:String(o.orderSource||o.origin||o.sourceType||o.source||'').trim()")&&s.includes('apiCreated:!!o.apiCreated,externalProviderOrder:!!o.externalProviderOrder,providerDirect:!!o.providerDirect')&&s.includes("free:!!(o.free||o.isFree),memberId:String(o.memberId||o.userId||o.uid||o.firebaseUid||o.telegramUserId||'')")],
 ['missing service prices are blocked before provider dispatch',/stage:'service_price'/.test(s)],
 ['customer order UI never displays REQ IDs as public numbers',/قيد الترقيم/.test(h)&&h.includes('Number(o.id)>=3000')],
 ['wallet directory joins a local alias to the verified Firebase child key',/const localMatches=localEntries\.filter/.test(s)&&/remoteIds=new Set\(\[\.\.\.ids\(u\),fold\(key\),fold\(decoded\)\]/.test(s)&&/firebase\+local/.test(s)],
 ['Firebase child-key identity can safely link a local UID profile',/linkedToLocal\(v,preferred\)/.test(s)&&/linkedToLocal\(v,key\)/.test(s)&&/matches.length===1&&matches\[0\]\[0\]===localEntry\[0\]/.test(s)],
 ['financial details use the provided Firebase record key',/findRemoteUserByUsername\(username,firebaseKey\)/.test(s)&&/user-finance/.test(s)&&/firebaseKey=/.test(h)],
 ['wallet mutation buttons require a Firebase link and allow a verified username fallback',/الحساب غير مربوط بسجل Firebase مؤكد؛ لم يتم تمكين تعديل الرصيد/.test(h)&&/سيُستخدم اسم المستخدم ومعرّف Firebase بعد التحقق/.test(h)&&!h.includes('الحساب لا يملك بريداً إلكترونياً صالحاً محفوظاً؛ لم يتم تغيير الرصيد.')],
 ['order audit avoids exposing internal REQ IDs as public numbers',s.includes("publicOrderNo:String((/^\\d{1,9}$/.test(String(o.publicOrderNo||''))")&&s.includes('Number(row.id)>=3000')],
 ['order audit reports a useful error after Railway network retry',/تعذر الوصول إلى خادم Railway/.test(h)],
 ['Realtime Database is pinned to REST OAuth so wallet and health use one driver',s.includes("function firebaseAdminEnabled(){return false;")&&s.includes("return (await firebaseRequest(pathname,'GET',undefined,timeoutMs)).data;")&&s.includes("const got=await firebaseRequest(pathname,'GET',undefined,timeoutMs,{'X-Firebase-ETag':'true'});")&&s.includes("firebaseDatabaseDriver:firebaseAdminEnabled()?'admin-sdk':'rest-oauth'")],
 ['UI and server deployment build IDs match',/const BUILD_ID = 'SADA-1\.6\.41-PROVIDER-SYNC-SAFE-20261014'/.test(s)&&/name="sada-build-id" content="SADA-1\.6\.41-PROVIDER-SYNC-SAFE-20261014"/.test(h)],
 ['visible app version 2.7 appears in the sidebar only while legacy page and splash badges are removed',h.includes('id="sada-sidebar-version"')&&h.includes('<b>2.8</b>')&&h.includes("const shown='2.8'")&&h.includes("document.title='صدى العراق'")&&h.includes("foot.textContent='SADA IRAQ'")&&h.includes('#sadairaq-version-badge{display:none!important;visibility:hidden!important')],
 ['manual support service is isolated, listed in hosting catalog, and creates no-provider orders',s.includes("p==='/api/admin/manual-services'")&&s.includes("serviceKind:'manual_support'")&&s.includes('handleManualSupportOrder')&&s.includes('manual_services.json')&&h.includes('sada-manual-support-services-23')&&h.includes('adminManualServiceKey')&&h.includes('نسخ رسالة الطلب كاملة')],
 ['manual support service database is included in administrative backups',s.includes("'manual_services.json'")&&s.includes('SADA_DB_BACKUP_FILES')],
 ['manual support UI override loads after legacy order/catalog handlers and reuses its category datalist',h.lastIndexOf('<script id="sada-manual-support-services-23">')>h.lastIndexOf('<script id="sada-free-services-21">')&&h.trimEnd().endsWith('</script>')&&h.includes("document.getElementById('sada-manual-category-list')||document.createElement('datalist')")],
 ['API page deployment test never displays version numbers',!h.includes("الإصدار '+String(health.version)")&&!h.includes("String(health.version||'?')+'، الواجهة")&&!h.includes("الخادم والإصدار متطابقان ('+String(health.version)")],
 ['wallet resolver accepts an exact selected-child email match despite a stale username hint',/emailMatches\)return direct|emailMatches\)\s*\{/.test(s)&&s.includes('findAdminWalletUserLegacy')],
 ['Telegram monitor no longer dereferences an undefined result object',(()=>{const p=s.indexOf('async function runTelegramNewOrdersMonitor'),e=s.indexOf('let TELEGRAM_ORDER_MONITOR_RUNNING',p);const block=s.slice(p,e);return block.includes('const visibleNo=')&&!block.includes('result.order.publicOrderNo')})()],
 ['session signing fallback is stable across ephemeral Railway deploys when service credentials exist',s.includes('stableSessionSecretFromEnvironment')&&s.includes("SESSION_SECRET_SOURCE='firebase-service-credential'")],
 ['API keys are resolved from durable Firebase storage when the release-local cache is missing',/async function apiKeyUser\(req\)/.test(s)&&/firebaseGetJson\('apiKeys\/'\+hash/.test(s)&&/firebaseWriteJson\('apiKeys\/'\+hash/.test(s)],
 ['new API keys are written to Firebase and verified by read-back before they are returned',/api_key_persistence_failed/.test(s)&&/const verify=await firebaseGetJson\('apiKeys\/'\+hash/.test(s)&&/verify\.username!==u/.test(s)],
 ['customer API handler awaits Firebase-backed key validation',s.includes('if(await handlePublicApiV1(req,res,urlObj,p))return;')&&s.includes('async function handlePublicApiV1')],
 ['deployment version, build ID and package version are bumped together',/const APP_VERSION = '1\.6\.41'/.test(s)&&/SADA-1\.6\.41-PROVIDER-SYNC-SAFE-20261014/.test(s)&&/name="sada-version" content="1\.6\.41"/.test(h)] ,
 ['wallet resolver prioritizes legacy direct Firebase child reads before full-list fallback',(()=>{const p=s.indexOf('async function findAdminWalletUserLegacy'),d=s.indexOf("firebaseGetJson('users/'+child,12000)",p),e=s.indexOf('findRemoteUserByEmail(normalizedEmail',p);return d>=0&&e>d&&s.includes('function foldWalletIdentity')})()],
 ['wallet uses a normalized direct Firebase child-key resolver',s.includes('async function findAdminWalletUserLegacy')&&s.includes("replace(/^users\\//i,'')")&&s.includes("firebaseGetJson('users/'+child,12000)")],
 ['wallet lookup failures diagnose empty/wrong Firebase users root without returning PII',s.includes('async function inspectAdminWalletLookup')&&s.includes('function walletLookupFailureMessage')&&s.includes('firebaseUsersCount')&&s.includes('emailMatchCount')],
 ['wallet list does not claim firebase+local when Firebase users root is empty',s.includes("if(root===null||root===undefined)throw new Error('مسار users فارغ في قاعدة Firebase")],
 ['discount action resolves by email plus Firebase key',s.includes('const found=await resolveAdminWalletUser(username,email,firebaseKey)')&&h.includes("email:String(u.email||'').trim().toLowerCase(),firebaseKey:u.firebaseKey||'',discountPct:pct")],
 ['all administrator charge paths submit email as the primary identity',/adjustAdminUserBalance\(username,type,usd,reason,session\(req\)\?\.username\|\|ADMIN_USER,firebaseKey,email\)/.test(s)&&/email,firebaseKey:String\(u\.firebaseKey\|\|''\),type,amountUsd/.test(h)&&/body:JSON\.stringify\(\{username,email,firebaseKey/.test(h)],
 ['category image upload persists to hosting JSON and mirrors to Firebase',s.includes("firebaseWriteJson('categoryMeta/'+key,meta,12000)")&&/function mergeCategoryMetaRoots/.test(s)&&/storage:'hosting-json'/.test(s)&&h.includes("path:'categoryMeta/")],
 ['API key creation uses the stable encryption resolver rather than requiring SADA_ENCRYPTION_KEY alone',s.includes('if(!telegramEncryptionReady())return json(res,503')&&!/if\(!String\(process\.env\.SADA_ENCRYPTION_KEY\|\|''\)\.trim\(\)\)return json\(res,503/.test(s)],
 ['Telegram monitor requires a configured activation channel instead of silently treating admin chat as channel',s.includes('const tg=telegramConfig();if(!tg.enabled||!tg.token||!tg.activationChat)return;')&&s.includes('primaryChat=cfg.activationChat;targets=[primaryChat,cfg.adminChat')],
 ['unified notification center has a Telegram channel tab and real send-test controls',h.includes("['channel','قنوات تيليجرام','fa-paper-plane']")&&h.includes("testChannel70('activation',channelStatus)")&&h.includes("if(tab==='channel')loadChannel70()")],
 ['reward page places WhatsApp CTA after instructions and reward tiers',(()=>{const a=h.indexOf('sada624-earn-hero'),b=h.indexOf('sada624-earn-whatsapp',a);return a>=0&&b>a&&h.includes('2,000 – 10,000 مشاهدة')})()],
 ['premium profile uses server-backed live account summary and excludes email verification form',h.includes('sada624-profile-stats-premium')&&h.includes("window.api('/api/user/summary')")&&!h.includes('سada624-no-email-verification')],
 ['sidebar swaps requested account/wallet and notifications/support slots',h.includes('swapNodes(home,wallet)')&&h.includes('swapNodes(notices,support)')],
 ['service details expose numeric Sada Iraq IDs with a copy button',h.includes('رقم الخدمة في صدى العراق')&&h.includes('sada1605-site-service-id-copy')&&h.includes('/^\\d{4,}$/')&&h.includes('تم نسخ رقم الخدمة')],
 ['service catalog persists unique numeric website IDs',s.includes('function ensureNumericSiteServiceIds()')&&s.includes('row.siteServiceId=id')&&s.includes('ensureNumericSiteServiceIds();const got=catalogReadPath(raw)'),],
 ['internal service IDs are limited to four digits and provider IDs remain separate',s.includes('const SITE_SERVICE_ID_MIN = 1000;')&&s.includes('const SITE_SERVICE_ID_MAX = 9999;')&&s.includes('legacySiteServiceIds')&&s.includes('canonicalServiceId')&&h.includes("const shown='2.8'")],
 ['service ID migration cache avoids walking JSON catalogs on every hot API request',s.includes('if(!SITE_SERVICE_IDS_DIRTY)return SITE_SERVICE_IDS_CACHE')&&s.includes('SITE_SERVICE_ID_FILES.has(String(file))')],
 ['mobile performance safeguards reduce decorative particles and pause retry loops while hidden',h.includes('container.childElementCount >= maxParticles')&&h.includes('setInterval(spawnParticle, 3200)')&&h.includes('sada-lite-motion')&&h.includes("prefers-reduced-motion: reduce")&&h.includes('},45000);')],
 ['website sends internal and provider service identifiers as separate fields',h.includes('siteServiceId,serviceId:siteServiceId,providerServiceId:sid,firebaseServiceKey:siteServiceId')&&h.includes('providerServiceId:serviceId,fbKey:siteServiceId')],
 ['order server uses the hosting catalog mapping before provider-only fallback',(()=>{const a=s.indexOf('async function authoritativeWebsiteService'),b=s.indexOf('function publicApiService',a),block=s.slice(a,b);return block.indexOf("readJSON('services.json'")>=0&&block.indexOf('const cached=findInternalApiService(sid)')>block.indexOf('if(localMatch)')&&s.includes('service:providerServiceId,link,quantity')})()],
 ['provider failure audit records both service IDs and does not reference an undefined serviceId',s.includes("{stage:'provider_response',uncertain:true,user:username,providerId,siteServiceId,providerServiceId,localId")&&s.includes("{stage:'firebase_order_persist',uncertain:true,user:username,providerId,siteServiceId,providerServiceId,localId")],
 ['provider failure diagnostics include upstream HTTP/error metadata without logging API credentials',s.includes('providerHttpStatus:Number(e.httpStatus||0)||null')&&s.includes('providerErrorCode:String(e.providerErrorCode||\'\').slice(0,60)')&&s.includes('err.providerDiagnostic=providerText.slice(0,180)')&&s.includes('ambiguousServerFailure')],
 ['service dropdown shows Sada Iraq numeric ID, not provider ID',h.includes("id.textContent='رقم الخدمة: '+(")&&!h.includes("id.textContent='#'+String(s.smmpartyId")],
 ['login saves the resolved account email into the saved user profile',h.includes('emailAddress||enteredEmail')&&h.includes('ensureUserFirebaseProfile(window.CU.u,{...u,email:window.CU.email})')&&h.includes('const email=String(sourceData.email')],
 ['account modal displays saved email without an email-verification wait state',h.includes("sessionEmail||'لم يُسجّل بريد إلكتروني'")&&h.includes('بيانات حسابك الأساسية جاهزة. تظهر الإحصائيات المحفوظة عند توفر اتصال الخادم.')&&!h.includes('جارٍ التحقق من البريد الإلكتروني')],
 ['API provides one standard action endpoint plus REST action aliases',s.includes('async function handlePublicApiV1')&&s.includes("action==='add'")&&s.includes("action==='status'")&&s.includes("action==='refill'")&&s.includes("action==='refill_status'")&&s.includes("action==='cancel'")&&s.includes('api/v1')],
 ['API service IDs are numeric Sada Iraq IDs and provider IDs stay internal',s.includes('function internalApiServices()')&&s.includes('providerServiceId,smmpartyId:providerServiceId')&&s.includes("const sid=String(id||'').trim()")&&s.includes("id:String(s?.siteServiceId||s?.id||'')")],
 ['Public API seeds the durable service catalog before listing or creating orders',s.includes("if(action==='services'){\n    try{await ensureLocalServiceCatalogSeeded();ensureNumericSiteServiceIds();}")&&s.includes("try{await ensureLocalServiceCatalogSeeded();ensureNumericSiteServiceIds();}catch(e){return {http:503,body:{error:'Service catalog is temporarily unavailable; no provider request was sent.',stage:'service_catalog'}};}")],
 ['API auth fails closed on Firebase outage and verifies/migrates a legacy record',s.includes("req._apiAuthError='storage_unavailable'")&&s.includes("'apiKeys/'+hash")&&s.includes('const verify=await firebaseGetJson')],
 ['API wallet uses Firebase transaction and retains an idempotent request record',s.includes('async function apiReserveBalance')&&s.includes('async function apiReleaseReservation')&&s.includes('sadaApiRequests')&&s.includes('firebaseTransaction(walletPath')],
 ['API financial endpoints use the actual resolved Firebase user child path',s.includes('async function resolveApiWallet')&&s.includes('wallet.path')&&s.includes("userPath=String(remoteUser?.firebasePath||'')")],
 ['API orders and refill records are persisted and owned by API username',s.includes('async function loadApiOwnedOrders')&&s.includes('async function persistApiOrderUpdate')&&s.includes('async function saveApiRefillRecord')&&s.includes("firebaseWriteJson('apiRefills/'+firebaseSafeKey(rec.id),rec,8000)")],
 ['API keys persist status and scopes and revocation is respected',s.includes("status:'pending',activationState:'pending',scopes:['services','balance','orders:read','orders:create','orders:cancel','orders:refill']")&&s.includes("['revoked','disabled','inactive'].includes(String(rec.status||'active').toLowerCase())")],
 ['Mutating supplier calls add/refill/cancel never auto-retry after ambiguous responses',s.includes("if(['add','refill','cancel'].includes(action))")&&s.includes('Mutating provider actions are one-shot')],
 ['Repeated identical API add requests are deduplicated even when client omits an idempotency token',s.includes('requestData.payloadHash')&&s.includes('Date.now()-120000')&&s.includes("['reserved','uncertain','completed'].includes(String(row.state||''))")],
 ['Refill intent is stored and verified in Firebase before calling the supplier',s.includes('async function saveApiRefillRecord')&&s.indexOf('await saveApiRefillRecord(rec,true);')<s.indexOf("providerRequest(prov,{action:'refill',order:String(order.providerOrderId)})")],
 ['Unknown supplier status responses are not returned as successful live status',s.includes("normalized==='unknown')return {http:502,body:{error:'Provider status response did not contain a recognized status")],
 ['API cancellation intent is persisted before supplier dispatch and ambiguous cancellations are not resent',(()=>{const a=s.indexOf('async function apiCancelOne('),b=s.indexOf('async function saveApiRefillRecord(',a),block=s.slice(a,b);return block.includes("cancelRequestState:'submitting'")&&block.indexOf("cancelRequestState:'submitting'")<block.indexOf("providerRequest(prov,{action:'cancel'")&&block.includes('if(order.cancelRequestedAt)')&&block.includes('The cancellation will not be resent automatically')})()],
 ['Refill records are written and read-verified in Firebase before being mirrored locally',(()=>{const a=s.indexOf('async function saveApiRefillRecord('),b=s.indexOf('async function apiRefillOne(',a),block=s.slice(a,b);return block.indexOf("await firebaseWriteJson('apiRefills/'")<block.indexOf("writeJSON('api_refills.json'")&&block.indexOf('await firebaseGetJson')<block.indexOf("writeJSON('api_refills.json'")})()],
 ['Concurrent refill requests use one atomic Firebase lock per user and order',s.includes('function apiRefillLockPath(username,orderId)')&&s.includes('const lockPath=apiRefillLockPath(auth.username,orderLabel)')&&s.includes('A refill request for this order is already pending or uncertain; it was not resent.')&&s.includes('await firebaseTransaction(lockPath')],
 ['Refill status responses preserve pending and uncertain states for the caller',s.includes('status:out.body.status,uncertain:!!out.body.uncertain')&&s.includes('status:value.status,uncertain:!!value.uncertain')],
 ['API admin activity endpoint, API-only block route, and central enforcement are present',s.includes("p==='/api/admin/api-users/activity'")&&s.includes("p==='/api/admin/api-users/block'")&&s.includes("apiKeyBlocks/")&&s.includes("req._apiAuthError='api_user_blocked'")],
 ['API developer cards expose activity and API-only block controls',h.includes('عرض الأنشطة')&&h.includes('حظر API للمستخدم')&&h.includes('/api/admin/api-users/activity?username=')&&h.includes('/api/admin/api-users/block')],

];
checks.push(
 ['production honors explicit FIREBASE_DATABASE_URL instead of silently pinning the bundled DB',s.includes("const CONFIGURED_FIREBASE_DATABASE_URL=String(process.env.FIREBASE_DATABASE_URL||'').trim()")&&s.includes("const FIREBASE_DATABASE_URL=String(CONFIGURED_FIREBASE_DATABASE_URL||BUNDLED_FIREBASE_DATABASE_URL)")&&!s.includes("process.env.NODE_ENV==='test' && process.env.FIREBASE_DATABASE_URL")],
 ['API-key admin diagnostic reports aggregates only and does not expose keys/users',(()=>{const a=s.indexOf("if(p==='/api/admin/api-key-diagnostics' && req.method==='GET')"),b=s.indexOf('// -------------------- Public API key management --------------------',a);const block=s.slice(a,b);return a>=0&&b>a&&block.includes('firebaseRecordCount')&&block.includes('validationPath')&&!block.includes('apiKey:raw')&&!block.includes('username:rec.username')})()],
 ['new API-key records bind SHA-256 hash and owner scopes to full key; legacy records remain readable',s.includes("keyHash:hash,hashAlgorithm:'sha256',version:3,status:'pending',activationState:'pending'")&&s.includes("if(rec.keyHash&&String(rec.keyHash).toLowerCase()!==hash.toLowerCase())return null")&&s.includes('Number(rec.version||0)>=3')],
 ['internal release version and build marker remain compatible with server APIs 1.6.41',/const APP_VERSION = '1\.6\.41'/.test(s)&&/SADA-1\.6\.41-PROVIDER-SYNC-SAFE-20261014/.test(s)&&/name="sada-version" content="1\.6\.41"/.test(h)&&/name="sada-build-id" content="SADA-1\.6\.41-PROVIDER-SYNC-SAFE-20261014"/.test(h)],
 ['AsiaCell state key uses stable sessionId across rotated session tokens',s.includes('const stateKey=sha256(String(webSession.sessionId||rawSid))')&&s.includes('sessionId:String(s.sessionId||token)')&&s.includes('sessionId:String(value?.sessionId||crypto.randomUUID())')],
 ['AsiaCell UI requires durable session persistence before proceeding',h.includes('d.sessionPersisted!==true')&&h.includes('حفظ الجلسة')],
 ['admin API key management lists safe metadata and supports Firebase-verified revocation',s.includes("if(p==='/api/admin/api-users' && req.method==='GET')")&&s.includes("if(p==='/api/admin/api-users/revoke' && req.method==='POST')")&&h.includes('sada32-api-list')&&h.includes('إلغاء هذا المفتاح')],
 ['Telegram sidebar channel URL can be edited from admin and read after save',s.includes("if(p==='/api/admin/site-links'&&req.method==='POST')")&&h.includes('sada32-telegram-url')&&h.includes('window.CFG.telegramChannelUrl=String(d.telegramChannelUrl)')],
 ['home and profile stats use real server summary fields',h.includes("window.api('/api/user/summary')")&&h.includes('completedOrders')&&h.includes('spentIQD')&&h.includes('loadHomeStats()')],
 ['wallet browsing includes motion and reduced-motion support',h.includes('sada1632-wallet-browse-fx')&&h.includes('prefers-reduced-motion:reduce')&&h.includes('IntersectionObserver')]
);


checks.push(
 ['AsiaCell wizard trusts server status rather than stale browser step state',h.includes("body:JSON.stringify({action:'status'})")&&h.includes('if(d.hasSession!==true){clearState();step=1;selected=1000')&&h.includes('sessionStorage is only a display cache')],
 ['AsiaCell always resets ordinary stale sessions before checking status on entry',h.includes("body:JSON.stringify({action:'reset'})" )&&h.includes("then(()=>request('/api/asiacell.php',{method:'POST',body:JSON.stringify({action:'status'})}))")],
 ['logout clears the open AsiaCell wizard and asks the server to discard unconfirmed OTP state',h.includes("fetch('/api/logout',{method:'POST'")&&h.includes("sessionStorage.removeItem('sada1637-asiacell-progress')")&&h.includes('onLogout:()=>{clearState();')],
 ['successful Firebase absence is authoritative across Railway instances',s.includes('successful Firebase read that returns null is authoritative')&&s.includes('if(!stored){ASIACELL_SESSIONS.delete(stateKey);return null;}')],
 ['uncertain AsiaCell transfers are indexed by user and protected from duplicate starts after logout',s.includes("const ASIACELL_PENDING_USER_NODE = 'asiacellPendingByUser'")&&s.includes('findPendingAsiacellSession')&&s.includes('writeAsiacellPendingPointer')&&s.includes("state.step==='provider_confirmed'" )],
 ['AsiaCell sessions expire after five minutes and UI close triggers immediate reset',s.includes('const ASIACELL_SESSION_TTL_MS = 5 * 60 * 1000')&&h.includes('let exitResetPromise=Promise.resolve()')&&h.includes('sada1637-asiacell-wizard-and-order-polish')&&h.includes("action:'reset'")&&h.includes('resend_transfer_code')&&!h.includes('EXIT_RESET_GRACE_MS=2*60*1000')],
 ['AsiaCell final step includes guarded resend code control with cooldown',h.includes('data-action=\"resend\"')&&h.includes('إعادة إرسال رمز التأكيد')&&s.includes('ASIACELL_MAX_RESEND_ATTEMPTS = 3')&&s.includes("action==='resend_transfer_code'")],
 ['API keys are pending at creation and auto-expire after 24 hours if never used',s.includes('const API_KEY_UNUSED_TTL_MS = 24 * 60 * 60 * 1000')&&s.includes("status:'pending',activationState:'pending'")&&s.includes('cleanupExpiredUnusedApiKeys')&&s.includes('async function deleteExpiredApiKey')],
 ['Non-critical images load lazily for low-bandwidth browsing',h.includes('sada1639-light-network-images')&&h.includes("img.loading='lazy'")&&h.includes('rel=\"preconnect\" href=\"https://sada-iraq-app-default-rtdb.firebaseio.com\"')]
);

let failures=0;
for(const [name,ok] of checks){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failures++;}
if(failures){console.error(failures+' static release checks failed');process.exit(1);}


async function testTelegramFallbackIsExactlyOnce(){
  const start=s.indexOf('function telegramOrderIdentity('),end=s.indexOf('\nasync function runTelegramNewOrdersMonitor',start);
  assert(start>=0&&end>start,'Telegram order idempotency functions should exist');
  const source=s.slice(start,end)+'\nglobalThis.__notifyTelegramNewOrder=notifyTelegramNewOrder;globalThis.__readTelegramOrderState=readTelegramOrderState;';
  let localState={initialized:true,seen:{}},remoteState={initialized:true,seen:{}},sendCount=0;
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const sandbox={
    readJSON:(file,fallback)=>file==='telegram_order_state.json'?clone(localState):fallback,
    writeJSON:(file,value)=>{if(file==='telegram_order_state.json')localState=clone(value)},
    firebaseGetJson:async path=>path==='config/telegramOrderState'?clone(remoteState):null,
    firebaseWriteJson:async(path,value)=>{if(path==='config/telegramOrderState')remoteState=clone(value);return true},
    DATA_IS_EXTERNAL:true,
    notifyTelegramRecipients:async()=>{sendCount++;return {ok:false,primaryOk:false,delivered:true,fallbackSent:true,deliveredTo:['admin-chat'],description:'القناة الأساسية فشلت لكن وصل الإشعار للأدمن'}},
    nowISO:()=>new Date('2026-10-13T00:00:00.000Z').toISOString(),
    Map,Set,Object,Array,String,Number,Date,Promise,Math,RegExp,Error,JSON
  };
  vm.runInNewContext(source,sandbox);
  const order={id:'3000',user:'alice',publicOrderNo:'3000',serviceName:'اختبار'};
  const first=await sandbox.__notifyTelegramNewOrder(order,{source:'test'});
  assert.equal(first.delivered,true,'a successful fallback destination counts as delivery');
  const second=await sandbox.__notifyTelegramNewOrder(order,{source:'monitor'});
  assert.equal(second.skipped,true,'a delivered order should not be resent by a later monitor pass');
  assert.equal(sendCount,1,'one order must trigger only one Telegram send even when the primary channel failed');
  const key='id:3000|u:alice';
  localState={initialized:true,seen:{[key]:{lastAttemptAt:'2026-10-12T00:00:00.000Z',attempts:2,primaryOk:false,pending:false,lastError:'old failure'}}};
  remoteState={initialized:true,seen:{[key]:{lastAttemptAt:'2026-10-12T00:01:00.000Z',attempts:2,primaryOk:false,adminFallbackDelivered:true,delivered:true,deliveredTo:['admin-chat'],sentAt:'2026-10-12T00:01:00.000Z'}}};
  const third=await sandbox.__notifyTelegramNewOrder(order,{source:'test-stale-local'});
  assert.equal(third.skipped,true,'a delivered Firebase record must beat a stale failed local record');
  assert.equal(sendCount,1,'merged local/Firebase delivery state must also prevent a repeat');
  console.log('PASS runtime Telegram idempotency: fallback delivery is recorded once and stale local state cannot resend');
}

async function testFirebaseDriverSelection(){
  const m=s.match(/function firebaseAdminEnabled\(\)\{[^}]+\}/);
  assert(m,'Firebase RTDB driver selector should exist');
  const sandbox={process:{env:{NODE_ENV:'production'}},String};
  vm.runInNewContext(m[0]+'\nglobalThis.__firebaseAdminEnabled=firebaseAdminEnabled;',sandbox);
  assert.equal(sandbox.__firebaseAdminEnabled(),false,'production without an explicit driver must use REST OAuth, matching the health-check path');
  sandbox.process.env.FIREBASE_RTDB_DRIVER='admin-sdk';
  assert.equal(sandbox.__firebaseAdminEnabled(),false,'wallet/RTDB driver must remain REST OAuth even if Railway has a stale admin-sdk variable');
  sandbox.process.env.NODE_ENV='test';
  assert.equal(sandbox.__firebaseAdminEnabled(),false,'test environment must not select the Admin SDK');
  console.log('PASS runtime Firebase driver selection: REST OAuth forced for all RTDB operations');
}

async function testPublicCounterRuntime(){
  const start=s.indexOf('async function nextPublicOrderNumber(){');
  const end=s.indexOf('\nfunction siteOrderById',start);
  assert(start>=0&&end>start,'public number allocator function should exist');
  const fnSource=s.slice(start,end)+'\nglobalThis.__testNextPublicOrderNumber=nextPublicOrderNumber;';
  let settings={publicOrderCounter:987654};
  let localOrders=[{id:'REQ_legacy_abc'},{id:'75000'},{id:'REQ_old_xyz'}];
  let remoteOrders={legacy:{id:'60000'},other:{id:'REQ_x'},oldPublic:{id:'REQ_public',publicOrderNo:''}};
  const sandbox={
    readJSON:(file,fallback)=>file==='settings.json'?JSON.parse(JSON.stringify(settings)):file==='orders.json'?JSON.parse(JSON.stringify(localOrders)):fallback,
    writeJSON:(file,value)=>{if(file==='settings.json')settings=JSON.parse(JSON.stringify(value));if(file==='orders.json')localOrders=JSON.parse(JSON.stringify(value));},
    withSiteOrderLock:fn=>fn(),
    firebaseGetJson:async path=>path==='orders'?JSON.parse(JSON.stringify(remoteOrders)):null,
    collectionEntries:root=>Array.isArray(root)?root.map((v,i)=>[String(i),v]):Object.entries(root||{}),
    Math,Number,String,Object,Array,Date,RegExp,Promise,Error
  };
  vm.runInNewContext(fnSource,sandbox);
  const first=await sandbox.__testNextPublicOrderNumber();
  assert.equal(first,'3000','stale counter/internal IDs must not jump public numbering');
  localOrders.push({id:'REQ_new',publicOrderNo:first});
  remoteOrders.next={id:'REQ_next',publicOrderNo:first};
  const second=await sandbox.__testNextPublicOrderNumber();
  assert.equal(second,'3001','subsequent public number must increment uniquely');
  console.log('PASS runtime public numbering: 3000 then 3001 despite stale counter/internal IDs');
}

async function testFirebaseUidKeyWalletCharge(){
  const decode=s.match(/function decodeFirebaseSafeKey\(value\)\{[^\n]+/);
  const normalize=s.match(/function normalizeEmail\(value\)\{[^\n]+/);
  const recordEmailStart=s.indexOf('function firebaseRecordEmail('),recordEmailEnd=s.indexOf('\nfunction validEmail(',recordEmailStart);
  const valid=s.match(/function validEmail\(value\)\{[^\n]+/);
  const findStart=s.indexOf('async function findRemoteUserByEmail('),findEnd=s.indexOf('\nfunction isCustomCategoryImage',findStart);
  const adjustStart=s.indexOf('async function adjustAdminUserBalance('),adjustEnd=s.indexOf('\n\n// Idempotently reconcile',adjustStart);
  assert(decode&&normalize&&recordEmailStart>=0&&recordEmailEnd>recordEmailStart&&valid&&findStart>=0&&findEnd>findStart&&adjustStart>=0&&adjustEnd>adjustStart,'email resolver and adjustment functions should exist');
  const source=decode[0]+'\n'+normalize[0]+'\n'+s.slice(recordEmailStart,recordEmailEnd)+'\n'+valid[0]+'\n'+s.slice(findStart,findEnd)+'\n'+s.slice(adjustStart,adjustEnd)+'\nglobalThis.__findRemoteUserByEmail=findRemoteUserByEmail;globalThis.__findRemoteUserByExactUsername=findRemoteUserByExactUsername;globalThis.__resolveAdminWalletUser=resolveAdminWalletUser;globalThis.__adjustAdminUserBalance=adjustAdminUserBalance;';
  let remoteRoot={users:{uid_cc4hsu6:{name:'محمد قاسم',balance:1000}}};
  let localStore={users:{cc4hsu6:{username:'cc4hsu6',uid:'uid_cc4hsu6',email:'test@example.com',balance:1000}}};
  const ledger=[],localLedger=[];
  const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  const get=(path)=>{const parts=String(path||'').split('/').filter(Boolean);let at=remoteRoot;for(const part of parts)at=at?.[part];return clone(at??null)};
  const put=(path,value)=>{const parts=String(path||'').split('/').filter(Boolean);let at=remoteRoot;for(const part of parts.slice(0,-1)){at[part] ||= {};at=at[part]}at[parts.at(-1)]=clone(value)};
  const sandbox={
    readJSON:(file,fallback)=>file==='users.json'?clone(localStore):fallback,
    writeJSON:(file,value)=>{if(file==='users.json')localStore=clone(value)},
    firebaseGetJson:async path=>get(path),
    findRemoteUserByUsername:async(username,preferredKey='')=>{const key=preferredKey&&remoteRoot.users?.[preferredKey]?preferredKey:username;const user=remoteRoot.users?.[key];return user&&String(user.username||key).toLowerCase()===String(username).toLowerCase()?{username:String(user.username||key),user:clone(user),firebasePath:'users/'+key}:null},
    firebaseTransaction:async(path,mutator)=>{const current=get(path);const decision=mutator(clone(current));if(!decision||decision.write===false)return {ok:true,changed:false,value:current,result:decision?.result||{}};put(path,decision.value);return {ok:true,changed:true,value:clone(decision.value),result:decision.result||{}}},
    firebaseWriteJson:async(path,value)=>{put(path,value);if(path.startsWith('balanceLedger/'))ledger.push(clone(value))},
    appendJsonLedger:(file,row)=>{localLedger.push(clone(row))},
    collectionEntries:root=>Array.isArray(root)?root.map((v,i)=>[String(i),v]):Object.entries(root||{}),
    decodeFirebaseSafeKey:v=>String(v||''),
    firebaseSafeKey:v=>String(v||''),
    nowISO:()=> '2026-10-12T00:00:00.000Z',
    FIXED_RATE:1250,ADMIN_USER:'admin',crypto:require('node:crypto'),
    String,Number,Object,Array,Map,Set,Math,Date,RegExp,Promise,Error,JSON
  };
  vm.runInNewContext(source,sandbox);
  // Current production symptom: RTDB child is keyed by auth UID and legacy user has no email field;
  // the unique local email profile carries that UID. A stale browser key must not override email.
  const resolved=await sandbox.__findRemoteUserByEmail(' TEST@example.com ','stale-cached-key','cc4hsu6');
  assert.equal(resolved?.firebasePath,'users/uid_cc4hsu6','unique local email plus UID must resolve the actual Firebase child record');
  const result=await sandbox.__adjustAdminUserBalance('cc4hsu6','charge',1,'Regression email-key charge','admin','stale-cached-key','test@example.com');
  assert.equal(result.ok,true,'email-verified account must be chargeable even with a stale cached Firebase key');
  assert.equal(remoteRoot.users.uid_cc4hsu6.balance,2250,'Firebase balance must rise by exactly 1250 IQD for USD 1');
  assert.equal(ledger.length,1,'one charge must create exactly one Firebase ledger event');
  assert.equal(localLedger.length,1,'one charge must create exactly one local audit event');
  assert.equal(localStore.users.cc4hsu6.balance,2250,'local mirror must reflect the Firebase committed balance');
  const before=remoteRoot.users.uid_cc4hsu6.balance;
  const unknown=await sandbox.__adjustAdminUserBalance('not-a-real-user','charge',1,'Must not charge any account','admin','uid_cc4hsu6','wrong@example.com');
  assert.equal(unknown.error,'user-not-found','unknown email must not charge a different Firebase record');
  assert.equal(remoteRoot.users.uid_cc4hsu6.balance,before,'failed email identity validation must not change balance');
  assert.equal(ledger.length,1,'failed identity validation must not write another ledger event');
  // Older schemas may store email in a nested profile or with different key casing.
  remoteRoot.users.uid_cc4hsu6.profile={EmailAddress:'test@example.com'};
  const nested=await sandbox.__findRemoteUserByEmail('test@example.com','stale-key','cc4hsu6');
  assert.equal(nested?.firebasePath,'users/uid_cc4hsu6','nested legacy email fields must resolve the matching record');
  delete remoteRoot.users.uid_cc4hsu6.profile;
  // If Firebase contains email explicitly, exact unique email takes precedence over a stale UI key.
  remoteRoot.users.uid_cc4hsu6.email='test@example.com';
  const direct=await sandbox.__findRemoteUserByEmail('test@example.com','wrong-stale-key','some-other-username');
  assert.equal(direct?.firebasePath,'users/uid_cc4hsu6','exact unique Firebase email must override a stale key and username hint');
  // Reproduce the production mismatch: wallet directory merged the records by phone,
  // but Firebase's legacy child has no email while the local profile stores the email.
  remoteRoot={users:{legacy_phone_key:{phoneNumber:'+9647700000000',balance:500}}};
  localStore={users:{cc4hsu6:{username:'cc4hsu6',email_address:'phone-link@example.com',phone:'+9647700000000',balance:500}}};
  const phoneLinked=await sandbox.__findRemoteUserByEmail('phone-link@example.com','legacy_phone_key','cc4hsu6');
  assert.equal(phoneLinked?.firebasePath,'users/legacy_phone_key','email-owned local profile must resolve a legacy Firebase record through the same verified phone alias as the wallet directory');
  const phoneCharge=await sandbox.__adjustAdminUserBalance('cc4hsu6','charge',1,'Regression charge via phone-linked legacy profile','admin','legacy_phone_key','phone-link@example.com');
  assert.equal(phoneCharge.ok,true,'the exact legacy phone-linked Firebase account must be chargeable via its unique local email profile');
  assert.equal(remoteRoot.users.legacy_phone_key.balance,1750,'the matched Firebase account must receive exactly 1250 IQD');
  assert.equal(localStore.users.cc4hsu6.balance,1750,'the local account mirror must reflect the committed Firebase balance');
  assert.equal(ledger.length,2,'a successful legacy-profile charge must append exactly one additional Firebase ledger event');
  // Duplicate email is ambiguous and must never pick a record by iteration order.
  remoteRoot={users:{uid_cc4hsu6:{email:'test@example.com',username:'cc4hsu6',balance:1000},other_uid:{email:'test@example.com',username:'cc4hsu6',balance:500}}};
  const duplicateBefore=remoteRoot.users.uid_cc4hsu6.balance;
  await assert.rejects(()=>sandbox.__findRemoteUserByEmail('test@example.com','uid_cc4hsu6','cc4hsu6'),/أكثر من سجل/);
  assert.equal(remoteRoot.users.uid_cc4hsu6.balance,duplicateBefore,'ambiguous duplicate email must not mutate either balance');
  // If a legacy Firebase row omits email, an exact verified username/key match can recover safely.
  remoteRoot={users:{cc4hsu6:{username:'cc4hsu6',balance:0}}};localStore={users:{}};
  const usernameFallback=await sandbox.__adjustAdminUserBalance('cc4hsu6','charge',2,'Username-only fallback regression','admin','cc4hsu6','');
  assert.equal(usernameFallback.ok,true,'exact unique Firebase username/key must support a username-only admin charge');
  assert.equal(remoteRoot.users.cc4hsu6.balance,2500,'username-only fallback must update the exact verified Firebase user balance');
  assert.equal(ledger.length,3,'username-only fallback must record exactly one extra Firebase ledger event');
  assert.equal(localLedger.length,3,'username-only fallback must record exactly one local audit row');
  // Match the owner-provided RTDB row exactly: users/cc4hsu6 with username and email fields.
  remoteRoot={users:{cc4hsu6:{username:'cc4hsu6',email:'cc4hsu6@gmail.com',balance:0}}};localStore={users:{}};
  const screenshotShape=await sandbox.__adjustAdminUserBalance('cc4hsu6','charge',1,'Exact Firebase screenshot shape','admin','users/cc4hsu6','cc4hsu6@gmail.com');
  assert.equal(screenshotShape.ok,true,'the exact Firebase schema shown by the owner must be chargeable');
  assert.equal(remoteRoot.users.cc4hsu6.balance,1250,'actual-shaped Firebase record must receive exactly 1250 IQD');
  assert.equal(ledger.length,4,'actual-shaped account charge must write exactly one additional ledger event');
  assert.equal(localLedger.length,4,'actual-shaped account charge must write one local audit row');
  // The exact selected Firebase child and exact email may be authoritative even when an old browser username hint is stale.
  remoteRoot={users:{uid_real:{username:'cc4hsu6',email:'cc4hsu6@gmail.com',balance:0}}};localStore={users:{}};
  const staleUsernameEmailCharge=await sandbox.__adjustAdminUserBalance('old-display-alias','charge',1,'Exact selected child plus exact email','admin','uid_real','cc4hsu6@gmail.com');
  assert.equal(staleUsernameEmailCharge.ok,true,'exact key + exact matching email should not be rejected solely because the UI username hint is stale');
  assert.equal(remoteRoot.users.uid_real.balance,1250,'only the exact selected Firebase record should receive the credit');
  assert.equal(ledger.length,5,'direct exact-email charge should append exactly one Firebase ledger event');
  assert.equal(localLedger.length,5,'direct exact-email charge should append exactly one local audit event');
  // Restore count expectations for subsequent conflict/ambiguity assertions.
  // An explicitly supplied but conflicting email must never charge a username-matched different account.
  remoteRoot={users:{cc4hsu6:{username:'cc4hsu6',email:'another@example.com',balance:700}}};localStore={users:{}};
  await assert.rejects(()=>sandbox.__adjustAdminUserBalance('cc4hsu6','charge',1,'Reject conflicting email identity','admin','cc4hsu6','cc4hsu6@gmail.com'),/البريد الإلكتروني لا يطابق/);
  assert.equal(remoteRoot.users.cc4hsu6.balance,700,'conflicting email must not mutate balance');
  assert.equal(ledger.length,5,'conflicting email must not create a ledger event');
  // Duplicate username records are ambiguous: do not select either one by object order or preferred key.
  remoteRoot={users:{cc4hsu6:{username:'cc4hsu6',balance:700},duplicate:{username:'cc4hsu6',balance:900}}};localStore={users:{}};
  await assert.rejects(()=>sandbox.__adjustAdminUserBalance('cc4hsu6','charge',1,'Reject ambiguous username','admin','cc4hsu6',''),/أكثر من سجل Firebase/);
  assert.equal(remoteRoot.users.cc4hsu6.balance,700,'ambiguous username must not mutate first candidate');
  assert.equal(remoteRoot.users.duplicate.balance,900,'ambiguous username must not mutate second candidate');
  assert.equal(ledger.length,5,'ambiguous username must not append ledger event');
  // If the selected child is readable but scanning the whole users collection times out,
  // a precise key+username+email match should work without falsely reporting bad credentials.
  const realFirebaseGet=sandbox.firebaseGetJson;
  let usersRootReads=0;
  remoteRoot={users:{cc4hsu6:{username:'cc4hsu6',email:'cc4hsu6@gmail.com',balance:0}}};localStore={users:{}};
  sandbox.firebaseGetJson=async path=>{if(String(path)==='users'){usersRootReads++;throw new Error('simulated collection scan timeout')}return realFirebaseGet(path)};
  const slowListCharge=await sandbox.__adjustAdminUserBalance('cc4hsu6','charge',1,'Direct-key wallet resolution without collection scan','admin','users/cc4hsu6','cc4hsu6@gmail.com');
  assert.equal(slowListCharge.ok,true,'exact direct child should work if full-list scan times out and identity is proven');
  assert.equal(remoteRoot.users.cc4hsu6.balance,1250,'direct fallback must update only the exact matched record');
  assert.equal(usersRootReads,0,'a unique, validated direct child must not depend on reading the entire users root');
  assert.equal(ledger.length,6,'direct fallback should save exactly one Firebase ledger event');
  assert.equal(localLedger.length,6,'direct fallback should append exactly one local audit event');
  sandbox.firebaseGetJson=realFirebaseGet;
  console.log('PASS runtime wallet regression: direct-key read avoids full-root dependency, email and username fallback, one-time ledger writes, conflicting/ambiguous identities rejected');
}

async function testTelegramFinanceMessage(){
  const start=s.indexOf('function telegramOrderMessage('),end=s.indexOf('\nfunction telegramOrderWasDelivered',start);
  assert(start>=0&&end>start,'Telegram order message formatter should exist');
  const source=s.slice(start,end)+'\nglobalThis.__formatTelegramOrder=telegramOrderMessage;';
  const sandbox={Number,String,Date,Intl,URL,nowISO:()=> '2026-10-13T00:00:00.000Z'};vm.runInNewContext(source,sandbox);
  const message=sandbox.__formatTelegramOrder({publicOrderNo:'3007',id:'API_example',user:'tester',userName:'Test Member',memberId:'592186',orderSource:'app',serviceName:'Mock service',category:'الخدمات المجانية',quantity:50,providerName:'Mock Provider',providerOrderId:'MOCK-90001',link:'https://example.com/reel',createdAt:'2026-10-13T20:38:00.000Z',free:true});
  for(const fragment of ['#3007','📍 من داخل التطبيق','رقم الطلب داخل التطبيق: 3007','📁 | الخدمة: Mock service','📱 | المنصة / القسم: الخدمات المجانية','♨️ | الكمية: 50','افتح الرابط من الزر أدناه','المزود: Mock Provider','رقم الطلب داخل المزود: MOCK-90001','مجاني 🎁','🆔 | المعرف: 592186','⌚ | الوقت: 13-10-2026 23:38'])assert(message.includes(fragment),'Telegram message should contain '+fragment);
  const apiMessage=sandbox.__formatTelegramOrder({publicOrderNo:'3008',user:'tester',apiCreated:true,link:'https://example.com'});assert(apiMessage.includes('🌐 عبر API / رابط الربط الخارجي'),'API orders must be labeled distinctly');
  const providerMessage=sandbox.__formatTelegramOrder({publicOrderNo:'3009',user:'tester',externalProviderOrder:true});assert(providerMessage.includes('🏢 طلب مباشر من رابط المزود'),'direct provider orders must be labeled distinctly');
  console.log('PASS runtime Telegram order message: formatted sections, link hint, Baghdad time, free type and source classification');
}

async function testCategoryServiceDescriptions(){
  const start=h.indexOf(' function descriptionFor(s){'),end=h.indexOf('\n function ensureDescriptionPanel',start);
  assert(start>=0&&end>start,'service description resolver should exist');
  const source=h.slice(start,end)+'\nglobalThis.__descriptionFor=descriptionFor;';
  const clean=v=>String(v??'').replace(/[\u200B-\u200F\uFEFF]/g,'').replace(/\s+/g,' ').trim();
  const fold=v=>clean(v).toLowerCase().normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[\s._-]+/g,' ');
  const sandbox={window:{SECTION_META:{Instagram:{name:'Instagram',description:'تعليمات القسم العامة'}}},clean,fold,String};
  vm.runInNewContext(source,sandbox);
  const combined=sandbox.__descriptionFor({categories:['Instagram'],description:'تفاصيل الخدمة من المزود'});
  assert.equal(combined,'تعليمات القسم العامة\n\nتفاصيل الخدمة من المزود','category description should appear before provider description for all services in that category');
  const manual=sandbox.__descriptionFor({categories:['Instagram'],description:'تفاصيل المزود',manualDescription:'الوصف اليدوي للخدمة'});
  assert.equal(manual,'الوصف اليدوي للخدمة','a service-specific manual description should take priority');
  console.log('PASS category descriptions: common description flows into every category service and service-specific manual text wins');
}

async function testCategoryImagePersistenceMerge(){
  const start=s.indexOf('function isCustomCategoryImage('),end=s.indexOf('\nfunction recordSuccessfulUserLogin',start);
  assert(start>=0&&end>start,'category image merge functions should exist');
  const source=s.slice(start,end)+'\nglobalThis.__mergeCategoryMetaRoots=mergeCategoryMetaRoots;';
  const sandbox={String,Object,Array,Set,RegExp};vm.runInNewContext(source,sandbox);
  const remote={ig:{name:'Instagram',image:'data:image/webp;base64,c3RhdGlj',customImage:true,imageIsCustom:true}};
  const local={ig:{name:'Instagram',image:'platform-icons/instagram.svg',customImage:false,imageIsCustom:false}};
  let merged=sandbox.__mergeCategoryMetaRoots(local,remote);
  assert.equal(merged.ig.image,remote.ig.image,'persisted custom Firebase image must restore when host local metadata has only a preset');
  const newer='data:image/webp;base64,bmV3';
  merged=sandbox.__mergeCategoryMetaRoots({ig:{name:'Instagram',image:newer,customImage:true,imageIsCustom:true}},remote);
  assert.equal(merged.ig.image,newer,'newer host custom image must beat a stale mirrored Firebase image');
  assert(/firebaseWriteJson\('categoryMeta\/'\+key,meta,12000\)/.test(s),'category editor save route must mirror custom image to Firebase');
  assert(/firebaseWriteJson\('categoryMeta\/'\+categoryKey,metaRoot\[categoryKey\],12000\)/.test(s),'service import route must mirror custom image to Firebase');
  console.log('PASS category image persistence: latest uploaded custom image wins and Firebase mirror restores after host file loss');
}


async function testInternalSiteServiceMapping(){
  const start=s.indexOf('function normalizeWebsiteOrderService'),end=s.indexOf('function publicApiService',start);
  assert(start>=0&&end>start,'website service mapping helpers should exist');
  const source=s.slice(start,end)+'\nglobalThis.__resolveWebsiteService=authoritativeWebsiteService;';
  const catalog={service_internal_abc:{providerId:'providerA',providerServiceId:'7392',smmpartyId:'7392',name:'Instagram test',sellingUsd:0.004,min:10,max:5000}};
  const sandbox={FIXED_RATE:1250,readJSON:(file,fallback)=>file==='services.json'?catalog:fallback,findInternalApiService:()=>null,String,Number,Object,Array};
  vm.runInNewContext(source,sandbox);
  const matched=await sandbox.__resolveWebsiteService('providerA','7392','service_internal_abc');
  assert.equal(matched.siteServiceId,'service_internal_abc','website must retain its own catalog child key as the internal service ID');
  assert.equal(matched.providerServiceId,'7392','the API provider service number must remain separate');
  assert.equal(matched.sellingUsd,0.004,'authoritative website selling price must come from the hosting catalog');
  const resolvedFromInternalId=await sandbox.__resolveWebsiteService('providerA','old-provider-id','service_internal_abc');
  assert.equal(resolvedFromInternalId.providerServiceId,'7392','a selected internal site key must resolve the canonical provider mapping rather than trust a stale provider ID');
  assert.equal(resolvedFromInternalId.siteServiceId,'service_internal_abc');
  console.log('PASS runtime internal service mapping: stable site ID, canonical provider ID and hosting price stay distinct');
}

Promise.all([testFirebaseDriverSelection(),testPublicCounterRuntime(),testFirebaseUidKeyWalletCharge(),testCategoryImagePersistenceMerge(),testCategoryServiceDescriptions(),testTelegramFallbackIsExactlyOnce(),testInternalSiteServiceMapping(),testTelegramFinanceMessage()]).then(()=>console.log('PASS '+(checks.length+8)+' release checks')).catch(e=>{console.error('FAIL runtime regression test:',e.stack||e);process.exit(1);});
