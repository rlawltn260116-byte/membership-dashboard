"""
Amarans v3 (hybrid) - 출고/주문현황 다운로더

전략:
1. 로그인 + 회사전환 + 페이지 진입 → 페이지의 axios가 wehago-sign 만들 환경 준비
2. route 인터셉트 등록 (페이로드 교체용)
3. 조회 버튼 클릭 → 페이지가 sign 포함한 요청 발송
4. route handler가 페이로드만 우리 것으로 교체 (sign 헤더는 그대로 유지)
5. 응답 받기 → JSON/xlsx 저장

UI 동작: 로그인 + 회사전환 + 페이지 진입 + 조회 버튼 클릭만.
Tab 키 시뮬레이션, 팝업 클릭, 기간 달력 클릭, 그리드 우클릭 다 없음.
"""

import os
import re
import sys
import json
import time
import getpass
import calendar
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, Playwright


# ============================================================
# 설정
# ============================================================
KST = timezone(timedelta(hours=9))


def now_kst():
    return datetime.now(KST)


def now_kst_iso():
    return now_kst().isoformat(timespec="seconds")


TARGET_YEAR = int(os.environ.get("AMARANS_YEAR", str(now_kst().year)))
# 거래처분류(고객분류) 그룹 코드 (응답 필드 tradeGrp 기준)
#  V10002~V10005 = 사업소 도매(이민우/안성종/장재순/이기현), V10006 = 유통사(도도매/유통사)
#  ※ 소매(V10001 등)는 제외. 전체 그룹 수집 시 데이터가 너무 커서 ERP가 502 발생 → 코드로 필터.
CUSTOMER_GROUPS = ["V10002", "V10003", "V10004", "V10005", "V10006"]
ITEM_GROUPS = ["TM00", "TP00"]
COST_ITEM_GROUPS = ["TM00"]
COST_CUSTOMER_GROUPS = ["V10002", "V10003", "V10004", "V10005", "V10006", "V10007"]

# 한 번에 받을 최대 행수. 이 값에 도달하면 자동 경고. 부족하면 더 늘려라.
PAGE_SIZE = int(os.environ.get("AMARANS_PAGE_SIZE", "99999"))

# 대시보드 폴더 (erp-data.js 자동 생성 위치)
DASHBOARD_DIR = os.environ.get(
    "AMARANS_DASHBOARD_DIR",
    r"C:\Users\woori\Downloads\dashboard_fixed_v9_app"
)

# Firebase Realtime Database REST 업로드 설정
# 대시보드 JS의 DB_URL 기본값과 맞춤. 다른 DB를 쓰려면 AMARANS_FIREBASE_DB_URL 지정.
FIREBASE_DB_URL = (
    os.environ.get("AMARANS_FIREBASE_DB_URL")
    or os.environ.get("FIREBASE_DB_URL")
    or "https://membership-7aef2-default-rtdb.firebaseio.com"
)
FIREBASE_AUTH_TOKEN = os.environ.get("AMARANS_FIREBASE_AUTH_TOKEN") or os.environ.get("FIREBASE_AUTH_TOKEN") or ""
REMOTE_ERP_PATH = os.environ.get("AMARANS_REMOTE_ERP_PATH", "erp/latest").strip("/")
SKIP_FIREBASE_UPLOAD = os.environ.get("AMARANS_SKIP_FIREBASE_UPLOAD", "").lower() in ("1", "true", "yes")
IGNORE_AUTO_HOURS = os.environ.get("AMARANS_IGNORE_AUTO_HOURS", "").lower() in ("1", "true", "yes")
IGNORE_AUTO_WEEKEND = os.environ.get("AMARANS_IGNORE_AUTO_WEEKEND", "").lower() in ("1", "true", "yes")

# 2026년 한국 기준 휴무일. --auto 모드에서만 자동 스킵한다.
KOREA_HOLIDAYS_2026 = {
    "2026-01-01": "신정",
    "2026-02-16": "설날 연휴",
    "2026-02-17": "설날",
    "2026-02-18": "설날 연휴",
    "2026-03-01": "삼일절",
    "2026-03-02": "삼일절 대체공휴일",
    "2026-05-01": "근로자의 날",
    "2026-05-05": "어린이날",
    "2026-05-24": "부처님오신날",
    "2026-05-25": "부처님오신날 대체공휴일",
    "2026-06-03": "지방선거일",
    "2026-06-06": "현충일",
    "2026-07-17": "제헌절",
    "2026-08-15": "광복절",
    "2026-08-17": "광복절 대체공휴일",
    "2026-09-24": "추석 연휴",
    "2026-09-25": "추석",
    "2026-09-26": "추석 연휴",
    "2026-10-03": "개천절",
    "2026-10-05": "개천절 대체공휴일",
    "2026-10-09": "한글날",
    "2026-12-25": "성탄절",
}

# 출고현황: 대시보드 양식의 한글 컬럼 → API JSON 필드 매핑
# 양식 컬럼 순서를 그대로 유지 (대시보드 인식용)
SHIP_COLUMN_MAP = [
    ("No",         None),           # 행 번호 자동 생성
    ("출고일자",   "isuDt"),         # 20260130 → 2026-01-30 자동 변환
    ("출고번호",   "isuNb"),
    ("순번",       "isuSq"),
    ("고객",       "trNm"),
    ("납품처",     "shipNm"),
    ("거래구분",   "soFgNm"),
    ("출고구분",   "mapFgNm"),
    ("과세구분",   "vatFgNm"),
    ("단가구분",   "umvatFgNm"),
    ("환율",       "exchRt"),
    ("단가",       "isuUm"),
    ("공급가",     "isugAm"),
    ("부가세",     "isuvAm"),
    ("합계액",     "isuhAm"),
    ("배송방법",   "shipFgNm"),
    ("담당자",     "empNm"),
    ("비고(건)",   "remarkDc"),
    ("품번",       "itemCd"),
    ("품명",       "itemNm"),
    ("규격",       "itemDc"),
    ("관리단위",   "unitmangDc"),
    ("출고수량",   "isuQt"),
    ("재고단위",   "unitDc"),
    ("재고단위수량", "clsQt"),
    ("단가유형",   "umNm"),
    ("외화단가",   "exchUm"),
    ("외화금액",   "exchAm"),
    ("관리구분",   "mgmtNm"),
    ("프로젝트",   "pjtNm"),
    ("비고(내역)", "remarkDcD"),
    ("출고창고",   "whNm"),
    ("출고장소",   "lcNm"),
    ("품목군",     "itemgrpNm"),
    ("대분류",     "lNm"),
    ("중분류",     "mNm"),
    ("소분류",     "sNm"),
    ("LOT여부",    "lotNm"),
    ("LOT No.",    "lotNb"),
    ("계정구분",   "acctNm"),
    ("조달구분",   "odrNm"),
    ("고객분류",   "tradeGrpNm"),
    ("담당그룹",   "deptNm"),
    ("지역",       "areaNm"),
    ("지역그룹",   "areaGrpNm"),
    ("프로젝트그룹", "pjtgrpNm"),
]

# 주문현황 양식 매핑 (43개 컬럼)
# 일부 필드는 페이로드 키와 양식 라벨로 추정. 실행 후 검증 필요.
ORDER_COLUMN_MAP = [
    ("No",          None),
    ("주문일자",     "soDt"),         # YYYYMMDD → YYYY-MM-DD 자동 변환
    ("주문번호",     "soNb"),
    ("L/C번호",      "lcNb"),
    ("고객",         "trNm"),
    ("거래구분",     "soFgNm"),
    ("과세구분",     "vatFgNm"),
    ("환종",         "exchCd"),
    ("환율",         "exchRt"),
    ("납품처",       "shipNm"),
    ("담당자",       "empNm"),
    ("순번",         "soSq"),
    ("품번",         "itemCd"),
    ("품명",         "itemNm"),
    ("규격",         "itemDc"),
    ("납기일자",     "dueDt"),        # 8자리 변환
    ("출하예정일자", "shipreqDt"),    # 8자리 변환
    ("관리단위",     "unitmangDc"),
    ("주문수량",     "soQt"),
    ("외화단가",     "exchUm"),
    ("외화금액",     "exchAm"),
    ("단가유형",     "umNm"),
    ("단가",         "soUm"),
    ("공급가",       "sogAm"),
    ("부가세",       "sovAm"),
    ("합계액",       "sohAm"),
    ("관리구분",     "mgmtNm"),
    ("프로젝트",     "pjtNm"),
    ("프로젝트그룹", "pjtgrpNm"),
    ("관리번호",     "mgmNm"),
    ("비고(건)",     "remarkDc"),
    ("비고(내역)",   "remarkDcD"),
    ("고객분류",     "tradeGrpNm"),
    ("지역",         "areaNm"),
    ("지역그룹",     "areaGrpNm"),
    ("담당그룹",     "deptNm"),
    ("품목군",       "itemgrpNm"),
    ("대분류",       "lNm"),
    ("중분류",       "mNm"),
    ("소분류",       "sNm"),
    ("계정구분",     "acctNm"),
    ("조달구분",     "odrNm"),
    ("LOT여부",      "lotNm"),
]

