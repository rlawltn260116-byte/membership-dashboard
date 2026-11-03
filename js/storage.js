// localStorage 키 → Firebase /data/ 경로 매핑
const FB_SYNC_KEYS = {
  'sj-entries-v4':        'data/entries',
  'sj-users-v6':          'data/users',
  'sj-targets-v4':        'data/targets',
  'sj-notices':           'data/notices',
  'sj-revisits':          'data/revisits',
  'sj-clients':           'data/clients',
  'sj-signup-pending-v1': 'data/signup-pending',
  'sj-grade-tiers':       'data/grade-tiers',
  'sj-grade-overrides':   'data/grade-overrides',
  'sj-manual-grades':     'data/manual-grades',
  'sj-grade-churn-settings': 'data/grade-churn-settings',
  'sj-login-logs-v1':     'data/login-logs',
};

const AUTH_LOCAL_KEYS = new Set([
  'sj-users-v6',
  'sj-signup-pending-v1',
]);

const SENSITIVE_LOCAL_KEYS = new Set([
  ...Object.keys(FB_SYNC_KEYS),
  'sj-orders-order',
  'sj-orders-ship',
  'sj-orders',
  'sj-erp-sync-meta',
  'sj-erp-auto-sync-meta',
  'sj-erp-auto-sync-lock',
  'sj-erp-last-sync',
]);

let storageCacheEpoch = 0;

function _fbSyncPath(key) {
  if (typeof key !== 'string') return null;
  if (Object.hasOwn(FB_SYNC_KEYS, key)) return FB_SYNC_KEYS[key];
  const safePathKey = value => String(value || '').replace(/[.$#[\]/?%\\\u0000-\u001f\u007f]/g, '_').slice(0, 120);
  const wm = key.match(/^sj-weekly-reports-(.+)$/);
  if (wm) return `data/weekly-reports/${safePathKey(wm[1])}`;
  const mm = key.match(/^sj-monthly-reports-(.+)$/);
  if (mm) return `data/monthly-reports/${safePathKey(mm[1])}`;
  return null;
}

function _fbUrl(path) {
  if (typeof path !== 'string' || !/^(?:data|erp)(?:\/[^.$#[\]/?%\\\u0000-\u001f\u007f]+)*$/.test(path)) return null;
  const rawBase = (typeof DB_URL === 'string' ? DB_URL : '').replace(/\/+$/, '');
  const base = typeof securityNormalizeFirebaseUrl === 'function' ? securityNormalizeFirebaseUrl(rawBase) : rawBase;
  return base ? `${base}/${path}.json` : null;
}

function _safeSetJsonStorage(key, value) {
  const cleanVal = typeof securitySanitizeData === 'function' ? securitySanitizeData(value) : value;
  localStorage.setItem(key, JSON.stringify(cleanVal));
}

function _isSensitiveLocalKey(key) {
  return SENSITIVE_LOCAL_KEYS.has(key)
    || /^sj-weekly-reports-/.test(key)
    || /^sj-monthly-reports-/.test(key)
    || /^sj-draft-/.test(key);
}

function _canRemoteWriteSharedKey(key) {
  if (key === 'sj-signup-pending-v1') return true;
  return typeof currentUser !== 'undefined' && !!currentUser;
}

function clearSensitiveLocalCache(options = {}) {
  storageCacheEpoch++;
  erpIdbClear();
  const keepAuth = options.keepAuth === true;
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !_isSensitiveLocalKey(key)) continue;
      if (keepAuth && AUTH_LOCAL_KEYS.has(key)) continue;
      keys.push(key);
    }
    keys.forEach(key => localStorage.removeItem(key));
  } catch (err) {
    console.warn('[storage:clearSensitiveLocalCache]', err);
  }

  try {
    window.__erpRemoteData = null;
    if (typeof allOrders !== 'undefined') allOrders = [];
    if (typeof allOrderOrders !== 'undefined') allOrderOrders = [];
    if (typeof allShipOrders !== 'undefined') allShipOrders = [];
    if (typeof allEntries !== 'undefined') allEntries = [];
    if (typeof allClients !== 'undefined') allClients = [];
    if (typeof allNotices !== 'undefined') allNotices = [];
    if (typeof allRevisits !== 'undefined') allRevisits = [];
    if (typeof targets !== 'undefined') targets = {};
  } catch (_) {}
}

function setShared(key, val) {
  const cleanVal = typeof securitySanitizeData === 'function' ? securitySanitizeData(val) : val;
  try {
    localStorage.setItem(key, JSON.stringify(cleanVal));
  } catch (err) {
    console.error('[storage:set]', key, err);
    return false;
  }
  const path = _fbSyncPath(key);
  if (path) {
    if (!_canRemoteWriteSharedKey(key)) {
      console.warn('[storage:fb:set:blocked-before-login]', key);
      return true;
    }
    const url = _fbUrl(path);
    if (url) {
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanVal),
      }).catch(e => console.warn('[storage:fb:set]', key, e));
    }
  }
  return true;
}

