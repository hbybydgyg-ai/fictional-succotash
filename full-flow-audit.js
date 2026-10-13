'use strict';
// Full-flow audit: real API order lifecycle, provider price changes and security regressions.
// Runs the real server.js against a local Firebase RTDB test double and a local mock SMM provider.
// Usage: node full-flow-audit.js [directory-with-server.js]   (exit code 1 when a check fails)
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const SERVER_DIR = path.resolve(process.argv[2] || __dirname);
const MODE = process.argv[3] || 'full';
const results = [];
function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: detail === undefined ? '' : String(detail).slice(0, 400) }); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function listen(s) { return new Promise(function (res, rej) { s.once('error', rej); s.listen(0, '127.0.0.1', function () { res(s.address().port); }); }); }
function readBody(req) { return new Promise(function (res, rej) { var b = ''; req.on('data', function (c) { b += c; }); req.on('end', function () { res(b); }); req.on('error', rej); }); }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function parts(u) { return decodeURIComponent(u.pathname.replace(/^\/+/, '').replace(/\.json$/, '')).split('/').filter(Boolean); }
function getAt(root, p) { var x = root; for (var i = 0; i < p.length; i++) { if (!x || typeof x !== 'object' || !Object.prototype.hasOwnProperty.call(x, p[i])) return null; x = x[p[i]]; } return x === undefined ? null : x; }
function setAt(root, p, v) { var x = root; for (var i = 0; i < p.length - 1; i++) { if (!x[p[i]] || typeof x[p[i]] !== 'object' || Array.isArray(x[p[i]])) x[p[i]] = {}; x = x[p[i]]; } var last = p[p.length - 1]; if (v === null) delete x[last]; else x[last] = clone(v); }

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sada-audit-'));
  const rootDb = { users: {
    tester: { username: 'tester', email: 'tester@example.com', balance: 100000, discountPct: 0 },
    other: { username: 'other', email: 'other@example.com', balance: 50000, discountPct: 0 },
    racer: { username: 'racer', email: 'racer@example.com', balance: 60000, discountPct: 0 } }, orders: {}, apiKeys: {} };
  var ver = 1;
  const db = http.createServer(async function (req, res) {
    try {
      const body = await readBody(req); const p = parts(new URL(req.url, 'http://127.0.0.1')); const m = req.method || 'GET';
      res.setHeader('Content-Type', 'application/json');
      if (m === 'GET') { res.setHeader('ETag', '"' + ver + '"'); res.end(JSON.stringify(clone(getAt(rootDb, p)))); return; }
      if (m === 'PUT') { const im = req.headers['if-match']; if (im && im !== '"' + ver + '"') { res.statusCode = 412; res.end('{"error":"precondition failed"}'); return; }
        const v = body ? JSON.parse(body) : null; setAt(rootDb, p, v); ver++; res.setHeader('ETag', '"' + ver + '"'); res.end(JSON.stringify(v)); return; }
      if (m === 'PATCH') { const v = body ? JSON.parse(body) : {}; const cur = getAt(rootDb, p) || {}; const nx = Object.assign({}, cur, v); setAt(rootDb, p, nx); ver++; res.setHeader('ETag', '"' + ver + '"'); res.end(JSON.stringify(nx)); return; }
      if (m === 'DELETE') { setAt(rootDb, p, null); ver++; res.end('null'); return; }
      res.statusCode = 405; res.end('{}');
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message || e) })); }
  });
  const dbPort = await listen(db);

  // ---- mock SMM provider (mutable: prices, outages, order statuses) ----
  const P = { rates: { 77: 2.5, 78: 1.0, 79: 10 }, zero: {}, orders: {}, next: 90001, adds: [], servicesFail: false, servicesCalls: 0 };
  const provider = http.createServer(async function (req, res) {
    const text = await readBody(req); const q = new URLSearchParams(text);
    res.setHeader('Content-Type', 'application/json');
    if (q.get('key') !== 'mock-provider-secret') { res.statusCode = 401; res.end('{"error":"bad key"}'); return; }
    const a = q.get('action');
    if (a === 'add') { const id = String(P.next++); P.orders[id] = { status: 'Pending', remains: Number(q.get('quantity')), start_count: 0, charge: '0.1' }; P.adds.push({ id: id, service: q.get('service'), link: q.get('link'), quantity: Number(q.get('quantity')) }); res.end(JSON.stringify({ order: Number(id) })); return; }
    if (a === 'status') { const o = P.orders[q.get('order')]; if (!o) { res.end('{"error":"Incorrect order ID"}'); return; } res.end(JSON.stringify(o)); return; }
    if (a === 'balance') { res.end('{"balance":"500.00","currency":"USD"}'); return; }
    if (a === 'services') { P.servicesCalls++; if (P.servicesFail) { res.statusCode = 500; res.end('{"error":"boom"}'); return; }
      res.end(JSON.stringify(Object.keys(P.rates).map(function (id) { return { service: Number(id), name: 'Mock ' + id, type: 'Default', category: 'Test', rate: String(P.zero[id] ? 0 : P.rates[id]), min: 1, max: 1000000, refill: false, cancel: true }; }))); return; }
    res.statusCode = 422; res.end('{"error":"unsupported"}');
  });
  const provPort = await listen(provider);

  const data = path.join(tmp, 'data'); fs.mkdirSync(data, { recursive: true });
  function svcRow(key, site, prov, cost, sell) { return { fbKey: key, siteServiceId: site, providerId: 'mock-provider', providerServiceId: prov, smmpartyId: prov, serviceId: site, name: 'Mock service ' + site, category: 'Test', sellingUsd: sell, providerRateUsd: cost, min: 1, max: 100000, active: true, refill: false, cancel: true, type: 'default' }; }
  fs.writeFileSync(path.join(data, 'services.json'), JSON.stringify({ 'svc-a': svcRow('svc-a', '1001', '77', 2.5, 3.75), 'svc-b': svcRow('svc-b', '1002', '78', 1.0, 1.5), 'svc-c': svcRow('svc-c', '1003', '79', 10, 15) }));
  fs.writeFileSync(path.join(data, 'providers.runtime.json'), JSON.stringify({ activeProvider: 'mock-provider', providers: { 'mock-provider': { id: 'mock-provider', name: 'Mock SMM Provider', url: 'http://127.0.0.1:' + provPort, key: 'mock-provider-secret' } }, deletedProviderIds: [] }));
  fs.writeFileSync(path.join(data, 'providers.json'), JSON.stringify({ activeProvider: '', providers: {}, deletedProviderIds: [] }));
  fs.writeFileSync(path.join(data, 'users.json'), JSON.stringify({ users: {} }));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ pricing: { markupPct: 50, autoSync: true, intervalHours: 1 } }));

  const tmpSrv = http.createServer(); const appPort = await listen(tmpSrv); await new Promise(function (r) { tmpSrv.close(r); });
  const SECRET = 'audit-session-secret-at-least-32-characters-long';
  const env = { NODE_ENV: 'test', PORT: String(appPort), SADA_DATA_DIR: data, FIREBASE_DATABASE_URL: 'http://127.0.0.1:' + dbPort, FIREBASE_ALLOW_UNAUTHENTICATED: 'true', ALLOW_LOCAL_PROVIDER_TEST: '1', SESSION_SECRET: SECRET, SADA_ENCRYPTION_KEY: 'audit-encryption-secret-at-least-32-characters', PRICE_GUARD_TTL_SECONDS: '5', PATH: '/usr/bin:/bin' };
  if (MODE === 'watcher') { env.PRICE_WATCH_SECONDS = '10'; env.PRICE_WATCH_FIRST_DELAY_SECONDS = '3'; }
  const app = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  var out = ''; app.stdout.on('data', function (d) { out += d; }); app.stderr.on('data', function (d) { out += d; });
  const base = 'http://127.0.0.1:' + appPort; var ipCounter = 0;
  async function call(method, p, o) {
    o = o || {}; const headers = Object.assign({ 'X-Forwarded-For': o.xff || ('203.0.113.' + (++ipCounter % 250 + 1) + '.' + Math.floor(ipCounter / 250)) }, o.headers || {});
    const t0 = Date.now(); const r = await fetch(base + p, { method: method, headers: headers, body: o.body });
    const text = await r.text(); var d; try { d = text ? JSON.parse(text) : null; } catch (e) { d = { raw: text.slice(0, 200) }; }
    return { status: r.status, data: d, ms: Date.now() - t0 };
  }
  function cookie(user, role) { const pl = Buffer.from(JSON.stringify({ username: user, role: role || 'user', iat: Date.now() })).toString('base64url'); return 'sadairaq_sid=' + pl + '.' + crypto.createHmac('sha256', SECRET).update(pl).digest('base64url'); }
  const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
  function v1(key, params, extraHeaders) { params = Object.assign({}, params); if (key) params.key = key; return call('POST', '/api/v1', { headers: Object.assign({}, FORM, extraHeaders || {}), body: new URLSearchParams(params).toString() }); }
  const IQD = function (u) { return rootDb.users[u].balance; };
  const near = function (a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.01 : tol); };

  try {
    var up = false, health = null;
    for (var i = 0; i < 120; i++) { if (app.exitCode !== null) throw new Error('server exited: ' + out.slice(-800)); try { const r = await call('GET', '/api/health'); if (r.status === 200) { up = true; health = r.data; break; } } catch (e) {} await wait(100); }
    check('server starts against local test database', up, up ? health.version + ' ' + (health.securityPatch || 'no-patch-marker') : out.slice(-300));
    if (!up) throw new Error('not up');
    check('health: all build markers consistent', health.deploymentConsistent === true, health.deploymentConsistent);

    // ---- API keys ----
    const keys = {};
    for (const u of ['tester', 'other', 'racer']) { const r = await call('POST', '/api/user/api-key', { headers: { Cookie: cookie(u) } }); keys[u] = r.data && r.data.apiKey; check('key created for ' + u, r.status === 200 && /^sr_/.test(keys[u] || ''), r.status); }
    const K = keys.tester;
    if (MODE === 'watcher') {
      // The provider changes prices while NOBODY orders and NOBODY touches the admin panel.
      P.rates[77] = 5; P.rates[79] = 14; await wait(7000);
      var w = await v1(K, { action: 'services' }); var wl = Array.isArray(w.data) ? w.data : []; var wr = function (id) { var s = wl.filter(function (x) { return x.id === id; })[0]; return s ? s.rate : null; };
      check('WATCHER (no order, no admin): first cycle re-priced 1001 (cost 5 -> 7.50) and 1003 (cost 14 -> 21.00)', near(wr('1001'), 7.5, 1e-4) && near(wr('1003'), 21, 1e-4), '1001=' + wr('1001') + ' 1003=' + wr('1003'));
      P.rates[78] = 0.4; await wait(12500);
      w = await v1(K, { action: 'services' }); wl = Array.isArray(w.data) ? w.data : [];
      check('WATCHER (no order, no admin): later cycle followed a price DROP (1002 cost 0.4 -> 0.60)', near(wr('1002'), 0.6, 1e-4), '1002=' + wr('1002'));
      P.rates[77] = 9; P.servicesFail = true; await wait(11000); P.servicesFail = false;
      w = await v1(K, { action: 'services' }); wl = Array.isArray(w.data) ? w.data : [];
      check('WATCHER: provider outage keeps last known prices (1001 stays 7.50), no zero/blank prices', near(wr('1001'), 7.5, 1e-4) && wl.every(function (s) { return s.rate > 0; }), '1001=' + wr('1001'));
      await wait(11000);
      w = await v1(K, { action: 'services' }); wl = Array.isArray(w.data) ? w.data : [];
      check('WATCHER: after the outage ends it catches up automatically (1001 cost 9 -> 13.50)', near(wr('1001'), 13.5, 1e-4), '1001=' + wr('1001'));
      var st = await call('GET', '/api/admin/pricing', { headers: { Cookie: cookie('admin', 'admin') } });
      check('admin pricing endpoint reports watcher status', st.status === 200 && st.data && st.data.guard && !!st.data.guard.lastWatchAt, JSON.stringify(st.data && st.data.guard));
      throw new Error('__done__');
    }

    // ---- catalogue ----
    var r = await v1(K, { action: 'services' });
    var list = Array.isArray(r.data) ? r.data : [];
    check('services: 3 services with numeric site IDs and selling price', r.status === 200 && list.length === 3 && list.every(function (s) { return /^\d{4,}$/.test(s.id); }), JSON.stringify(list.map(function (s) { return s.id + ':' + s.rate; })));
    r = await v1(K, { action: 'balance' });
    check('balance returns USD wallet (100000 IQD = 80 USD)', r.status === 200 && near(r.data.balance, 80, 1e-6), JSON.stringify(r.data));

    // ---- real order #1 : create, charge, provider call, persistence ----
    var before = IQD('tester');
    r = await v1(K, { action: 'add', service: '1001', link: 'https://instagram.com/p/AUDIT1', quantity: '2000', idempotency_key: 'audit-1' });
    const o1 = r.data || {};
    check('order #1 accepted', r.status === 200 && !!o1.order, r.status + ' ' + JSON.stringify(o1).slice(0, 150));
    check('order #1 charged exactly 2000/1000 x 3.75 USD = 9375 IQD', near(before - IQD('tester'), 9375, 0.01), 'charged ' + (before - IQD('tester')));
    check('order #1 sent once to the provider with the PROVIDER service id', P.adds.length === 1 && P.adds[0].service === '77' && P.adds[0].quantity === 2000 && P.adds[0].link === 'https://instagram.com/p/AUDIT1', JSON.stringify(P.adds[0]));
    check('order #1 stored in database', Object.values(rootDb.orders).some(function (o) { return o && o.user === 'tester' && o.publicOrderNo === String(o1.order); }), Object.keys(rootDb.orders).length + ' orders');
    P.orders[P.adds[0].id].status = 'In progress';
    r = await v1(K, { action: 'status', order: String(o1.order) });
    check('status: in-progress mapped', r.status === 200 && /process|progress/i.test(String(r.data.status)), JSON.stringify(r.data).slice(0, 160));
    P.orders[P.adds[0].id].status = 'Completed'; P.orders[P.adds[0].id].remains = 0;
    var b2 = IQD('tester'); r = await v1(K, { action: 'status', order: String(o1.order) });
    check('status: completed, wallet untouched', r.status === 200 && /complete/i.test(String(r.data.status)) && IQD('tester') === b2, JSON.stringify(r.data).slice(0, 160));

    // ---- partial order: refund of the undelivered part exactly once ----
    before = IQD('tester'); r = await v1(K, { action: 'add', service: '1001', link: 'https://instagram.com/p/AUDIT2', quantity: '1000', idempotency_key: 'audit-2' });
    const o2 = r.data || {}; const prov2 = P.adds[P.adds.length - 1].id; const charged2 = before - IQD('tester');
    check('order #2 charged 4687.5 IQD', near(charged2, 4687.5, 0.01), charged2);
    P.orders[prov2].status = 'Partial'; P.orders[prov2].remains = 400;
    b2 = IQD('tester'); r = await v1(K, { action: 'status', order: String(o2.order) });
    const refund1 = IQD('tester') - b2;
    check('partial: undelivered 400/1000 refunded (expected 1875 IQD)', near(refund1, 1875, 1), 'refunded ' + refund1 + ' status=' + (r.data && r.data.status));
    b2 = IQD('tester'); await v1(K, { action: 'status', order: String(o2.order) });
    check('partial: second status check does NOT refund again', IQD('tester') === b2, 'delta ' + (IQD('tester') - b2));

    // ---- canceled order: full refund exactly once ----
    before = IQD('tester'); r = await v1(K, { action: 'add', service: '1002', link: 'https://instagram.com/p/AUDIT3', quantity: '1000', idempotency_key: 'audit-3' });
    const o3 = r.data || {}; const prov3 = P.adds[P.adds.length - 1].id; const charged3 = before - IQD('tester');
    P.orders[prov3].status = 'Canceled'; b2 = IQD('tester'); r = await v1(K, { action: 'status', order: String(o3.order) });
    check('canceled: full charge refunded (' + charged3 + ' IQD)', near(IQD('tester') - b2, charged3, 1), 'refunded ' + (IQD('tester') - b2));
    b2 = IQD('tester'); await v1(K, { action: 'status', order: String(o3.order) });
    check('canceled: second status check does NOT refund again', IQD('tester') === b2);

    // ---- input validation / abuse ----
    const addsBefore = P.adds.length; const balBefore = IQD('tester');
    const bad = [['quantity 0', { service: '1001', link: 'https://x.co/a', quantity: '0' }], ['negative quantity', { service: '1001', link: 'https://x.co/a', quantity: '-5' }], ['fractional quantity', { service: '1001', link: 'https://x.co/a', quantity: '1.5' }], ['text quantity', { service: '1001', link: 'https://x.co/a', quantity: 'abc' }], ['quantity above service max', { service: '1001', link: 'https://x.co/a', quantity: '1000000000' }], ['missing link', { service: '1001', quantity: '100' }], ['javascript: link', { service: '1001', link: 'javascript:alert(1)', quantity: '100' }], ['ftp link', { service: '1001', link: 'ftp://x.co/a', quantity: '100' }], ['oversized link', { service: '1001', link: 'https://x.co/' + 'a'.repeat(2500), quantity: '100' }], ['non-numeric service', { service: 'abc', link: 'https://x.co/a', quantity: '100' }], ['injection in service', { service: '1001; DROP', link: 'https://x.co/a', quantity: '100' }], ['unknown service', { service: '9999', link: 'https://x.co/a', quantity: '100' }]];
    const leaks = [];
    for (const b of bad) { const rr = await v1(K, Object.assign({ action: 'add' }, b[1])); if (rr.status === 200) leaks.push(b[0]); }
    check('12 invalid orders all rejected, nothing sent to provider, wallet untouched', leaks.length === 0 && P.adds.length === addsBefore && IQD('tester') === balBefore, 'accepted: ' + leaks.join(',') + ' | adds ' + (P.adds.length - addsBefore) + ' | wallet delta ' + (balBefore - IQD('tester')));
    r = await v1(K, { action: 'add', service: '1003', link: 'https://x.co/rich', quantity: '100000' });
    check('insufficient balance -> 402, provider not called, wallet untouched', r.status === 402 && P.adds.length === addsBefore && IQD('tester') === balBefore, r.status);

    // ---- authentication ----
    r = await call('GET', '/api/v1?action=balance'); check('no key -> 401', r.status === 401, r.status);
    r = await call('GET', '/api/v1/balance?key=' + encodeURIComponent(K)); check('key in URL query string is NOT accepted (it would leak into logs)', r.status === 401, r.status);
    r = await call('GET', '/api/v1/balance', { headers: { Authorization: 'Bearer ' + K } }); check('Bearer header accepted', r.status === 200, r.status);
    r = await call('GET', '/api/v1/balance', { headers: { 'X-API-Key': K } }); check('X-API-Key header accepted', r.status === 200, r.status);
    r = await call('GET', '/api/v1/balance', { headers: { 'X-API-Key': 'sr_' + 'A'.repeat(43) } }); check('forged key -> 401', r.status === 401, r.status);
    r = await call('GET', '/api/v1/balance', { headers: { 'X-API-Key': K.slice(0, -1) + (K.slice(-1) === 'A' ? 'B' : 'A') } }); check('key with one changed character -> 401', r.status === 401, r.status);

    // ---- isolation between customers ----
    r = await v1(keys.other, { action: 'status', order: String(o1.order) }); check("another customer cannot read tester's order", r.status === 404, r.status + ' ' + JSON.stringify(r.data).slice(0, 100));
    r = await call('GET', '/api/v1/orders', { headers: { 'X-API-Key': keys.other } }); check("another customer's order list is empty", r.status === 200 && Array.isArray(r.data) && r.data.length === 0, JSON.stringify(r.data).slice(0, 100));
    r = await v1(keys.other, { action: 'cancel', order: String(o1.order) }); check("another customer cannot cancel tester's order", r.status !== 200 || (Array.isArray(r.data) && r.data[0] && r.data[0].cancel === 0), r.status + ' ' + JSON.stringify(r.data).slice(0, 100));

    // ---- double-spend races ----
    const rb = IQD('racer'); const adds0 = P.adds.length;
    const race = await Promise.all([1, 2, 3, 4, 5].map(function (n) { return v1(keys.racer, { action: 'add', service: '1001', link: 'https://x.co/race' + n, quantity: '10000', idempotency_key: 'race-' + n }); }));
    const won = race.filter(function (x) { return x.status === 200; }).length; const sent = P.adds.length - adds0;
    check('5 parallel orders with wallet for only 1: exactly one wins, no negative wallet', won === 1 && sent === 1 && IQD('racer') >= 0 && near(rb - IQD('racer'), 46875, 0.01), 'won=' + won + ' sent=' + sent + ' wallet=' + IQD('racer') + ' statuses=' + race.map(function (x) { return x.status; }).join(','));
    var tb = IQD('tester'); const adds1 = P.adds.length;
    const same = await Promise.all([1, 2, 3, 4, 5].map(function () { return v1(K, { action: 'add', service: '1002', link: 'https://x.co/same', quantity: '1000', idempotency_key: 'same-key' }); }));
    check('5 parallel requests with the SAME idempotency key: charged once, sent once', P.adds.length - adds1 === 1 && near(tb - IQD('tester'), 1875, 0.01), 'sent=' + (P.adds.length - adds1) + ' charged=' + (tb - IQD('tester')) + ' statuses=' + same.map(function (x) { return x.status; }).join(','));

    // ---- PROVIDER PRICE CHANGES ----
    // A) provider raises service 77 from 2.5 to 4.0 USD and 79 from 10 to 14; nobody touches the panel.
    P.rates[77] = 4.0; P.rates[79] = 14; await wait(5600);
    tb = IQD('tester'); r = await v1(K, { action: 'add', service: '1001', link: 'https://x.co/after-rise', quantity: '1000', idempotency_key: 'rise-1' });
    var chargedUsd = (tb - IQD('tester')) / 1250;
    check('PRICE RISE: order placed right after the provider raised its price is not sold below provider cost (4.00 USD)', r.status === 200 && chargedUsd >= 4.0 - 1e-6, 'charged ' + chargedUsd.toFixed(4) + ' USD per 1000, provider now charges 4.0000');
    check('PRICE RISE: customer is charged new cost + 50% markup = 6.00 USD', near(chargedUsd, 6.0, 1e-4), chargedUsd.toFixed(4));
    // website order path (browser flow) on service 1003: provider cost 10 -> 14, expected 21 USD
    tb = IQD('tester'); r = await call('POST', '/api/order/create', { headers: { 'Content-Type': 'application/json', Cookie: cookie('tester') }, body: JSON.stringify({ providerId: 'mock-provider', siteServiceId: '1003', providerServiceId: '79', firebaseServiceKey: 'svc-c', link: 'https://x.co/web-after-rise', quantity: 1000, localId: 'LOCAL-AUDIT-1' }) });
    chargedUsd = (tb - IQD('tester')) / 1250;
    check('PRICE RISE (website order path): charged at least the new provider cost (14 USD) and exactly 21 USD', r.status === 200 && near(chargedUsd, 21, 1e-3), 'status ' + r.status + ' charged ' + chargedUsd.toFixed(4) + ' ' + JSON.stringify(r.data).slice(0, 120));
    // B) admin sync (what the hourly job does) must also converge the catalogue
    r = await call('POST', '/api/admin/pricing/sync', { headers: { Cookie: cookie('admin', 'admin'), 'Content-Type': 'application/json' }, body: '{}' });
    r = await v1(K, { action: 'services' }); list = Array.isArray(r.data) ? r.data : []; const rateOf = function (id) { const s = list.filter(function (x) { return x.id === id; })[0]; return s ? s.rate : null; };
    check('PRICE RISE: catalogue shows new prices after sync (1001=6.00, 1003=21.00)', near(rateOf('1001'), 6, 1e-4) && near(rateOf('1003'), 21, 1e-4), '1001=' + rateOf('1001') + ' 1003=' + rateOf('1003'));
    // C) provider LOWERS price: customers get the lower price too
    P.rates[78] = 0.5; await wait(5600);
    tb = IQD('tester'); r = await v1(K, { action: 'add', service: '1002', link: 'https://x.co/after-drop', quantity: '1000', idempotency_key: 'drop-1' });
    chargedUsd = (tb - IQD('tester')) / 1250;
    check('PRICE DROP: order is charged the new lower price (0.75 USD)', r.status === 200 && near(chargedUsd, 0.75, 1e-4), chargedUsd.toFixed(4));
    // D) provider glitch: reports 0 for a paid service -> must never become free
    P.zero[79] = true; await wait(5600);
    tb = IQD('tester'); r = await v1(K, { action: 'add', service: '1003', link: 'https://x.co/zero', quantity: '1000', idempotency_key: 'zero-1' });
    chargedUsd = (tb - IQD('tester')) / 1250;
    check('PROVIDER GLITCH (rate 0): paid service is not given away free', chargedUsd >= 14 - 1e-6, 'charged ' + chargedUsd.toFixed(4));
    await call('POST', '/api/admin/pricing/sync', { headers: { Cookie: cookie('admin', 'admin'), 'Content-Type': 'application/json' }, body: '{}' });
    r = await v1(K, { action: 'services' }); list = Array.isArray(r.data) ? r.data : [];
    check('PROVIDER GLITCH (rate 0): catalogue keeps a non-zero price after sync', rateOf('1003') > 0, '1003=' + rateOf('1003'));
    P.zero[79] = false;
    // E) provider catalogue endpoint down: orders still work at the saved price, quickly
    P.servicesFail = true; await wait(5600);
    tb = IQD('tester'); r = await v1(K, { action: 'add', service: '1002', link: 'https://x.co/outage', quantity: '1000', idempotency_key: 'outage-1' });
    chargedUsd = (tb - IQD('tester')) / 1250;
    check('PROVIDER CATALOGUE OUTAGE: order still accepted at saved price (>0), under 30s', r.status === 200 && chargedUsd > 0 && r.ms < 30000, 'status ' + r.status + ' charged ' + chargedUsd.toFixed(4) + ' in ' + r.ms + 'ms');
    P.servicesFail = false;

    // ---- security regressions ----
    var limited = 0; const hdrs = function (n) { return { 'X-Forwarded-For': '10.0.0.' + n + ', 9.9.9.9' }; };
    for (var k = 0; k < 70; k++) { const rr = await call('GET', '/api/v1/balance', { headers: hdrs(1), xff: '10.0.0.1, 9.9.9.9' }); if (rr.status === 429) limited++; }
    const spoof = await call('GET', '/api/v1/balance', { xff: '10.0.0.2, 9.9.9.9' });
    check('rate limit works (>=1 request limited after 60/min)', limited >= 1, 'limited ' + limited);
    check('rate limit CANNOT be reset by changing a client-supplied X-Forwarded-For prefix', spoof.status === 429, 'spoofed request got ' + spoof.status + ' (429 = still limited)');
    for (const f of ['/START_HERE_AR.txt', '/database.rules.json', '/release-smoke-1.6.29.js', '/api-runtime-smoke-1.6.29.js', '/release-smoke-1.6.31.js', '/api-runtime-smoke-1.6.31.js', '/asiacell-runtime-smoke-1.6.31.js', '/railway.json', '/server.js', '/package.json', '/data/users.json', '/.env']) { r = await call('GET', f); check('static: ' + f + ' is not publicly downloadable', r.status === 403 || r.status === 404, r.status); }
    r = await call('GET', '/index.html'); check('static: index.html is still served', r.status === 200, r.status);
    const src = fs.readFileSync(path.join(SERVER_DIR, 'server.js'), 'utf8');
    const m = src.match(/process\.env\.ADMIN_PASSWORD\s*\|\|\s*'([^']+)'/);
    check('source has no hard-coded fallback admin password', !m, m ? 'FOUND a hard-coded fallback in server.js' : '');
    var cap = await call('GET', '/api/auth/captcha', { xff: '198.51.100.7' }); var nums = String(cap.data && cap.data.question || '').match(/\d+/g) || [0, 0];
    const guessPw = m ? m[1] : 'definitely-not-the-admin-password';
    r = await call('POST', '/api/auth', { xff: '198.51.100.7', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'hsydgyg5@gmail.com', password: guessPw, captchaId: cap.data.captchaId, captchaAnswer: String(Number(nums[0]) + Number(nums[1])) }) });
    check('admin login with no ADMIN_PASSWORD configured is refused', r.status !== 200 || !(r.data && r.data.role === 'admin'), 'status ' + r.status + (m ? ' (tried the hard-coded fallback)' : ''));
    r = await call('POST', '/api/v1', { headers: Object.assign({ 'Content-Type': 'application/json' }, { 'X-API-Key': K }), body: JSON.stringify({ action: 'balance', pad: 'x'.repeat(2 * 1024 * 1024) }) });
    check('oversized request body rejected without crashing', r.status >= 400 && r.status < 500, r.status);
    r = await call('GET', '/api/health'); check('server still healthy after all abuse tests', r.status === 200, r.status);
  } catch (e) {
    if (String(e && e.message) !== '__done__') check('audit crashed', false, String(e && e.stack || e).slice(0, 300));
  } finally {
    app.kill('SIGTERM'); await Promise.race([new Promise(function (r) { app.once('exit', r); }), wait(3000)]); if (app.exitCode === null) app.kill('SIGKILL');
    for (const srv of [provider, db]) {
      if (!srv || !srv.listening) continue;
      const closed = new Promise(function (resolve) { try { srv.close(resolve); } catch (_) { resolve(); } });
      try { srv.closeAllConnections?.(); } catch (_) {}
      await Promise.race([closed, wait(1200)]);
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  const failed = results.filter(function (x) { return !x.ok; });
  for (const x of results) console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok || !x.detail ? '' : '  -> ' + x.detail));
  console.log('\nRESULT ' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
}
main().catch(function (e) { console.error(e); process.exit(2); });