# 출고현황 페이로드
SHIP_PAYLOAD = {
    "readType": "data",
    "pagingDirection": "scrollToBottom",
    "rowCountPerPage": PAGE_SIZE,
    "initialPageSize": PAGE_SIZE,
    "markPreventRead": False,
    "currentPage": 0,
    "startRowIndex": 0,
    "currentRowCount": PAGE_SIZE,
    "divCds": [], "deptCds": [], "empCds": [],
    "isuDtFrom": f"{TARGET_YEAR}0101",
    "isuDtTo":   f"{TARGET_YEAR}1231",
    "isuNbFg": "0", "isuNb": "",
    "remarkDcFg": "0", "remarkDc": "",
    "soQtFg": "0", "negNumYn": "0",
    "itemCds": [], "itemCdExcludes": [],
    "itemgrpCds": ITEM_GROUPS,
    "lCds": [], "mCds": [], "sCds": [],
    "lotFgs": [], "acctFgs": [], "odrFgs": [],
    "trCds": [], "trCdExcludes": [], "shipCds": [],
    "tradeGrps": CUSTOMER_GROUPS,
    "soFgs": [], "mapFgs": [], "exchCds": [],
    "plnCdFg": "2", "plnCds": [], "plnsCds": [],
    "areaCds": [], "areaGrps": [],
    "mgmtCds": [], "pjtCds": [], "pjtgrpCds": [],
    "vatFgs": [], "whCds": [], "lcCds": [], "shipFgs": [],
    "userColListSq1": [], "userColListSq2": [],
    "userColModuleCd": "", "userColMenuCd": "", "userColPageCd": "",
}

JOBS = [
    {
        "slug": "ship",
        "menu_name": "출고현황",
        "endpoint": "/logis/blf0050/0lo00001",
        "url_hash": "#/BL/BLF0050/BLF0050",
        "payload": SHIP_PAYLOAD,
        "column_map": SHIP_COLUMN_MAP,
        "date_fields": ("isuDtFrom", "isuDtTo"),
        "key_fields": ("isuNb", "isuSq"),
        "dashboard_fields": {
            "date": "isuDt", "no": "isuNb", "qty": "isuQt",
            "supply": "isugAm", "total": "isuhAm",
        },
    },
    {
        "slug": "order",
        "menu_name": "주문현황",
        "endpoint": "/logis/blc0030/0lo00001",
        "url_hash": "#/BL/BLC0030/BLC0030",
        "payload": {
            "readType": "data",
            "pagingDirection": "scrollToBottom",
            "rowCountPerPage": PAGE_SIZE,
            "initialPageSize": PAGE_SIZE,
            "markPreventRead": False,
            "currentPage": 0,
            "startRowIndex": 0,
            "currentRowCount": PAGE_SIZE,
            "divCds": [], "deptCds": [], "empCds": [],
            "from": f"{TARGET_YEAR}0101",
            "to":   f"{TARGET_YEAR}1231",
            "isTotalSelectTr": "0",
            "trCds": [], "soFgs": [],
            "isTotalSelectItem": "0",
            "itemCds": [],
            "itemgrpCds": ITEM_GROUPS,
            "lCds": [], "mCds": [], "sCds": [],
            "lotFgs": [], "acctFgs": [], "odrFgs": [],
            "expireYns": [],
            "shipCds": [],
            "tradeGrps": CUSTOMER_GROUPS,
            "exchCds": [],
            "plnCdFg": "2", "plnCds": [], "plnsCds": [],
            "areaCds": [], "areaGrps": [],
            "mgmtCds": [], "pjtCds": [], "pjtgrpCds": [],
            "vatFgs": [],
            "nbFg": "0", "nb": "",
            "remarkDcFg": "0", "remarkDc": "",
            "fromDueDt": "", "toDueDt": "",
            "fromShipreqDt": "", "toShipreqDt": "",
            "mgmNm": "",
            "whCds": [],
            "userColListSq1": [], "userColListSq2": [],
            "userColModuleCd": "", "userColMenuCd": "", "userColPageCd": "",
        },
        "column_map": ORDER_COLUMN_MAP,
        "date_fields": ("from", "to"),
        "key_fields": ("soNb", "soSq"),
        "dashboard_fields": {
            "date": "soDt", "no": "soNb", "qty": "soQt",
            "supply": "sogAm", "total": "sohAm",
        },
    },
]

COST_ANALYSIS_JOB = {
    "slug": "cost-analysis",
    "menu_name": "원가분석현황(마감기준)",
    "endpoint": "/logis/BLG0130/0lo00001",
    "url_hash": "#/BL/BLG0130/BLG0130",
}

COST_ANALYSIS_VIEWS = [
    {"key": "closing-customer", "tab": "마감기준", "label": "고객", "topTab": "0", "subTab": "0", "codeFields": ["trCd", "hKey"], "nameFields": ["trNm", "hKeyNm"]},
    {"key": "closing-item", "tab": "마감기준", "label": "품목", "topTab": "0", "subTab": "1", "codeFields": ["itemCd", "hKey"], "nameFields": ["itemNm", "hKeyNm"]},
    {"key": "closing-employee", "tab": "마감기준", "label": "담당자", "topTab": "0", "subTab": "2", "codeFields": ["empCd", "hKey"], "nameFields": ["empNm", "hKeyNm"]},
    {"key": "closing-management", "tab": "마감기준", "label": "관리구분", "topTab": "0", "subTab": "3", "codeFields": ["mgmtCd", "hKey"], "nameFields": ["mgmtNm", "hKeyNm"]},
    {"key": "closing-project", "tab": "마감기준", "label": "프로젝트", "topTab": "0", "subTab": "4", "codeFields": ["pjtCd", "hKey"], "nameFields": ["pjtNm", "hKeyNm"]},
    {"key": "closing-dept", "tab": "마감기준", "label": "부서", "topTab": "0", "subTab": "5", "codeFields": ["deptCd", "hKey"], "nameFields": ["deptNm", "hKeyNm"]},
    {"key": "mgmt-customer-class", "tab": "관리분류별", "label": "고객분류", "topTab": "1", "subTab": "6", "codeFields": ["trgrpCd", "hKey"], "nameFields": ["trgrpNm", "hKeyNm"]},
    {"key": "mgmt-area", "tab": "관리분류별", "label": "지역", "topTab": "1", "subTab": "7", "codeFields": ["areaCd", "hKey"], "nameFields": ["areaNm", "hKeyNm"]},
    {"key": "mgmt-area-group", "tab": "관리분류별", "label": "지역그룹", "topTab": "1", "subTab": "8", "codeFields": ["areagrpCd", "hKey"], "nameFields": ["areagrpNm", "hKeyNm"]},
    {"key": "mgmt-manager-group", "tab": "관리분류별", "label": "담당그룹", "topTab": "1", "subTab": "9", "codeFields": ["plnsCd", "deptCd", "hKey"], "nameFields": ["plnsNm", "deptNm", "hKeyNm"]},
    {"key": "item-group", "tab": "품목분류별", "label": "품목군", "topTab": "2", "subTab": "10", "codeFields": ["itemgrpCd", "hKey"], "nameFields": ["itemgrpNm", "hKeyNm"]},
    {"key": "item-large", "tab": "품목분류별", "label": "대분류", "topTab": "2", "subTab": "11", "codeFields": ["lCd", "hKey"], "nameFields": ["lNm", "hKeyNm"]},
    {"key": "item-middle", "tab": "품목분류별", "label": "중분류", "topTab": "2", "subTab": "12", "codeFields": ["mCd", "hKey"], "nameFields": ["mNm", "hKeyNm"]},
    {"key": "item-small", "tab": "품목분류별", "label": "소분류", "topTab": "2", "subTab": "13", "codeFields": ["sCd", "hKey"], "nameFields": ["sNm", "hKeyNm"]},
]


# ============================================================
# 누적 데이터 / 대시보드 변환 / merge
# ============================================================
def compute_date_range(days):
    """days=None이면 올해 전체, days=N이면 (오늘 - N일, 오늘)"""
    today = now_kst()
    if days is None:
        return (f"{today.year}0101", f"{today.year}1231")
    start = today - timedelta(days=days)
    return (start.strftime("%Y%m%d"), today.strftime("%Y%m%d"))


def _cost_month_range(year, month):
    last_day = calendar.monthrange(year, month)[1]
    return f"{year}{month:02d}01", f"{year}{month:02d}{last_day:02d}"


