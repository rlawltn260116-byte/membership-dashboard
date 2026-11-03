"""
ERP sync watchdog.

Checks Firebase erp/latest/syncedAt, verifies the expected GitHub Actions
schedule, and triggers a recent60 ERP sync when the data is stale.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


KST = timezone(timedelta(hours=9))
DEFAULT_FIREBASE_DB_URL = "https://membership-7aef2-default-rtdb.firebaseio.com"
REMOTE_ERP_PATH = os.environ.get("AMARANS_REMOTE_ERP_PATH", "erp/latest").strip("/")
WATCHDOG_PATH = os.environ.get("AMARANS_WATCHDOG_PATH", "erp/syncWatchdog").strip("/")

EXPECTED_SCHEDULE_BLOCK = """  schedule:
    # Session starts. GitHub cron starts the runner; scripts/erp_sync_loop.py
    # keeps the precise interval inside the job.
    # KST weekdays 08:00, 12:00, 16:00, 20:00. UTC 23 previous day, 03, 07, 11.
    - cron: '0 23 * * 0-4'
    - cron: '0 3 * * 1-5'
    - cron: '0 7 * * 1-5'
    - cron: '0 11 * * 1-5'
    # KST weekends 08:00, 12:00, 16:00, 20:00. The loop runs every 2 hours through 24:00.
    - cron: '0 23 * * 5,6'
    - cron: '0 3 * * 6,0'
    - cron: '0 7 * * 6,0'
    - cron: '0 11 * * 6,0'