function getShared(key, def) {
  try {
    const v = localStorage.getItem(key);
    const parsed = v ? JSON.parse(v) : def;
    return typeof securitySanitizeData === 'function' ? securitySanitizeData(parsed) : parsed;
  } catch (err) {
    console.error('[storage:get]', key, err);
    return def;
  }
}

function setPlainStorage(key, val) {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch (err) {
    console.error('[storage:setPlain]', key, err);
    return false;
  }
}

function normalizeLoginLogsForUpload(value) {
  const rows = Array.isArray(value) ? value : Object.values(value || {});
  const out = {};
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || !row.id || !row.at) return;
    const key = row.logId || `legacy-${String(row.id).replace(/[.$#[\]/]/g, '_')}-${String(row.at).replace(/[^0-9A-Za-z]/g, '')}-${index}`;
    out[key] = { ...row, logId: row.logId || key };
  });
  return out;
}

async function mergeLoginLogsForUpload(localValue) {
  const merged = normalizeLoginLogsForUpload(localValue);
  try {
    const url = _fbUrl('data/login-logs');
    if (!url) return merged;
    const res = await fetch(`${url}?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return merged;
    const remote = await res.json().catch(() => null);
    Object.assign(merged, normalizeLoginLogsForUpload(remote));
  } catch (e) {
    console.warn('[storage:mergeLoginLogsForUpload]', e);
  }
  return merged;
}

function setErpRuntimeData(parsedOrder, parsedShip, payload = {}) {
  const order = Array.isArray(parsedOrder) ? parsedOrder : [];
  const ship = Array.isArray(parsedShip) ? parsedShip : [];
  window.__erpRemoteData = {
    order,
    ship,
    meta: {
      source: payload.source || 'amarans-playwright',
      syncedAt: payload.syncedAt || new Date().toISOString(),
      orderCount: payload.orderCount || order.length,
      shipCount: payload.shipCount || ship.length,
    },
  };
  allOrderOrders = order;
  allShipOrders = ship;
  try {
    localStorage.removeItem('sj-orders-order');
    localStorage.removeItem('sj-orders-ship');
    localStorage.removeItem('sj-orders');
    localStorage.setItem('sj-erp-sync-meta', JSON.stringify(window.__erpRemoteData.meta));
  } catch (err) {
    console.warn('[storage:erp:meta]', err);
  }
}

// 로그인 화면에서는 사용자/가입대기 정보만 최소 조회한다.
async function syncAuthFromFirebase() {
  const epoch = storageCacheEpoch;
  const rawBase = (typeof DB_URL === 'string' ? DB_URL : '').replace(/\/+$/, '');
  const base = typeof securityNormalizeFirebaseUrl === 'function' ? securityNormalizeFirebaseUrl(rawBase) : rawBase;
  if (!base) return false;

  try {
    const [usersRes, pendingRes] = await Promise.all([
      fetch(`${base}/data/users.json?_=${Date.now()}`, { cache: 'no-store' }),
      fetch(`${base}/data/signup-pending.json?_=${Date.now()}`, { cache: 'no-store' }),
    ]);

    if (usersRes.ok) {
      const users = await usersRes.json().catch(() => null);
      if (epoch !== storageCacheEpoch) return false;
      if (users !== null && users !== undefined) _safeSetJsonStorage('sj-users-v6', users);
    }
    if (pendingRes.ok) {
      const pending = await pendingRes.json().catch(() => null);
      if (epoch !== storageCacheEpoch) return false;
      _safeSetJsonStorage('sj-signup-pending-v1', pending || []);
    }
    return true;
  } catch (e) {
    console.warn('[storage:syncAuthFromFirebase]', e);
    return false;
  }
}

// 앱 진입 시 Firebase /data + erp/latest 전체를 localStorage에 동기화
async function syncFromFirebase() {
  const epoch = storageCacheEpoch;
  const rawBase = (typeof DB_URL === 'string' ? DB_URL : '').replace(/\/+$/, '');
  const base = typeof securityNormalizeFirebaseUrl === 'function' ? securityNormalizeFirebaseUrl(rawBase) : rawBase;
  if (!base) return;

  // /data (영업일지, 사용자, 거래처 등)
  try {
    const res = await fetch(`${base}/data.json?_=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = typeof securitySanitizeData === 'function'
        ? securitySanitizeData(await res.json())
        : await res.json();
      if (epoch !== storageCacheEpoch) return;
      if (data && typeof data === 'object') {
        if (data.entries          !== undefined) _safeSetJsonStorage('sj-entries-v4',        data.entries);
        if (data.users            !== undefined) _safeSetJsonStorage('sj-users-v6',          data.users);
        if (data.targets          !== undefined) _safeSetJsonStorage('sj-targets-v4',        data.targets);
        if (data.notices          !== undefined) _safeSetJsonStorage('sj-notices',           data.notices);
        if (data.revisits         !== undefined) _safeSetJsonStorage('sj-revisits',          data.revisits);
        if (data.clients          !== undefined) _safeSetJsonStorage('sj-clients',           data.clients);
        if (data['signup-pending']!== undefined) _safeSetJsonStorage('sj-signup-pending-v1', data['signup-pending']);
        if (data['grade-tiers']   !== undefined) _safeSetJsonStorage('sj-grade-tiers',       data['grade-tiers']);
        if (data['grade-overrides']!==undefined) _safeSetJsonStorage('sj-grade-overrides',   data['grade-overrides']);
        if (data['manual-grades'] !== undefined) _safeSetJsonStorage('sj-manual-grades',     data['manual-grades']);
        if (data['grade-churn-settings'] !== undefined) _safeSetJsonStorage('sj-grade-churn-settings', data['grade-churn-settings']);
        if (data['login-logs']    !== undefined) _safeSetJsonStorage('sj-login-logs-v1',     data['login-logs']);
        if (data['weekly-reports'] && typeof data['weekly-reports'] === 'object') {
          Object.entries(data['weekly-reports']).forEach(([uid, val]) => _safeSetJsonStorage('sj-weekly-reports-' + uid, val));
        }
        if (data['monthly-reports'] && typeof data['monthly-reports'] === 'object') {
          Object.entries(data['monthly-reports']).forEach(([uid, val]) => _safeSetJsonStorage('sj-monthly-reports-' + uid, val));
        }
      }
    }
  } catch (e) { console.warn('[storage:syncFromFirebase /data]', e); }

  // erp/latest (주문/출고 ERP 데이터) — loadAndRender() 전에 localStorage에 넣어야 렌더 시 데이터가 있음
  try {
    if (epoch === storageCacheEpoch) await syncErpFromFirebase(base);
  } catch (e) { console.warn('[storage:syncFromFirebase erp/latest]', e); }
}