def cost_months_to_collect(year, selection="", current=None):
    current = current or now_kst()
    if year < 2000 or year > current.year:
        raise ValueError("Invalid cost collection year")
    last_month = 12 if year < current.year else current.month
    if not selection.strip():
        return list(range(last_month, 0, -1))
    months = []
    for value in selection.split(","):
        match = re.fullmatch(r"(\d{4})-(0[1-9]|1[0-2])", value.strip())
        if not match or int(match[1]) != year or int(match[2]) > last_month:
            raise ValueError("Cost months must be YYYY-MM in the selected year, without future months")
        month = int(match[2])
        if month not in months:
            months.append(month)
    return months


def cost_response_rows(data):
    # A failed or unfamiliar response must never replace stored figures with zero.
    if isinstance(data, dict):
        code = data.get("resultCode")
        if code is not None and str(code).upper() not in ("0", "200", "SUCCESS", "OK"):
            raise ValueError("ERP reported an unsuccessful cost response")
    rows, rows_path = find_rows(data)
    if rows is not None:
        if not all(isinstance(row, dict) and "clsgAm" in row and
                   ("benefitAm" in row or "costAm" in row) for row in rows):
            raise ValueError("Unrecognized cost row schema")
        return rows, rows_path
    paths = [(), ("rows",), ("data",), ("data", "rows"), ("result", "rows"),
             ("list",), ("resultData",), ("resultData", "rows"), ("resultData", "list"),
             ("resultData", "dataList"), ("resultData", "data"), ("resultData", "records"),
             ("resultData", "result"), ("resultData", "items")]
    for path in paths:
        node = data
        for key in path:
            node = node.get(key) if isinstance(node, dict) else None
        if isinstance(node, list) and not node:
            return [], ".".join(path) or "(root)"
    raise ValueError("Missing cost rows in ERP response")


def build_cost_analysis_payload(year, month, view=None):
    date_from, date_to = _cost_month_range(year, month)
    view = view or COST_ANALYSIS_VIEWS[6]
    return {
        "option0": "1",
        "option0Ym": "",
        "option1": "0",
        "option1Ym": "",
        "topTab": view["topTab"],
        "subTab": view["subTab"],
        "gridFg": "header",
        "checkedKey": None,
        "hKey": "",
        "divCds": [],
        "deptCds": [],
        "empCds": [],
        "clsDtFrom": date_from,
        "clsDtTo": date_to,
        "rtFg": "0",
        "trCds": [],
        "trCdExcludes": [],
        "shipCds": [],
        "itemCds": [],
        "itemCdExcludes": [],
        "itemgrpCds": COST_ITEM_GROUPS,
        "soFgs": [],
        "tradeGrps": COST_CUSTOMER_GROUPS,
        "plnFg": "0",
        "plnCds": [],
        "plnsCds": [],
        "mgmtCds": [],
        "pjtCds": [],
        "pjtgrpCds": [],
        "areaCds": [],
        "areaGrps": [],
        "lCds": [],
        "mCds": [],
        "sCds": [],
        "acctFgs": [],
        "odrFgs": [],
        "setitemFgs": [],
        "lotFgs": [],
        "deptFg": "0",
    }


def _safe_num(v):
    if v == "" or v is None:
        return 0
    try:
        f = float(v)
        # NaN 체크
        if f != f:
            return 0
        return f
    except (ValueError, TypeError):
        return 0


def _safe_str(v):
    """None, NaN, 'nan' 문자열 등을 안전하게 빈 문자열로."""
    if v is None:
        return ""
    s = str(v).strip()
    if s.lower() in ("nan", "none", "nat"):
        return ""
    return s


def _safe_int(v):
    return int(round(_safe_num(v)))


def _first_value(row, fields):
    for field in fields:
        value = _safe_str(row.get(field))
        if value:
            return value
    return ""


def normalize_cost_analysis_rows(rows, view=None):
    view = view or COST_ANALYSIS_VIEWS[6]
    normalized = []
    seen = set()
    for row in rows or []:
        name = _first_value(row, view["nameFields"] + ["hKeyNm", "trgrpNm", "trNm", "itemNm"])
        item_group = _safe_str(row.get("itemgrpNm"))
        if item_group and item_group != "상품":
            continue
        code = _first_value(row, view["codeFields"] + ["hKey", "trgrpCd", "trCd", "itemCd"]) or name
        if not code or code in seen:
            continue
        seen.add(code)
        sales = _safe_int(row.get("clsgAm"))
        cost = _safe_int(row.get("costAm"))
        profit = _safe_int(row.get("benefitAm"))
        if not cost and sales and profit:
            cost = sales - profit
        rate = round(_safe_num(row.get("benefitRt")), 2)
        if not rate and sales:
            rate = round((profit / sales) * 100, 2)
        normalized.append({
            "code": code,
            "name": name,
            "sales": sales,
            "cost": cost,
            "profit": profit,
            "marginRate": rate,
        })
    normalized.sort(key=lambda item: item["sales"], reverse=True)
    return normalized


def merge_by_key(existing, new_rows, key_fields):
    """unique key 기반 merge. 새 행이 기존 행을 덮어씀 (modifyDt 기반 갱신 효과)."""
    def make_key(r):
        return tuple(str(r.get(f, "")) for f in key_fields)

    by_key = {make_key(r): r for r in existing}
    added = 0
    updated = 0
    for r in new_rows:
        k = make_key(r)
        if k in by_key:
            updated += 1
        else:
            added += 1
        by_key[k] = r
    return list(by_key.values()), added, updated


# 대시보드에 포함할 품목군(itemgrpNm) — "상품"만 사용, 부품 제외
ITEMGRP_KEEP = {"상품"}

# 채널 분류 (고객분류=tradeGrpNm 기준)
#  - 사업소(office): 도매(이기현/장재순/이민우/안성종)
#  - 유통사(dist): 고객분류 == "도매(도도매/유통사)"  (person 추출 시 "도도매/유통사")
#  - 그 외(소매, 도매(기타) 등): other → 대시보드 제외
OFFICE_PERSONS = {"이기현", "장재순", "이민우", "안성종"}
DIST_PERSON = "도도매/유통사"

# 대시보드에 보관할 채널 (사업소 + 유통사만)
CHANNEL_KEEP = {"office", "dist"}


def classify_channel(cust_cls, person):
    if person == DIST_PERSON or cust_cls == "도매(도도매/유통사)":
        return "dist"
    if person in OFFICE_PERSONS:
        return "office"
    return "other"


def to_dashboard_format(rows, job):
    """erpParseRows와 동일한 형식으로 변환."""
    df = job["dashboard_fields"]
    basis = job["slug"]
    result = []
    grp_counts = {}
    chan_counts = {}
    skipped_grp = 0
    skipped_chan = 0
    for r in rows:
        # 품목군 필터: 상품만 (부품 제외)
        grp = _safe_str(r.get("itemgrpNm", "")).strip()
        grp_counts[grp or "(빈값)"] = grp_counts.get(grp or "(빈값)", 0) + 1
        if ITEMGRP_KEEP and grp not in ITEMGRP_KEEP:
            skipped_grp += 1
            continue
        cust_cls = _safe_str(r.get("tradeGrpNm", "")).strip()
        match = re.search(r"도매\((.+?)\)", cust_cls)
        person = match.group(1) if match else _safe_str(r.get("empNm", ""))
        channel = classify_channel(cust_cls, person)
        chan_counts[channel] = chan_counts.get(channel, 0) + 1
        # 채널 필터: 사업소 + 유통사만 (소매·기타 제외)
        if channel not in CHANNEL_KEEP:
            skipped_chan += 1
            continue

        date_str = format_date(r.get(df["date"], ""))
        client = _safe_str(r.get("trNm", ""))
        if not date_str or not client:
            continue

        result.append({
            "basis": basis,
            "date": date_str,
            "client": client,
            "product": _safe_str(r.get("itemNm", "")),
            "category": _safe_str(r.get("lNm", "")),
            "qty": _safe_num(r.get(df["qty"], 0)),
            "supply": _safe_num(r.get(df["supply"], 0)),
            "total": _safe_num(r.get(df["total"], 0)),
            "person": person,
            "custClass": cust_cls,
            "channel": channel,
            "region": _safe_str(r.get("areaNm", "")),
            "orderNo": _safe_str(r.get(df["no"], "")),
        })
    print(f"   [{basis}] 품목군 분포: {grp_counts} | 상품만 유지, 부품 등 제외 {skipped_grp}건")
    print(f"   [{basis}] 채널 분포: {chan_counts} | 사업소+유통사 {len(result)}건 보관, 소매/기타 {skipped_chan}건 제외")
    return result


