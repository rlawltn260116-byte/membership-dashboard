import contextlib
import io
import json
import unittest
from datetime import datetime
from unittest.mock import patch

import amarans_api_v10 as sync


class CostSyncTests(unittest.TestCase):
    def setUp(self):
        self.writes = []
        for item in [patch.object(sync, "SKIP_FIREBASE_UPLOAD", False),
                     patch.object(sync, "_firebase_write", side_effect=self.write),
                     contextlib.redirect_stdout(io.StringIO())]:
            item.__enter__()
            self.addCleanup(item.__exit__, None, None, None)

    def write(self, path, data, method="PUT"):
        self.writes.append((path, data, method))
        return True

    @staticmethod
    def response(*args, **kwargs):
        return json.dumps({"resultCode": 0, "resultData": [{"hKey": "a", "hKeyNm": "Test",
                           "clsgAm": 1000, "costAm": 800, "benefitAm": 200}]}).encode(), {"status": 200}

    def month_writes(self):
        return [data for path, data, method in self.writes if "/months/" in path]

    def test_month_selection_and_year_boundary(self):
        now = datetime(2026, 11, 1, tzinfo=sync.KST)
        self.assertEqual(sync.cost_months_to_collect(2026, current=now), list(range(11, 0, -1)))
        self.assertEqual(sync.cost_months_to_collect(2026, "2026-08,2026-10,2026-08", now), [8, 10])
        self.assertEqual(len(sync.cost_months_to_collect(2025, current=now)), 12)
        for selection in ["2026-12", "2025-08", "2026-00", "bad"]:
            with self.assertRaises(ValueError):
                sync.cost_months_to_collect(2026, selection, now)

    def test_success_has_all_views_and_confirmation(self):
        with patch.object(sync, "run_job", side_effect=self.response):
            result = sync.collect_cost_analysis(None, 2026, [8])
        self.assertEqual(result["uploaded"], 1)
        month = self.month_writes()[0]
        self.assertEqual(len(month["views"]), 14)
        self.assertEqual(month["totals"]["profit"], 200)
        self.assertEqual(self.writes[-1][1]["status"], "success")
        self.assertIn("lastSuccessAt", self.writes[-1][1])

    def test_one_failed_view_preserves_existing_month(self):
        responses = [self.response()] * 14
        responses[6] = (None, {"status": 500})
        with patch.object(sync, "run_job", side_effect=responses), self.assertRaises(RuntimeError):
            sync.collect_cost_analysis(None, 2026, [8])
        self.assertEqual(self.month_writes(), [])
        self.assertEqual(self.writes[-1][1]["status"], "failed")
        self.assertNotIn("lastSuccessAt", self.writes[-1][1])

    def test_empty_month_is_distinct_from_error(self):
        with patch.object(sync, "run_job", return_value=(b'{"resultCode":0,"resultData":[]}', {"status": 200})):
            sync.collect_cost_analysis(None, 2026, [11])
        self.assertEqual(self.month_writes()[0]["rowCount"], 0)
        for body in [{"error": "expired"}, {"resultCode": -1, "resultData": []},
                     {"resultData": [{"lookup": "not sales"}]}]:
            with self.assertRaises(ValueError):
                sync.cost_response_rows(body)

    def test_upload_failure_fails_job(self):
        def write(path, data, method="PUT"):
            self.write(path, data, method)
            return "/months/" not in path
        with patch.object(sync, "run_job", side_effect=self.response), \
                patch.object(sync, "_firebase_write", side_effect=write), self.assertRaises(RuntimeError):
            sync.collect_cost_analysis(None, 2026, [8])
        self.assertEqual(self.writes[-1][1]["status"], "failed")

    def test_metadata_failure_does_not_query_or_overwrite(self):
        with patch.object(sync, "_firebase_write", return_value=False), \
                patch.object(sync, "run_job") as query, self.assertRaises(RuntimeError):
            sync.collect_cost_analysis(None, 2026, [8])
        query.assert_not_called()


if __name__ == "__main__":
    unittest.main()