// ════════════════════════════════════
// ERP 데이터 로딩 — 압축본 + IndexedDB 캐시
// ════════════════════════════════════
const ERP_IDB_NAME = 'sj-erp-cache';
const ERP_IDB_STORE = 'erp';

function erpIdbOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(ERP_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ERP_IDB_STORE)) db.createObjectStore(ERP_IDB_STORE);
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

function erpIdbGet(key) {
  return erpIdbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(ERP_IDB_STORE, 'readonly');
    tx.oncomplete = () => db.close();
    tx.onabort = () => { db.close(); reject(tx.error); };
    const r = tx.objectStore(ERP_IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  })).catch(() => null);
}

function erpIdbPut(key, value, epoch = storageCacheEpoch) {
  return erpIdbOpen().then(db => new Promise((resolve, reject) => {
    if (epoch !== storageCacheEpoch) { db.close(); resolve(false); return; }
    const tx = db.transaction(ERP_IDB_STORE, 'readwrite');
    tx.objectStore(ERP_IDB_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  })).catch(() => false);
}

function erpIdbClear() {
  return erpIdbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(ERP_IDB_STORE, 'readwrite');
    tx.objectStore(ERP_IDB_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  })).catch(() => false);
}

// 압축본 → 원래 레코드 배열로 복원
function erpUnpack(part) {
  if (!part || !Array.isArray(part.rows) || !part.dict) return [];
  const d = part.dict;
  const D = f => Array.isArray(d[f]) ? d[f] : [];
  const date = D('date'), client = D('client'), product = D('product'), category = D('category'),
        person = D('person'), custClass = D('custClass'), channel = D('channel'), region = D('region');
  const basis = part.basis || 'ship';
  const out = new Array(part.rows.length);
  for (let i = 0; i < part.rows.length; i++) {
    const r = part.rows[i];
    out[i] = {
      basis,
      date: date[r[0]] || '',
      client: client[r[1]] || '',
      product: product[r[2]] || '',
      category: category[r[3]] || '',
      qty: r[4] || 0,
      supply: r[5] || 0,
      total: r[6] || 0,
      person: person[r[7]] || '',
      custClass: custClass[r[8]] || '',
      channel: channel[r[9]] || '',
      region: region[r[10]] || '',
      orderNo: '',
    };
  }
  return out;
}