def write_dashboard_data_js(ship_records, order_records, dashboard_dir):
    """대시보드 폴더에 erp-data.js 생성 → localStorage 자동 주입."""
    dash = Path(dashboard_dir)
    if not dash.exists():
        print(f"⚠️ 대시보드 폴더를 찾을 수 없음: {dash}")
        print(f"   AMARANS_DASHBOARD_DIR 환경변수로 경로 지정 가능")
        return None

    js_dir = dash / "js"
    if not js_dir.exists():
        js_dir = dash

    output_path = js_dir / "erp-data.js"
    ship_json = json.dumps(ship_records, ensure_ascii=False, separators=(",", ":"))
    order_json = json.dumps(order_records, ensure_ascii=False, separators=(",", ":"))
    now_iso = now_kst_iso()

    content = f"""// Auto-generated by amarans_api_v10 at {now_iso}
// 대시보드 로드 시 localStorage에 ERP 데이터 자동 주입
(function() {{
    try {{
        const ship = {ship_json};
        const order = {order_json};
        localStorage.setItem('sj-orders-ship', JSON.stringify(ship));
        localStorage.setItem('sj-orders-order', JSON.stringify(order));
        localStorage.setItem('sj-orders', JSON.stringify(ship));
        localStorage.setItem('sj-erp-last-sync', '{now_iso}');
        localStorage.setItem('sj-erp-sync-meta', JSON.stringify({{
            source: 'amarans-playwright-local',
            syncedAt: '{now_iso}',
            orderCount: order.length,
            shipCount: ship.length
        }}));
        console.log('✓ ERP 데이터 자동 주입: 출고 ' + ship.length.toLocaleString() + '건, 주문 ' + order.length.toLocaleString() + '건');
    }} catch (err) {{
        console.error('ERP 데이터 주입 실패:', err);
    }}
}})();
"""

    # atomic write: 대시보드가 동시 로드 중이어도 깨지지 않게
    tmp_path = output_path.with_suffix(".js.tmp")
    tmp_path.write_text(content, encoding="utf-8")
    tmp_path.replace(output_path)

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"✓ 대시보드 데이터 생성: {output_path} ({size_mb:.1f} MB)")
    return output_path


def build_firebase_rest_url(path):
    """Firebase Realtime Database REST API URL."""
    if not FIREBASE_DB_URL:
        return ""
    base = FIREBASE_DB_URL.rstrip("/")
    clean_path = path.strip("/")
    url = f"{base}/{clean_path}.json"
    if FIREBASE_AUTH_TOKEN:
        url += "?" + urllib.parse.urlencode({"auth": FIREBASE_AUTH_TOKEN})
    return url


def fetch_remote_dashboard_payload():
    """Read the current Firebase ERP payload used as the full-year base."""
    if SKIP_FIREBASE_UPLOAD:
        return None

    url = build_firebase_rest_url(REMOTE_ERP_PATH)
    if not url:
        return None

    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
        if not raw or raw.strip() == b"null":
            return None
        return json.loads(raw.decode("utf-8"))
    except Exception as exc:
        print(f"  Remote base read skipped: {exc}")
        return None


def remote_payload_has_full_year_base(payload):
    """Return True only after a full-year bootstrap has been uploaded."""
    if not isinstance(payload, dict):
        return False
    try:
        year = int(payload.get("year") or 0)
    except (TypeError, ValueError):
        year = 0
    if year != TARGET_YEAR:
        return False
    if payload.get("hasFullYearBase") is not True:
        return False
    return isinstance(payload.get("order"), list) and isinstance(payload.get("ship"), list)


def _parse_dashboard_record_date(row):
    value = _safe_str(row.get("date") if isinstance(row, dict) else "")
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            sample = value[:10] if fmt == "%Y-%m-%d" else value[:8]
            return datetime.strptime(sample, fmt).date()
        except ValueError:
            continue
    return None


def merge_dashboard_date_window(existing_records, fresh_records, date_from, date_to):
    """Replace only the fetched date window inside the full-year Firebase base."""
    existing_records = existing_records if isinstance(existing_records, list) else []
    fresh_records = fresh_records if isinstance(fresh_records, list) else []
    start = datetime.strptime(date_from, "%Y%m%d").date()
    end = datetime.strptime(date_to, "%Y%m%d").date()

    kept = []
    removed = 0
    dropped_other_year = 0
    for row in existing_records:
        record_date = _parse_dashboard_record_date(row)
        if record_date and record_date.year != TARGET_YEAR:
            dropped_other_year += 1
            continue
        if record_date and start <= record_date <= end:
            removed += 1
            continue
        kept.append(row)

    return kept + fresh_records, removed, dropped_other_year


def upload_dashboard_data_remote(ship_records, order_records, date_from=None, date_to=None, remote_payload=None):
    """대시보드가 읽을 최신 ERP 데이터를 Firebase REST API로 업로드."""
    if SKIP_FIREBASE_UPLOAD:
        print("  원격 업로드 생략: AMARANS_SKIP_FIREBASE_UPLOAD 설정됨")
        return False

    url = build_firebase_rest_url(REMOTE_ERP_PATH)
    if not url:
        print("  원격 업로드 생략: FIREBASE DB URL 없음")
        return False

    now_iso = now_kst_iso()
    full_year_from = f"{TARGET_YEAR}0101"
    full_year_to = f"{TARGET_YEAR}1231"
    is_full_year = date_from == full_year_from and date_to == full_year_to
    sync_mode = "full-year" if is_full_year else "recent-window"
    base_synced_at = ""

    if not is_full_year and date_from and date_to:
        if remote_payload is None:
            remote_payload = fetch_remote_dashboard_payload()

        if remote_payload_has_full_year_base(remote_payload):
            base_synced_at = _safe_str(remote_payload.get("syncedAt", ""))
            order_records, order_removed, order_dropped = merge_dashboard_date_window(
                remote_payload.get("order", []),
                order_records,
                date_from,
                date_to,
            )
            ship_records, ship_removed, ship_dropped = merge_dashboard_date_window(
                remote_payload.get("ship", []),
                ship_records,
                date_from,
                date_to,
            )
            sync_mode = "recent-window-merged"
            print(
                "  Remote merge: "
                f"{date_from}~{date_to}, "
                f"order replaced {order_removed:,}, ship replaced {ship_removed:,}, "
                f"other-year dropped {order_dropped + ship_dropped:,}"
            )
        else:
            print("  Remote full-year base not found. Uploading the fetched window as-is.")

    meta = {
        "source": "amarans-playwright",
        "syncedAt": now_iso,
        "year": TARGET_YEAR,
        "syncMode": sync_mode,
        "hasFullYearBase": is_full_year or (remote_payload_has_full_year_base(remote_payload) if remote_payload else False),
        "rangeFrom": date_from or "",
        "rangeTo": date_to or "",
        "baseSyncedAt": base_synced_at,
        "orderCount": len(order_records),
        "shipCount": len(ship_records),
        "uploading": False,
    }

    # 대시보드는 압축본(packed)만 내려받는다. 원본 대비 약 1/7 크기.
    packed = {
        "v": 1,
        "syncedAt": now_iso,
        "order": pack_records(order_records, "order"),
        "ship": pack_records(ship_records, "ship"),
    }

    # 큰 배열의 전체 교체는 요청 본문이 작아도 Firebase 변경 크기 제한에 걸린다.
    # 숫자 인덱스를 묶어 PATCH하고, 모든 데이터 저장 후에만 완료 시각을 공개한다.
    if not _firebase_write(REMOTE_ERP_PATH, {"uploading": True}, "PATCH"):
        return False
    if not _firebase_write(f"{REMOTE_ERP_PATH}/packed", {"uploading": True}, "PATCH"):
        return False
    for basis, records in (("order", order_records), ("ship", ship_records)):
        if not _firebase_replace_rows(f"{REMOTE_ERP_PATH}/{basis}", records):
            return False
        part = packed[basis]
        if not _firebase_write(f"{REMOTE_ERP_PATH}/packed/{basis}",
                               {"basis": basis, "dict": part["dict"]}, "PATCH"):
            return False
        if not _firebase_replace_rows(f"{REMOTE_ERP_PATH}/packed/{basis}/rows", part["rows"]):
            return False
    if not _firebase_write(f"{REMOTE_ERP_PATH}/packed", {"v": 1, "syncedAt": now_iso, "uploading": False}, "PATCH"):
        return False
    if not _firebase_write(REMOTE_ERP_PATH, meta, "PATCH"):
        return False
    print(f"✓ Firebase 업로드 완료: /{REMOTE_ERP_PATH} (주문 {len(order_records):,}, 출고 {len(ship_records):,})")
    return True


# 대시보드 전송용 압축 포맷.
# 레코드마다 반복되는 키 이름과 문자열 값(거래처/품목/영업사원 등)을 사전으로 빼고
# 본문은 인덱스 배열만 남긴다. 실측 26.2MB -> 3.6MB (약 1/7). 무손실.
PACK_DICT_FIELDS = ["date", "client", "product", "category", "person", "custClass", "channel", "region"]


