# membership-dashboard

멤버십사업팀 영업/ERP 대시보드입니다. 현재 운영은 Netlify를 사용하지 않고 GitHub Pages, GitHub Actions, Firebase Realtime Database로만 구성합니다.

## Live

- Production: https://rlawltn260116-byte.github.io/membership-dashboard/
- Repository: `rlawltn260116-byte/membership-dashboard`
- Deploy source: GitHub Pages, `main` branch root

## Security

- 자세한 보안 정책과 남은 한계는 [SECURITY.md](SECURITY.md)를 확인하세요.
- 배포 전 `scripts/security-scan.ps1`이 Bearer 토큰, Amarans/Bizcube 쿠키, private key, 평문 password literal, 위험 실행 API, `javascript:` 링크, 외부 스크립트 SRI 누락을 검사합니다.
- 신규/변경/초기화 비밀번호는 PBKDF2-SHA256 해시로 저장됩니다.
- 기존 Firebase 데이터에 남아 있는 평문 비밀번호는 해당 사용자가 로그인에 성공하면 자동으로 해시로 마이그레이션됩니다.
- 로그인 전에는 Firebase의 사용자/가입대기 정보만 최소 조회하고, 영업/거래처/ERP 데이터는 로그인 성공 뒤에만 동기화합니다.
- 로그아웃 시 브라우저의 영업/거래처/ERP 로컬 캐시와 작성 중 임시저장을 제거합니다.
- 세션은 14시간, "로그인 유지"는 7일 만료로 제한됩니다.
- 로그인 실패가 반복되면 브라우저 세션 기준으로 5분간 추가 시도를 제한합니다.
- GitHub Pages 정적 사이트 특성상 Firebase Authentication 또는 서버 프록시 없이 Firebase 직접 REST 공격을 완전히 차단할 수는 없습니다.

## 원클릭 작업

