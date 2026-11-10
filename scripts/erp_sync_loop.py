"""
Run Amarans ERP sync repeatedly inside one GitHub Actions job.

GitHub scheduled workflows are not a precise 5-minute timer. This loop keeps a
single job alive for a bounded segment and performs the precise interval inside
the runner after dependencies have already been installed.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


KST = timezone(timedelta(hours=9))
REQUEST_POLL_SECONDS = 15


def build_firebase_rest_url(path):
    # amarans_api_v10.py와 같은 설정/인증 규칙. 폴링에는 Playwright가 필요 없다.
    base = (os.environ.get("AMARANS_FIREBASE_DB_URL")
            or os.environ.get("FIREBASE_DB_URL")
            or "https://membership-7aef2-default-rtdb.firebaseio.com").rstrip("/")
    token = (os.environ.get("AMARANS_FIREBASE_AUTH_TOKEN")
             or os.environ.get("FIREBASE_AUTH_TOKEN") or "")
    url = f"{base}/{path.strip('/')}.json"
    if token:
        url += "?" + urllib.parse.urlencode({"auth": token})
    return url


def read_sync_request():
    try:
        request = urllib.request.Request(build_firebase_rest_url("erp/syncRequest"),
                                         headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.load(response)
        return payload if isinstance(payload, dict) else None
    except Exception:
        # 요청 노드 장애가 정기 수집을 중단시키지 않도록 한다. URL/토큰은 출력하지 않는다.
        return None


def is_new_sync_request(payload, last_started_at, last_handled_requested_at=None):
    try:
        request_id = payload["requestedAt"]
        # 클라이언트 시계가 빨라도 같은 요청은 한 번만 처리한다.
        if request_id in (payload.get("handledRequestedAt"), last_handled_requested_at):
            return False
        requested_at = datetime.fromisoformat(request_id.replace("Z", "+00:00"))
        if requested_at.tzinfo is None:
            return False
        return last_started_at is None or requested_at > last_started_at
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def mark_sync_request_handled(payload, started_at):
    try:
        # PATCH는 동시에 들어온 새 requestedAt/by를 덮어쓰지 않는다.
        data = json.dumps({"handledAt": started_at.isoformat(),
                           "handledRequestedAt": payload["requestedAt"]}).encode("utf-8")
        request = urllib.request.Request(build_firebase_rest_url("erp/syncRequest"),
                                         data=data, method="PATCH",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5):
            pass
    except Exception:
        pass


def wait_for_next_sync(interval, deadline, last_started_at, include_weekend=False,
                       last_handled_requested_at=None):
    next_tick = min(time.monotonic() + interval, deadline)
    while time.monotonic() < next_tick:
        if in_active_window(now_kst(), include_weekend=include_weekend):
            payload = read_sync_request()
            if is_new_sync_request(payload, last_started_at, last_handled_requested_at):
                return payload
        remaining = next_tick - time.monotonic()
        if remaining > 0:
            time.sleep(min(REQUEST_POLL_SECONDS, remaining))
    return None


def now_kst():
    return datetime.now(KST)


def in_active_window(dt, include_weekend=False, elapsed_seconds=0):
    # Weekend sessions may intentionally include the next 00:00 tick.
    if include_weekend and dt.hour == 0:
        return True
    if dt.weekday() >= 5 and not include_weekend:
        return False
    return 8 <= dt.hour < 24


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval-minutes", type=int, required=True)
    parser.add_argument("--duration-minutes", type=int, required=True)
    parser.add_argument("--recent", type=int, default=60)
    parser.add_argument("--include-weekend", action="store_true")
    args = parser.parse_args()

    start = time.monotonic()
    deadline = start + max(1, args.duration_minutes) * 60
    interval = max(1, args.interval_minutes) * 60
    attempt = 0
    success = 0
    failure = 0
    last_started_at = None
    last_handled_requested_at = None
    pending_request = None

    env = os.environ.copy()
    env["AMARANS_IGNORE_AUTO_HOURS"] = "1"
    if args.include_weekend:
        env["AMARANS_IGNORE_AUTO_WEEKEND"] = "1"

    print("=" * 60)
    print("ERP sync loop started")
    print(f"KST start: {now_kst().isoformat(timespec='seconds')}")
    print(f"interval: {args.interval_minutes} min, duration: {args.duration_minutes} min")
    print("=" * 60)

    while True:
        current = now_kst()
        elapsed = time.monotonic() - start
        if elapsed > args.duration_minutes * 60:
            break

        if in_active_window(current, include_weekend=args.include_weekend, elapsed_seconds=elapsed):
            request = pending_request or read_sync_request()
            pending_request = None
            current = now_kst()
            if is_new_sync_request(request, last_started_at, last_handled_requested_at):
                # PATCH 실패 때도 프로세스 안에서는 중복 요청을 다시 실행하지 않는다.
                last_handled_requested_at = request["requestedAt"]
                mark_sync_request_handled(request, current)
            last_started_at = current
            attempt += 1
            print(f"\n[{attempt}] KST {current.isoformat(timespec='seconds')} sync start", flush=True)
            cmd = [
                sys.executable,
                "scripts/amarans_api_v10.py",
                "--auto",
                "--recent",
                str(args.recent),
            ]
            completed = subprocess.run(cmd, env=env)
            if completed.returncode == 0:
                success += 1
                print(f"[{attempt}] sync success", flush=True)
            else:
                failure += 1
                print(f"[{attempt}] sync failed: exit {completed.returncode}", flush=True)
        else:
            print(f"KST {current.isoformat(timespec='seconds')} outside active window, waiting", flush=True)

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        pending_request = wait_for_next_sync(interval, deadline, last_started_at,
                                             include_weekend=args.include_weekend,
                                             last_handled_requested_at=last_handled_requested_at)

    print("=" * 60)
    print(f"ERP sync loop finished: attempts={attempt}, success={success}, failure={failure}")
    print(f"KST end: {now_kst().isoformat(timespec='seconds')}")
    print("=" * 60)

    if attempt and success:
        return 0
    if attempt == 0:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