def pack_records(rows, basis):
    dic = {f: [] for f in PACK_DICT_FIELDS}
    idx = {f: {} for f in PACK_DICT_FIELDS}

    def put(field, value):
        v = "" if value is None else str(value)
        table = idx[field]
        if v not in table:
            table[v] = len(dic[field])
            dic[field].append(v)
        return table[v]

    packed_rows = []
    for r in rows or []:
        packed_rows.append([
            put("date", r.get("date")),
            put("client", r.get("client")),
            put("product", r.get("product")),
            put("category", r.get("category")),
            r.get("qty", 0),
            r.get("supply", 0),
            r.get("total", 0),
            put("person", r.get("person")),
            put("custClass", r.get("custClass")),
            put("channel", r.get("channel")),
            put("region", r.get("region")),
        ])
    return {"basis": basis, "dict": dic, "rows": packed_rows}


def _firebase_replace_rows(path, rows, batch_size=500):
    """배열 형식을 유지하면서 기존 꼬리 행도 제거한다. 조회 실패 시 덮어쓰지 않는다."""
    url = build_firebase_rest_url(path)
    if not url:
        return False
    try:
        req = urllib.request.Request(url + ("&" if "?" in url else "?") + "shallow=true")
        with urllib.request.urlopen(req, timeout=60) as resp:
            existing = json.loads(resp.read().decode("utf-8"))
        if existing is not None and not isinstance(existing, (dict, list)):
            raise ValueError("Expected an indexed Firebase collection")
        old_keys = set(existing) if isinstance(existing, dict) else set(map(str, range(len(existing or []))))
    except Exception as exc:
        print(f"  Firebase 배열 조회 실패: /{path}: {exc}")
        return False

    for start in range(0, len(rows), batch_size):
        batch = {str(index): rows[index] for index in range(start, min(start + batch_size, len(rows)))}
        if not _firebase_write(path, batch, "PATCH"):
            return False
    removed = sorted(old_keys - set(map(str, range(len(rows)))))
    for start in range(0, len(removed), batch_size):
        if not _firebase_write(path, dict.fromkeys(removed[start:start + batch_size]), "PATCH"):
            return False
    return True


def _firebase_write(path, data, method="PUT"):
    """Firebase REST 단일 노드 쓰기. 16MB 제한을 피하려 노드별로 호출한다."""
    url = build_firebase_rest_url(path)
    if not url:
        return False
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    size_mb = len(body) / 1048576
    if size_mb >= 15:
        print(f"  ⚠️ /{path} 쓰기 크기 {size_mb:.1f}MB — Firebase 16MB 제한 근접")
    req = urllib.request.Request(
        url, data=body, method=method,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            status = getattr(resp, "status", resp.getcode())
            if 200 <= int(status) < 300:
                print(f"  ✓ {method} /{path} ({size_mb:.1f}MB)")
                return True
            print(f"  ⚠️ {method} /{path} 응답 이상: HTTP {status}")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        print(f"  ⚠️ {method} /{path} 실패: {exc} | {detail}")
    except Exception as exc:
        print(f"  ⚠️ {method} /{path} 실패: {exc}")
    return False


def auto_skip_reason(now=None, ignore_hours=None, ignore_weekend=None):
    """--auto 실행 시 야간/주말/공휴일 스킵 여부."""
    now = now or now_kst()
    if ignore_hours is None:
        ignore_hours = IGNORE_AUTO_HOURS
    if ignore_weekend is None:
        ignore_weekend = IGNORE_AUTO_WEEKEND
    ymd = now.strftime("%Y-%m-%d")
    if now.weekday() >= 5 and not ignore_weekend:
        return "주말"
    if ymd in KOREA_HOLIDAYS_2026:
        return KOREA_HOLIDAYS_2026[ymd]
    if not ignore_hours and (now.hour < 9 or now.hour >= 21):
        return "야간 시간대"
    return ""


# ============================================================
# UI 단계 (최소)
# ============================================================
def login(page, username, password):
    print("[1/5] 로그인")
    page.goto("https://work.hectonproject.com/#/login")
    page.get_by_role("textbox", name="아이디를 입력하세요").fill(username)
    page.get_by_role("button", name="다음").click()
    page.get_by_role("textbox", name="비밀번호를 입력하세요").fill(password)
    page.get_by_role("textbox", name="비밀번호를 입력하세요").press("Enter")
    page.wait_for_timeout(3000)


def switch_company(page):
    print("[2/5] 회사 전환 → 조아실버케어")
    try:
        page.get_by_text("(주)헥톤프로젝트 멤버십사업팀").click(timeout=15000)
    except Exception as exc:
        body_text = ""
        try:
            body_text = page.locator("body").inner_text(timeout=5000)
        except Exception:
            pass
        login_words = ("아이디", "비밀번호", "로그인", "일치하지", "인증")
        if page.url.endswith("#/login") or any(word in body_text for word in login_words):
            raise RuntimeError(
                "Amarans login did not reach the company selector. "
                "Check AMARANS_USERNAME/AMARANS_PASSWORD GitHub secrets."
            ) from exc
        print("  ⚠ 회사 전환 메뉴를 찾지 못했습니다. 현재 로그인된 회사 컨텍스트로 계속 진행합니다.")
        return
    page.locator("#userInfoPopupBtn").get_by_text("(주)헥톤프로젝트-(주)헥톤프로젝트-비전개발본부-멤버십사업팀").click()
    page.get_by_text("(주)조아실버케어", exact=True).click()
    page.get_by_role("button", name="확인").click()
    page.wait_for_timeout(5000)


# ============================================================
# 응답 저장
# ============================================================
def find_rows(data):
    """JSON 안에서 데이터 list를 자동 탐색."""
    # 1) 알려진 경로 후보
    candidates = [
        ["rows"], ["data", "rows"], ["data"], ["result", "rows"], ["list"],
        ["resultData"], ["resultData", "rows"], ["resultData", "list"],
        ["resultData", "dataList"], ["resultData", "data"], ["resultData", "records"],
        ["resultData", "result"], ["resultData", "items"],
    ]
    for path in candidates:
        node = data
        ok = True
        for k in path:
            if isinstance(node, dict) and k in node:
                node = node[k]
            else:
                ok = False
                break
        if ok and isinstance(node, list) and len(node) > 0 and isinstance(node[0], dict):
            return node, ".".join(path)

    # 2) 깊이우선 탐색: 가장 큰 list of dicts
    best_node = None
    best_path = None

    def walk(obj, path, depth=0):
        nonlocal best_node, best_path
        if depth > 8:
            return
        if isinstance(obj, list):
            if obj and isinstance(obj[0], dict):
                if best_node is None or len(obj) > len(best_node):
                    best_node = obj
                    best_path = path or "(root)"
        elif isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, f"{path}.{k}" if path else k, depth + 1)

    walk(data, "")
    return best_node, best_path


def save_response(body_bytes, job):
    stamp = now_kst().strftime("%Y%m%d_%H%M%S")
    out_dir = Path("downloads") / "api"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        text = body_bytes.decode("utf-8")
        data = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raw_path = out_dir / f"{job['slug']}_{stamp}.bin"
        raw_path.write_bytes(body_bytes)
        print(f"⚠️ 응답 파싱 실패({e}). raw bytes 저장: {raw_path}")
        return raw_path

    json_path = out_dir / f"{job['slug']}_{stamp}.json"
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ Saved JSON: {json_path}")

    return convert_to_xlsx(data, json_path, column_map=job.get("column_map"))


def format_date(v):
    """20260130 (int/str) → '2026-01-30' (str). 그 외는 원본 유지."""
    if v is None or v == "":
        return ""
    s = str(v).strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return v


# 양식 컬럼명에 "일자"가 들어가면 자동으로 날짜 포맷 적용
DATE_COL_KEYWORDS = ("일자",)


def apply_template(rows, column_map):
    """API rows를 양식 컬럼 순서/이름으로 변환."""
    import pandas as pd

    # 1) 매핑 진단: 첫 행 기준으로 API에 존재하지 않는 필드 찾기
    if rows:
        sample_keys = set(rows[0].keys())
        missing = []
        for korean_name, api_key in column_map:
            if api_key is not None and api_key not in sample_keys:
                missing.append((korean_name, api_key))
        if missing:
            print(f"  ⚠️ API 응답에 없는 매핑 ({len(missing)}개):")
            for k, v in missing:
                print(f"     '{k}' ← '{v}' (필드 없음 → 빈 칸으로 채움)")

    # 2) 실제 변환
    out = []
    for idx, row in enumerate(rows, start=1):
        mapped = {}
        for korean_name, api_key in column_map:
            if api_key is None:
                mapped[korean_name] = idx
            else:
                val = row.get(api_key, "")
                # 컬럼명에 "일자" 들어가면 날짜 포맷 자동 적용
                if any(kw in korean_name for kw in DATE_COL_KEYWORDS):
                    val = format_date(val)
                mapped[korean_name] = val
        out.append(mapped)
    return pd.DataFrame(out, columns=[name for name, _ in column_map])


