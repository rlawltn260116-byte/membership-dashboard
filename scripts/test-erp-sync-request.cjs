const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../js/products-grades-erp.js'), 'utf8');

function setup({ failPut = false, offline = false, staleReload = false, noUser = false, holdPut = false, logout = false } = {}) {
  let now = Date.parse('2026-11-10T08:20:00Z');
  let requestedAt, polls = 0, reloads = 0, releasePut;
  const requests = [], toasts = [];
  const element = () => ({ textContent: '', title: '', disabled: false, attrs: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    replaceChildren(...nodes) { this.children = nodes; this.textContent = nodes.map(n => n.textContent).join(''); },
  });
  const button = element(), stamp = element();
  const context = vm.createContext({ console, AbortController, getShared: () => null,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout(fn, ms) {
      if (ms !== 10000) { now += ms; queueMicrotask(() => { if (logout) context.currentUser = null; fn(); }); }
      return 1;
    },
    clearTimeout() {},
    document: { getElementById: id => id === 'erp-sidebar-refresh-btn' ? button : stamp,
      createElement: element, createTextNode: textContent => ({ textContent }) },
    showToast: (...args) => toasts.push(args),
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (options.method === 'PUT') {
        requestedAt = JSON.parse(options.body).requestedAt;
        if (holdPut) await new Promise(resolve => { releasePut = resolve; });
        return { ok: !failPut, status: failPut ? 403 : 200 };
      }
      polls++;
      if (offline) throw new Error('offline');
      // 첫 확인은 이전 시각: 화면 시각을 요청 시각으로 미리 바꾸지 않아야 한다.
      return { ok: true, json: async () => polls === 1 ? '2026-11-10T08:19:00Z' : new Date(now).toISOString() };
    },
  });
  vm.runInContext(source, context);
  Object.assign(context, { DB_URL: 'https://example.invalid', currentUser: noUser ? null : { name: '검증 사용자' },
    erpReadSyncMeta: () => ({ syncedAt: requestedAt || '2026-11-10T08:19:00Z' }),
    erpRefreshSyncStatus() {},
    erpRefreshFromRemote: async options => {
      assert.equal(options.force, true);
      reloads++;
      return { ok: true, syncedAt: staleReload && reloads === 1 ? '2026-11-10T08:19:00Z' : new Date(now).toISOString() };
    },
  });
  return { context, button, stamp, requests, toasts, run: () => vm.runInContext('erpRequestSyncFromSidebar()', context),
    release: () => releasePut(), stats: () => ({ polls, reloads, requestedAt }) };
}

(async () => {
  const success = setup({ staleReload: true });
  const result = await success.run();
  assert.equal(result.ok, true);
  assert.equal(success.requests[0].method, 'PUT');
  assert.equal(success.requests[0].url, 'https://example.invalid/erp/syncRequest.json');
  assert.deepEqual(JSON.parse(success.requests[0].body), { requestedAt: '2026-11-10T17:20:00.000+09:00', by: '검증 사용자' });
  assert.equal(success.stats().polls, 3);
  assert.equal(success.stats().reloads, 2);
  assert.equal(success.button.disabled, false);
  assert.equal(success.button.attrs['aria-busy'], undefined);
  assert.match(success.button.title, /수집 완료/);
  assert.equal(success.stamp.children[0].textContent, '마지막 업데이트');
  assert.equal(success.stamp.children[2].textContent, '2026.11.10 17:20');
  vm.runInContext("erpLatestWatchdogState = {warn: true}; erpUpdateSidebarSyncStamp()", success.context);
  assert.equal(success.stamp.children[0].textContent, '! 마지막 업데이트');

  const timeout = setup({ offline: true });
  await timeout.run();
  assert.equal(timeout.button.disabled, false);
  assert.equal(timeout.stats().reloads, 0);
  assert.match(timeout.toasts.at(-1)[0], /다음 정기 수집/);
  assert.equal(timeout.stats().polls, 59);

  const failure = setup({ failPut: true });
  await failure.run();
  assert.equal(failure.button.disabled, false);
  assert.equal(failure.stats().polls, 0);
  assert.match(failure.toasts.at(-1)[0], /요청을 보내지 못했습니다/);

  const guarded = setup({ holdPut: true });
  const pending = guarded.run();
  assert.equal(guarded.button.disabled, true);
  await guarded.run();
  assert.equal(guarded.requests.length, 1);
  guarded.release();
  await pending;
  const anonymous = setup({ noUser: true });
  await anonymous.run();
  assert.equal(anonymous.requests.length, 0);
  const signedOut = setup({ logout: true });
  await signedOut.run();
  assert.equal(signedOut.requests.length, 1);
  assert.equal(signedOut.stats().reloads, 0);
  assert.equal(signedOut.button.disabled, false);
  console.log('PASS: 수집 요청/KST/중복 방지/이전 시각 유지/완료 재로드/오류/15분 만료/로그아웃 취소/경고 DOM');
})().catch(error => { console.error(error); process.exitCode = 1; });
