import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts import qoj_auth, reconcile_qoj_status as reconcile


class QojToolsTests(unittest.TestCase):
    def test_challenge_never_becomes_an_empty_profile(self):
        session = SimpleNamespace(get=lambda *a, **k: SimpleNamespace(text="Just a moment"))
        with patch.object(qoj_auth.time, "sleep"), self.assertRaises(qoj_auth.QOJAuthError):
            qoj_auth.fetch(session, "https://qoj.ac/login")

    def test_login_uses_token_digest_and_authenticated_profile(self):
        posts = []
        session = SimpleNamespace(post=lambda url, **kwargs:
                                  posts.append(kwargs["data"]) or SimpleNamespace(text="ok"))
        with patch.object(qoj_auth, "new_session", return_value=session), \
                patch.object(qoj_auth, "fetch", return_value=SimpleNamespace(text='_token: "' + "a" * 60 + '"')), \
                patch.object(qoj_auth, "is_logged_in", return_value=True):
            self.assertIs(qoj_auth.login("test", "example"), session)
        self.assertEqual(posts[0]["_token"], "a" * 60)
        self.assertEqual(posts[0]["password"], qoj_auth.hashlib.md5(b"example").hexdigest())

    def test_cookies_are_private_and_reusable(self):
        session = SimpleNamespace(cookies=SimpleNamespace(jar=[SimpleNamespace(name="session", value="test")]))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested/cookies.json"
            qoj_auth.save_cookies(session, str(path))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), {"session": "test"})

    def run_reconciliation(self, apply=False, profile=None):
        original = {
            "100": {"status": "AC", "updated_at": "2020-01-01"},
            "101": {"status": "AC", "updated_at": "2020-01-02"},
            "-123": {"status": "AC", "updated_at": "2020-01-03"},
            "102": {"status": "TL", "updated_at": "2020-01-04"},
            "999": {"status": "AC", "updated_at": "2020-01-05"},
            "123456": {"status": "AC", "updated_at": "2020-01-06"},
        }
        statuses = dict(original)
        deleted = []

        def api(request, **kwargs):
            path = request.full_url.removeprefix(reconcile.APP_API)
            if path == "/auth/login":
                body = {"token": "test-token", "user": {"id": 7, "username": "test", "qoj_handle": "test"}}
            elif path == "/status":
                body = statuses
            else:
                self.assertEqual(request.method, "DELETE")
                self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
                pid = path.rsplit("/", 1)[-1]
                deleted.append(pid)
                statuses.pop(pid)
                body = {"ok": True}
            return io.BytesIO(json.dumps(body).encode())

        if profile is None:
            profile = 'Accepted problems <a href="/problem/100">100</a> Tried problems Authored problems'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            (root / "data/tagged.json").write_text(json.dumps([{"problems": [
                {"problem_id": pid} for pid in [100, 101, -123, 102]
            ]}]))
            with patch.object(reconcile, "__file__", str(root / "scripts/reconcile_qoj_status.py")), \
                    patch.dict(os.environ, {"APP_PASSWORD": "test", "QOJ_PASSWORD": "test"}), \
                    patch.object(reconcile.sys, "argv", ["reconcile", "test"] + (["--apply"] if apply else [])), \
                    patch.object(reconcile.urllib.request, "urlopen", side_effect=api), \
                    patch.object(qoj_auth, "login"), \
                    patch.object(qoj_auth, "fetch", return_value=SimpleNamespace(text=profile)), \
                    contextlib.redirect_stdout(io.StringIO()):
                reconcile.main()
            backups = list(root.glob(".qoj/*.json"))
            if apply:
                self.assertEqual(len(backups), 1)
                self.assertEqual(json.loads(backups[0].read_text())["statuses"], original)
                self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
            else:
                self.assertEqual(backups, [])
        return deleted, statuses, original

    def test_dry_run_does_not_write(self):
        deleted, statuses, original = self.run_reconciliation()
        self.assertEqual(deleted, [])
        self.assertEqual(statuses, original)

    def test_apply_only_removes_stale_catalog_acs(self):
        deleted, statuses, original = self.run_reconciliation(apply=True)
        self.assertEqual(set(deleted), {"101", "-123"})
        self.assertEqual(statuses, {pid: row for pid, row in original.items() if pid not in deleted})

    def test_unrecognized_profile_aborts(self):
        with self.assertRaisesRegex(SystemExit, "nothing changed"):
            self.run_reconciliation(apply=True, profile="<html>Login</html>")


if __name__ == "__main__":
    unittest.main()