다른 PC에서 처음 세팅할 때는 PowerShell에서 아래 한 줄만 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path $env:TEMP 'membership-dashboard-setup.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/rlawltn260116-byte/membership-dashboard/main/scripts/setup-workspace.ps1' -OutFile $p; & $p"
```

이 명령은 `C:\Users\사용자명\Downloads\dashboard_fixed_v9_app`에 저장소를 clone 또는 pull 하고, 로컬 확인용 서버를 연 뒤 브라우저를 띄웁니다.

처음 한 번은 GitHub 로그인이 필요할 수 있습니다. GitHub CLI(`gh`)가 설치되어 있으면 로그인 화면을 열고, 없으면 `git push` 시점에 브라우저 인증이 뜰 수 있습니다.

작업 폴더 안에서는 아래 파일을 더블클릭해서 쓰면 됩니다.

- `start-local.cmd`: 로컬 서버 실행 후 브라우저 열기
- `deploy.cmd`: 수정분을 커밋, 푸시, GitHub Pages 상태 확인
- `stop-local.cmd`: 로컬 서버 종료

## 코드 체계와 점검

- 코드 역할과 리팩터링 기준은 [CODE_HEALTH.md](CODE_HEALTH.md)를 기준으로 합니다.
- `scripts/security-scan.ps1`은 비밀정보와 위험 실행 패턴을 차단합니다.
- `scripts/code-health.ps1`은 큰 파일, `innerHTML`, 인라인 이벤트, 전역 함수가 많은 파일을 요약합니다.
- `scripts/test-app-architecture.cjs`는 스크립트 순서, 공통 함수 중복, 잘못된 HTML 속성, 공통 UI helper를 검사합니다.
- `deploy.cmd`는 보안 스캔, 코드 건강도 요약, 구조 테스트, 기능 테스트, `git diff --check`를 통과한 뒤 푸시합니다.

## 운영 구조

1. `index.html`과 정적 파일은 GitHub Pages에서 서빙합니다.
2. 사용자가 대시보드에 접속하면 Firebase Realtime Database의 공유 데이터와 `erp/latest`를 읽습니다.
3. 아마란스 주문현황/출고현황 수집은 GitHub Actions의 `amarans-sync.yml`이 담당합니다.
4. `scripts/amarans_api_v10.py`가 Playwright로 아마란스에 로그인하고, signed API 요청을 활용해 데이터를 가져옵니다.
5. 수집 결과는 Firebase `erp/latest`에 `{ order, ship, syncedAt, orderCount, shipCount }` 형태로 업로드됩니다.

브라우저에는 아마란스 계정 정보나 GitHub 토큰을 저장하지 않습니다.

## 배포 방식

Netlify 배포는 사용하지 않습니다.

수정 후 자동 배포는 `deploy.cmd` 더블클릭으로 처리합니다. 내부 동작은 아래와 같습니다.

```powershell
git diff --check
git add -A
git commit -m "update: dashboard YYYY-MM-DD HH:mm"
git pull --rebase origin main
git push origin main
```

`main`에 push되면 GitHub Pages가 자동으로 재빌드합니다. 배포 후 https://rlawltn260116-byte.github.io/membership-dashboard/ 에서 확인합니다.

## 아마란스 ERP 자동 수집

워크플로: `.github/workflows/amarans-sync.yml`

스케줄:

- 평일 KST 09:17~20:17: 1시간마다 최근 60일 데이터 수집
- 평일 KST 08:17: 올해 전체 데이터 수집
- 주말과 2026년 한국 공휴일/대체공휴일은 Python 스크립트의 `--auto` 검사에서 스킵됩니다.
- GitHub Actions 스케줄은 정각 실행을 보장하지 않고, 정각에는 지연/드랍 가능성이 더 커서 매시 17분으로 분산했습니다.
- GitHub가 업무시간 예약 작업을 늦게 실행해도 수집은 진행되도록 설정했습니다. 단, 수동 실행이 아닌 자동 실행은 주말/공휴일에는 계속 스킵됩니다.

수동 실행:

1. GitHub 저장소의 `Actions` 탭으로 이동
2. `아마란스 ERP 동기화` workflow 선택
3. `Run workflow` 클릭
4. `recent60` 또는 `full` 선택

필요한 GitHub Secrets:

- `AMARANS_USERNAME`
- `AMARANS_PASSWORD`
- `AMARANS_FIREBASE_DB_URL`
- `AMARANS_FIREBASE_AUTH_TOKEN` Firebase 규칙에서 인증이 필요할 때만

## 대시보드 새로고침

대시보드의 ERP `새로고침` 버튼은 아마란스 수집기를 즉시 실행하지 않습니다.

현재 버튼 동작:

- Firebase `erp/latest/syncedAt`을 먼저 확인합니다.
- 원격 데이터가 더 최신이 아니면 기존 런타임 데이터를 유지합니다.
- 강제 새로고침 또는 하루 첫 동기화인 경우 Firebase `erp/latest` 전체 데이터를 다시 읽습니다.

즉시 아마란스 수집이 필요하면 GitHub Actions에서 `아마란스 ERP 동기화` workflow를 수동 실행합니다.

## 주요 파일

- `index.html`: GitHub Pages 진입 파일
- `css/style.css`: 공통 스타일
- `js/storage.js`: Firebase 공유 데이터 로드/저장
- `js/app-data.js`: 공유 데이터 초기화와 활성 화면 갱신
- `js/ui-utils.js`: 공통 출력 정화 helper
- `js/ui-feedback.js`: 공통 모달과 알림
- `js/products-grades-erp.js`: 제품별 현황, 거래처 등급, ERP 데이터 반영
- `js/core-auth-nav.js`: 로그인, 권한, 메뉴, 주문/출고 기준 전환
- `js/dashboard-sales.js`: 대시보드/영업현황 집계와 차트
- `js/records.js`, `js/users.js`, `js/targets.js`, `js/account.js`: 기록/계정/목표/비밀번호 화면
- `js/journals-weekly.js`, `js/journals-monthly.js`, `js/daily-entry.js`: 주간/월간/일간 영업일지
- `js/stats-notices.js`: 실적 분석, 공지사항, 재방문 화면
- `.github/workflows/amarans-sync.yml`: 아마란스 자동/수동 수집
- `scripts/amarans_api_v10.py`: 아마란스 Playwright 수집기
- `scripts/setup-workspace.ps1`: 다른 PC 최초 세팅
- `scripts/start-local.ps1`: 로컬 서버 실행
- `scripts/deploy.ps1`: 커밋/푸시/배포 확인
- `CODE_HEALTH.md`: 파일 책임과 리팩터링 규칙

## 로컬 실행

원클릭 실행은 `start-local.cmd`를 더블클릭합니다.

직접 실행하려면:

```powershell
python -m http.server 8000
```

그 다음 http://127.0.0.1:8000/ 로 접속합니다.

## 로컬 수집 테스트

로컬 PC에서 직접 강제 수집하려면 환경변수 설정 후 실행합니다.

```powershell
python .\scripts\amarans_api_v10.py --auto --force --recent 60
```

전체 수집:

```powershell
python .\scripts\amarans_api_v10.py --auto --force --full
```

주요 Python 환경변수:

- `AMARANS_USERNAME`
- `AMARANS_PASSWORD`
- `AMARANS_FIREBASE_DB_URL`
- `AMARANS_FIREBASE_AUTH_TOKEN`
- `AMARANS_REMOTE_ERP_PATH` 기본값: `erp/latest`
- `AMARANS_PAGE_SIZE` 기본값: `99999`
- `AMARANS_SKIP_FIREBASE_UPLOAD=1` 로컬 파일만 만들고 Firebase 업로드 생략

## 버전 관리

Git 커밋을 기준으로 버전을 관리합니다. 별도 `dashboard_fixed_v12_app` 같은 폴더 스냅샷은 기본적으로 만들지 않습니다.