def convert_to_xlsx(data, json_path, column_map=None):
    """JSON 데이터를 xlsx로 변환. column_map 있으면 양식 매핑 적용."""
    rows, used_path = find_rows(data)

    if not rows:
        top_keys = list(data.keys()) if isinstance(data, dict) else type(data).__name__
        print(f"⚠️ rows 자동 못 찾음. 최상위 키: {top_keys}")
        return json_path

    try:
        import pandas as pd
    except ImportError:
        print("⚠️ pandas 미설치. 'pip install pandas openpyxl' 필요.")
        return json_path

    xlsx_path = Path(json_path).with_suffix(".xlsx")

    if column_map:
        df = apply_template(rows, column_map)
        print(f"✓ 양식 매핑 적용: {len(column_map)}개 한글 컬럼")
    else:
        df = pd.DataFrame(rows)
        print(f"(원본 컬럼 그대로 사용 - column_map 미지정)")

    df.to_excel(xlsx_path, index=False)
    print(f"✓ Saved Excel: {xlsx_path} ({len(rows):,}행, {len(df.columns)}열, rows={used_path})")

    if len(rows) >= PAGE_SIZE:
        print(f"⚠️ 받은 {len(rows):,}행이 한계값({PAGE_SIZE:,})에 도달했습니다. 데이터가 잘렸을 수 있습니다.")
        print(f"   더 받으려면: PowerShell에서 `$env:AMARANS_PAGE_SIZE=\"999999\"` 후 재실행")

    return xlsx_path


# ============================================================
# 메인 잡 실행 (route 인터셉트로 페이로드 교체)
# ============================================================
def run_job(page, job, replace_payload=True, override_payload=None):
    captured = {"body": None, "status": None, "url": None, "error": None}

    effective_payload = override_payload if override_payload is not None else job["payload"]
    custom_payload_str = json.dumps(effective_payload)
    mode = "페이로드 교체" if replace_payload else "원본 페이로드 유지"

    # 페이지에는 빈 응답만 돌려준다. 실제 데이터(최대 80MB+)를 그리드에 렌더링하면
    # 브라우저 렌더러가 OOM으로 죽어("Target page ... closed") 다음 단계가 실패하기 때문.
    # 우리는 route 레벨에서 본문을 이미 캡처하므로 페이지 표시는 필요 없다.
    EMPTY_BODY = b'{"resultData":[],"data":[],"list":[],"rows":[],"resultList":[]}'
    EMPTY_HEADERS = {"Content-Type": "application/json; charset=utf-8"}

    def handle_route(route):
        if captured["body"] is not None:
            # 이미 캡처함 — 페이지엔 빈 응답만 줘서 대용량 재요청/렌더링 방지
            try:
                route.fulfill(status=200, headers=EMPTY_HEADERS, body=EMPTY_BODY)
            except Exception:
                try:
                    route.abort()
                except Exception:
                    pass
            return

        try:
            if replace_payload:
                # 페이로드만 우리 것으로 교체, 헤더는 그대로 (wehago-sign 포함)
                resp = route.fetch(post_data=custom_payload_str)
            else:
                resp = route.fetch()

            body = resp.body()
            captured["body"] = body
            captured["status"] = resp.status
            captured["url"] = resp.url
            print(f"  ✓ 응답 캡처: HTTP {resp.status} ({len(body):,} bytes, mode={mode})")

            # 캡처 완료 → 페이지엔 빈 응답을 fulfill (대용량 렌더링 크래시 방지)
            route.fulfill(status=resp.status, headers=EMPTY_HEADERS, body=EMPTY_BODY)
        except Exception as exc:
            captured["error"] = repr(exc)
            print(f"  ✗ route fetch 실패: {exc}")
            try:
                route.continue_()
            except Exception:
                pass

    route_predicate = lambda url: job["endpoint"] in url
    page.route(route_predicate, handle_route)

    def click_visible_search_button():
        clicked_js = page.evaluate(
            """() => {
                const candidates = [...document.querySelectorAll('button')].filter((button) => {
                    const rect = button.getBoundingClientRect();
                    const style = window.getComputedStyle(button);
                    const cls = String(button.className || '');
                    const isSearch =
                        button.id === 'tutorial-conditionPanel-search' ||
                        cls.includes('OBTConditionPanel_searchButton') ||
                        button.innerText.trim() === '조회';
                    return isSearch &&
                        rect.width > 0 &&
                        rect.height > 0 &&
                        rect.top > 150 &&
                        style.visibility !== 'hidden' &&
                        style.display !== 'none';
                });
                const target = candidates[candidates.length - 1];
                if (!target) return false;
                for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
                    target.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, view: window}));
                }
                return true;
            }"""
        )
        if clicked_js:
            page.wait_for_timeout(1000)
        return clicked_js

    try:
        # 조회 버튼이 간헐적으로 안 떠서 페이지 새로고침 + 재시도 (최대 3회)
        max_attempts = 3
        clicked = False
        for attempt in range(1, max_attempts + 1):
            try:
                print(f"[3/5] {job['menu_name']} 페이지 진입 (시도 {attempt}/{max_attempts})")
                page.goto(f"https://work.hectonproject.com/{job['url_hash']}")
                page.wait_for_timeout(7000)

                # 페이지 진입만으로 자동 조회되는 경우 있음 (주문현황 등)
                if captured["body"] is not None:
                    print(f"[4/5] 페이지 진입 시 자동 조회 감지 → 버튼 클릭 생략")
                    clicked = True
                    break

                print(f"[4/5] 조회 버튼 클릭 (페이지가 sign 만들어서 API 호출 → 우리가 가로채기)")
                # 조회 버튼 후보 여러 개 시도
                for locator in [
                    page.get_by_role("button", name="조회").first,
                    page.locator("button").filter(has_text="조회").first,
                    page.locator("#tutorial-conditionPanel-search").last,
                    page.locator(".OBTConditionPanel_searchButton__fpGKw").last,
                    page.locator(".OBTButton_root__1g4ov").first,
                    page.locator(".OBTButton_root__JCv3f").first,
                ]:
                    try:
                        locator.wait_for(state="visible", timeout=8000)
                        locator.click()
                        clicked = True
                        break
                    except Exception:
                        continue
                if not clicked:
                    clicked = click_visible_search_button()
                if clicked:
                    break
                print(f"  ⚠ 조회 버튼 못 찾음 — 새로고침 후 재시도 ({attempt}/{max_attempts})")
                page.wait_for_timeout(3000)
            except Exception as exc:
                # 페이지/브라우저가 닫히는 등 일시 오류 → 다음 시도로
                print(f"  ⚠ 진입/조회 중 오류({attempt}/{max_attempts}): {exc}")
                if attempt >= max_attempts:
                    raise
                try:
                    page.wait_for_timeout(3000)
                except Exception:
                    pass

        if not clicked and captured["body"] is None:
            raise RuntimeError("조회 버튼을 찾지 못했습니다.")

        print(f"[5/5] API 응답 대기 (최대 300초, 큰 데이터는 시간 걸림)")
        deadline = time.time() + 300
        while time.time() < deadline:
            if captured["body"] is not None or captured["error"]:
                break
            page.wait_for_timeout(500)
    finally:
        try:
            page.unroute(route_predicate, handle_route)
        except Exception:
            pass

    if captured["error"]:
        return None, captured

    if captured["body"] is None:
        return None, {"error": "300초 안에 응답을 받지 못함"}

    # 401/400이면 페이로드 교체 때문일 수 있음 → 폴백 신호
    if captured["status"] in (400, 401):
        try:
            preview = captured["body"].decode("utf-8", errors="replace")[:300]
        except Exception:
            preview = ""
        print(f"  ⚠️ HTTP {captured['status']}: {preview}")
        return None, captured

    return captured["body"], captured


