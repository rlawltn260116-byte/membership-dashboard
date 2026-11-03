import contextlib
import io
import json
import unittest
from unittest.mock import patch

import amarans_api_v10 as sync


class SalesSyncTests(unittest.TestCase):
    def setUp(self):
        self.writes = []
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)

    def write(self, path, data, method="PUT"):
        self.writes.append((path, data, method))
        return True

    def test_batches_replace_rows_and_remove_deleted_tail(self):
        response = io.BytesIO(json.dumps({str(i): True for i in range(1200)}).encode())
        with patch.object(sync.urllib.request, "urlopen", return_value=response), \
                patch.object(sync, "_firebase_write", side_effect=self.write):
            self.assertTrue(sync._firebase_replace_rows("test/rows", list(range(503))))
        self.assertTrue(all(method == "PATCH" and len(data) <= 500 for _, data, method in self.writes))
        state = dict.fromkeys(map(str, range(1200)), "old")
        for _, batch, _ in self.writes:
            for key, value in batch.items():
                if value is None:
                    state.pop(key, None)
                else:
                    state[key] = value
        self.assertEqual(state, {str(i): i for i in range(503)})

    def test_read_failure_does_not_write(self):
        with patch.object(sync.urllib.request, "urlopen", side_effect=OSError("offline")), \
                patch.object(sync, "_firebase_write", side_effect=self.write):
            self.assertFalse(sync._firebase_replace_rows("test/rows", [1]))
        self.assertEqual(self.writes, [])

    def test_failed_batch_stops(self):
        with patch.object(sync.urllib.request, "urlopen", return_value=io.BytesIO(b"null")), \
                patch.object(sync, "_firebase_write", return_value=False) as write:
            self.assertFalse(sync._firebase_replace_rows("test/rows", list(range(1001))))
        self.assertEqual(write.call_count, 1)

    def upload(self):
        return sync.upload_dashboard_data_remote(
            [{"date": "2026-11-03", "supply": 123}],
            [{"date": "2026-11-03", "supply": 456}],
            f"{sync.TARGET_YEAR}0101", f"{sync.TARGET_YEAR}1231")

    def test_data_failure_does_not_advance_success_stamp(self):
        with patch.object(sync, "SKIP_FIREBASE_UPLOAD", False), \
                patch.object(sync, "_firebase_replace_rows", side_effect=[True, True, False]), \
                patch.object(sync, "_firebase_write", side_effect=self.write):
            self.assertFalse(self.upload())
        self.assertFalse(any("syncedAt" in data for _, data, _ in self.writes))

    def test_success_stamp_is_published_last(self):
        with patch.object(sync, "SKIP_FIREBASE_UPLOAD", False), \
                patch.object(sync, "_firebase_replace_rows", return_value=True) as rows, \
                patch.object(sync, "_firebase_write", side_effect=self.write):
            self.assertTrue(self.upload())
        self.assertEqual(rows.call_count, 4)
        packed_meta, final_meta = self.writes[-2:]
        self.assertEqual(packed_meta[1]["syncedAt"], final_meta[1]["syncedAt"])
        self.assertEqual(final_meta[0], sync.REMOTE_ERP_PATH)
        self.assertEqual(final_meta[1]["shipCount"], 1)


if __name__ == "__main__":
    unittest.main()