// 진행 상황 콜백 (로딩 화면에서 사용)
let erpLoadProgress = null;
function setErpLoadProgress(fn) { erpLoadProgress = typeof fn === 'function' ? fn : null; }
function _erpProgress(stage, detail) { try { if (erpLoadProgress) erpLoadProgress(stage, detail || {}); } catch (_) {} }

async function syncErpFromFirebase(base) {
  const epoch = storageCacheEpoch;
  base = securityNormalizeFirebaseUrl(base);
  if (!base) return false;
  // 1) 서버의 최신 동기화 시각만 먼저 확인 (수십 바이트)
  _erpProgress('check');
  let syncedAt = '';
  try {
    const r = await fetch(`${base}/erp/latest/syncedAt.json?_=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) syncedAt = (await r.json().catch(() => '')) || '';
  } catch (_) {}

  // 2) 캐시가 같은 시각이면 다운로드 생략
  if (epoch !== storageCacheEpoch) return false;
  if (syncedAt) {
    const cached = await erpIdbGet('packed');
    if (epoch !== storageCacheEpoch) return false;
    if (cached && cached.syncedAt === syncedAt && cached.payload) {
      _erpProgress('cache');
      const order = erpUnpack(cached.payload.order);
      const ship = erpUnpack(cached.payload.ship);
      if (order.length || ship.length) {
        setErpRuntimeData(order, ship, { syncedAt, source: 'idb-cache', orderCount: order.length, shipCount: ship.length });
        _erpProgress('done', { cached: true, order: order.length, ship: ship.length });
        return true;
      }
    }
  }

  // 3) 압축본 다운로드
  _erpProgress('download');
  try {
    const res = await fetch(`${base}/erp/latest/packed.json?_=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const packed = await res.json().catch(() => null);
      if (epoch !== storageCacheEpoch) return false;
      // 압축본이 서버 최신 동기화보다 오래됐으면 신뢰하지 않고 원본으로 간다.
      const stale = syncedAt && packed && packed.syncedAt && packed.syncedAt !== syncedAt;
      if (stale) console.warn('[storage:erp] packed 오래됨 → 원본 사용', packed.syncedAt, '!=', syncedAt);
      if (!stale && packed && (packed.order || packed.ship)) {
        _erpProgress('decode');
        const order = erpUnpack(packed.order);
        const ship = erpUnpack(packed.ship);
        if (order.length || ship.length) {
          setErpRuntimeData(order, ship, {
            syncedAt: packed.syncedAt || syncedAt, source: 'packed',
            orderCount: order.length, shipCount: ship.length,
          });
          erpIdbPut('packed', { syncedAt: packed.syncedAt || syncedAt, payload: packed }, epoch);
          _erpProgress('done', { cached: false, order: order.length, ship: ship.length });
          return true;
        }
      }
    }
  } catch (e) { console.warn('[storage:erp:packed]', e); }

  // 4) 압축본이 아직 없으면 기존 원본으로 폴백
  if (epoch !== storageCacheEpoch) return false;
  _erpProgress('fallback');
  try {
    const erpRes = await fetch(`${base}/erp/latest.json?_=${Date.now()}`, { cache: 'no-store' });
    if (erpRes.ok) {
      const payload = await erpRes.json().catch(() => null);
      if (epoch !== storageCacheEpoch) return false;
      if (payload && typeof erpExtractApiRows === 'function') {
        const parsedOrder = erpNormalizeApiRows(erpExtractApiRows(payload, 'order'), 'order');
        const parsedShip  = erpNormalizeApiRows(erpExtractApiRows(payload, 'ship'),  'ship');
        if (parsedOrder.length || parsedShip.length) {
          erpValidateRemoteRows(payload, parsedOrder, parsedShip);
          setErpRuntimeData(parsedOrder, parsedShip, payload);
          _erpProgress('done', { cached: false, order: parsedOrder.length, ship: parsedShip.length });
          return true;
        }
      }
    }
  } catch (e) { console.warn('[storage:erp:fallback]', e); }
  _erpProgress('done', { cached: false, order: 0, ship: 0 });
  return false;
}