def collect_cost_analysis(page, year, months=None):
    print(f"\n{'='*60}")
    print(f"  {COST_ANALYSIS_JOB['menu_name']} 월별 수집")
    print(f"{'='*60}")

    months = months if months is not None else cost_months_to_collect(year)
    uploaded = 0
    failed = []
    completed = []
    sync_path = f"erp/costAnalysis/{year}/sync"

    if not SKIP_FIREBASE_UPLOAD:
        if not _firebase_write(sync_path, {"status": "running", "attemptStartedAt": now_kst_iso(),
                              "requestedMonths": [f"{year}-{m:02d}" for m in months],
                              "completedMonths": [], "error": ""}, method="PATCH"):
            raise RuntimeError("Could not record cost sync start")
        schema_ok = _firebase_write(f"erp/costAnalysis/{year}/schemaVersion", 1, method="PUT")
        filters_ok = _firebase_write(
            f"erp/costAnalysis/{year}/filters",
            {
                "basis": "마감기준",
                "views": COST_ANALYSIS_VIEWS,
                "itemGroups": COST_ITEM_GROUPS,
                "customerGroups": COST_CUSTOMER_GROUPS,
                "customerClassContains": "도매",
            },
            method="PUT",
        )
        if not schema_ok or not filters_ok:
            _firebase_write(sync_path, {"status": "failed", "finishedAt": now_kst_iso(),
                            "error": "metadata_upload_failed"}, method="PATCH")
            raise RuntimeError("Could not upload cost metadata")

    for month in months:
        month_key = f"{year}-{month:02d}"
        views_payload = {}
        default_rows = []
        date_from, date_to = _cost_month_range(year, month)
        print(f"\n  [{month_key}] 조회")
        for view in COST_ANALYSIS_VIEWS:
            payload = build_cost_analysis_payload(year, month, view)
            print(f"    - {view['tab']} / {view['label']}")
            try:
                body, info = run_job(page, COST_ANALYSIS_JOB, replace_payload=True, override_payload=payload)
                if body is None or not 200 <= (info.get("status") or 0) < 300:
                    raise ValueError("Cost query did not return HTTP success")
                data = json.loads(body.decode("utf-8"))
                raw_rows, rows_path = cost_response_rows(data)
                rows = normalize_cost_analysis_rows(raw_rows, view)
            except Exception as exc:
                failed.append({"month": month_key, "view": view["key"], "error": type(exc).__name__})
                print(f"      ✗ 조회/검증 실패: {type(exc).__name__}")
                continue
            totals = {
                "sales": sum(row["sales"] for row in rows),
                "cost": sum(row["cost"] for row in rows),
                "profit": sum(row["profit"] for row in rows),
            }
            totals["marginRate"] = round((totals["profit"] / totals["sales"]) * 100, 3) if totals["sales"] else 0
            views_payload[view["key"]] = {
                "key": view["key"],
                "tab": view["tab"],
                "label": view["label"],
                "rowCount": len(rows),
                "rows": rows,
                "totals": totals,
            }
            if view["key"] == "mgmt-customer-class":
                default_rows = rows
            print(f"      rows={rows_path or '-'} | {len(rows)}행 | 매출 {totals['sales']:,} | 매익 {totals['profit']:,}")
        if len(views_payload) != len(COST_ANALYSIS_VIEWS):
            print(f"  ✗ {month_key}: 일부 기준 조회 실패, 기존 월 데이터 유지")
            continue
        rows = default_rows
        payload_remote = {
            "syncedAt": now_kst_iso(),
            "basis": "마감기준",
            "month": month_key,
            "dateFrom": date_from,
            "dateTo": date_to,
            "itemGroups": COST_ITEM_GROUPS,
            "customerGroups": COST_CUSTOMER_GROUPS,
            "customerClassContains": "도매",
            "rowCount": len(rows),
            "rows": rows,
            "views": views_payload,
            "totals": {
                "sales": sum(row["sales"] for row in rows),
                "cost": sum(row["cost"] for row in rows),
                "profit": sum(row["profit"] for row in rows),
            },
        }
        totals = payload_remote["totals"]
        totals["marginRate"] = round((totals["profit"] / totals["sales"]) * 100, 3) if totals["sales"] else 0
        if not SKIP_FIREBASE_UPLOAD:
            ok = _firebase_write(
                f"erp/costAnalysis/{year}/months/{month_key}",
                payload_remote,
                method="PUT",
            )
            if ok:
                uploaded += 1
                completed.append(month_key)
                print(f"  ✓ {month_key}: {len(views_payload)}개 기준 업로드 완료")
                _firebase_write(sync_path, {"completedMonths": completed}, method="PATCH")
            else:
                failed.append({"month": month_key, "error": "upload_failed"})

    if not SKIP_FIREBASE_UPLOAD:
        status = {"status": "failed" if failed else "success", "finishedAt": now_kst_iso(),
                  "completedMonths": completed, "error": "partial_or_failed" if failed else ""}
        if not failed:
            status["lastSuccessAt"] = now_kst_iso()
        if not _firebase_write(sync_path, status, method="PATCH"):
            failed.append({"error": "status_upload_failed"})
    print(f"  원가분석 업로드 완료: {uploaded}/{len(months)}개월")
    if failed:
        print(f"  ⚠ 원가분석 실패: {failed}")
        raise RuntimeError(f"Cost sync incomplete: {len(failed)} failures; existing failed months were preserved")
    return {"uploaded": uploaded, "failed": failed}


