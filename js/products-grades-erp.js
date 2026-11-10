// 품목별 분석/거래처 등급/ERP 데이터 변환 모듈.
// 전역 ERP 데이터(allOrders/allShipOrders/allOrderOrders)를 읽어 품목 흐름, ABC 분석, 거래처 등급을 렌더링한다.
// PRODUCTS PAGE
// ════════════════════════════════════
let productPersonId = 'all';
let productCategoryId = 'all';
// 아마란스 ERP "고객분류"의 도매(이름) → 영업사원 이름 목록 (allOrders 기준, 가나다순)
// channel 지정 시 해당 채널(office/dist) 레코드로만 한정
function erpPersonNames(channel) {
  const src = (typeof allOrders !== 'undefined' ? allOrders : [])
    .filter(o => !channel || (typeof orderChannel === 'function' ? orderChannel(o) : (o.channel || 'office')) === channel);
  return [...new Set(src.map(o => (o.person || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
}
// 제품/등급 페이지네이션·정렬 상태 (clients.js에서 이동)
let _prodSortCol = 'sales', _prodSortDir = 'desc';
let _prodPage = 1, _prodList = [], _prodHasPrev = false;
let _gradePage = 1, _gradeList = [];
const PRODUCT_CATEGORY_ORDER = [
  '전동침대',
  '수동휠체어',
  '이동변기',
  '목욕의자',
  '안전손잡이',
  '미끄럼방지용품 매트리스',
  '미끄럼방지용품 양말',
  '요실금팬티',
  '간이변기',
  '욕창예방방석',
  '욕창예방매트리스',
  '이동욕조',
  '지팡이',
  '자세변환용구',
  '성인용보행기',
  '경사로',
  '구강세척기(마우스피스형)',
  '비급여',
];
const PRODUCT_CATEGORY_LABELS = {
  '구강세척기(마우스피스형)': '구강세척기',
  '미끄럼방지용품 매트리스': '미끄럼방지매트',
  '미끄럼방지용품 양말': '미끄럼방지양말',
};

function _calcPeriodRange(mode) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const fmt = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const f = fmt;
  const mon = (y,m,d) => new Date(y,m,d);
  // 이번주 월요일
  const dow = now.getDay() === 0 ? 6 : now.getDay()-1;
  const weekStart = new Date(now); weekStart.setDate(now.getDate()-dow);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate()+6);
  // 전주
  const lweekEnd   = new Date(weekStart); lweekEnd.setDate(weekStart.getDate()-1);
  const lweekStart = new Date(lweekEnd);  lweekStart.setDate(lweekEnd.getDate()-6);
  // 전일
  const yest = new Date(now); yest.setDate(now.getDate()-1);

  const map = {
    'year':      [f(mon(y,0,1)),      f(mon(y,11,31))],
    'ytd':       [f(mon(y,0,1)),      f(now)],
    'today':     [f(now),             f(now)],
    'yesterday': [f(yest),            f(yest)],
    'week':      [f(weekStart),       f(weekEnd)],
    'lweek':     [f(lweekStart),      f(lweekEnd)],
    'this':      [f(mon(y,m,1)),      f(mon(y,m+1,0))],
    'last':      [f(mon(y,m-1,1)),    f(mon(y,m,0))],
    'q1':        [f(mon(y,0,1)),      f(mon(y,3,0))],
    'q2':        [f(mon(y,3,1)),      f(mon(y,6,0))],
    'q3':        [f(mon(y,6,1)),      f(mon(y,9,0))],
    'q4':        [f(mon(y,9,1)),      f(mon(y,12,0))],
    'h1':        [f(mon(y,0,1)),      f(mon(y,6,0))],
    'h2':        [f(mon(y,6,1)),      f(mon(y,12,0))],
    'py1':       [f(mon(y-1,0,1)),    f(mon(y-1,12,0))],
    'py2':       [f(mon(y-2,0,1)),    f(mon(y-2,12,0))],
  };
  // 월별 (m1~m12)
  const mm = mode.match(/^m(\d+)$/);
  if (mm) {
    const mi = parseInt(mm[1])-1;
    return [f(mon(y,mi,1)), f(mon(y,mi+1,0))];
  }
  return map[mode] || ['',''];
}

function gradeSetPeriod(mode) {
  drpShortcut('grade', mode);
}
// ════════════════════════════════════
// GRADE PAGE
// ════════════════════════════════════
let gradeTiers = (() => {
  const saved = getShared('sj-grade-tiers', null);
  // 저장된 값이 만원 단위(너무 작음)면 초기화
  // saved 값이 있으면 그대로 사용
  return saved || [
  {id:'g1', name:'VIP',   color:'#E8900A', min:3000},
  {id:'g2', name:'A등급', color:'#009E6A', min:1000},
  {id:'g3', name:'B등급', color:'#2B72C8', min:300},
  {id:'g4', name:'C등급', color:'#9AB0AA', min:0},
  ];
})();

// 이탈위험 거래처의 "급감" 기준.
// compareMode는 이번달을 제외한 과거 월 기준이며, floor는 거래중단/급감 공통 최소 기준매출이다.
const DEFAULT_CHURN_SETTINGS = { compareMode: 'prev', dropRate: 50, floor: 300000 };

function getChurnSettings() {
  const saved = getShared('sj-grade-churn-settings', null) || {};
  const compareModes = ['prev', 'prev2', 'avg2', 'avg3'];
  return {
    compareMode: compareModes.includes(saved.compareMode) ? saved.compareMode : DEFAULT_CHURN_SETTINGS.compareMode,
    dropRate: Math.min(Math.max(parseFloat(saved.dropRate) || DEFAULT_CHURN_SETTINGS.dropRate, 1), 99),
    floor: Math.max(parseFloat(saved.floor) || DEFAULT_CHURN_SETTINGS.floor, 0),
  };
}

// 설정 UI의 값은 즉시 공유 저장소에 반영한다. renderChurnRisk()가 표/엑셀 원본을 다시 계산한다.
function saveChurnSettings() {
  const compareMode = document.getElementById('churn-compare-mode')?.value || DEFAULT_CHURN_SETTINGS.compareMode;
  const dropRate = parseFloat(document.getElementById('churn-drop-rate')?.value || '') || DEFAULT_CHURN_SETTINGS.dropRate;
  const floor = parseFloat((document.getElementById('churn-floor')?.value || '').replace(/,/g, '')) || DEFAULT_CHURN_SETTINGS.floor;
  setShared('sj-grade-churn-settings', {
    compareMode,
    dropRate: Math.min(Math.max(dropRate, 1), 99),
    floor: Math.max(floor, 0),
  });
  renderChurnRisk();
  showToast('급감사업소 기준이 저장되었습니다.', 'success');
}

function getAutoGrade(sales) {
  const tiers = [...gradeTiers].sort((a,b)=>b.min-a.min);
  for (const t of tiers) { if (sales >= t.min) return t; }
  return tiers[tiers.length-1] || null;
}

function saveGradeSettings() {
  const rows = document.querySelectorAll('.grade-tier-row');
  rows.forEach((row, i) => {
    if (!gradeTiers[i]) return;
    gradeTiers[i].name  = row.querySelector('.gt-name').value.trim() || gradeTiers[i].name;
    gradeTiers[i].color = row.querySelector('.gt-color').value;
    gradeTiers[i].min   = parseFloat((row.querySelector('.gt-min').value || '').replace(/,/g, '')) || 0;
  });
  gradeTiers.sort((a, b) => b.min - a.min);
  setShared('sj-grade-tiers', gradeTiers);
  renderGradeSettings();
  renderGrade();
  showToast('등급 설정이 저장됐습니다.', 'success');
}



function toggleGradeSettings() {
  const body = document.getElementById('grade-settings-body');
  const arrow = document.getElementById('grade-settings-arrow');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  arrow.style.transform = open ? 'rotate(180deg)' : '';
}

// ════════════════════════════════════
// PRODUCTS PAGE
// ════════════════════════════════════
function renderProductPersonFilter() {
  const filterEl = document.getElementById('prod-person-filter');
  if (!filterEl) return;
  const personNames = erpPersonNames();
  if (productPersonId !== 'all' && !personNames.includes(productPersonId)) {
    productPersonId = 'all';
  }
  const btns = [{id:'all', name:'전체'}, ...personNames.map(n=>({id:n, name:n}))];
  uiSetHtml(filterEl, btns.map(b => `<button type="button" class="stats-person-btn${productPersonId === b.id ? ' active' : ''}" ${uiAction("click", function (event, uiValues) {
  setProductPerson(String(uiValues[0]));
}, [b.id])}>${escHtml(b.name)}</button>`).join(''));
}

function setProductPerson(id) {
  productPersonId = id || 'all';
  renderProducts();
}

// 전기간 구간 = 전월 같은 일자 (예: 8/1~8/8 → 7/1~7/8). 전월에 없는 날짜는 그 달 말일로 보정.
// 조회기간이 한 달을 넘어 전월 구간이 현재 구간과 겹치면 직전 동일 길이 구간으로 대체한다.
function prodPrevRange(dateFrom, dateTo) {
  const shiftMonth = ds => {
    const [y, m, d] = ds.split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const lastDay = new Date(py, pm, 0).getDate();
    const dd = Math.min(d, lastDay);
    return `${py}-${String(pm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };
  let prevFrom = shiftMonth(dateFrom), prevTo = shiftMonth(dateTo);
  if (prevTo >= dateFrom) {
    const d1 = new Date(dateFrom + 'T00:00:00'), d2 = new Date(dateTo + 'T00:00:00');
    const lenDays = Math.round((d2 - d1) / 86400000) + 1;
    const pTo = new Date(d1.getTime() - 86400000);
    const pFrom = new Date(pTo.getTime() - (lenDays - 1) * 86400000);
    const f = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    prevFrom = f(pFrom);
    prevTo = f(pTo);
  }
  return { prevFrom, prevTo };
}

function renderProductCategoryFilter(categories) {
  const filterEl = document.getElementById('prod-category-filter');
  if (!filterEl) return;
  if (productCategoryId !== 'all' && !categories.includes(productCategoryId)) {
    productCategoryId = 'all';
  }
  const allBtn = document.getElementById('prod-category-all-btn');
  if (allBtn) allBtn.classList.toggle('active', productCategoryId === 'all');
  const ordered = [
    ...PRODUCT_CATEGORY_ORDER.filter(c => categories.includes(c)),
    ...categories.filter(c => !PRODUCT_CATEGORY_ORDER.includes(c)),
  ];
  const btns = ordered.map(c=>({id:c, name:PRODUCT_CATEGORY_LABELS[c] || c, title:c}));
  uiSetHtml(filterEl, btns.map(b => `<button type="button" class="stats-person-btn${productCategoryId === b.id ? ' active' : ''}" title="${escHtml(b.title)}" ${uiAction("click", function (event, uiValues) {
  setProductCategory(String(uiValues[0]));
}, [b.id])}>${escHtml(b.name)}</button>`).join(''));
}

function setProductCategory(id) {
  productCategoryId = id || 'all';
  renderProducts();
}

function renderProducts() {
  updateOrderBasisUI();
  renderProductPersonFilter();
  const personF = productPersonId || 'all';
  const cats = [...new Set((allOrders || []).map(o => o.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  renderProductCategoryFilter(cats);
  const catF = productCategoryId || 'all';
  const sortV   = document.getElementById('prod-sort')?.value || 'supply-desc';
  const searchV = (document.getElementById('prod-search')?.value || '').toLowerCase();

  // 날짜 필터 (prod-date-from / prod-date-to)
  const dateFrom = document.getElementById('prod-date-from')?.value || '';
  const dateTo   = document.getElementById('prod-date-to')?.value || '';

  // ── 품목별 집계 (ERP allOrders 기반) ──
  const tbody = document.getElementById('prod-tbody');
  const empty = document.getElementById('prod-empty');
  if (empty) empty.textContent = `${getOrderBasisMeta().label} ERP 데이터를 먼저 업로드하세요. (사이드바 → ERP 자료 업로드)`;

  if (!allOrders || allOrders.length === 0) {
    uiSetHtml(tbody, '');
    empty.style.display = '';
    document.getElementById('prod-pagination').style.display = 'none';
    document.getElementById('prod-sum-items').textContent = '0';
    document.getElementById('prod-sum-qty').textContent   = '0';
    document.getElementById('prod-sum-sales').textContent = '0';
    document.getElementById('prod-sum-avg').textContent   = '0';
    return;
  }

  const map = {};
  allOrders.forEach(o => {
    if (!o.date) return;
    if (dateFrom && o.date < dateFrom) return;
    if (dateTo   && o.date > dateTo)   return;
    if (personF !== 'all' && o.person !== personF) return;
    if (catF !== 'all' && (o.category||'') !== catF) return;
    const productName = o.product || '(품명 없음)';
    if (searchV && !productName.toLowerCase().includes(searchV)) return;
    const key = productName;
    if (!map[key]) map[key] = { name: key, category: o.category||'-', qty: 0, sales: 0, clients: new Set() };
    map[key].qty   += (o.qty   || 0);
    map[key].sales += (o.supply|| 0);
    if (o.client) map[key].clients.add(o.client);
  });

  // ── 전기간(전월 동일 일자) 매출 집계 — 증감 컬럼용 ──
  const prevMap = {};
  _prodHasPrev = false;
  if (dateFrom && dateTo) {
    const { prevFrom, prevTo } = prodPrevRange(dateFrom, dateTo);
    _prodHasPrev = true;
    allOrders.forEach(o => {
      if (!o.date || o.date < prevFrom || o.date > prevTo) return;
      if (personF !== 'all' && o.person !== personF) return;
      if (catF !== 'all' && (o.category || '') !== catF) return;
      const productName = o.product || '(품명 없음)';
      if (searchV && !productName.toLowerCase().includes(searchV)) return;
      prevMap[productName] = (prevMap[productName] || 0) + (o.supply || 0);
    });
  }

  let list = Object.values(map).map(r => ({ name: r.name, category: r.category, qty: r.qty, sales: r.sales, clientCount: r.clients.size, prevSales: prevMap[r.name] || 0 }));

  // 헤더 클릭 정렬
  const col = _prodSortCol, dir = _prodSortDir;
  const strCols = new Set(['name', 'category']);
  if (col && dir) {
    list.sort((a, b) => {
      if (strCols.has(col)) {
        const av = a[col] || '', bv = b[col] || '';
        return dir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
      }
      const av = a[col] || 0, bv = b[col] || 0;
      return dir === 'asc' ? av - bv : bv - av;
    });
  } else {
    list.sort((a, b) => b.sales - a.sales);
  }

  // 헤더 아이콘 업데이트
  ['name','category','qty','sales','clientCount'].forEach(c => {
    const el = document.getElementById('prod-sort-' + c);
    if (!el) return;
    el.textContent = (col === c) ? (dir === 'desc' ? ' ▼' : dir === 'asc' ? ' ▲' : '') : '';
    el.style.color = 'var(--green)';
  });

  const totalSales = list.reduce((s,r) => s + r.sales, 0);
  const totalQty   = list.reduce((s,r) => s + r.qty,   0);
  const avgPrice   = totalQty ? Math.round(totalSales / totalQty) : 0;
  document.getElementById('prod-sum-items').textContent = list.length.toLocaleString();
  document.getElementById('prod-sum-qty').textContent   = totalQty.toLocaleString();
  document.getElementById('prod-sum-sales').textContent = totalSales.toLocaleString();
  document.getElementById('prod-sum-avg').textContent   = avgPrice.toLocaleString();

  if (!list.length) {
    uiSetHtml(tbody, ''); empty.style.display = '';
    document.getElementById('prod-pagination').style.display = 'none';
    _prodList = [];
    return;
  }
  empty.style.display = 'none';
  _prodList = list;
  _prodPage = 1;
  prodRenderPage();
  if (typeof renderProdAbc === 'function') renderProdAbc();
  if (typeof renderProductAnalytics === 'function') renderProductAnalytics();
}

// 화면의 필터 입력값을 한 번에 읽는다.
function prodAbcFilters() {
  return {
    dateFrom: document.getElementById('prod-date-from')?.value || '',
    dateTo:   document.getElementById('prod-date-to')?.value || '',
    personF:  (typeof productPersonId !== 'undefined') ? (productPersonId || 'all') : 'all',
    catF:     (typeof productCategoryId !== 'undefined') ? (productCategoryId || 'all') : 'all',
    searchV:  (document.getElementById('prod-search')?.value || '').toLowerCase(),
    limit:    parseInt(document.getElementById('prod-abc-limit')?.value || '50', 10),
  };
}

// ABC 집계 — DOM을 건드리지 않는 순수 계산.
// 매출 내림차순 품목 목록에 점유율/누적점유율/등급(A≤80%, B≤95%, C)을 붙여 반환한다.
function prodAbcCompute(f, rows) {
  const src = rows || allOrders || [];
  const filtered = src.filter(o => {
    if (!o.product || !o.date) return false;
    if (f.dateFrom && o.date < f.dateFrom) return false;
    if (f.dateTo && o.date > f.dateTo) return false;
    if (f.personF !== 'all' && o.person !== f.personF) return false;
    if (f.catF !== 'all' && (o.category || '') !== f.catF) return false;
    if (f.searchV && !o.product.toLowerCase().includes(f.searchV)) return false;
    return true;
  });

  const byProduct = {};
  filtered.forEach(o => {
    const k = o.product;
    if (!byProduct[k]) byProduct[k] = { name: k, category: (o.category || '').trim(), supply: 0, qty: 0, count: 0 };
    byProduct[k].supply += parseFloat(o.supply) || 0;
    byProduct[k].qty += parseFloat(o.qty) || 0;
    byProduct[k].count += 1;
  });

  const items = Object.values(byProduct).filter(i => i.supply > 0).sort((a, b) => b.supply - a.supply);
  const total = items.reduce((s, i) => s + i.supply, 0);
  if (total > 0) {
    let cum = 0;
    items.forEach(it => {
      it.share = it.supply / total * 100;
      cum += it.share;
      it.cumShare = cum;
      it.grade = it.cumShare <= 80 ? 'A' : it.cumShare <= 95 ? 'B' : 'C';
    });
  }
  return { filtered, items, total };
}

function renderProdAbc() {
  const summaryEl = document.getElementById('prod-abc-summary');
  const tableEl = document.getElementById('prod-abc-table');
  const subEl = document.getElementById('prod-abc-sub');
  const canvas = document.getElementById('chart-prod-abc');
  const insightEl = document.getElementById('prod-abc-insights');
  if (!summaryEl || !tableEl || !canvas) return;

  if (charts['chart-prod-abc']) { charts['chart-prod-abc'].destroy(); delete charts['chart-prod-abc']; }
  if (!allOrders || !allOrders.length) {
    uiSetHtml(summaryEl, '<div style="color:var(--text3);padding:12px">ERP 데이터가 없습니다.</div>');
    uiSetHtml(tableEl, '');
    if (subEl) subEl.textContent = '';
    if (insightEl) uiSetHtml(insightEl, '');
    return;
  }

  const basisMeta = (typeof getOrderBasisMeta === 'function') ? getOrderBasisMeta() : { label: '출고' };
  const f = prodAbcFilters();
  const { dateFrom, dateTo, catF, limit } = f;
  const { filtered, items, total } = prodAbcCompute(f);

  const fmt = d => d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0');
  const _now = new Date();
  const defStart = new Date(_now.getFullYear(), _now.getMonth(), 1);
  const defEnd = new Date(_now.getFullYear(), _now.getMonth()+1, 0);
  const startDate = dateFrom ? new Date(dateFrom) : defStart;
  const endDate = dateTo ? new Date(dateTo) : defEnd;
  const periodLabel = (dateFrom||dateTo) ? `${fmt(startDate)} ~ ${fmt(endDate)}` : `${startDate.getFullYear()}년 ${startDate.getMonth()+1}월`;
  if (subEl) subEl.textContent = `${periodLabel} · ${basisMeta.label} 기준 · ${catF==='all' ? '전체 품목군' : catF} · 총 ${items.length}개 품목`;

  if (!items.length || total <= 0) {
    uiSetHtml(summaryEl, '<div style="color:var(--text3);padding:12px">선택한 기간에 해당 데이터가 없습니다.</div>');
    uiSetHtml(tableEl, '');
    if (insightEl) uiSetHtml(insightEl, '');
    return;
  }

  const grades = [
    {g:'A', label:'A등급 (~80%)', color:'#D94040'},
    {g:'B', label:'B등급 (80~95%)', color:'#E8900A'},
    {g:'C', label:'C등급 (95~100%)', color:'#43A047'},
  ];
  uiSetHtml(summaryEl, grades.map(({
  g,
  label,
  color
}) => {
  const arr = items.filter(i => i.grade === g);
  const sum = arr.reduce((s, i) => s + i.supply, 0);
  const pct = total ? sum / total * 100 : 0;
  return `<div style="flex:1;min-width:170px;border:1px solid var(--border);border-left:4px solid ${color};border-radius:6px;padding:10px 12px;background:var(--surface)">
      <div style="font-size:11px;color:var(--text2);font-weight:600">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color};margin:2px 0">${arr.length}개 품목</div>
      <div style="font-size:12px;color:var(--text2)">${Math.round(sum).toLocaleString()}원 (${pct.toFixed(1)}%)</div>
    </div>`;
}).join(''));

  if (insightEl) {
    const insights = [];
    const aArr = items.filter(i => i.grade === 'A');
    const cArr = items.filter(i => i.grade === 'C');
    const aSharePct = items.length ? (aArr.length / items.length * 100) : 0;
    const cSharePct = items.length ? (cArr.length / items.length * 100) : 0;
    const cSalesPct = total ? (cArr.reduce((s,i)=>s+i.supply,0) / total * 100) : 0;
    const top1 = items[0];
    const top3Sum = items.slice(0,3).reduce((s,i)=>s+i.share, 0);

    if (aSharePct < 10) {
      insights.push({ color:'#D94040', bg:'#FEF2F2', title:'⚠ 매우 집중된 구조',
        text:`상위 ${aArr.length}개 품목(전체의 ${aSharePct.toFixed(1)}%)이 매출의 80%를 담당. 핵심 품목 이슈 시 타격 큼.`,
        action:'A등급 안전재고 강화 + 백업 공급선 확보 + 결품 모니터링 강화' });
    } else if (aSharePct > 25) {
      insights.push({ color:'#2B72C8', bg:'#EFF6FF', title:'🌐 분산 구조',
        text:`상위 ${aArr.length}개 품목(전체의 ${aSharePct.toFixed(1)}%)이 매출의 80% — 매출이 잘 분산됨. 안정적이나 집중 효과는 낮음.`,
        action:'A 중에서도 핵심 5~10개 식별해 영업 자원 집중 권장' });
    } else {
      insights.push({ color:'#43A047', bg:'#F0FDF4', title:'✓ 표준 파레토 구조',
        text:`상위 ${aArr.length}개 품목(전체의 ${aSharePct.toFixed(1)}%)이 매출의 80%. 일반적 도매 패턴.`,
        action:'현 구조 유지 + A등급 안정 관리' });
    }

    if (top1 && top1.share >= 25) {
      insights.push({ color:'#D94040', bg:'#FEF2F2', title:'⚠ 단일 품목 의존도',
        text:`1위 "${escHtml(top1.name)}"이 매출의 ${top1.share.toFixed(1)}% 차지. 이 품목 이슈 시 큰 손실.`,
        action:'대체 품목 영업 강화 + 1위 품목 최우선 안전재고 + 가격 변동 최소화' });
    } else if (top3Sum >= 50) {
      insights.push({ color:'#E8900A', bg:'#FFFBEB', title:'⚠ 상위 3개 품목 쏠림',
        text:`상위 3개 품목이 매출의 ${top3Sum.toFixed(1)}%. 일부 결품 시 전체 매출 영향 큼.`,
        action:'상위 3개 결품 방지 최우선 + B등급 품목 신규 거래처 영업 확대' });
    }

    if (cSharePct >= 60 && cSalesPct < 10) {
      insights.push({ color:'#7856C8', bg:'#FAF5FF', title:'🔄 롱테일 — SKU 단순화 기회',
        text:`C등급 ${cArr.length}개 품목(전체의 ${cSharePct.toFixed(1)}%)이 매출 ${cSalesPct.toFixed(1)}%만 기여. 관리 비용 대비 효율 낮음.`,
        action:'하위 품목 단종 후보 식별 + 특정 거래처 전용 여부 확인 + 묶음 판매 검토' });
    }

    if (catF === 'all' && items.length > 0) {
      const byCat = {};
      items.forEach(it => { const c = it.category || '미분류'; byCat[c] = (byCat[c]||0) + it.supply; });
      const catRanked = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
      if (catRanked.length > 1) {
        const topCatPct = total ? (catRanked[0][1] / total * 100) : 0;
        if (topCatPct >= 50) {
          const others = catRanked.slice(1,3).map(c=>c[0]).join(', ');
          insights.push({ color:'#2B72C8', bg:'#EFF6FF', title:'🏷 카테고리 편중',
            text:`'${escHtml(catRanked[0][0])}' 카테고리가 매출의 ${topCatPct.toFixed(1)}%. 한 카테고리 의존.`,
            action:`다른 카테고리(${escHtml(others)}) 영업 확대 검토` });
        }
      }
    }

    if (!insights.length) {
      insights.push({ color:'#43A047', bg:'#F0FDF4', title:'✓ 균형잡힌 매출 구조',
        text:'특별한 쏠림이나 이상 신호가 없습니다.',
        action:'현 영업 전략 유지 + 정기 모니터링' });
    }

    const insightHtml = insights.map(i => `
      <div style="border-left:3px solid ${i.color};background:${i.bg};padding:10px 14px;margin-bottom:6px;border-radius:4px">
        <div style="font-size:13px;font-weight:700;color:${i.color}">${i.title}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:3px;line-height:1.5">${i.text}</div>
        <div style="font-size:11px;color:var(--text);margin-top:6px"><strong style="color:${i.color}">→ 권장 액션:</strong> ${i.action}</div>
      </div>`).join('');

    const actionGridHtml = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px">
        <div style="border:1px solid var(--border);border-top:3px solid #D94040;border-radius:4px;padding:10px 12px;background:var(--surface)">
          <div style="font-size:12px;font-weight:700;color:#D94040;margin-bottom:6px">A등급 (핵심) 영업 전략</div>
          <ul style="font-size:11px;margin:0;padding-left:16px;color:var(--text2);line-height:1.7">
            <li>결품 절대 방지, 안전재고 +20% 이상</li>
            <li>핵심 거래처 우선 배정·VIP 관리</li>
            <li>가격 변동 최소화 (충성도 유지)</li>
            <li>대체 공급선 확보 (백업)</li>
          </ul>
        </div>
        <div style="border:1px solid var(--border);border-top:3px solid #E8900A;border-radius:4px;padding:10px 12px;background:var(--surface)">
          <div style="font-size:12px;font-weight:700;color:#E8900A;margin-bottom:6px">B등급 (성장 후보) 영업 전략</div>
          <ul style="font-size:11px;margin:0;padding-left:16px;color:var(--text2);line-height:1.7">
            <li>신규 거래처 추천 후보 (검증된 품목)</li>
            <li>묶음·크로스셀로 A 승격 시도</li>
            <li>마케팅·프로모션 확대 검토</li>
            <li>가격 탄력 테스트 가능</li>
          </ul>
        </div>
        <div style="border:1px solid var(--border);border-top:3px solid #43A047;border-radius:4px;padding:10px 12px;background:var(--surface)">
          <div style="font-size:12px;font-weight:700;color:#43A047;margin-bottom:6px">C등급 (꼬리) 영업 전략</div>
          <ul style="font-size:11px;margin:0;padding-left:16px;color:var(--text2);line-height:1.7">
            <li>단종 후보 식별 (SKU 단순화)</li>
            <li>특정 거래처 전용 여부 확인</li>
            <li>묶음·번들 구성으로 활용</li>
            <li>재고 최소화·주문 생산 전환</li>
          </ul>
        </div>
      </div>`;

    uiSetHtml(insightEl, `
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px">
        <span>💡</span><span>인사이트 & 영업 전략</span>
      </div>
      ${insightHtml}
      ${actionGridHtml}`);
  }

  const shown = limit > 0 ? items.slice(0, limit) : items;
  const labels = shown.map(i => i.name);
  const barData = shown.map(i => Math.round(i.supply));
  const lineData = shown.map(i => i.cumShare);
  const barColors = shown.map(i => i.grade==='A' ? '#D94040CC' : i.grade==='B' ? '#E8900ACC' : '#43A047CC');

  charts['chart-prod-abc'] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type:'bar', label:'매출(원)', data: barData, backgroundColor: barColors, borderWidth: 0, yAxisID:'y', order: 2 },
        { type:'line', label:'누적 %', data: lineData, borderColor:'#2B72C8', backgroundColor:'#2B72C822', yAxisID:'y1', tension:0.2, pointRadius:2, borderWidth:2, order: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const it = shown[ctx.dataIndex];
              if (ctx.dataset.type === 'line') return ` 누적 ${ctx.parsed.y.toFixed(1)}%`;
              return ` 매출 ${Math.round(ctx.parsed.y).toLocaleString()}원 (점유 ${it.share.toFixed(1)}%, 수량 ${it.qty.toLocaleString()}, ${it.grade})`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 60, minRotation: 60, autoSkip: false } },
        y: { position: 'left', ticks: { font: { size: 10 }, callback: v => (v/10000).toLocaleString()+'만' }, title: { display: true, text: '매출(만원)', font: { size: 10 } } },
        y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { font: { size: 10 }, callback: v => v+'%' }, title: { display: true, text: '누적 %', font: { size: 10 } } },
      },
    },
  });

  const today = new Date(); today.setHours(0,0,0,0);
  const effEnd = endDate > today ? today : endDate;
  const daysInPeriod = Math.max(1, Math.round((effEnd - startDate) / 86400000) + 1);
  const leadTime = Math.max(1, parseInt(document.getElementById('prod-abc-leadtime')?.value || '7', 10));
  const stockParams = { A: { safetyDays:10, orderCycle:7 }, B: { safetyDays:5, orderCycle:14 }, C: { safetyDays:3, orderCycle:30 } };

  uiSetHtml(tableEl, shown.map((it, i) => {
  const gColor = it.grade === 'A' ? '#D94040' : it.grade === 'B' ? '#E8900A' : '#43A047';
  const p = stockParams[it.grade];
  const avgDaily = it.qty / daysInPeriod;
  const safetyStock = Math.ceil(avgDaily * p.safetyDays);
  const orderQty = Math.ceil(avgDaily * p.orderCycle);
  const reorderPt = Math.ceil(avgDaily * leadTime + safetyStock);
  return `<tr style="border-top:1px solid var(--border);text-align:center">
      <td style="padding:6px 4px;font-family:var(--mono)">${i + 1}</td>
      <td style="padding:6px 8px;text-align:left">${escHtml(it.name)}</td>
      <td style="padding:6px 4px;color:var(--text2);font-size:11px">${escHtml(it.category || '-')}</td>
      <td style="padding:6px 4px;text-align:right;font-family:var(--mono)">${avgDaily.toFixed(1)}</td>
      <td style="padding:6px 4px;text-align:right;font-family:var(--mono);background:#FEF2F2;color:#D94040;font-weight:700">${safetyStock.toLocaleString()}</td>
      <td style="padding:6px 4px;text-align:right;font-family:var(--mono);background:#FEF2F2">${orderQty.toLocaleString()}</td>
      <td style="padding:6px 4px;text-align:right;font-family:var(--mono);background:#FEF2F2">${reorderPt.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:var(--text2);font-size:11px">${Math.round(it.supply).toLocaleString()}</td>
      <td style="padding:6px 4px;color:${gColor};font-weight:700">${it.grade}</td>
    </tr>`;
}).join(''));
}

