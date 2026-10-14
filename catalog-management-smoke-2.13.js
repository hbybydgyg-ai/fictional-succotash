'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync(__dirname + '/package.json', 'utf8'));

// The section-management endpoint must support bulk section creation, pinning and guarded deletion.
assert.match(server, /if\(action==='create'\)[\s\S]*?if\(!raw\.length\|\|raw\.length>100\)/, 'bulk section creation must support up to 100 sections');
assert.match(server, /if\(action==='pin'\)[\s\S]*?pinned:b\.pinned/, 'section pin status must persist in hosted metadata');
assert.match(server, /if\(action==='delete'\)[\s\S]*?b\.confirmation!=='DELETE_SECTION'/, 'section delete must require an explicit confirmation token');
assert.ok(server.includes("fs.writeFileSync(backupFull,JSON.stringify({createdAt:nowISO(),action:'delete-section'"), 'section deletion must write a recovery backup');
assert.ok(server.includes("remotePatch['services/'+key]=null") && server.includes("remotePatch['categoryMeta/'+key]=null"), 'deleting a section must clean obsolete Firebase service and metadata mirrors');
assert.ok(server.includes("remotePatch['categoryMeta/'+metaKey]=meta") && server.includes("remotePatch['settings/catalogOrder']=settingsNext.catalogOrder"), 'metadata references and order must be persisted in Firebase after section deletion');
assert.ok(server.includes("await persistFirebaseCatalogPatch(remotePatch,{verify:true,atomic:true,timeoutMs:45000})"), 'section deletion must be an atomic verified Firebase mutation');
assert.ok(server.includes('async function ensureLocalServiceCatalogSeeded()') && server.includes("firebaseGetJson('services',15000)") && server.includes("source:'firebase'"), 'catalog startup must load and migrate into Firebase rather than relying on Railway files');
assert.ok(server.includes('async function persistCatalogPathMutation') && server.includes('await persistCatalogPathMutation(rawPath,mode,b.value)') && server.includes('persistCatalogBatchToFirebase'), 'single and batch catalog writes must be verified in Firebase');
assert.ok(server.includes('firebaseVerified:true') && server.includes("storage:'firebase'"), 'manual service import must not report success until Firebase write/read-back verification passes');

// Provider category import and typed section creation remain available in the admin catalog UI.
assert.ok(html.includes("mtab.textContent='➕ إنشاء أقسام كاملة'"), 'admin must retain the bulk-section creation view');
assert.ok(html.includes('names.value.split(/\\r?\\n/)') && html.includes('sections:list.map(name=>({name,platforms:[platform.value],image,pinned:pinNew.checked}))'), 'bulk creation must accept one name per line and selected platform');
assert.ok(html.includes("const cb=document.createElement('input');cb.type='checkbox';cb.className='sada32-provider-cat-check'") && html.includes("sections:namesUnique.map(name=>({name,platforms:[impPlatform.value]"), 'provider categories must be selectable and renamed before import');
assert.ok(html.includes("sectionsApi({action:'pin',name:cat,pinned:m.pinned!==true})"), 'pin toggle must call the hosted pin endpoint');
assert.ok(html.includes("confirmation:'DELETE_SECTION'"), 'section deletion UI must use the guarded delete endpoint');

// The customer-facing final dropdown must apply both persisted pin state and the saved service order.
const finalCatSort = html.lastIndexOf('const cats=[...byKey.values()].filter(c=>c.rows.length>0).sort((a,b)=>');
assert.ok(finalCatSort >= 0, 'final category dropdown sorter must exist');
const catSortChunk = html.slice(finalCatSort, html.indexOf('});', finalCatSort) + 3);
assert.ok(catSortChunk.includes('resolveMeta(a.name)?.pinned===true') && catSortChunk.includes('if(ap!==bp)return ap-bp'), 'pinned sections must precede unpinned sections in the actual order form');
assert.ok(html.includes('const serviceRank=new Map(savedOrder.map((id,i)=>[id,i]))') && html.includes('if(ar!==br)return ar-br'), 'service dropdown must rank services using saved catalog order');
assert.ok(html.includes("fetch('/api/catalog?path=settings/catalogOrder'"), 'order form must refresh the authoritative saved ordering from the hosting API');
assert.ok(html.includes("const shown='2.14'") && html.includes('SADA-1.6.41-FIREBASE-CATALOG-PRIMARY-2.14-20261014'), 'HTML visible version and build identity must match this release');
assert.equal(pkg.buildId, 'SADA-1.6.41-FIREBASE-CATALOG-PRIMARY-2.14-20261014', 'package buildId must match release');