# ============================================================
# 메인
# ============================================================
def process_job(page, job, days, save_xlsx=False):
    """잡 1개 처리: API 호출 → 누적 merge → 대시보드 형식 변환. 결과 dict 반환."""
    slug = job["slug"]
    print(f"\n{'='*60}")
    print(f"  {job['menu_name']} ({job['endpoint']})")
    print(f"{'='*60}")

    # 1) 페이로드에 동적 날짜 박기
    date_from, date_to = compute_date_range(days)
    range_label = f"{date_from} ~ {date_to}" + (f" (최근 {days}일)" if days else " (올해 전체)")
    print(f"  기간: {range_label}")

    df_from, df_to = job["date_fields"]
    payload = dict(job["payload"])
    payload[df_from] = date_from
    payload[df_to] = date_to

    # 2) API 호출 (페이로드 교체 → 실패 시 원본 페이로드)
    body, info = run_job(page, job, replace_payload=True, override_payload=payload)
    if body is None and info.get("status") in (400, 401):
        print("\n>> 2차 시도: 페이로드 교체 안 함")
        page.wait_for_timeout(2000)
        body, info = run_job(page, job, replace_payload=False)
        if body is not None:
            print("  ⚠️ 2차 모드 성공 — 거래처/품목 필터 미적용된 데이터일 수 있음")

    if body is None:
        stamp = now_kst().strftime("%Y%m%d_%H%M%S")
        err_path = Path("downloads/api") / f"{slug}_FAIL_{stamp}.txt"
        err_path.parent.mkdir(parents=True, exist_ok=True)
        err_info = {k: (v.decode("utf-8", "replace") if isinstance(v, bytes) else v)
                    for k, v in info.items()}
        err_path.write_text(json.dumps(err_info, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"✗ 최종 실패. 상세: {err_path}")
        return None

    # 3) JSON 파싱 + rows 추출
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception as e:
        print(f"⚠️ JSON 파싱 실패: {e}")
        return None

    new_rows, used_path = find_rows(data)
    if not new_rows:
        print(f"⚠️ rows 자동 못 찾음. 최상위 키: {list(data.keys()) if isinstance(data,dict) else type(data).__name__}")
        return None

    print(f"  새로 받은 행수: {len(new_rows):,} (rows={used_path})")
    if len(new_rows) >= PAGE_SIZE:
        print(f"  ⚠️ PAGE_SIZE({PAGE_SIZE:,}) 도달 — 데이터 잘렸을 수 있음")

    fresh_dashboard_records = to_dashboard_format(new_rows, job)

    # 4) 누적 파일 로드 + merge
    out_dir = Path("downloads") / "api"
    out_dir.mkdir(parents=True, exist_ok=True)
    all_path = out_dir / f"{slug}_all.json"

    existing = []
    if all_path.exists():
        try:
            with all_path.open("r", encoding="utf-8") as f:
                existing = json.load(f)
            print(f"  기존 누적 데이터: {len(existing):,}행 로드")
        except Exception as e:
            print(f"  ⚠️ 기존 누적 로드 실패 ({e}) — 새로 시작")

    merged, added, updated = merge_by_key(existing, new_rows, list(job["key_fields"]))
    print(f"  Merge 결과: 총 {len(merged):,}행 (신규 {added:,}, 갱신 {updated:,})")

    # 5) 누적 파일 atomic 저장
    tmp_path = all_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
    tmp_path.replace(all_path)
    print(f"  ✓ 누적 저장: {all_path}")

    # 6) 옵션: xlsx 양식 매핑 (--with-xlsx 일 때)
    if save_xlsx and job.get("column_map"):
        stamp = now_kst().strftime("%Y%m%d_%H%M%S")
        json_path = out_dir / f"{slug}_{stamp}.json"
        json_path.write_text(json.dumps({"resultData": merged}, ensure_ascii=False), encoding="utf-8")
        convert_to_xlsx({"resultData": merged}, json_path, column_map=job["column_map"])

    # 7) 대시보드 형식 변환
    dashboard_records = to_dashboard_format(merged, job)
    print(f"  대시보드 형식 변환: {len(dashboard_records):,}행")

    return {
        "slug": slug,
        "raw_count": len(merged),
        "dashboard": dashboard_records,
        "fresh_dashboard": fresh_dashboard_records,
        "date_from": date_from,
        "date_to": date_to,
    }


def run(playwright: Playwright, days=60, save_xlsx=False, cost_only=False, include_cost=False):
    cost_months = cost_months_to_collect(TARGET_YEAR, os.environ.get("AMARANS_COST_MONTHS", "")) if cost_only or include_cost else None
    username = os.environ.get("AMARANS_USERNAME") or input("Amarans ID: ").strip()
    password = os.environ.get("AMARANS_PASSWORD") or getpass.getpass("Amarans password: ").strip()
    if not username or not password:
        raise RuntimeError("ID/PW가 필요합니다. 환경변수 AMARANS_USERNAME/AMARANS_PASSWORD 권장.")

    is_auto = bool(os.environ.get("AMARANS_USERNAME"))
    headless = is_auto and os.environ.get("AMARANS_HEADLESS", "1") != "0"

    remote_payload = None
    if not cost_only and days is not None and not SKIP_FIREBASE_UPLOAD:
        remote_payload = fetch_remote_dashboard_payload()
        if not remote_payload_has_full_year_base(remote_payload):
            print("  Remote full-year base not found; switching this run to full-year bootstrap.")
            days = None

    date_from, date_to = compute_date_range(days)

    browser_channel = os.environ.get("AMARANS_BROWSER_CHANNEL", "chrome").strip()
    launch_options = {"headless": headless, "slow_mo": 200}
    if browser_channel:
        launch_options["channel"] = browser_channel
    browser = playwright.chromium.launch(**launch_options)
    context = browser.new_context(accept_downloads=True, viewport={"width": 1366, "height": 768})
    page = context.new_page()
    page.set_default_timeout(60000)

    page.on("console", lambda m: print(f"  [browser:{m.type}] {m.text}"[:200])
            if m.type in ("error",) else None)

    results = {}
    try:
        login(page, username, password)
        switch_company(page)

        if not cost_only:
            for job in JOBS:
                r = process_job(page, job, days=days, save_xlsx=save_xlsx)
                if r:
                    results[r["slug"]] = r

        if cost_only or include_cost:
            try:
                results["cost-analysis"] = collect_cost_analysis(page, TARGET_YEAR, cost_months)
            except Exception as exc:
                print(f"  ⚠ 원가분석 수집 실패: {exc}")
                if cost_only:
                    raise
        else:
            print("  원가분석 수집 생략: 기본 주문/출고 동기화 속도를 유지합니다.")

        if not cost_only and ("ship" not in results or "order" not in results):
            raise RuntimeError("주문/출고 수집 일부 실패: 갱신 완료로 처리하지 않습니다.")

        # 대시보드 erp-data.js 생성
        if "ship" in results and "order" in results:
            print(f"\n{'='*60}")
            print(f"  대시보드 데이터 주입")
            print(f"{'='*60}")
            ship_result = results.get("ship", {})
            order_result = results.get("order", {})
            ship_records = ship_result.get("dashboard", [])
            order_records = order_result.get("dashboard", [])
            remote_ship_records = ship_result.get("fresh_dashboard", ship_records)
            remote_order_records = order_result.get("fresh_dashboard", order_records)
            write_dashboard_data_js(
                ship_records,
                order_records,
                DASHBOARD_DIR,
            )
            uploaded = upload_dashboard_data_remote(
                remote_ship_records,
                remote_order_records,
                date_from=date_from,
                date_to=date_to,
                remote_payload=remote_payload,
            )
            if not uploaded and not SKIP_FIREBASE_UPLOAD:
                raise RuntimeError("ERP 업로드 실패: 매출 데이터와 갱신 시각이 모두 저장되지 않았습니다.")

        print("\n완료.")
        if not is_auto:
            page.wait_for_timeout(5000)
    finally:
        context.close()
        browser.close()


def print_scheduler_help():
    """Windows 작업 스케줄러 등록 안내."""
    script_path = Path(__file__).resolve()
    print("\n" + "=" * 60)
    print("  Windows 작업 스케줄러 등록 (자동화 설정)")
    print("=" * 60)
    print(f"""
PowerShell을 '관리자 권한'으로 열고 아래 명령을 한 번만 실행:

# 1) 환경변수 영구 설정 (사용자 단위)
[System.Environment]::SetEnvironmentVariable('AMARANS_USERNAME','너의ID','User')
[System.Environment]::SetEnvironmentVariable('AMARANS_PASSWORD', (Read-Host 'Amarans password'), 'User')
[System.Environment]::SetEnvironmentVariable('AMARANS_FIREBASE_DB_URL','{FIREBASE_DB_URL}','User')

# 2) 09시~21시 5분마다 자동 실행
#    스크립트 내부에서 21시 이후, 주말, 2026년 한국 공휴일은 자동 스킵
$action = New-ScheduledTaskAction -Execute 'python' -Argument '"{script_path}" --auto --recent 60'
$trigger = New-ScheduledTaskTrigger -Daily -At 9am
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At 9am -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 12)).Repetition
Register-ScheduledTask -TaskName 'Amarans_Sync' -Action $action -Trigger $trigger -RunLevel Limited

# 등록 확인:
Get-ScheduledTask -TaskName 'Amarans_Sync'

# 즉시 한 번 실행해서 테스트:
Start-ScheduledTask -TaskName 'Amarans_Sync'

# 영업시간 제한 없이 지금 강제 실행:
python "{script_path}" --auto --force --recent 60

# 작업 삭제 (필요 시):
Unregister-ScheduledTask -TaskName 'Amarans_Sync' -Confirm:$false
""")


if __name__ == "__main__":
    print("=" * 60)
    print(f"  amarans_api_v10  (modifyDt 누적 + 대시보드 자동 주입)")
    print("=" * 60)
    print(f"  대시보드 폴더: {DASHBOARD_DIR}")

    args = sys.argv[1:]

    # --help / --schedule: 작업 스케줄러 안내만 출력
    if "--help" in args or "--schedule" in args:
        print_scheduler_help()
        sys.exit(0)

    # --convert: 이미 받은 JSON을 xlsx로 변환
    if len(args) >= 2 and args[0] == "--convert":
        in_path = Path(args[1])
        if not in_path.exists():
            print(f"파일을 찾을 수 없음: {in_path}")
            sys.exit(1)
        print(f"\n[convert 모드] {in_path}")
        with in_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        column_map = None
        for j in JOBS:
            if in_path.name.startswith(j["slug"] + "_"):
                column_map = j.get("column_map")
                print(f"  (매칭된 job: {j['menu_name']}, 양식 매핑 적용)")
                break
        convert_to_xlsx(data, in_path, column_map=column_map)
        sys.exit(0)

    # 모드 결정
    # --full : 올해 전체 (첫 1회용)
    # --recent N : 최근 N일 (기본 60)
    # --auto : 환경변수 ID/PW + headless (작업 스케줄러용)
    # --with-xlsx : xlsx 양식 매핑도 같이 저장
    # --cost-only : 원가분석현황(마감기준) Firebase 노드만 갱신
    # --include-cost : 기존 주문/출고 수집 뒤 원가분석까지 함께 갱신
    days = 60
    save_xlsx = "--with-xlsx" in args
    cost_only = "--cost-only" in args
    include_cost = "--include-cost" in args
    if "--full" in args:
        days = None
        print(f"  모드: 올해 전체 (--full)")
    elif "--recent" in args:
        idx = args.index("--recent")
        if idx + 1 < len(args):
            try:
                days = int(args[idx + 1])
            except ValueError:
                pass
        print(f"  모드: 최근 {days}일 (--recent)")
    else:
        print(f"  모드: 기본 (최근 {days}일 증분)")
    if cost_only:
        print(f"  모드: 원가분석만 (--cost-only)")
    elif include_cost:
        print(f"  모드: 주문/출고 + 원가분석 (--include-cost)")

    if "--auto" in args:
        print(f"  AUTO: headless + 환경변수 사용")
        if IGNORE_AUTO_HOURS:
            print(f"  AUTO: 스케줄 지연 허용(야간 시간 제한 무시)")
        if IGNORE_AUTO_WEEKEND:
            print(f"  AUTO: 주말 예약 실행 허용(공휴일은 계속 스킵)")
        if "--force" not in args:
            reason = auto_skip_reason()
            if reason:
                print(f"  자동 실행 스킵: {reason}")
                sys.exit(0)

    print("=" * 60)
    with sync_playwright() as pw:
        run(pw, days=days, save_xlsx=save_xlsx, cost_only=cost_only, include_cost=include_cost)
