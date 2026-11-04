const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, URL, window: {}, localStorage: {
  getItem: () => null, setItem() {}, removeItem() {},
} });
for (const file of ['storage.js', 'products-grades-erp.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
}
vm.runInContext(`
  let allOrderOrders = [], allShipOrders = [], rendered = 0, failPacked = true;
  const DB_URL = 'https://membership-7aef2-default-rtdb.firebaseio.com';
  const stamp = '2026-11-04T10:24:30+09:00';
  const requests = [];
  function securityNormalizeFirebaseUrl(url) { return url; }
  function erpGetRemoteDataUrl() { return DB_URL + '/erp/latest.json'; }
  function erpGetKstParts() { return { ymd: '2026-11-04' }; }
  function erpReadAutoSyncMeta() { return { lastFullYmd: '2026-11-04' }; }
  function erpReadSyncMeta() { return window.__erpRemoteData?.meta || { syncedAt: stamp }; }
  function erpWriteAutoSyncMeta() {}
  function erpIdbGet() { return Promise.resolve(null); }
  function erpIdbPut() { return Promise.resolve(true); }
  function applyOrderBasis() {}
  function rerenderOrderBasisPages() { rendered++; }
  function erpRefreshSyncStatus() {}
  function erpRenderSyncPreview() {}
  const part = basis => ({ basis, dict: { date: ['2026-11-03'], client: ['client'],
    product: ['product'], channel: ['office'] }, rows: [[0,0,0,0,1,1200,1320,0,0,0,0]] });
  async function fetch(url) {
    requests.push(url);
    if (url.includes('/syncedAt.json')) return { ok: true, json: async () => stamp };
    if (url.includes('/packed.json') && !failPacked) return { ok: true, json: async () => ({
      syncedAt: stamp, uploading: false, order: part('order'), ship: part('ship') }) };
    return { ok: false, status: 503, json: async () => null };
  }
`, context);
(async () => {
  // First download fails. Even with a saved matching timestamp, empty memory must reload.
  assert.equal(await vm.runInContext('syncErpFromFirebase(DB_URL)', context), false);
  vm.runInContext('failPacked = false; requests.length = 0', context);
  const recovered = await vm.runInContext('erpRefreshFromRemote({ silent: true })', context);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.orderCount, 1);
  assert.equal(recovered.shipCount, 1);
  assert.equal(vm.runInContext('allShipOrders[0].supply', context), 1200);
  assert.equal(vm.runInContext('rendered', context), 1);
  assert.equal(vm.runInContext("requests.some(url => url.includes('/erp/latest.json'))", context), false);
  const cached = await vm.runInContext('erpRefreshFromRemote({ silent: true })', context);
  assert.equal(cached.cached, true);
  // Failure must preserve the already displayed snapshot.
  vm.runInContext('failPacked = true', context);
  assert.equal((await vm.runInContext('erpRefreshFromRemote({ silent: true, force: true })', context)).ok, false);
  assert.equal(vm.runInContext('allShipOrders.length', context), 1);
  console.log('PASS: initial failure recovery via packed, metadata-only cache, render, populated cache, failure preserves data');
})().catch(error => { console.error(error); process.exitCode = 1; });