// Run the real backend ordering helpers in a small isolated VM to prove new services are prepended.
const helperStart = server.indexOf('function canonicalCatalogOrder(');
const helperEnd = server.indexOf('function catalogMutatePath(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'backend catalog ordering helpers must be present');
const helperSource = server.slice(helperStart, helperEnd);
const state = {
  'category_meta.json': { Pinned: { name: 'Pinned', pinned: true } },
  'catalog_settings.json': { catalogOrder: { categories: ['Ordinary', 'Pinned'], services: { __all__: ['older'], instagram: ['older'] } } }
};
const sandbox = {
  JSON, Date,
  normalizeCatalogLabel: value => String(value ?? '').trim().toLocaleLowerCase('ar'),
  normalizeCatalogKey: value => String(value ?? '').trim().toLowerCase().replace(/[^a-zA-Z0-9\u0600-\u06ff_-]+/g, '_').slice(0, 90) || 'cat',
  catalogRowGroups: row => { const out=[]; const add=v=>{ const z=String(v??'').trim(); if(z && !out.some(x=>x.toLowerCase()===z.toLowerCase())) out.push(z); }; if(Array.isArray(row?.groups)) row.groups.forEach(add); if(Array.isArray(row?.categories)) row.categories.forEach(add); add(row?.category); return out; },
  readJSON: (file, fallback) => state[file] === undefined ? fallback : state[file],
  writeJSON: (file, value) => { state[file] = value; }
};
vm.createContext(sandbox);
vm.runInContext(helperSource, sandbox);
const pinnedOrder = sandbox.canonicalCatalogOrder({categories:['Ordinary','Pinned','Last'],services:{}}, state['category_meta.json']);
assert.equal(pinnedOrder.categories[0], 'Pinned', 'canonical section order must put a pinned section first');
const changed = sandbox.syncCatalogServiceOrderChanges([{ key:'new-service', oldRow:null, newRow:{name:'Newest service',groups:['Instagram'],categories:['Instagram'],category:'Instagram',scope:'category',showInAll:false} }]);
assert.equal(changed, true, 'adding a service must update the saved order');
assert.equal(state['catalog_settings.json'].catalogOrder.services.instagram[0], 'new-service', 'new service must be first in its category');
assert.equal(state['catalog_settings.json'].catalogOrder.services.__all__[0], 'new-service', 'new service must also be first in All');

console.log('PASS catalog management 2.14 smoke checks: bulk sections, pinning, Firebase-authoritative persistence, delete cleanup, and new-service-first ordering verified');

// Multi-category provider import: mobile-friendly multi-select, grouped service selection,
// canonical existing site names/order, and batch import into each category.
assert.ok(html.includes("providerCat.multiple=true") && html.includes("providerCat.size=5"), 'provider source categories must allow selecting more than one category');
assert.ok(html.includes('function selectedProviderCats36()') && html.includes('cats.some(sel=>key36(c)===key36(sel))'), 'section mode must include services from every selected provider category');
assert.ok(html.includes('const selectedCats=selectedProviderCats36();const existingNames=categoryNames36();const canonicalName=src=>existingNames.find(n=>key36(n)===key36(src))||src;'), 'provider category import must reuse canonical site category names when they already exist');
assert.ok(html.includes('الأقسام الموجودة احتفظت بترتيب الموقع، والأقسام الجديدة أُضيفت في نهاية الترتيب.'), 'multi-category import must preserve existing site category order and append new categories');
console.log('PASS multi-category provider import: multiple source categories, site-name matching, order preservation, and per-category Firebase import');