"""


def now_kst():
    return datetime.now(KST)


def iso_kst(dt):
    return dt.astimezone(KST).isoformat(timespec="seconds")


def firebase_base():
    return (
        os.environ.get("AMARANS_FIREBASE_DB_URL")
        or os.environ.get("FIREBASE_DB_URL")
        or DEFAULT_FIREBASE_DB_URL
    ).rstrip("/")


def firebase_auth_query():
    token = os.environ.get("AMARANS_FIREBASE_AUTH_TOKEN") or os.environ.get("FIREBASE_AUTH_TOKEN") or ""
    return "?" + urllib.parse.urlencode({"auth": token}) if token else ""


def firebase_url(path):
    return f"{firebase_base()}/{path.strip('/')}.json{firebase_auth_query()}"


def http_json(url, method="GET", data=None, headers=None, timeout=30):
    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))


def parse_sync_time(value):
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=KST)
        return dt.astimezone(KST)
    except ValueError:
        return None


def is_active_collection_window(dt):
    # Weekdays: 08:00 through 23:59 KST.
    if dt.weekday() < 5:
        return 8 <= dt.hour < 24
    # Weekends: 08:00, then every 2 hours through 24:00. The watchdog may run
    # between those exact ticks, so treat the whole 08:00-23:59 window as active.
    return 8 <= dt.hour < 24


def expected_stale_minutes(dt):
    if dt.weekday() < 5:
        return int(os.environ.get("AMARANS_WATCHDOG_WEEKDAY_STALE_MINUTES", "20"))
    return int(os.environ.get("AMARANS_WATCHDOG_WEEKEND_STALE_MINUTES", "150"))


def ensure_schedule_file(path):
    workflow = Path(path)
    text = workflow.read_text(encoding="utf-8")
    start = text.find("  schedule:\n")
    end = text.find("\n\nconcurrency:", start)
    if start < 0 or end < 0:
        raise RuntimeError(f"Cannot find schedule block in {workflow}")
    current = text[start:end + 1]
    if current == EXPECTED_SCHEDULE_BLOCK:
        return False
    workflow.write_text(text[:start] + EXPECTED_SCHEDULE_BLOCK + text[end + 1 :], encoding="utf-8")
    return True


def github_headers():
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    if not token:
        return {}
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "membership-erp-watchdog",
    }


def github_repo():
    return os.environ.get("GITHUB_REPOSITORY", "rlawltn260116-byte/membership-dashboard")


def github_ref():
    return os.environ.get("GITHUB_REF_NAME") or os.environ.get("GITHUB_REF", "main").split("/")[-1] or "main"


def github_api(path, method="GET", data=None):
    headers = github_headers()
    if not headers:
        raise RuntimeError("GITHUB_TOKEN is not available")
    return http_json(f"https://api.github.com/repos/{github_repo()}{path}", method=method, data=data, headers=headers, timeout=30)


def enable_sync_workflow():
    try:
        github_api("/actions/workflows/amarans-sync.yml/enable", method="PUT")
        return True
    except Exception as exc:
        print(f"workflow enable skipped: {exc}")
        return False


def dispatch_sync():
    github_api(
        "/actions/workflows/amarans-sync.yml/dispatches",
        method="POST",
        data={"ref": github_ref(), "inputs": {"mode": "loop"}},
    )


def recent_sync_runs():
    try:
        data = github_api("/actions/workflows/amarans-sync.yml/runs?per_page=5")
        return data.get("workflow_runs", []) if isinstance(data, dict) else []
    except Exception as exc:
        print(f"recent run lookup skipped: {exc}")
        return []


def write_watchdog_status(payload):
    try:
        http_json(firebase_url(WATCHDOG_PATH), method="PUT", data=payload, timeout=30)
        return True
    except Exception as exc:
        print(f"watchdog status upload skipped: {exc}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repair-schedule", action="store_true")
    ap.add_argument("--dispatch-on-stale", action="store_true")
    ap.add_argument("--workflow", default=".github/workflows/amarans-sync.yml")
    args = ap.parse_args()

    checked_at = now_kst()
    result = {
        "checkedAt": iso_kst(checked_at),
        "activeWindow": is_active_collection_window(checked_at),
        "scheduleRepaired": False,
        "stale": False,
        "dispatched": False,
        "enabledWorkflow": False,
        "status": "ok",
        "message": "",
    }

    if args.repair_schedule:
        try:
            result["scheduleRepaired"] = ensure_schedule_file(args.workflow)
        except Exception as exc:
            result["status"] = "schedule-repair-failed"
            result["message"] = str(exc)

    try:
        synced_raw = http_json(firebase_url(f"{REMOTE_ERP_PATH}/syncedAt"), timeout=30)
        synced_at = parse_sync_time(synced_raw)
        result["syncedAt"] = synced_raw or ""
        result["syncedAtKst"] = iso_kst(synced_at) if synced_at else ""
        packed_time = http_json(firebase_url(f"{REMOTE_ERP_PATH}/packed/syncedAt"), timeout=30)
        packed_at = parse_sync_time(packed_time)
        # 업로드 중의 짧은 시각 차이는 허용하되, 오래된 압축본을 정상으로 보지 않는다.
        result["packedSyncedAt"] = packed_time or ""
        data_mismatch = bool(synced_at and (not packed_at or (synced_at - packed_at).total_seconds() > 300))
        result["dataMismatch"] = data_mismatch
        if synced_at:
            age_minutes = int((checked_at - synced_at).total_seconds() // 60)
            result["ageMinutes"] = age_minutes
            result["staleThresholdMinutes"] = expected_stale_minutes(checked_at)
            result["stale"] = result["activeWindow"] and age_minutes > result["staleThresholdMinutes"]
        else:
            result["ageMinutes"] = None
            result["staleThresholdMinutes"] = expected_stale_minutes(checked_at)
            result["stale"] = result["activeWindow"]
        if data_mismatch:
            result["stale"] = result["activeWindow"]
            result["status"] = "data-mismatch"
            result["message"] = "주문/출고 원본과 압축 데이터의 갱신 시각이 다릅니다. 업로드 로그를 확인하세요."
    except Exception as exc:
        result["status"] = "firebase-read-failed"
        result["message"] = str(exc)
        result["stale"] = result["activeWindow"]

    runs = recent_sync_runs()
    if runs:
        result["latestRun"] = {
            "number": runs[0].get("run_number"),
            "event": runs[0].get("event"),
            "status": runs[0].get("status"),
            "conclusion": runs[0].get("conclusion"),
            "headSha": runs[0].get("head_sha"),
            "createdAt": runs[0].get("created_at"),
            "url": runs[0].get("html_url"),
        }
        result["recentFailures"] = sum(1 for r in runs if r.get("conclusion") == "failure")

    latest_run = result.get("latestRun", {})
    latest_status = latest_run.get("status")
    current_sha = os.environ.get("GITHUB_SHA", "")
    latest_run_is_current_sha = not current_sha or latest_run.get("headSha") == current_sha
    active_run_is_current_sha = not current_sha or latest_run.get("headSha") == current_sha

    if result["stale"] and not args.dispatch_on_stale:
        result["status"] = "stale-detected"
        result["message"] = "ERP data is stale. Dispatch was not requested for this run."

    if (
        args.dispatch_on_stale
        and result["stale"]
        and result.get("recentFailures", 0) >= 3
        and result["activeWindow"]
        and latest_run_is_current_sha
    ):
        result["status"] = "sync-failing"
        result["message"] = "Recent amarans-sync runs are failing on the current workflow revision. Check ERP credentials/login or workflow logs."
    if (
        args.dispatch_on_stale
        and result["stale"]
        and latest_status in ("queued", "in_progress", "waiting", "requested")
        and active_run_is_current_sha
    ):
        result["status"] = "stale-sync-already-running"
        result["message"] = "ERP data is stale, but an amarans-sync run is already active."

    if (
        args.dispatch_on_stale
        and result["stale"]
        and not result["dispatched"]
        and result["status"] not in ("stale-sync-already-running", "sync-failing")
    ):
        result["enabledWorkflow"] = enable_sync_workflow()
        try:
            dispatch_sync()
            result["dispatched"] = True
            result["status"] = "stale-dispatched"
            result["message"] = "ERP data is stale; dispatched amarans-sync loop session."
        except Exception as exc:
            result["status"] = "dispatch-failed"
            result["message"] = str(exc)
            write_watchdog_status(result)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2

    if result["status"] in ("ok", "stale-detected") and result.get("recentFailures", 0) >= 3 and result["activeWindow"]:
        result["status"] = "sync-failing"
        result["message"] = "Recent amarans-sync runs are failing. Check ERP credentials/login or workflow logs."

    write_watchdog_status(result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