// 전기간 대비 증감 셀 (전월 동일 일자 구간 매출 대비)
function prodDeltaCell(r) {
  if (!_prodHasPrev) return '<span style="color:var(--text3)">-</span>';
  const prev = r.prevSales || 0;
  if (prev === 0) return r.sales > 0 ? '<span style="color:var(--blue);font-weight:700">신규</span>' : '<span style="color:var(--text3)">-</span>';
  const pct = Math.round((r.sales - prev) / prev * 100);
  if (pct === 0) return '<span style="color:var(--text3)">0%</span>';
  const up = pct > 0;
  return `<span style="color:${up ? 'var(--green-dark)' : 'var(--red)'};font-weight:700">${up ? '▲' : '▼'}${Math.abs(pct)}%</span>`;
}

function prodRenderPage() {
  const PAGE = 30;
  const list = _prodList;
  const totalSales = list.reduce((s,r) => s + r.sales, 0);
  const totalPages = Math.ceil(list.length / PAGE);
  const p = Math.max(1, Math.min(_prodPage, totalPages));
  _prodPage = p;
  const slice = list.slice((p-1)*PAGE, p*PAGE);
  const startIdx = (p-1)*PAGE;

  const tbody = document.getElementById('prod-tbody');
  uiSetHtml(tbody, slice.map((r, i) => {
  const ratio = totalSales ? Math.round(r.sales / totalSales * 100) : 0;
  const gi = startIdx + i;
  return `<tr style="border-bottom:1px solid var(--border);${gi % 2 ? 'background:var(--surface2)' : ''}">
      <td style="padding:9px 14px;color:var(--text3);font-size:12px">${gi + 1}</td>
      <td style="padding:9px 14px;font-weight:500">${escHtml(r.name)}</td>
      <td style="padding:9px 14px;font-size:12px;color:var(--text2)">${escHtml(r.category)}</td>
      <td style="padding:9px 14px;text-align:right;font-family:var(--mono)">${r.qty.toLocaleString()}</td>
      <td style="padding:9px 14px;text-align:right;font-family:var(--mono);color:var(--green-dark);font-weight:600">${r.sales.toLocaleString()}</td>
      <td style="padding:9px 14px;text-align:right;font-family:var(--mono);font-size:12px">${prodDeltaCell(r)}</td>
      <td style="padding:9px 14px;text-align:right">
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
          <div style="width:70px;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="width:${ratio}%;height:100%;background:var(--blue);border-radius:3px"></div>
          </div>
          <span style="font-family:var(--mono);font-size:12px;color:var(--blue);font-weight:600">${ratio}%</span>
        </div>
      </td>
      <td style="padding:9px 14px;text-align:right;font-family:var(--mono);color:var(--text2)">${r.clientCount}</td>
    </tr>`;
}).join(''));

  const pgEl = document.getElementById('prod-pagination');
  pgEl.style.display = 'flex';
  document.getElementById('prod-page-info').textContent = `${list.length}개 품목 중 ${(p-1)*PAGE+1}~${Math.min(p*PAGE,list.length)}번`;
  uiSetHtml(document.getElementById('prod-page-btns'), renderPageBtns(p, totalPages, prodGoPage));
}

