#!/usr/bin/env python3
"""Clear one app user's ACs absent from QOJ. Dry run unless --apply is given."""
import argparse
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import sys
import urllib.request
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import qoj_auth
from src.qoj_sync import parse_qoj_profile_html

APP_API = "https://my-react-app-33zw.onrender.com/api"


def stale_acs(statuses, accepted, catalog_ids):
    """Only catalog ACs qualify; leave CF, other verdicts and unknown IDs alone."""
    return sorted(pid for pid, row in statuses.items()
                  if row["status"] == "AC" and int(pid) in catalog_ids
                  and int(pid) not in accepted)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--reuse", help="authenticated QOJ cookie file")
    parser.add_argument("--tor", action="store_true", help="use the documented local Tor proxy for QOJ")
    args = parser.parse_args()
    password = os.environ.get("APP_PASSWORD") or getpass.getpass("App password: ")

    def api(path, method="GET", body=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(APP_API + path, method=method, headers=headers,
                                         data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    auth = api("/auth/login", "POST", {"username": args.username, "password": password})
    user = auth["user"]
    handle = user.get("qoj_handle")
    if not handle:
        raise SystemExit("Connect the correct QOJ handle in the app first; nothing changed.")
    proxy = qoj_auth.TOR if args.tor else None
    if args.reuse:
        session = qoj_auth.load_cookies(args.reuse, proxy)
        if not qoj_auth.is_logged_in(session, handle):
            raise SystemExit("QOJ cookies are not authenticated; nothing changed.")
    else:
        qoj_password = os.environ.get("QOJ_PASSWORD") or getpass.getpass(f"QOJ password for {handle}: ")
        session = qoj_auth.login(handle, qoj_password, proxy)
    html = qoj_auth.fetch(session, f"{qoj_auth.BASE}/user/profile/{quote(handle, safe='')}").text
    if not (any(marker in html for marker in ("Accepted problems", "通过的题目"))
            and any(marker in html for marker in ("Tried problems", "尝试过的题目"))):
        raise SystemExit("QOJ profile sections not found; nothing changed.")
    accepted, _ = parse_qoj_profile_html(html)
    statuses = api("/status", token=auth["token"])
    catalog = json.loads((Path(__file__).resolve().parent.parent / "data/tagged.json").read_text())
    catalog_ids = {p["problem_id"] for c in catalog for p in c["problems"]}
    stale = stale_acs(statuses, set(accepted), catalog_ids)
    print(f"{user['username']} / QOJ {handle}: {len(set(accepted))} accepted; {len(stale)} stale app ACs")
    print("IDs:", ", ".join(stale) or "none")
    if not args.apply or not stale:
        return

    directory = Path(__file__).resolve().parent.parent / ".qoj"
    directory.mkdir(exist_ok=True)
    backup = directory / f"status-before-{user['id']}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump({"user": user, "statuses": statuses, "qoj_accepted": accepted, "candidate_ids": stale}, output, indent=2)
    # Recheck immediately before clearing so a changed non-AC verdict is preserved.
    current = api("/status", token=auth["token"])
    stale = [pid for pid in stale if current.get(pid) == statuses[pid]]
    for pid in stale:
        api(f"/status/{pid}", "DELETE", token=auth["token"])
    remaining = api("/status", token=auth["token"])
    if any(remaining.get(pid, {}).get("status") == "AC" for pid in stale):
        raise SystemExit(f"An AC remains; inspect the backup at {backup} before retrying.")
    print(f"Cleared {len(stale)} ACs. Backup: {backup}")


if __name__ == "__main__":
    main()
