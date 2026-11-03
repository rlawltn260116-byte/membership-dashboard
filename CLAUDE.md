# 영업일지 대시보드 (membership-dashboard)

한국어로 대화한다. 도매(보조기기) 영업 대시보드 — GitHub Pages로 배포되는 정적 SPA.

- **배포 URL**: https://rlawltn260116-byte.github.io/membership-dashboard/
- **배포 방식**: GitHub Pages, `main` 브랜치 루트 기준. **push하면 자동 재배포** (1~2분).

## ⚠️ 작업 규칙 (필수)

1. **main에 직접 푸시한다.** 브랜치/PR을 만들지 말 것. 푸시 즉시 사이트에 반영된다.
2. **JS 파일을 수정하면 반드시 `index.html`의 해당 `<script src="js/....js?v=...">` 캐시버전을 갱신할 것.**
   - 형식: `?v=YYYYMMDD-설명` (예: `?v=20260613-channel-fix`)
   - 이걸 빼먹으면 브라우저가 구버전 JS를 캐시로 계속 사용해서 수정이 반영 안 됨 (실제로 여러 번 발생한 버그).
   - `project-tracker.html` 수정 시에도 index.html의 iframe `src="project-tracker.html?v=..."` 갱신.
3. `.github/workflows/amarans-sync.yml`의 cron 스케줄은 사용자가 직접 관리한다. 임의로 바꾸지 말 것.

## 프로젝트 구조

```
index.html              # SPA 전체 (사이드바 nav + 모든 page-* 섹션 + <script> 태그)
project-tracker.html    # 프로젝트 관리 (iframe으로 임베드, localStorage 저장 + 휴지통)
css/style.css           # 라이트 테마. CSS 변수: --surface --border --text2/3 --blue --green-dark 등
js/
  state.js              # 전역 상태, Firebase 설정, 공휴일(krHolidayName), orderChannel() 채널판정
  core-auth-nav.js      # 로그인/권한(MENU_ACCESS_ITEMS), showPage/PAGE_TITLES/PAGE_RENDERERS, 네비
  dashboard-records-users.js  # 대시보드(page-sales) KPI 카드, 일별 차트, 순위, 계정 관리
  stats-notices.js      # 실적 분석(renderStats/genReport, statsChannel), 공지
  products-grades-erp.js # 품목별 분석(renderProducts/renderProdAbc ABC분석), 등급, ERP 업로드/자동동기화
  clients.js, daily-entry.js, journals-weekly-monthly.js, bootstrap-datepicker.js
scripts/amarans_api_v10.py  # 아마란스 ERP 스크래퍼 (Playwright, GitHub Actions에서 실행)
.github/workflows/amarans-sync.yml  # 동기화 스케줄: 평일 KST 9~21시 5분 단위(recent60) + 매일 KST 08:00 전체(full)
```

## 데이터 흐름

아마란스 ERP → (GitHub Actions에서 `amarans_api_v10.py`) → Firebase RTDB `erp/latest` → 대시보드가 로드.

- Firebase: `https://membership-7aef2-default-rtdb.firebaseio.com/erp/latest` 아래 `order`(주문), `ship`(출고), 메타(syncedAt 등).
- **Firebase 단일 쓰기 16MB 제한** 때문에 order/ship 노드를 각각 PUT, 메타는 PATCH로 분리 업로드한다 (`_firebase_write`). 합치지 말 것.
- 스크래퍼는 route 인터셉트로 응답을 캡처하고 **페이지에는 빈 JSON만 fulfill** (80MB+ 응답을 그리드에 렌더링하면 브라우저 OOM 크래시 — 되돌리지 말 것).
- 수동 동기화: GitHub Actions → "아마란스 ERP 동기화" → Run workflow (mode: `full`=올해 전체 / `recent60`=최근 60일).
- ERP "조회 버튼" 오류는 간헐적 — 스크립트 내 3회 재시도 있음. 실패 시 워크플로 재실행하면 대부분 해결.

## 채널 분류 (사업소/유통사) — 중요 도메인 규칙

아마란스 "고객분류"(custClass, `tradeGrpNm`) 기준. 판정은 **`js/state.js`의 `orderChannel(o)`** 한 곳에서만 한다:

- **사업소(office)**: `도매(이기현)` `도매(장재순)` `도매(이민우)` `도매(안성종)` — person이 OFFICE_PERSONS
- **유통사(dist)**: 고객분류 `도매(도도매/유통사)` (person은 "도도매/유통사")
- **기타(other)**: 소매, 도매(기타) 등 — 대시보드에서 제외

수집 측(파이썬)도 동일 규칙: 거래처분류 코드 `V10002~V10005`(사업소) + `V10006`(유통사)만 수집, 품목군은 **"상품"만** (부품 제외).

## 주요 페이지 (index.html의 page-* / PAGE_RENDERERS)

- `page-sales` 대시보드: 상단 KPI 3카드 = 이번달 누적 **합계**(사업소+유통사) / **사업소** / **유통사** 매출
- `page-stats` 실적 분석: 사이드바 접이식 하위메뉴 **사업소 분석 / 유통사 분석** (`showStatsChannel('office'|'dist')`, 전역 `statsChannel`)
- `page-products` 품목별 분석: 개요 탭 + 재고분석 탭(ABC/파레토 + 재고 권장수량)
- `page-project` 프로젝트 관리: `project-tracker.html` iframe. localStorage(`pt-*` 키) 저장 + 휴지통(복원/영구삭제)
- 영업사원 필터 버튼은 사용자 계정이 아니라 **ERP person 값**(`erpPersonNames(channel)`)에서 생성

## 기타

- 공휴일: `state.js`의 `krHolidayName()` — 대한민국 2025-26 공휴일(대체공휴일 포함). 공휴일/주말은 차트에서 빨간 글씨만 (🔴 이모지 금지).
- 날짜 기준 '오늘'은 KST. 차트는 Chart.js 4.4.1 (`charts{}` 레지스트리, 재생성 전 destroy).
- 커밋 메시지는 한국어로, 변경 요약 위주.

<!-- ai-collab:start -->
Follow @AGENTS.md (section "Automatic model routing") for ai-collab model routing.
<!-- ai-collab:end -->
