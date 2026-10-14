'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');

// Parse every inline JavaScript block so a small HTML patch cannot silently break the app.
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
let match, compiled = 0;
while ((match = scriptRe.exec(html))) {
  const attrs = match[1] || '';
  if (/\bsrc\s*=/.test(attrs) || /\btype\s*=\s*["'](?:application\/json|application\/ld\+json|importmap|module)["']/i.test(attrs)) continue;
  const code = match[2].replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
  if (!code.trim()) continue;
  try { new vm.Script(code, { filename: `index-inline-${compiled + 1}.js` }); }
  catch (error) { throw new Error(`Inline JavaScript block ${compiled + 1} is invalid: ${error.message}`); }
  compiled++;
}
assert.ok(compiled >= 50, `expected broad inline script coverage, got ${compiled}`);

// Regressions specifically covering automatic imports and large-catalog interaction costs.
assert.ok(server.includes("result.importPolicy='manual-approval-required'"), 'provider sync must remain manual-approval-only');
assert.ok(server.includes('function quarantineUnapprovedAutoImportedServices') && html.includes('تم تعطيل الحذف الجماعي القديم'), 'automatic-import quarantine/protected catalog behavior must remain in the release');
assert.ok(html.includes('const batchSize=100') && html.includes('appendBatch()'), 'service options must append in bounded batches');
assert.ok(!html.includes("arr.slice(150).forEach((s,i)=>more.before(render(s,i+150)))"), 'the old single-click render-all path must not return');
assert.ok(html.includes('cats.get(k).count++') && !html.includes("raw.filter(x=>catLabels(x).some(z=>key36(z)===key36(c))).length"), 'provider category counts must be collected in one pass');
assert.ok(html.includes('const providerSearchCache36=new WeakMap()') && html.includes('setTimeout(()=>{page=0;render()},120)'), 'large provider searches must reuse normalized search text and debounce redraws');
assert.ok(html.includes('const activeRows=active===\'all\'?allRows:allRows.filter(s=>supports(s,active))'), 'category dropdown must filter the active platform once, not rescan every category');
assert.ok(html.includes('const allBuckets=Object.entries(window.ALL_CATS||{}).filter(([name])=>key(name)===selected)'), 'selected category must use the category index before a full-catalog fallback');
assert.ok(html.includes('catServiceKeys=new Map()') && html.includes('seenByCategory=new Map()'), 'catalog indexes must use sets/maps instead of repeated array scans');

console.log(`PASS catalog performance and inline-JS smoke checks: ${compiled} inline scripts compiled; manual import and bounded rendering verified`);
