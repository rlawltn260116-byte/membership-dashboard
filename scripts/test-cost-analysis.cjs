const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ Intl, Date, Map, Set, Number });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/cost-analysis.js'), 'utf8') + '\nthis.api = costAnalysis;', context);
const { total, rate, validate, syncSummary } = context.api;
const rows = [
  { code: 'A', name: '사업소', sales: 1000, cost: 800, profit: 200 },
  { code: 'B', name: '유통사', sales: 100, cost: 95, profit: 5 }
];
assert.equal(total(rows).profit, 205);
assert.equal(rate(total(rows).profit, total(rows).sales), 205 / 1100 * 100);
assert.equal(rate(0, 0), null);
assert.equal(total([{ sales: -100, cost: -80, profit: -20 }]).profit, -20);
assert.equal(Object.keys(validate(null, '2026')).length, 0);
const month = { rows, syncedAt: '2026-09-26T15:00:00Z' };
assert.equal(validate({ schemaVersion: 1, months: { '2026-09': { syncedAt: month.syncedAt, rowCount: 0 } } }, '2026')['2026-09'].rows.length, 0);
assert.equal(validate({ schemaVersion: 1, months: { '2026-09': month } }, '2026')['2026-09'].rows.length, 2);
assert.throws(() => validate({ schemaVersion: 1, months: { '2025-09': month } }, '2026'));
assert.throws(() => validate({ schemaVersion: 1, months: { '2026-09': { ...month, rows: [rows[0], rows[0]] } } }, '2026'));
assert.throws(() => validate({ schemaVersion: 1, months: { '2026-09': { ...month, rows: [{ ...rows[0], cost: null }] } } }, '2026'));
assert.throws(() => validate({ schemaVersion: 1, months: { '2026-09': { ...month, rows: [{ ...rows[0], sales: Infinity }] } } }, '2026'));
console.log('PASS: weighted margin, returns, zero sales, missing months, malformed data, duplicate groups');
const now = Date.parse('2026-11-01T12:00:00Z');
assert.equal(syncSummary([], now).time, null);
assert.equal(syncSummary([{ syncedAt: '2026-11-01T00:00:00Z' }], now).stale, false);
assert.equal(syncSummary([{ syncedAt: '2026-09-27T00:00:00Z' }, { syncedAt: '2026-11-01T00:00:00Z' }], now).stale, true);

(async () => {
  let clock = now, calls = 0, timer = 0;
  const timers = new Map();
  class Clock extends Date { static now() { return clock; } }
  const ctx = vm.createContext({ Intl, Date: Clock, Map, Set, Number, AbortController,
    currentUser: { id: 'test' }, userCanOpenPage: () => true, DB_URL: 'https://test.invalid',
    document: { getElementById: () => null },
    setTimeout: (callback, delay) => { timers.set(++timer, { callback, delay }); return timer; },
    clearTimeout: id => timers.delete(id),
    fetch: async () => { calls++; return { ok: true, json: async () => null }; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/cost-analysis.js'), 'utf8') + '\nthis.api = costAnalysis;', ctx);
  await ctx.api.render();
  await ctx.api.render();
  assert.equal(calls, 1, 'Fresh cache should be reused');
  clock += 5 * 60 * 1000;
  await ctx.api.render();
  assert.equal(calls, 2, 'Expired cache should be refetched');
  await ctx.api.render(true);
  assert.equal(calls, 3, 'Manual refresh should bypass cache');
  ctx.api.clear();
  assert.equal(timers.size, 0, 'Logout must cancel refresh timers');
  await ctx.api.render();
  assert.equal(calls, 4, 'Logout must clear cached years');
  ctx.api.clear();
  console.log('PASS: oldest-month freshness, five-minute cache expiry, manual refresh and logout cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
