"""수집 요청 폴링 검증. 네트워크/실제 ERP 수집 없이 실행한다."""

import io
import json
import os
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import erp_sync_loop as loop


class SyncRequestTests(unittest.TestCase):
    def setUp(self):
        self.started = datetime(2026, 11, 10, 17, 0, tzinfo=loop.KST)
        self.request = {"requestedAt": (self.started + timedelta(seconds=20)).isoformat(),
                        "by": "검증 사용자"}
        self.elapsed = 0

    def sleep(self, seconds):
        self.elapsed += seconds

    def clock_patches(self):
        return (patch.object(loop.time, "monotonic", side_effect=lambda: self.elapsed),
                patch.object(loop.time, "sleep", side_effect=self.sleep),
                patch.object(loop, "now_kst", side_effect=lambda: self.started + timedelta(seconds=self.elapsed)))

    def test_request_dates(self):
        self.assertTrue(loop.is_new_sync_request(self.request, self.started))
        self.assertFalse(loop.is_new_sync_request(self.request, self.started + timedelta(seconds=20)))
        for payload in (None, {}, [], {"requestedAt": "bad"}, {"requestedAt": "2026-11-10T17:00:00"}):
            self.assertFalse(loop.is_new_sync_request(payload, self.started))

    def test_handled_request_is_ignored_even_with_future_timestamp(self):
        future = {"requestedAt": "2099-01-01T00:00:00+09:00"}
        self.assertTrue(loop.is_new_sync_request(future, self.started))
        self.assertFalse(loop.is_new_sync_request(future, self.started, future["requestedAt"]))
        acknowledged = {**future, "handledRequestedAt": future["requestedAt"]}
        self.assertFalse(loop.is_new_sync_request(acknowledged, self.started))
        self.assertFalse(loop.is_new_sync_request(acknowledged, None))
        # 다른 요청의 처리 기록은 새 PUT 요청을 막지 않아야 한다.
        future["handledRequestedAt"] = self.request["requestedAt"]
        self.assertTrue(loop.is_new_sync_request(future, self.started))

    def test_firebase_read_and_ack_use_existing_environment_auth(self):
        seen = []

        def respond(request, timeout):
            seen.append(request)
            self.assertEqual(timeout, 5)
            return io.BytesIO(json.dumps(self.request).encode())

        with patch.dict(os.environ, {"AMARANS_FIREBASE_DB_URL": "https://example.invalid/",
                                     "AMARANS_FIREBASE_AUTH_TOKEN": "test token"}), \
                patch.object(loop.urllib.request, "urlopen", side_effect=respond):
            self.assertEqual(loop.read_sync_request(), self.request)
            loop.mark_sync_request_handled(self.request, self.started)
        self.assertEqual(seen[0].full_url, "https://example.invalid/erp/syncRequest.json?auth=test+token")
        self.assertEqual(seen[1].method, "PATCH")
        ack = json.loads(seen[1].data)
        self.assertEqual(ack["handledRequestedAt"], self.request["requestedAt"])
        self.assertNotIn("requestedAt", ack)

    def test_read_and_ack_failures_are_ignored(self):
        with patch.object(loop.urllib.request, "urlopen", side_effect=OSError("offline")):
            self.assertIsNone(loop.read_sync_request())
            loop.mark_sync_request_handled(self.request, self.started)

    def test_new_request_interrupts_five_minute_wait(self):
        a, b, c = self.clock_patches()
        with a, b, c, patch.object(loop, "read_sync_request", side_effect=[None, self.request]):
            self.assertEqual(loop.wait_for_next_sync(300, 1000, self.started), self.request)
        self.assertEqual(self.elapsed, 15)

    def test_old_request_and_failed_reads_keep_regular_interval(self):
        a, b, c = self.clock_patches()
        with a, b, c, patch.object(loop, "read_sync_request", return_value=self.request):
            self.assertIsNone(loop.wait_for_next_sync(300, 1000, self.started + timedelta(minutes=1)))
        self.assertEqual(self.elapsed, 300)
        self.elapsed = 0
        a, b, c = self.clock_patches()
        with a, b, c, patch.object(loop, "read_sync_request", return_value=None):
            self.assertIsNone(loop.wait_for_next_sync(300, 34, self.started))
        self.assertEqual(self.elapsed, 34)

    def test_outside_window_does_not_accept_request(self):
        self.started = self.started.replace(hour=1)
        a, b, c = self.clock_patches()
        with a, b, c, patch.object(loop, "read_sync_request") as read:
            loop.wait_for_next_sync(300, 45, self.started)
            read.assert_not_called()
        self.assertEqual(self.elapsed, 45)

    def test_main_collects_immediately_on_request_and_acknowledges(self):
        runs = []

        def collect(*args, **kwargs):
            runs.append(self.elapsed)
            return SimpleNamespace(returncode=0)

        a, b, c = self.clock_patches()
        with a, b, c, \
                patch.object(loop.sys, "argv", ["loop", "--interval-minutes", "5", "--duration-minutes", "1"]), \
                patch.object(loop, "read_sync_request", side_effect=lambda: self.request if self.elapsed >= 30 else None), \
                patch.object(loop, "mark_sync_request_handled") as ack, \
                patch.object(loop.subprocess, "run", side_effect=collect):
            self.assertEqual(loop.main(), 0)
            self.assertEqual(runs[:2], [0, 30])
            self.assertEqual(ack.call_count, 1)
            self.assertEqual(ack.call_args.args[0], self.request)

    def test_main_exit_codes_and_weekend_window(self):
        self.assertFalse(loop.in_active_window(self.started.replace(day=14)))
        self.assertTrue(loop.in_active_window(self.started.replace(day=14), include_weekend=True))
        self.assertTrue(loop.in_active_window(self.started.replace(hour=0), include_weekend=True))
        for hour, code, expected in [(17, 1, 1), (17, 0, 0), (1, 1, 0)]:
            self.started = self.started.replace(hour=hour)
            self.elapsed = 0
            a, b, c = self.clock_patches()
            with a, b, c, \
                    patch.object(loop.sys, "argv", ["loop", "--interval-minutes", "5", "--duration-minutes", "1"]), \
                    patch.object(loop, "read_sync_request", return_value=None), \
                    patch.object(loop.subprocess, "run", return_value=SimpleNamespace(returncode=code)):
                self.assertEqual(loop.main(), expected)

    def test_future_request_interrupts_once_even_when_ack_write_fails(self):
        future = {"requestedAt": "2099-01-01T00:00:00+09:00", "by": "검증 사용자"}
        runs = []

        def collect(*args, **kwargs):
            runs.append(self.elapsed)
            self.elapsed += 120
            return SimpleNamespace(returncode=0)

        a, b, c = self.clock_patches()
        with a, b, c, redirect_stdout(io.StringIO()), \
                patch.object(loop.sys, "argv", ["loop", "--interval-minutes", "5", "--duration-minutes", "60"]), \
                patch.object(loop, "read_sync_request", side_effect=lambda: future if self.elapsed >= 150 else None), \
                patch.object(loop.urllib.request, "urlopen", side_effect=OSError("offline")), \
                patch.object(loop, "mark_sync_request_handled", wraps=loop.mark_sync_request_handled) as ack, \
                patch.object(loop.subprocess, "run", side_effect=collect):
            self.assertEqual(loop.main(), 0)
            self.assertEqual(ack.call_count, 1)
        self.assertEqual(runs[:3], [0, 150, 570])
        self.assertEqual(len(runs), 10)

    def test_prior_session_handled_future_request_keeps_regular_wait(self):
        future = {"requestedAt": "2099-01-01T00:00:00+09:00",
                  "handledRequestedAt": "2099-01-01T00:00:00+09:00"}
        a, b, c = self.clock_patches()
        with a, b, c, redirect_stdout(io.StringIO()), \
                patch.object(loop.sys, "argv", ["loop", "--interval-minutes", "5", "--duration-minutes", "1"]), \
                patch.object(loop, "read_sync_request", return_value=future), \
                patch.object(loop, "mark_sync_request_handled") as ack, \
                patch.object(loop.subprocess, "run", return_value=SimpleNamespace(returncode=0)):
            self.assertEqual(loop.main(), 0)
            ack.assert_not_called()
        self.assertEqual(self.elapsed, 60)


if __name__ == "__main__":
    unittest.main()