function prodSortBy(col) {
  if (_prodSortCol !== col) {
    _prodSortCol = col; _prodSortDir = 'desc';
  } else if (_prodSortDir === 'desc') {
    _prodSortDir = 'asc';
  } else if (_prodSortDir === 'asc') {
    _prodSortCol = 'sales'; _prodSortDir = 'desc'; // 원래대로
  }
  renderProducts();
}

function addGradeTier() {
  gradeTiers.push({ id: 'g'+Date.now(), name: '신규등급', color: '#999999', min: 0 });
  setShared('sj-grade-tiers', gradeTiers);
  renderGradeSettings();
  renderGrade();
}

function renderGradeSettings() {
  const el = document.getElementById('grade-settings-list');
  if (!el) return;
  uiSetHtml(el, gradeTiers.map((t, i) => `
    <div class="grade-tier-row" style="display:flex;align-items:center;gap:10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px">
      <input type="color" class="gt-color" value="${safeColor(t.color)}" style="width:32px;height:32px;border:none;border-radius:4px;cursor:pointer;padding:0;background:none" />
      <input class="gt-name form-input" value="${escHtml(t.name)}" placeholder="등급명" style="width:100px;font-weight:600" />
      <span style="font-size:12px;color:var(--text2);white-space:nowrap">월 매출</span>
      <input class="gt-min form-input" type="text" inputmode="numeric" value="${Number(t.min || 0).toLocaleString()}" placeholder="0" ${uiAction("input", function (event, uiValues) {
  fmtComma(this);
}, [])} style="width:150px;font-family:var(--mono);text-align:right" />
      <span style="font-size:12px;color:var(--text2)">원 이상</span>
      <button class="btn-sm btn-danger" ${uiAction("click", function (event, uiValues) {
  removeGradeTier(uiValues[0]);
}, [i])} style="margin-left:auto;padding:4px 10px">삭제</button>
    </div>`).join(''));
}