// 현재 브라우저 localStorage 데이터 전체를 Firebase에 한 번에 업로드 (마이그레이션용)
async function pushAllToFirebase() {
  if (typeof currentUser === 'undefined' || !currentUser || (typeof isAdminUser === 'function' && !isAdminUser(currentUser))) {
    alert('관리자 로그인 후 업로드할 수 있습니다.');
    return false;
  }
  const url = _fbUrl('data');
  if (!url) { alert('Firebase DB URL이 설정되지 않았습니다.'); return false; }

  const payload = {};

  // 고정 키
  const fixed = {
    entries:          'sj-entries-v4',
    users:            'sj-users-v6',
    targets:          'sj-targets-v4',
    notices:          'sj-notices',
    revisits:         'sj-revisits',
    clients:          'sj-clients',
    'signup-pending': 'sj-signup-pending-v1',
    'grade-tiers':    'sj-grade-tiers',
    'grade-overrides':'sj-grade-overrides',
    'manual-grades':  'sj-manual-grades',
    'grade-churn-settings': 'sj-grade-churn-settings',
  };
  Object.entries(fixed).forEach(([fbKey, lsKey]) => {
    try {
      const v = localStorage.getItem(lsKey);
      if (v) payload[fbKey] = JSON.parse(v);
    } catch (_) {}
  });

  // 동적 키: weekly/monthly-reports
  const weekly = {}, monthly = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const wm = k && k.match(/^sj-weekly-reports-(.+)$/);
    const mm = k && k.match(/^sj-monthly-reports-(.+)$/);
    try {
      if (wm) weekly[wm[1]] = JSON.parse(localStorage.getItem(k));
      if (mm) monthly[mm[1]] = JSON.parse(localStorage.getItem(k));
    } catch (_) {}
  }
  if (Object.keys(weekly).length)  payload['weekly-reports']  = weekly;
  if (Object.keys(monthly).length) payload['monthly-reports'] = monthly;
  try {
    const localLoginLogs = JSON.parse(localStorage.getItem('sj-login-logs-v1') || '[]');
    payload['login-logs'] = await mergeLoginLogsForUpload(localLoginLogs);
  } catch (_) {
    payload['login-logs'] = await mergeLoginLogsForUpload([]);
  }

  try {
    const cleanPayload = typeof securitySanitizeData === 'function' ? securitySanitizeData(payload) : payload;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanPayload),
    });
    return res.ok;
  } catch (e) {
    console.error('[storage:pushAllToFirebase]', e);
    return false;
  }
}

function updateFbStatus() {}
