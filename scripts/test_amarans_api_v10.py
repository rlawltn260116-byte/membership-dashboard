"""실제 로그인/네트워크 없이 접속 회사 검증과 업로드 실패 복구를 확인한다."""

import io
import json
import os
import ssl
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import amarans_api_v10 as api


class FakePage:
    def __init__(self, text, url="https://example.invalid/#/main", login_form=False):
        self.text = text
        self.url = url
        self.login_form = login_form

    def wait_for_function(self, expression, timeout):
        if "조아실버케어" not in self.text or "#/login" in self.url:
            raise TimeoutError("화면 전환 대기 종료")

    def locator(self, selector):
        if selector == "body":
            return SimpleNamespace(inner_text=lambda **kwargs: self.text)
        return SimpleNamespace(count=lambda: int(self.login_form))


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        # 운영 로그의 기호가 Windows 기본 stdout 인코딩에 영향을 주지 않게 한다.
        self.enterContext(redirect_stdout(io.StringIO()))


class CompanyVerificationTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.original_diagnostic = api._save_company_diagnostic
        self.diagnostics = patch.object(api, "_save_company_diagnostic")
        self.save = self.diagnostics.start()
        self.addCleanup(self.diagnostics.stop)

    def test_direct_login_requires_no_clicks_or_company_switch(self):
        # FakePage에는 클릭/회사 선택 API가 없다. 일반 계정 메뉴 단어도 허용한다.
        api.verify_company(FakePage("(주)조아실버케어 출고현황 비밀번호 변경 로그인 기록"))
        api.switch_company(FakePage("(주)조아실버케어"))
        self.save.assert_not_called()

    def test_other_company_and_unreadable_page_fail_closed(self):
        for page in (FakePage("(주)헥톤프로젝트 멤버십사업팀"), FakePage("")):
            with self.subTest(page=page.text), self.assertRaisesRegex(RuntimeError, "회사 확인 실패"):
                api.verify_company(page)
        broken = FakePage("조아실버케어")
        broken.locator = Mock(side_effect=RuntimeError("화면 읽기 실패"))
        with self.assertRaisesRegex(RuntimeError, "회사 확인 실패"):
            api.verify_company(broken)
        self.assertEqual(self.save.call_count, 3)

    def test_login_screen_is_reported_separately_even_with_company_name(self):
        for page in (FakePage("조아실버케어 로그인", url="https://example.invalid/#/login"),
                     FakePage("조아실버케어 비밀번호", login_form=True)):
            with self.subTest(page=page.url), self.assertRaisesRegex(RuntimeError, "로그인 실패"):
                api.verify_company(page)

    def test_company_success_log_supports_windows_cp949(self):
        stream = io.TextIOWrapper(io.BytesIO(), encoding="cp949")
        with redirect_stdout(stream):
            api.verify_company(FakePage("(주)조아실버케어"))
        self.save.assert_not_called()

    def test_diagnostic_redacts_credentials_without_hiding_non_secret_flags(self):
        with patch.dict(os.environ, {"AMARANS_IGNORE_AUTO_HOURS": "1", "AMARANS_PASSWORD": "가짜 암호"}):
            text = api._redact_diagnostic_text("2026-11-16 매출 1,234,100 가짜 암호")
        self.assertEqual(text, "2026-11-16 매출 1,234,100 ***")

    def test_company_failure_stops_before_collection_and_upload(self):
        page = FakePage("다른 회사")
        page.set_default_timeout = Mock()
        page.on = Mock()
        context = SimpleNamespace(new_page=lambda: page, close=Mock())
        browser = SimpleNamespace(new_context=Mock(return_value=context), close=Mock())
        playwright = SimpleNamespace(chromium=SimpleNamespace(launch=Mock(return_value=browser)))
        with patch.dict(os.environ, {"AMARANS_USERNAME": "가짜 계정", "AMARANS_PASSWORD": "가짜 암호"}), \
                patch.object(api, "login"), patch.object(api, "process_job") as collect, \
                patch.object(api, "upload_dashboard_data_remote") as upload, \
                patch.object(api, "_firebase_write") as write:
            with self.assertRaisesRegex(RuntimeError, "회사 확인 실패"):
                api.run(playwright, days=None)
        collect.assert_not_called()
        upload.assert_not_called()
        write.assert_not_called()
        context.close.assert_called_once()
        browser.close.assert_called_once()

    def test_diagnostic_escapes_html_and_redacts_secrets_before_truncation(self):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(api, "Path", side_effect=lambda *parts: Path(directory).joinpath(*parts)), \
                patch.dict(os.environ, {"AMARANS_USERNAME": "가짜 계정", "AMARANS_PASSWORD": "가짜 암호",
                                       "AMARANS_FIREBASE_AUTH_TOKEN": "가짜 토큰"}), \
                redirect_stdout(output):
            # setUp에서 가린 함수를 실제 구현으로 호출한다.
            self.original_diagnostic("<script>가짜 계정 가짜 암호 가짜 토큰</script>" + "가" * 4100)
            artifacts = list(Path(directory).rglob("*.html"))
            self.assertEqual(len(artifacts), 1)
            raw = artifacts[0].read_bytes()
            self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))
            artifact = raw.decode("utf-8")
        for secret in ("가짜 계정", "가짜 암호", "가짜 토큰"):
            self.assertNotIn(secret, output.getvalue() + artifact)
        self.assertIn("&lt;script&gt;", artifact)
        self.assertNotIn("<script>", artifact)
        self.assertLess(len(artifact), 4200)


class UploadRecoveryTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        settings = patch.multiple(api, SKIP_FIREBASE_UPLOAD=False, FIREBASE_DB_URL="https://example.invalid",
                                  FIREBASE_AUTH_TOKEN="", REMOTE_ERP_PATH="erp/latest")
        settings.start()
        self.addCleanup(settings.stop)
        self.record = {"date": f"{api.TARGET_YEAR}-01-01", "client": "검증 거래처", "total": 100}

    def upload(self):
        return api.upload_dashboard_data_remote([self.record], [self.record],
                                              f"{api.TARGET_YEAR}0101", f"{api.TARGET_YEAR}1231")

    def test_success_publishes_timestamps_only_after_all_separate_data_writes(self):
        events = []

        def write(path, data, method):
            events.append((path, data.copy(), method))
            return True

        def rows(path, data):
            events.append((path, list(data), "rows"))
            return True

        with patch.object(api, "_firebase_write", side_effect=write), \
                patch.object(api, "_firebase_replace_rows", side_effect=rows):
            self.assertTrue(self.upload())
        self.assertEqual([event[0] for event in events if event[2] == "rows"],
                         ["erp/latest/order", "erp/latest/packed/order/rows",
                          "erp/latest/ship", "erp/latest/packed/ship/rows"])
        timestamp_indices = [i for i, (_, data, _) in enumerate(events)
                             if isinstance(data, dict) and "syncedAt" in data]
        self.assertEqual(timestamp_indices, [len(events) - 2, len(events) - 1])
        self.assertTrue(all(events[i][1]["uploading"] is False for i in timestamp_indices))

    def test_every_failed_write_clears_both_flags_and_reports_failure(self):
        # 시작 표시 2개, basis별 사전 2개, 완료 메타데이터 2개.
        for failed_at in range(1, 7):
            with self.subTest(failed_at=failed_at):
                calls = []

                def write(path, data, method):
                    calls.append((path, data.copy(), method))
                    return len(calls) != failed_at

                with patch.object(api, "_firebase_write", side_effect=write), \
                        patch.object(api, "_firebase_replace_rows", return_value=True):
                    self.assertFalse(self.upload())
                self.assertEqual(calls[-2:], [("erp/latest", {"uploading": False}, "PATCH"),
                                             ("erp/latest/packed", {"uploading": False}, "PATCH")])
                if failed_at <= 4:
                    self.assertFalse(any("syncedAt" in data for _, data, _ in calls))

    def test_failed_or_raised_row_upload_clears_both_flags_without_synced_at(self):
        for failed_at in range(1, 5):
            for failure in (False, RuntimeError("검증용 실패")):
                with self.subTest(failed_at=failed_at, failure=failure):
                    row_calls = 0

                    def rows(*args):
                        nonlocal row_calls
                        row_calls += 1
                        if row_calls == failed_at:
                            if isinstance(failure, Exception):
                                raise failure
                            return failure
                        return True

                    with patch.object(api, "_firebase_write", return_value=True) as write, \
                            patch.object(api, "_firebase_replace_rows", side_effect=rows):
                        self.assertFalse(self.upload())
                    self.assertEqual(write.call_args_list[-2].args, ("erp/latest", {"uploading": False}, "PATCH"))
                    self.assertEqual(write.call_args_list[-1].args, ("erp/latest/packed", {"uploading": False}, "PATCH"))
                    self.assertFalse(any("syncedAt" in call.args[1] for call in write.call_args_list))

    def test_raised_write_and_cleanup_failure_preserve_original_failure(self):
        for cleanup_result in (False, RuntimeError("검증용 정리 실패")):
            with self.subTest(cleanup_result=cleanup_result), \
                    patch.object(api, "_firebase_write", side_effect=[
                        RuntimeError("검증용 쓰기 실패"), cleanup_result, True]) as write:
                self.assertFalse(self.upload())
                self.assertEqual(write.call_count, 3)
                self.assertEqual(write.call_args.args, ("erp/latest/packed", {"uploading": False}, "PATCH"))


class FirebaseRetryTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        settings = patch.multiple(api, FIREBASE_DB_URL="https://example.invalid", FIREBASE_AUTH_TOKEN="검증 토큰")
        settings.start()
        self.addCleanup(settings.stop)

    def response(self, status=200):
        response = Mock()
        response.__enter__ = Mock(return_value=SimpleNamespace(status=status))
        response.__exit__ = Mock(return_value=False)
        return response

    def test_transient_ssl_and_network_failures_retry_same_idempotent_patch(self):
        failures = [ssl.SSLEOFError("검증용 SSL EOF"), urllib.error.URLError("검증용 연결 종료")]
        with patch.object(api.urllib.request, "urlopen", side_effect=failures + [self.response()]) as send, \
                patch.object(api.time, "sleep") as sleep:
            self.assertTrue(api._firebase_write("erp/latest", {"uploading": False}, "PATCH"))
        self.assertEqual(send.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])
        for call in send.call_args_list:
            self.assertEqual(call.args[0].method, "PATCH")
            self.assertEqual(json.loads(call.args[0].data), {"uploading": False})

    def test_retry_exhaustion_is_bounded_and_does_not_log_authenticated_url(self):
        output = io.StringIO()
        with patch.object(api.urllib.request, "urlopen", side_effect=TimeoutError("https://example.invalid?auth=검증 토큰")) as send, \
                patch.object(api.time, "sleep") as sleep, redirect_stdout(output):
            self.assertFalse(api._firebase_write("erp/latest", {}, "PATCH"))
        self.assertEqual(send.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertNotIn("검증 토큰", output.getvalue())

    def test_http_auth_failure_does_not_retry_but_server_failure_does(self):
        for status, expected in ((401, False), (403, False), (503, True)):
            error = urllib.error.HTTPError("https://example.invalid?auth=검증 토큰", status,
                                           "검증용 오류", {}, io.BytesIO(b"private response"))
            output = io.StringIO()
            with self.subTest(status=status), \
                    patch.object(api.urllib.request, "urlopen", side_effect=[error, self.response()]) as send, \
                    patch.object(api.time, "sleep"), redirect_stdout(output):
                self.assertEqual(api._firebase_write("erp/latest", {}, "PATCH"), expected)
            self.assertEqual(send.call_count, 2 if expected else 1)
            self.assertNotIn("검증 토큰", output.getvalue())
            self.assertNotIn("private response", output.getvalue())


if __name__ == "__main__":
    unittest.main()