function removeGradeTier(i) {
  gradeTiers.splice(i, 1);
  setShared('sj-grade-tiers', gradeTiers);
  renderGradeSettings();
  renderGrade();
}

// 이탈위험 거래처: 설정한 기준매출 이상이던 거래처 중 이번달 중단/급감한 거래처.
// 목록 원본(_churnList)은 전체 위험 거래처이고, 화면/엑셀은 churnFilteredList()로 필터링한다.
function renderChurnRisk() {
  const card = document.getElementById('grade-churn-card');
  if (!card) return;
  const orders = (typeof allOrders !== 'undefined' ? allOrders : []);
  if (!orders.length) { card.style.display = 'none'; return; }
  const settings = getChurnSettings();
  const now = new Date();
  const ymOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const monthName = ym => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
  const currentYm = ymOf(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev2Date = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const prev3Date = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const prevYm = ymOf(prevDate);
  const prev2Ym = ymOf(prev2Date);
  const prev3Ym = ymOf(prev3Date);
  const currentLabel = monthName(currentYm);
  const prevLabel = monthName(prevYm);
  const prev2Label = monthName(prev2Ym);
  const prev3Label = monthName(prev3Ym);
  const compareLabels = {
    prev: `${prevLabel} 매출`,
    prev2: `${prev2Label} 매출`,
    avg2: `${prev2Label}~${prevLabel} 평균`,
    avg3: `${prev3Label}~${prevLabel} 평균`,
  };
  const currentMap = {}, prevMap = {}, prev2Map = {}, prev3Map = {}, managerMap = {};
  const managerLabel = o => {
    const person = String(o.person || '').trim();
    const custClass = String(o.custClass || '').trim();
    const channel = typeof orderChannel === 'function' ? orderChannel(o) : String(o.channel || '').trim();
    if (channel === 'dist' || person === '도도매/유통사' || custClass === '도매(도도매/유통사)') return '유통사';
    return person || '-';
  };
  orders.forEach(o => {
    const d = o.date || ''; const k = o.client || '';
    if (!d || !k) return;
    if (!managerMap[k] || d >= managerMap[k].date) managerMap[k] = { date: d, label: managerLabel(o) };
    const amt = parseFloat(o.supply) || 0;
    const ym = d.slice(0, 7);
    if (ym === currentYm) currentMap[k] = (currentMap[k] || 0) + amt;
    else if (ym === prevYm) prevMap[k] = (prevMap[k] || 0) + amt;
    else if (ym === prev2Ym) prev2Map[k] = (prev2Map[k] || 0) + amt;
    else if (ym === prev3Ym) prev3Map[k] = (prev3Map[k] || 0) + amt;
  });
  // 비교기준은 이번달을 제외한다: 전월, 전전월, 최근 2개월 평균, 최근 3개월 평균.
  const getBasisAmount = k => {
    const prev = prevMap[k] || 0;
    const prev2 = prev2Map[k] || 0;
    const prev3 = prev3Map[k] || 0;
    if (settings.compareMode === 'prev2') return prev2;
    if (settings.compareMode === 'avg2') return (prev + prev2) / 2;
    if (settings.compareMode === 'avg3') return (prev + prev2 + prev3) / 3;
    return prev;
  };
  const risk = [];
  const clientNames = new Set([
    ...Object.keys(prevMap),
    ...Object.keys(prev2Map),
    ...Object.keys(prev3Map),
  ]);
  clientNames.forEach(k => {
    const prev2 = prev2Map[k] || 0;
    const prev = prevMap[k] || 0;
    const current = currentMap[k] || 0;
    const basis = getBasisAmount(k);
    if (basis < settings.floor) return;
    const drop = basis > 0 ? Math.round((1 - current / basis) * 100) : 0;
    if (current === 0 || drop >= settings.dropRate) {
      risk.push({
        name: k,
        prev2,
        prev,
        current,
        basis,
        drop,
        lost: current === 0,
        manager: managerMap[k]?.label || '-',
      });
    }
  });
  risk.sort((a, b) => b.basis - a.basis);
  const lostCnt = risk.filter(r => r.lost).length;
  _churnList = risk;
  _churnPeriodLabels = {
    prev2: prev2Label,
    prev: prevLabel,
    current: currentLabel,
    basis: compareLabels[settings.compareMode] || compareLabels.prev,
  };
  _churnPage = 1;
  const floorLabel = Math.round(settings.floor).toLocaleString();
  card.style.display = 'block';
  uiSetHtml(card, `
    <div style="display:flex;align-items:center;gap:8px;user-select:none">
      <div ${uiAction("click", function (event, uiValues) {
  toggleChurnBody();
}, [])} style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;min-width:0">
        <span style="font-size:15px">⚠️</span>
        <span style="font-size:14px;font-weight:700;color:var(--red)">이탈위험 거래처 ${risk.length}곳</span>
        <span style="font-size:11px;color:var(--text2)">거래중단 ${lostCnt}곳 · 급감 ${risk.length - lostCnt}곳</span>
      </div>
      <button type="button" class="btn-sm btn-ghost" ${uiAction("click", function (event, uiValues) {
  downloadGradeChurnExcel();
}, [])} style="background:#fff">↓ 엑셀</button>
      <span id="grade-churn-arrow" ${uiAction("click", function (event, uiValues) {
  toggleChurnBody();
}, [])} style="font-size:13px;color:var(--red);transition:transform .2s;font-weight:700;cursor:pointer">▼</span>
    </div>
    <div id="grade-churn-collapse">
      <div style="font-size:11px;color:var(--text3);margin:8px 0 10px;line-height:1.5">
        기준: <strong>${_churnPeriodLabels.basis}</strong> <strong>${floorLabel}원 이상</strong> 거래처 중 · <strong style="color:var(--red)">거래중단</strong> = ${currentLabel} 매출 0원 · <strong style="color:var(--amber)">급감</strong> = ${_churnPeriodLabels.basis} 대비 <strong>${settings.dropRate}% 이상</strong> 감소
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px">
        <span style="font-size:12px;font-weight:700;color:var(--text)">급감사업소 기준</span>
        <select id="churn-compare-mode" class="form-select" style="width:190px;font-size:12px;padding:6px 10px" ${uiAction("click", function (event, uiValues) {
  event.stopPropagation();
}, [])}>
          <option value="prev"${settings.compareMode === 'prev' ? ' selected' : ''}>전월 대비</option>
          <option value="prev2"${settings.compareMode === 'prev2' ? ' selected' : ''}>전전월 대비</option>
          <option value="avg2"${settings.compareMode === 'avg2' ? ' selected' : ''}>최근 2개월 평균 대비</option>
          <option value="avg3"${settings.compareMode === 'avg3' ? ' selected' : ''}>최근 3개월 평균 대비</option>
        </select>
        <span style="font-size:12px;color:var(--text2)">기준매출</span>
        <input id="churn-floor" class="form-input" type="text" inputmode="numeric" value="${floorLabel}" ${uiAction("input", function (event, uiValues) {
  fmtComma(this);
}, [])} ${uiAction("click", function (event, uiValues) {
  event.stopPropagation();
}, [])} style="width:130px;font-size:12px;padding:6px 10px;text-align:right;font-family:var(--mono)" />
        <span style="font-size:12px;color:var(--text2)">원 이상</span>
        <span style="font-size:12px;color:var(--text2)">감소율</span>
        <input id="churn-drop-rate" class="form-input" type="number" min="1" max="99" value="${settings.dropRate}" ${uiAction("click", function (event, uiValues) {
  event.stopPropagation();
}, [])} style="width:74px;font-size:12px;padding:6px 10px;text-align:right;font-family:var(--mono)" />
        <span style="font-size:12px;color:var(--text2)">% 이상</span>
        <button type="button" class="btn-sm btn-primary" ${uiAction("click", function (event, uiValues) {
  event.stopPropagation();
  saveChurnSettings();
}, [])} style="margin-left:auto">적용</button>
      </div>
      <div id="grade-churn-filters"></div>
      <div id="grade-churn-body"></div>
    </div>`);
  churnRenderPage();
  applyChurnCollapse();
}

let _churnList = [], _churnPage = 1, _churnCollapsed = false;
let _churnStatusFilter = 'all', _churnManagerFilter = 'all';
let _churnPeriodLabels = { prev2: '전전월', prev: '전월', current: '이번달', basis: '비교기준' };

function churnFilteredList() {
  return _churnList.filter(r => {
    if (_churnStatusFilter === 'lost' && !r.lost) return false;
    if (_churnStatusFilter === 'drop' && r.lost) return false;
    if (_churnManagerFilter !== 'all' && (r.manager || '-') !== _churnManagerFilter) return false;
    return true;
  });
}

// 이탈위험 표 전용 필터. 원본 계산 기준은 유지하고 화면 표시와 엑셀 다운로드 범위만 좁힌다.
function renderChurnFilters() {
  const el = document.getElementById('grade-churn-filters');
  if (!el) return;
  const managers = [...new Set(_churnList.map(r => r.manager || '-'))].sort((a, b) => a.localeCompare(b, 'ko'));
  if (_churnManagerFilter !== 'all' && !managers.includes(_churnManagerFilter)) _churnManagerFilter = 'all';
  const managerScoped = _churnManagerFilter === 'all'
    ? _churnList
    : _churnList.filter(r => (r.manager || '-') === _churnManagerFilter);
  const lostCount = managerScoped.filter(r => r.lost).length;
  const dropCount = managerScoped.length - lostCount;
  const filteredCount = churnFilteredList().length;
  uiSetHtml(el, `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px">
      <span style="font-size:12px;font-weight:700;color:var(--text)">목록 필터</span>
      <select id="churn-status-filter" class="form-select" style="width:140px;font-size:12px;padding:6px 10px" ${uiAction("change", function (event, uiValues) {
  setChurnFilters();
}, [])}>
        <option value="all"${_churnStatusFilter === 'all' ? ' selected' : ''}>전체 상태</option>
        <option value="lost"${_churnStatusFilter === 'lost' ? ' selected' : ''}>거래중단</option>
        <option value="drop"${_churnStatusFilter === 'drop' ? ' selected' : ''}>급감</option>
      </select>
      <select id="churn-manager-filter" class="form-select" style="width:150px;font-size:12px;padding:6px 10px" ${uiAction("change", function (event, uiValues) {
  setChurnFilters();
}, [])}>
        <option value="all"${_churnManagerFilter === 'all' ? ' selected' : ''}>담당자 전체</option>
        ${managers.map(m => `<option value="${escHtml(m)}"${_churnManagerFilter === m ? ' selected' : ''}>${escHtml(m)}</option>`).join('')}
      </select>
      <span style="font-size:11px;color:var(--text3);margin-left:auto">표시 ${filteredCount}곳 · 거래중단 ${lostCount}곳 · 급감 ${dropCount}곳</span>
    </div>`);
}

function setChurnFilters() {
  _churnStatusFilter = document.getElementById('churn-status-filter')?.value || 'all';
  _churnManagerFilter = document.getElementById('churn-manager-filter')?.value || 'all';
  _churnPage = 1;
  churnRenderPage();
}

function churnRenderPage() {
  const body = document.getElementById('grade-churn-body');
  if (!body) return;
  renderChurnFilters();
  const PAGE = 10;
  const list = churnFilteredList();
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE));
  const p = Math.max(1, Math.min(_churnPage, totalPages));
  _churnPage = p;
  const slice = list.slice((p - 1) * PAGE, p * PAGE);
  if (!list.length) {
    uiSetHtml(body, `
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:18px;text-align:center;color:var(--text3);font-size:12px">
        현재 필터에 해당하는 이탈위험 거래처가 없습니다.
      </div>`);
    return;
  }
  uiSetHtml(body, `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff;border-radius:6px">
      <thead><tr>${['거래처', _churnPeriodLabels.prev2, _churnPeriodLabels.prev, _churnPeriodLabels.current, '비교기준', '감소율', '상태', '담당자'].map((h, i) => `<th style="padding:7px 10px;text-align:${i === 0 ? 'left' : i >= 6 ? 'center' : 'right'};font-size:10px;font-weight:700;color:var(--text3);border-bottom:1px solid var(--border);white-space:nowrap">${h}</th>`).join('')}</tr></thead>
      <tbody>${slice.map(r => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:7px 10px;font-weight:500">${escHtml(r.name)}</td>
        <td style="padding:7px 10px;text-align:right;font-family:var(--mono);color:var(--text3);white-space:nowrap">${Math.round(r.prev2).toLocaleString()}원</td>
        <td style="padding:7px 10px;text-align:right;font-family:var(--mono);color:var(--text2);white-space:nowrap">${Math.round(r.prev).toLocaleString()}원</td>
        <td style="padding:7px 10px;text-align:right;font-family:var(--mono);color:${r.current ? 'var(--text)' : 'var(--red)'};font-weight:600;white-space:nowrap">${Math.round(r.current).toLocaleString()}원</td>
        <td style="padding:7px 10px;text-align:right;font-family:var(--mono);color:var(--text2);white-space:nowrap">${Math.round(r.basis).toLocaleString()}원</td>
        <td style="padding:7px 10px;text-align:right;font-family:var(--mono);color:var(--red);font-weight:700">▼${r.drop}%</td>
        <td style="padding:7px 10px;text-align:center">${r.lost ? '<span style="background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px">거래중단</span>' : '<span style="background:var(--amber-l);color:var(--amber);font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px">급감</span>'}</td>
        <td style="padding:7px 10px;text-align:center;color:var(--text2);font-weight:600">${escHtml(r.manager || '-')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;flex-wrap:wrap;gap:6px">
      <span style="font-size:11px;color:var(--text3)">${(p - 1) * PAGE + 1}–${Math.min(p * PAGE, list.length)} / 총 ${list.length}곳 (비교기준 매출 큰 순)</span>
      <div style="display:flex;gap:4px">${renderPageBtns(p, totalPages, churnGoPage)}</div>
    </div>`);
}
function churnGoPage(p) { _churnPage = p; churnRenderPage(); }
function applyChurnCollapse() {
  const c = document.getElementById('grade-churn-collapse');
  const a = document.getElementById('grade-churn-arrow');
  if (c) c.style.display = _churnCollapsed ? 'none' : 'block';
  if (a) a.style.transform = _churnCollapsed ? '' : 'rotate(180deg)';
}
function toggleChurnBody() { _churnCollapsed = !_churnCollapsed; applyChurnCollapse(); }

function gradeExcelStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
}

function writeGradeWorkbook(rows, sheetName, fileName) {
  if (typeof XLSX === 'undefined') {
    showToast('엑셀 라이브러리를 불러오지 못했습니다.', 'error');
    return false;
  }
  if (!rows || !rows.length) {
    showToast('다운로드할 데이터가 없습니다.', 'error');
    return false;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0] || {}).map(key => {
    const maxLen = Math.max(String(key).length, ...rows.map(row => String(row[key] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 2, 12), 36) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
  return true;
}

function downloadGradeChurnExcel() {
  if (!_churnList.length) renderChurnRisk();
  const list = churnFilteredList();
  if (!list.length) {
    showToast('다운로드할 이탈위험 거래처 데이터가 없습니다.', 'error');
    return;
  }
  const rows = list.map((r, i) => ({
    '순위': i + 1,
    '거래처': r.name,
    [_churnPeriodLabels.prev2 || '전전월']: Math.round(r.prev2 || 0),
    [_churnPeriodLabels.prev || '전월']: Math.round(r.prev || 0),
    [_churnPeriodLabels.current || '이번달']: Math.round(r.current || 0),
    [_churnPeriodLabels.basis || '비교기준']: Math.round(r.basis || 0),
    '감소율(%)': r.drop,
    '상태': r.lost ? '거래중단' : '급감',
    '담당자': r.manager || '-',
  }));
  if (writeGradeWorkbook(rows, '이탈위험 거래처', `이탈위험_거래처_${gradeExcelStamp()}.xlsx`)) {
    showToast('이탈위험 거래처 엑셀 파일이 다운로드됩니다.', 'success');
  }
}

function downloadGradeListExcel() {
  if (!_gradeList.length) renderGrade();
  if (!_gradeList.length) {
    showToast('다운로드할 거래처 등급 데이터가 없습니다.', 'error');
    return;
  }
  const dateFrom = document.getElementById('grade-date-from')?.value || '';
  const dateTo = document.getElementById('grade-date-to')?.value || '';
  const period = dateFrom || dateTo ? `${dateFrom || ''}~${dateTo || '현재'}` : `${getOrderBasisMeta().label} 전체`;
  const rows = _gradeList.map((r, i) => ({
    '순위': i + 1,
    '거래처명': r.name,
    '지역': r.region || '',
    '조회기간': period,
    '기간 매출(원)': Math.round(r.sales || 0),
    '자동 등급': r.autoGrade?.name || '',
    '수동 등급': r.manualGradeName || '',
    '최종 등급': r.finalGrade?.name || '',
  }));
  if (writeGradeWorkbook(rows, '거래처 등급 리스트', `거래처_등급리스트_${gradeExcelStamp()}.xlsx`)) {
    showToast('거래처 등급 리스트 엑셀 파일이 다운로드됩니다.', 'success');
  }
}

function renderGrade() {
  updateOrderBasisUI();
  renderChurnRisk();
  // 등급 필터 옵션 갱신
  const gSel = document.getElementById('grade-filter-grade');
  const curGf = gSel?.value || 'all';
  if (gSel) {
    uiSetHtml(gSel, '<option value="all">전체 등급</option>' + gradeTiers.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join(''));
    gSel.value = curGf;
  }

  const regionF = document.getElementById('grade-filter-region')?.value || 'all';
  const gradeF  = document.getElementById('grade-filter-grade')?.value || 'all';
  const searchV = (document.getElementById('grade-search')?.value || '').toLowerCase();

  // 날짜 범위 매출 집계
  const dateFrom = document.getElementById('grade-date-from')?.value || '';
  const dateTo   = document.getElementById('grade-date-to')?.value   || '';

  // ERP 기반(원단위) 집계
  const useErp = allOrders && allOrders.length > 0;
  const salesMap = {};
  if (useErp) {
    allOrders.forEach(o => {
      const d = o.date || '';
      if (dateFrom && d < dateFrom) return;
      if (dateTo   && d > dateTo)   return;
      const k = o.client || '(미입력)';
      salesMap[k] = (salesMap[k] || 0) + Math.round(parseFloat(o.supply) || 0);
    });
  } else {
    allEntries.forEach(e => {
      const d = e.date || '';
      if (dateFrom && d < dateFrom) return;
      if (dateTo   && d > dateTo)   return;
      const k = e.institution || '(미입력)';
      salesMap[k] = (salesMap[k] || 0) + (e.ourPurchase || 0);
    });
  }

  const hdr = document.getElementById('grade-sales-header');
  if (hdr) hdr.textContent = (dateFrom || dateTo) ? `${dateFrom||''}~${dateTo||'현재'} 매출(원)` : `${getOrderBasisMeta().label} 전체 매출(원)`;

  // 수동 등급 데이터
  let manualGrades = getShared('sj-manual-grades', {});

  // 거래처 리스트: allClients + ERP에만 있는 거래처 합산
  const clientNames = new Set([
    ...allClients.map(c => c.name),
    ...Object.keys(salesMap),
  ]);

  let list = Array.from(clientNames).map(name => {
    const client = allClients.find(c => c.name === name);
    const region = client?.region || '';
    const sales = salesMap[name] || 0;
    const autoGrade = getAutoGrade(sales);
    const manualGradeName = manualGrades[name] || '';
    const finalGrade = manualGradeName
      ? (gradeTiers.find(t => t.name === manualGradeName) || autoGrade)
      : autoGrade;
    return { name, region, sales, autoGrade, manualGradeName, finalGrade };
  });

  // 매출 0이고 ERP에도 없는 거래처 숨김 (데이터 없는 시드 DB 거래처)
  if (useErp) list = list.filter(r => r.sales > 0);

  // 필터
  if (regionF !== 'all') list = list.filter(r => r.region === regionF);
  if (gradeF  !== 'all') list = list.filter(r => r.finalGrade.name === gradeF);
  if (searchV) list = list.filter(r => r.name.toLowerCase().includes(searchV));
  list.sort((a, b) => b.sales - a.sales);

  // 등급별 요약 바
  const summary = {};
  gradeTiers.forEach(t => { summary[t.name] = { count: 0, color: t.color }; });
  list.forEach(r => {
    if (!summary[r.finalGrade.name]) summary[r.finalGrade.name] = { count: 0, color: r.finalGrade.color };
    summary[r.finalGrade.name].count++;
  });
  uiSetHtml(document.getElementById('grade-summary-row'), Object.entries(summary).filter(([, v]) => v.count > 0).map(([name, v]) => {
  const color = safeColor(v.color);
  return `<div style="background:${color}22;border:1px solid ${color}44;border-radius:8px;padding:8px 16px;display:flex;align-items:center;gap:8px">
      <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block"></span>
      <span style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(name)}</span>
      <span style="font-size:13px;font-family:var(--mono);color:${color};font-weight:700">${v.count}개</span>
    </div>`;
}).join(''));

  document.getElementById('grade-count-label').textContent = `총 ${list.length}개 거래처`;

  const tbody = document.getElementById('grade-tbody');
  if (!list.length) {
    uiSetHtml(tbody, `<tr><td colspan="7" style="padding:48px;text-align:center;color:var(--text3)">${useErp ? '조건에 맞는 거래처가 없습니다.' : `${getOrderBasisMeta().label} ERP 데이터를 업로드하거나 기간을 조정해보세요.`}</td></tr>`);
    document.getElementById('grade-pagination').style.display = 'none';
    return;
  }

  _gradeList = list;
  _gradePage = 1;
  gradeRenderPage();
}

function gradeRenderPage() {
  const PAGE = 30;
  const list = _gradeList;
  const totalPages = Math.ceil(list.length / PAGE);
  const p = Math.max(1, Math.min(_gradePage, totalPages));
  _gradePage = p;
  const slice = list.slice((p-1)*PAGE, p*PAGE);

  const tbody = document.getElementById('grade-tbody');
  const startIdx = (p-1)*PAGE;
  uiSetHtml(tbody, slice.map((r, i) => {
  const gi = startIdx + i;
  const opts = gradeTiers.map(t => `<option value="${escHtml(t.name)}" ${r.manualGradeName === t.name ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('');
  const autoColor = safeColor(r.autoGrade?.color);
  const finalColor = safeColor(r.finalGrade?.color);
  return `<tr style="border-bottom:1px solid var(--border);${gi % 2 ? 'background:var(--surface2)' : ''}">
      <td style="padding:9px 14px;font-weight:500">${escHtml(r.name)}</td>
      <td style="padding:9px 14px;font-size:12px;color:var(--text2)">${escHtml(r.region || '-')}</td>
      <td style="padding:9px 14px;text-align:right;font-family:var(--mono);color:var(--green-dark);font-weight:600">${r.sales.toLocaleString()}</td>
      <td style="padding:9px 14px;text-align:center">
        <span style="background:${autoColor}22;color:${autoColor};font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px">${escHtml(r.autoGrade?.name || '-')}</span>
      </td>
      <td style="padding:9px 14px;text-align:center">
        <select class="form-select" style="font-size:11px;padding:3px 6px;width:90px" ${uiAction("change", function (event, uiValues) {
    setManualGrade(String(uiValues[0]), this.value);
  }, [r.name])}>
          <option value="">자동</option>${opts}
        </select>
      </td>
      <td style="padding:9px 14px;text-align:center">
        <span style="background:${finalColor}22;color:${finalColor};font-size:12px;font-weight:700;padding:3px 10px;border-radius:4px">${escHtml(r.finalGrade?.name || '-')}</span>
      </td>
      <td style="padding:9px 14px;font-size:12px;color:var(--text2)">-</td>
    </tr>`;
}).join(''));

  const pgEl = document.getElementById('grade-pagination');
  pgEl.style.display = 'flex';
  document.getElementById('grade-page-info').textContent = `${list.length}개 거래처 중 ${(p-1)*PAGE+1}~${Math.min(p*PAGE,list.length)}번`;
  uiSetHtml(document.getElementById('grade-page-btns'), renderPageBtns(p, totalPages, gradeGoPage));
}

function setManualGrade(name, grade) {
  let mg = getShared('sj-manual-grades', {});
  if (grade) mg[name] = grade; else delete mg[name];
  setShared('sj-manual-grades', mg);
  renderGrade();
}


// ════════════════════════════════════
// ERP API 연동 / 수동 업로드
// ════════════════════════════════════
let erpParsedByBasis = { order: [], ship: [] };
const ERP_REMOTE_DATA_PATH = 'erp/latest';
const ERP_WATCHDOG_DATA_PATH = 'erp/syncWatchdog';
const ERP_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const ERP_AUTO_SYNC_CHECK_MS = 5 * 60 * 1000;
const ERP_AUTO_SYNC_RETRY_MS = 15 * 60 * 1000;
const ERP_AUTO_SYNC_LOCK_MS = 10 * 60 * 1000;
const ERP_AUTO_SYNC_META_KEY = 'sj-erp-auto-sync-meta';
const ERP_AUTO_SYNC_LOCK_KEY = 'sj-erp-auto-sync-lock';
const ERP_WATCHDOG_ALERT_KEY = 'sj-erp-watchdog-alert-key';
let erpWatchdogLastFetchAt = 0;
let erpLatestWatchdogState = null;
const ERP_AUTO_SYNC_HOLIDAYS = {
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-01': '근로자의 날',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '부처님오신날 대체공휴일',
  '2026-06-03': '지방선거일',
  '2026-06-06': '현충일',
  '2026-07-17': '제헌절',
  '2026-08-15': '광복절',
  '2026-08-17': '광복절 대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '개천절 대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
};
let erpAutoSyncTimer = null;
let erpAutoSyncInFlight = false;
let erpAutoSyncListenersReady = false;

function erpNum(v) {
  return parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
}

function erpFormatDate(raw) {
  if (raw instanceof Date) {
    return raw.getFullYear()+'-'+String(raw.getMonth()+1).padStart(2,'0')+'-'+String(raw.getDate()).padStart(2,'0');
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    return s ? s.substring(0,10).replace(/\//g,'-') : '';
  }
  if (typeof raw === 'number') {
    const d = new Date(Math.round((raw - 25569)*86400*1000));
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  return '';
}

function erpParseRows(rows, basis) {
  const meta = getOrderBasisMeta(basis);
  const dateCol = basis === 'order' ? '주문일자' : '출고일자';
  const noCol = basis === 'order' ? '주문번호' : '출고번호';
  const qtyCol = basis === 'order' ? '주문수량' : '출고수량';
  const first = rows[0] || {};
  [dateCol, noCol, qtyCol, '고객', '품명', '공급가'].forEach(col => {
    if (!(col in first)) throw new Error(`${meta.label} 파일에 "${col}" 컬럼이 없습니다.`);
  });

  return rows.map(r => {
    const custCls = String(r['고객분류']||'');
    const personMatch = custCls.match(/도매\((.+)\)/);
    const person = personMatch ? personMatch[1] : String(r['담당자']||'').trim();
    return {
      basis,
      date:      erpFormatDate(r[dateCol]),
      client:    String(r['고객']||'').trim(),
      product:   String(r['품명']||'').trim(),
      category:  String(r['대분류']||'').trim(),
      qty:       erpNum(r[qtyCol]),
      supply:    erpNum(r['공급가']),
      total:     erpNum(r['합계액']),
      person,
      region:    String(r['지역']||'').trim(),
      orderNo:   String(r[noCol]||'').trim(),
    };
  }).filter(r => r.date && r.client);
}

function erpSummarize(list) {
  const dates = [...new Set(list.map(r=>r.date))].sort();
  return {
    dates,
    clients: [...new Set(list.map(r=>r.client))].length,
    totalAmt: sumSupply(list),
    qty: list.reduce((s,r)=>s+(parseFloat(r.qty)||0),0),
  };
}

function erpUpdateUploadPreview() {
  const statusEl = document.getElementById('erp-upload-status');
  const preview = document.getElementById('erp-preview');
  const previewLabel = document.getElementById('erp-preview-label');
  const previewList = document.getElementById('erp-preview-list');
  const totalLabel = document.getElementById('erp-total-label');
  const confirmBtn = document.getElementById('erp-confirm-btn');
  const orderCount = erpParsedByBasis.order.length;
  const shipCount = erpParsedByBasis.ship.length;
  const hasAny = orderCount || shipCount;
  const hasBoth = orderCount && shipCount;

  if (!hasAny) {
    if (statusEl) statusEl.style.display = 'none';
    if (preview) preview.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = 'none';
    if (totalLabel) totalLabel.textContent = '';
    return;
  }

  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = hasBoth ? 'var(--green-light)' : 'var(--amber-l)';
    statusEl.style.color = hasBoth ? 'var(--green-dark)' : 'var(--amber)';
    uiSetHtml(statusEl, hasBoth ? `✓ 주문현황 <strong>${orderCount.toLocaleString()}건</strong>, 출고현황 <strong>${shipCount.toLocaleString()}건</strong> 파싱 완료` : `주문현황과 출고현황 파일을 모두 선택해야 저장할 수 있습니다.`);
  }

  if (previewLabel) previewLabel.textContent = '업로드 미리보기';
  if (previewList) {
    uiSetHtml(previewList, ['order', 'ship'].map(basis => {
  const meta = getOrderBasisMeta(basis);
  const list = erpParsedByBasis[basis] || [];
  if (!list.length) return `<div style="padding:7px 0;color:var(--text3)">${meta.label}: 파일 미선택</div>`;
  const s = erpSummarize(list);
  const range = s.dates.length ? `${s.dates[0]} ~ ${s.dates[s.dates.length - 1]} (${s.dates.length}일)` : '-';
  return `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:700;color:var(--text);margin-bottom:4px">${meta.label}</div>
        <div style="display:grid;grid-template-columns:1.4fr .7fr .8fr 1fr;gap:8px;color:var(--text2)">
          <span>${range}</span>
          <span>${list.length.toLocaleString()}건</span>
          <span>${s.clients.toLocaleString()}개 거래처</span>
          <span style="font-family:var(--mono);color:var(--green-dark);text-align:right">${s.totalAmt.toLocaleString()}원</span>
        </div>
      </div>`;
}).join(''));
  }
  if (preview) preview.style.display = 'block';
  if (totalLabel) totalLabel.textContent = hasBoth ? `총 ${(orderCount + shipCount).toLocaleString()}건` : '두 파일 필요';
  if (confirmBtn) confirmBtn.style.display = hasBoth ? 'inline-flex' : 'none';
}

function erpHandleFile(input, basis = 'ship') {
  const file = input.files[0];
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
    input.value = '';
    showToast('20MB 이하 XLSX 파일만 업로드할 수 있습니다.', 'error');
    return;
  }
  const meta = getOrderBasisMeta(basis);
  const stateEl = document.getElementById(`erp-${basis}-state`);
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      const parsed = erpParseRows(rows, basis);
      if (!parsed.length) throw new Error('유효한 데이터가 없습니다.');
      erpParsedByBasis[basis] = parsed;
      if (stateEl) {
        stateEl.textContent = `${file.name} · ${parsed.length.toLocaleString()}건`;
        stateEl.style.color = 'var(--green-dark)';
      }
      erpUpdateUploadPreview();
    } catch(err) {
      const statusEl = document.getElementById('erp-upload-status');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'var(--red-l)';
        statusEl.style.color = 'var(--red)';
        statusEl.textContent = `${meta.label} 파싱 오류: ` + err.message;
      }
      erpParsedByBasis[basis] = [];
      if (stateEl) {
        stateEl.textContent = '파싱 실패';
        stateEl.style.color = 'var(--red)';
      }
      erpUpdateUploadPreview();
    }
  };
  reader.readAsArrayBuffer(file);
}

function erpMergeByDate(existing, parsed) {
  const uploadDates = new Set(parsed.map(r=>r.date));
  return [...existing.filter(r => !uploadDates.has(r.date)), ...parsed];
}

function erpSaveRows(parsedOrder, parsedShip, sourceLabel = 'ERP') {
  const runtimeOrder = window.__erpRemoteData?.order || [];
  const runtimeShip = window.__erpRemoteData?.ship || [];
  const existingOrder = runtimeOrder.length ? runtimeOrder : getShared('sj-orders-order', []);
  const existingShip = runtimeShip.length ? runtimeShip : getShared('sj-orders-ship', getShared('sj-orders', []));

  const mergedOrder = parsedOrder.length ? erpMergeByDate(existingOrder, parsedOrder) : existingOrder;
  const mergedShip = parsedShip.length ? erpMergeByDate(existingShip, parsedShip) : existingShip;
  allOrderOrders = mergedOrder;
  allShipOrders = mergedShip;
  window.__erpRemoteData = {
    order: mergedOrder,
    ship: mergedShip,
    meta: {
      source: sourceLabel,
      syncedAt: new Date().toISOString(),
      orderCount: mergedOrder.length,
      shipCount: mergedShip.length,
    },
  };
  if (sourceLabel === 'manual-xlsx') {
    setShared('sj-orders-order', mergedOrder);
    setShared('sj-orders-ship', mergedShip);
    setShared('sj-orders', mergedShip);
  } else {
    try {
      localStorage.removeItem('sj-orders-order');
      localStorage.removeItem('sj-orders-ship');
      localStorage.removeItem('sj-orders');
    } catch (_) {}
  }
  applyOrderBasis();
  rerenderOrderBasisPages();

  const meta = {
    source: sourceLabel,
    syncedAt: new Date().toISOString(),
    orderCount: parsedOrder.length,
    shipCount: parsedShip.length,
  };
  setPlainStorage('sj-erp-sync-meta', JSON.stringify(meta));
  erpRefreshSyncStatus();
  return meta;
}

function erpResetUploadState() {
  erpParsedByBasis = { order: [], ship: [] };
  ['order','ship'].forEach(basis => {
    const input = document.getElementById(`erp-${basis}-file-input`);
    const state = document.getElementById(`erp-${basis}-state`);
    if (input) input.value = '';
    if (state) {
      state.textContent = '파일 미선택';
      state.style.color = 'var(--text3)';
    }
  });
  erpUpdateUploadPreview();
}

function erpConfirmUpload() {
  const parsedOrder = erpParsedByBasis.order || [];
  const parsedShip = erpParsedByBasis.ship || [];
  if (!parsedOrder.length || !parsedShip.length) {
    const statusEl = document.getElementById('erp-upload-status');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'var(--red-l)';
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = '주문현황과 출고현황 파일을 모두 업로드하세요.';
    }
    return;
  }

  erpSaveRows(parsedOrder, parsedShip, 'manual-xlsx');

  closeModal('modal-erp-upload');
  showToast(`ERP 데이터 저장 완료 · 주문 ${parsedOrder.length.toLocaleString()}건 / 출고 ${parsedShip.length.toLocaleString()}건`, 'success');
  erpResetUploadState();
}

function erpPick(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return '';
}

function erpNormalizeApiRows(rows, basis) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  try {
    return erpParseRows(list, basis);
  } catch (_) {
    const dateKeys = basis === 'order'
      ? ['date','orderDate','orderedAt','주문일자','수주일자']
      : ['date','shipDate','shippedAt','출고일자'];
    const noKeys = basis === 'order'
      ? ['orderNo','orderNumber','no','주문번호','수주번호']
      : ['orderNo','shipNo','shipmentNo','no','출고번호'];
    const qtyKeys = basis === 'order'
      ? ['qty','quantity','orderQty','주문수량','수주수량']
      : ['qty','quantity','shipQty','출고수량'];

    return list.map(r => ({
      basis,
      date: erpFormatDate(erpPick(r, dateKeys)),
      client: String(erpPick(r, ['client','clientName','customer','customerName','거래처','거래처명','고객']) || '').trim(),
      product: String(erpPick(r, ['product','productName','item','itemName','품명']) || '').trim(),
      category: String(erpPick(r, ['category','itemGroup','largeCategory','대분류','품목군']) || '').trim(),
      qty: erpNum(erpPick(r, qtyKeys)),
      supply: erpNum(erpPick(r, ['supply','supplyAmount','amount','netAmount','공급가'])),
      total: erpNum(erpPick(r, ['total','totalAmount','grossAmount','합계액'])),
      person: String(erpPick(r, ['person','salesPerson','manager','담당자']) || '').trim(),
      region: String(erpPick(r, ['region','area','지역']) || '').trim(),
      orderNo: String(erpPick(r, noKeys) || '').trim(),
    })).filter(r => r.date && r.client);
  }
}

function erpSetStatus(kind, message) {
  const statusEl = document.getElementById('erp-upload-status');
  if (!statusEl) return;
  const styles = {
    ok: ['var(--green-light)', 'var(--green-dark)'],
    warn: ['var(--amber-l)', 'var(--amber)'],
    error: ['var(--red-l)', 'var(--red)'],
    info: ['var(--surface2)', 'var(--text2)'],
  };
  const [bg, color] = styles[kind] || styles.info;
  statusEl.style.display = 'block';
  statusEl.style.background = bg;
  statusEl.style.color = color;
  uiSetHtml(statusEl, message);
}

function erpReadSyncMeta() {
  try {
    return JSON.parse(localStorage.getItem('sj-erp-sync-meta') || 'null');
  } catch (_) {
    return null;
  }
}

function erpReadAutoSyncMeta() {
  try {
    return JSON.parse(localStorage.getItem(ERP_AUTO_SYNC_META_KEY) || 'null');
  } catch (_) {
    return null;
  }
}

function erpWriteAutoSyncMeta(meta) {
  setPlainStorage(ERP_AUTO_SYNC_META_KEY, JSON.stringify({
    ...(erpReadAutoSyncMeta() || {}),
    ...meta,
  }));
}

function erpGetKstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function erpAutoSyncBlockReason(date = new Date()) {
  const parts = erpGetKstParts(date);
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return '주말';
  if (ERP_AUTO_SYNC_HOLIDAYS[parts.ymd]) return ERP_AUTO_SYNC_HOLIDAYS[parts.ymd];
  if (parts.hour < 9 || parts.hour >= 21) return '야간 시간대';
  return '';
}

function erpFormatLocalTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function erpGetNextAutoSyncText() {
  const now = new Date();
  const blockReason = erpAutoSyncBlockReason(now);
  const autoMeta = erpReadAutoSyncMeta();
  if (erpAutoSyncInFlight) return '자동 동기화 실행 중';
  if (blockReason) return `대기 · ${blockReason}`;
  const syncMeta = erpReadSyncMeta();
  const lastSyncedAt = syncMeta?.syncedAt ? erpParseSyncDate(syncMeta.syncedAt) : null;
  if (!lastSyncedAt || Number.isNaN(lastSyncedAt.getTime())) return '영업시간 중 곧 실행';
  const nextAt = new Date(lastSyncedAt.getTime() + ERP_AUTO_SYNC_INTERVAL_MS);
  if (nextAt <= now) return '영업시간 중 곧 실행';
  if (autoMeta?.lastAutoStatus === 'error' && autoMeta.lastAutoAttemptAt) {
    const retryAt = new Date(new Date(autoMeta.lastAutoAttemptAt).getTime() + ERP_AUTO_SYNC_RETRY_MS);
    if (retryAt > now) return `오류 후 재시도 ${erpFormatLocalTime(retryAt)}`;
  }
  return `다음 ${erpFormatLocalTime(nextAt)}`;
}

function erpParseSyncDate(value) {
  if (value instanceof Date) return value;
  if (!value) return new Date(NaN);
  const text = String(value).trim();
  const legacyUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text);
  return new Date(legacyUtc ? `${text}Z` : text);
}

function erpFormatSidebarUpdatedAt(value) {
  const date = erpParseSyncDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

function erpUpdateSidebarSyncStamp(meta = erpReadSyncMeta()) {
  const el = document.getElementById('erp-sidebar-updated-at');
  if (!el) return;
  const syncedAt = meta?.syncedAt ? erpFormatSidebarUpdatedAt(meta.syncedAt) : '';
  const watchdog = erpLatestWatchdogState;
  const hasWarning = !!watchdog?.warn;
  const label = document.createElement('span');
  label.className = 'sidebar-sync-label';
  label.textContent = `${hasWarning ? '! ' : ''}마지막 업데이트`;
  const time = document.createElement('span');
  time.className = 'sidebar-sync-time';
  time.textContent = syncedAt || '-';
  el.replaceChildren(label, document.createTextNode(' '), time);
  el.title = syncedAt
    ? `Firebase ERP 기준: ${syncedAt} · ${meta?.syncMode || meta?.source || 'ERP'}`
    : '';
  if (hasWarning && watchdog?.title) {
    el.title = `${el.title ? `${el.title}\n` : ''}${watchdog.title}`;
  }
  el.classList.toggle('is-empty', !syncedAt);
  el.classList.toggle('is-watchdog-warn', hasWarning);
}

function erpGetWatchdogUrl() {
  const base = (typeof DB_URL === 'string' ? DB_URL : '').replace(/\/+$/, '');
  return base ? `${base}/${ERP_WATCHDOG_DATA_PATH}.json` : '';
}

function erpDescribeWatchdog(payload) {
  if (!payload || typeof payload !== 'object') {
    return { text: '점검 전', title: '', warn: false, ok: false };
  }
  const checked = payload.checkedAt ? erpFormatSidebarUpdatedAt(payload.checkedAt) : '';
  const age = Number.isFinite(Number(payload.ageMinutes)) ? `${Number(payload.ageMinutes).toLocaleString()}분 지연` : '';
  const baseTitle = checked ? `감시 점검 ${checked}` : '';
  if (payload.status === 'stale-dispatched') {
    return { text: `지연 감지 · 자동 재실행${age ? ` (${age})` : ''}`, title: payload.message || baseTitle, warn: true, ok: false };
  }
  if (payload.status === 'stale-sync-already-running') {
    return { text: `지연 감지 · 실행 중${age ? ` (${age})` : ''}`, title: payload.message || baseTitle, warn: true, ok: false };
  }
  if (payload.status === 'sync-failing' || payload.status === 'dispatch-failed' || payload.status === 'firebase-read-failed' || payload.status === 'data-mismatch') {
    return { text: `동기화 장애${age ? ` (${age})` : ''}`, title: payload.message || baseTitle, warn: true, ok: false };
  }
  if (payload.stale) {
    return { text: `지연 감지${age ? ` (${age})` : ''}`, title: payload.message || baseTitle, warn: true, ok: false };
  }
  return { text: checked ? `정상 · ${checked}` : '정상', title: baseTitle, warn: false, ok: true };
}

function erpNotifyWatchdogWarning(payload, state) {
  if (!state?.warn) return;
  const key = [
    payload?.status || 'warn',
    payload?.checkedAt || '',
    payload?.syncedAt || '',
    payload?.ageMinutes ?? '',
  ].join('|');
  try {
    if (sessionStorage.getItem(ERP_WATCHDOG_ALERT_KEY) === key) return;
    sessionStorage.setItem(ERP_WATCHDOG_ALERT_KEY, key);
  } catch (_) {}
  const message = state.text
    ? `ERP 자동 업데이트 경고: ${state.text}`
    : 'ERP 자동 업데이트 상태를 확인해 주세요.';
  if (typeof showToast === 'function') showToast(message, 'error');
}

async function erpRefreshWatchdogStatus(force = false) {
  const el = document.getElementById('erp-sync-watchdog-state');
  if (!el) return;
  const now = Date.now();
  if (!force && erpWatchdogLastFetchAt && now - erpWatchdogLastFetchAt < 60 * 1000) return;
  erpWatchdogLastFetchAt = now;
  const url = erpGetWatchdogUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, { cache: 'no-store' });
    const payload = res.ok ? await res.json().catch(() => null) : null;
    const state = erpDescribeWatchdog(payload);
    erpLatestWatchdogState = state;
    el.textContent = state.text;
    el.title = state.title || '';
    el.classList.toggle('is-watchdog-warn', state.warn);
    el.classList.toggle('is-watchdog-ok', state.ok);
    erpUpdateSidebarSyncStamp();
    erpNotifyWatchdogWarning(payload, state);
  } catch (_) {
    erpLatestWatchdogState = { text: '감시 확인 실패', title: 'ERP 자동 업데이트 감시 상태를 불러오지 못했습니다.', warn: true, ok: false };
    el.textContent = '감시 확인 실패';
    el.classList.add('is-watchdog-warn');
    el.classList.remove('is-watchdog-ok');
    erpUpdateSidebarSyncStamp();
    erpNotifyWatchdogWarning({ status: 'watchdog-read-failed', checkedAt: new Date().toISOString() }, erpLatestWatchdogState);
  }
}

function erpRefreshSyncStatus() {
  const meta = erpReadSyncMeta();
  const stateEl = document.getElementById('erp-sync-state');
  const orderEl = document.getElementById('erp-sync-order-count');
  const shipEl = document.getElementById('erp-sync-ship-count');
  const autoEl = document.getElementById('erp-sync-auto-state');
  erpRefreshWatchdogStatus();
  if (!meta) {
    if (stateEl) stateEl.textContent = '아직 동기화 기록 없음';
    if (orderEl) orderEl.textContent = (allOrderOrders || []).length ? `${allOrderOrders.length.toLocaleString()}건 저장됨` : '-';
    if (shipEl) shipEl.textContent = (allShipOrders || []).length ? `${allShipOrders.length.toLocaleString()}건 저장됨` : '-';
    if (autoEl) autoEl.textContent = erpGetNextAutoSyncText();
    erpUpdateSidebarSyncStamp(null);
    return;
  }
  const syncedAt = meta.syncedAt ? erpParseSyncDate(meta.syncedAt) : null;
  if (stateEl) stateEl.textContent = syncedAt ? `${erpFormatSidebarUpdatedAt(meta.syncedAt)} · ${meta.source || 'ERP'}` : `${meta.source || 'ERP'} 동기화됨`;
  if (orderEl) orderEl.textContent = `${Number(meta.orderCount || 0).toLocaleString()}건`;
  if (shipEl) shipEl.textContent = `${Number(meta.shipCount || 0).toLocaleString()}건`;
  if (autoEl) autoEl.textContent = erpGetNextAutoSyncText();
  erpUpdateSidebarSyncStamp(meta);
}

function erpRenderSyncPreview(parsedOrder, parsedShip, label = 'API 동기화 미리보기') {
  erpParsedByBasis = { order: parsedOrder, ship: parsedShip };
  erpUpdateUploadPreview();
  const previewLabel = document.getElementById('erp-preview-label');
  const confirmBtn = document.getElementById('erp-confirm-btn');
  if (previewLabel) previewLabel.textContent = label;
  if (confirmBtn) confirmBtn.style.display = 'none';
}

function erpExtractApiRows(payload, basis) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const keys = basis === 'order'
    ? ['order','orders','orderRows','orderStatus','주문현황']
    : ['ship','ships','shipments','shipmentRows','outbound','outboundRows','출고현황'];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && Array.isArray(payload[key].rows)) return payload[key].rows;
    if (payload[key] && Array.isArray(payload[key].items)) return payload[key].items;
    if (payload[key] && Array.isArray(payload[key].data)) return payload[key].data;
  }
  if (payload.data) return erpExtractApiRows(payload.data, basis);
  if (payload.result) return erpExtractApiRows(payload.result, basis);
  return [];
}

function erpGetRemoteDataUrl() {
  const base = (typeof DB_URL === 'string' ? DB_URL : '').replace(/\/+$/, '');
  return base ? `${base}/${ERP_REMOTE_DATA_PATH}.json` : '';
}

function erpIsNewerRemoteSync(remoteSyncedAt, previousSyncedAt) {
  if (!remoteSyncedAt) return false;
  if (!previousSyncedAt) return true;
  const remoteTime = erpParseSyncDate(remoteSyncedAt).getTime();
  const previousTime = erpParseSyncDate(previousSyncedAt).getTime();
  return Number.isFinite(remoteTime) && (!Number.isFinite(previousTime) || remoteTime > previousTime);
}

function erpValidateRemoteRows(payload, order, ship) {
  if (payload?.uploading) throw new Error('ERP 데이터 업로드 중입니다. 완료 후 다시 불러옵니다.');
  for (const [basis, rows] of [['order', order], ['ship', ship]]) {
    const expected = payload?.[`${basis}Count`];
    if (!Array.isArray(rows) || !rows.length || (expected != null && Number(expected) !== rows.length)) {
      throw new Error(`ERP 데이터 저장 불일치 (${basis}: ${rows?.length || 0}/${expected ?? '-'}건). 동기화 복구가 필요합니다.`);
    }
  }
}

async function erpRefreshFromRemote(options = {}) {
  const silent = options.silent === true;
  const url = erpGetRemoteDataUrl();
  if (!url) {
    const message = 'Firebase DB_URL이 설정되지 않았습니다.';
    if (!silent) erpSetStatus('error', message);
    return { ok: false, error: message };
  }

  const todayYmd = erpGetKstParts().ymd;
  const needDailyFull = options.force === true || erpReadAutoSyncMeta()?.lastFullYmd !== todayYmd;
  if (!needDailyFull && allOrderOrders.length && allShipOrders.length) {
    try {
      const tsRes = await fetch(`${url.replace(/\.json$/, '/syncedAt.json')}?_=${Date.now()}`, { method: 'GET', cache: 'no-store' });
      if (tsRes.ok) {
        const remoteSyncedAt = await tsRes.json().catch(() => null);
        if (remoteSyncedAt && !erpIsNewerRemoteSync(remoteSyncedAt, erpReadSyncMeta()?.syncedAt || '')) {
          erpRefreshSyncStatus();
          return { ok: true, cached: true, syncedAt: erpReadSyncMeta()?.syncedAt || '' };
        }
      }
    } catch (_) {}
  }

  if (!silent) erpSetStatus('info', 'Firebase에서 최신 ERP 데이터를 불러오는 중입니다.');
  try {
    // 최초 로드와 같은 압축본/캐시 경로를 사용해야 일시 실패 뒤에도 복구된다.
    // 전체 erp/latest에는 대용량 원본과 packed가 함께 있어 갱신마다 받지 않는다.
    const loaded = await syncErpFromFirebase(DB_URL);
    if (!loaded) throw new Error('ERP 데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
    const parsedOrder = allOrderOrders;
    const parsedShip = allShipOrders;
    applyOrderBasis();
    rerenderOrderBasisPages();
    erpRefreshSyncStatus();
    const meta = window.__erpRemoteData.meta;
    erpWriteAutoSyncMeta({ lastFullYmd: todayYmd });
    erpRenderSyncPreview(parsedOrder, parsedShip, 'Firebase 최신 ERP 데이터');

    if (!silent) {
      erpSetStatus('ok', `최신 ERP 데이터 반영 완료 · 주문 <strong>${parsedOrder.length.toLocaleString()}건</strong> / 출고 <strong>${parsedShip.length.toLocaleString()}건</strong>`);
      showToast('최신 ERP 데이터를 불러왔습니다.', 'success');
    }
    return { ok: true, orderCount: parsedOrder.length, shipCount: parsedShip.length, syncedAt: meta.syncedAt };
  } catch (err) {
    if (!silent) erpSetStatus('error', `ERP 데이터 새로고침 오류: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function erpRunUnifiedRefresh() {
  const btn = document.getElementById('erp-refresh-btn');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '새로고침 중...';
  }
  try {
    return await erpRefreshFromRemote({ force: true });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || '새로고침';
    }
  }
}

let erpSidebarSyncRequestInFlight = false;

async function erpSyncRequestFetch(url, options = {}, readJson = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
    if (readJson) return { ok: response.ok, payload: response.ok ? await response.json() : null };
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function erpRequestSyncFromSidebar() {
  if (erpSidebarSyncRequestInFlight) return;
  const button = document.getElementById('erp-sidebar-refresh-btn');
  const base = (typeof DB_URL === 'string' ? DB_URL : '').replace(/\/+$/, '');
  if (!base || typeof currentUser === 'undefined' || !currentUser) {
    showToast('로그인과 Firebase 연결을 확인해 주세요.', 'error');
    return;
  }
  const requestingUser = currentUser;
  const setState = text => {
    if (!button) return;
    button.title = text;
    button.setAttribute('aria-label', text);
  };
  erpSidebarSyncRequestInFlight = true;
  if (button) {
    button.disabled = true;
    button.classList.add('is-sync-pending');
    button.setAttribute('aria-busy', 'true');
  }
  let completed = false;
  try {
    setState('ERP 수집 요청 전송 중');
    const requestedAt = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
    const response = await erpSyncRequestFetch(`${base}/erp/syncRequest.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestedAt, by: currentUser.name || currentUser.id || '사용자' }),
    });
    if (!response.ok) throw new Error(`요청 저장 실패 (${response.status})`);
    if (currentUser !== requestingUser) { setState('ERP 수집 요청'); return; }
    const waitingText = 'ERP 수집 대기 중 · 수집 세션이 없으면 다음 정기 수집 때 반영됩니다.';
    setState(waitingText);
    showToast(`수집을 요청했습니다. ${waitingText}`, 'info');
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(15000, deadline - Date.now())));
      if (currentUser !== requestingUser) { setState('ERP 수집 요청'); return; }
      if (Date.now() >= deadline) break;
      try {
        const res = await erpSyncRequestFetch(`${base}/erp/latest/syncedAt.json?_=${Date.now()}`, {}, true);
        if (currentUser !== requestingUser) { setState('ERP 수집 요청'); return; }
        if (!res.ok) continue;
        const syncedAt = res.payload;
        if (!erpIsNewerRemoteSync(syncedAt, requestedAt)) continue;
        setState('수집 완료 · 최신 ERP 데이터 반영 중');
        const result = await erpRefreshFromRemote({ force: true });
        if (!result.ok || !erpIsNewerRemoteSync(result.syncedAt, requestedAt)) continue;
        erpUpdateSidebarSyncStamp();
        setState('ERP 수집 완료 · 다시 수집 요청');
        completed = true;
        return result;
      } catch (_) {
        // 일시적인 조회/다운로드 오류는 다음 확인 주기에 다시 확인한다.
        setState('ERP 수집 결과 확인 중 · 연결이 복구되면 다시 확인합니다.');
      }
    }
    const message = '수집 세션이 실행 중이 아니면 다음 정기 수집 때 반영됩니다. 잠시 후 다시 확인해 주세요.';
    setState(message);
    showToast(message, 'info');
  } catch (err) {
    setState('ERP 수집 요청 실패 · 다시 시도');
    showToast(`ERP 수집 요청을 보내지 못했습니다: ${err.message}`, 'error');
  } finally {
    erpSidebarSyncRequestInFlight = false;
    if (button) {
      button.disabled = false;
      button.classList.remove('is-sync-pending');
      button.removeAttribute('aria-busy');
    }
    if (!completed && currentUser === requestingUser) erpRefreshSyncStatus();
  }
}

function erpClaimAutoSyncLock() {
  const now = Date.now();
  const lock = (() => {
    try { return JSON.parse(localStorage.getItem(ERP_AUTO_SYNC_LOCK_KEY) || 'null'); }
    catch (_) { return null; }
  })();
  if (lock?.at && now - Number(lock.at) < ERP_AUTO_SYNC_LOCK_MS) return false;
  setPlainStorage(ERP_AUTO_SYNC_LOCK_KEY, JSON.stringify({ at: now }));
  return true;
}

function erpReleaseAutoSyncLock() {
  try { localStorage.removeItem(ERP_AUTO_SYNC_LOCK_KEY); } catch (_) {}
}

function erpShouldAutoSync() {
  if (document.hidden) return { ok: false, reason: '탭 비활성' };
  const blockReason = erpAutoSyncBlockReason();
  if (blockReason) return { ok: false, reason: blockReason };

  const now = Date.now();
  const autoMeta = erpReadAutoSyncMeta();
  if (autoMeta?.lastAutoStatus === 'error' && autoMeta.lastAutoAttemptAt) {
    const lastAttempt = new Date(autoMeta.lastAutoAttemptAt).getTime();
    if (Number.isFinite(lastAttempt) && now - lastAttempt < ERP_AUTO_SYNC_RETRY_MS) {
      return { ok: false, reason: '오류 후 재시도 대기' };
    }
  }

  const syncMeta = erpReadSyncMeta();
  const lastSynced = syncMeta?.syncedAt ? erpParseSyncDate(syncMeta.syncedAt).getTime() : 0;
  if (Number.isFinite(lastSynced) && lastSynced && now - lastSynced < ERP_AUTO_SYNC_INTERVAL_MS) {
    return { ok: false, reason: '수집 주기 미도래' };
  }
  return { ok: true };
}

async function erpRunAutoSync() {
  const decision = erpShouldAutoSync();
  if (!decision.ok || erpAutoSyncInFlight) {
    erpRefreshSyncStatus();
    return;
  }
  if (!erpClaimAutoSyncLock()) return;

  erpAutoSyncInFlight = true;
  erpWriteAutoSyncMeta({ lastAutoAttemptAt: new Date().toISOString(), lastAutoStatus: 'running' });
  erpRefreshSyncStatus();

  try {
    const result = await erpRefreshFromRemote({ auto: true, silent: true });
    erpWriteAutoSyncMeta({
      lastAutoFinishedAt: new Date().toISOString(),
      lastAutoStatus: result.ok ? 'ok' : 'error',
      lastAutoError: result.ok ? '' : result.error,
    });
    if (!result.ok) console.warn('[erp:auto-sync]', result.error);
  } finally {
    erpAutoSyncInFlight = false;
    erpReleaseAutoSyncLock();
    erpRefreshSyncStatus();
  }
}

function erpStartAutoSync() {
  if (erpAutoSyncTimer) {
    erpRefreshSyncStatus();
    return;
  }
  erpRefreshSyncStatus();
  setTimeout(erpRunAutoSync, 2000);
  erpAutoSyncTimer = setInterval(erpRunAutoSync, ERP_AUTO_SYNC_CHECK_MS);

  if (!erpAutoSyncListenersReady) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) erpRunAutoSync();
    });
    window.addEventListener('focus', erpRunAutoSync);
    erpAutoSyncListenersReady = true;
  }
}
