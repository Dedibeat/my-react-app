#!/usr/bin/env python3
"""
qoj_auth.py — browserless QOJ.ac authentication (username + password, no browser).

Verified against QOJ 4.5.46 on 2026-10-04.

    python3 scripts/qoj_auth.py <username> --save .qoj/cookies.json
    python3 scripts/qoj_auth.py <username> --reuse .qoj/cookies.json

Requires: pip install curl_cffi
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

from curl_cffi import requests as cr

BASE = "https://qoj.ac"
DEFAULT_IMPERSONATE = "chrome136"  # REQUIRED: plain requests/curl gets 403 from Cloudflare
TOR = {"http": "socks5h://127.0.0.1:9050", "https": "socks5h://127.0.0.1:9050"}

# The token lives in the page's JS: _token : "<60 alnum>"
_TOKEN_RE = re.compile(r'_token\s*:\s*"([A-Za-z0-9]{60})"')
_CHALLENGE = "Just a moment"


class QOJAuthError(RuntimeError):
    pass


def new_session(proxy: dict | None = None, impersonate: str = DEFAULT_IMPERSONATE):
    s = cr.Session(impersonate=impersonate)
    if proxy:
        s.proxies.update(proxy)
    return s


def fetch(session, url: str, retries: int = 3, backoff: float = 3.0, timeout: int = 40):
    """GET with Cloudflare-challenge backoff."""
    for i in range(retries):
        r = session.get(url, timeout=timeout)
        if _CHALLENGE in r.text[:3000]:
            time.sleep(backoff * (i + 1))
            continue
        r.raise_for_status()
        return r
    raise QOJAuthError(f"cloudflare challenge persisted: {url}")


def _csrf(html: str) -> str:
    m = _TOKEN_RE.search(html)
    if not m:
        raise QOJAuthError("no _token found on /login — the login flow has changed")
    return m.group(1)


def is_logged_in(session, username: str) -> bool:
    """The ONLY reliable auth check.

    NOTE: an unauthenticated GET of a profile page returns HTTP 200 with the
    login page body — so never trust the status code or the URL.
    """
    r = fetch(session, f"{BASE}/user/profile/{quote(username, safe='')}")
    return "My Profile" in r.text


def login(
    username: str,
    password: str,
    proxy: dict | None = None,
    impersonate: str = DEFAULT_IMPERSONATE,
    verify: bool = True,
):
    """Authenticate and return a live session (holds UOJSESSID + UOJREMEMBER)."""
    s = new_session(proxy, impersonate)
    tok = _csrf(fetch(s, f"{BASE}/login").text)

    # Exact payload submitLoginPost() sends. `trust` is optional (remember-me).
    r = s.post(
        f"{BASE}/login",
        data={
            "_token": tok,
            "login": "",
            "username": username,
            "password": hashlib.md5(password.encode()).hexdigest(),  # md5 hex, NOT plaintext
        },
        timeout=40,
    )

    body = r.text.strip()
    if body != "ok":
        # 4.5.46 returns the literal string "ok" on success, "failed" otherwise.
        # It does NOT redirect, so redirect/status checks are useless here.
        raise QOJAuthError(f"login rejected (server said {body[:80]!r})")
    if verify and not is_logged_in(s, username):
        raise QOJAuthError("server replied 'ok' but the session is not authenticated")
    return s


def save_cookies(session, path: str) -> None:
    jar = {c.name: c.value for c in session.cookies.jar}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(jar, f, indent=2)


def load_cookies(path: str, proxy: dict | None = None, impersonate: str = DEFAULT_IMPERSONATE):
    with open(path) as f:
        jar = json.load(f)
    s = new_session(proxy, impersonate)
    s.headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in jar.items())
    return s


def main() -> int:
    ap = argparse.ArgumentParser(description="Browserless QOJ login")
    ap.add_argument("username")
    ap.add_argument("--save", metavar="FILE", help="write the cookie jar to FILE")
    ap.add_argument("--reuse", metavar="FILE", help="reuse a saved cookie jar instead of logging in")
    ap.add_argument("--tor", action="store_true", help="route via Tor (slow: ~12x, exit-dependent)")
    args = ap.parse_args()

    proxy = TOR if args.tor else None

    try:
        if args.reuse:
            s = load_cookies(args.reuse, proxy)
            print(f"[+] reused cookies from {args.reuse}")
            if not is_logged_in(s, args.username):
                raise QOJAuthError("saved cookies are no longer authenticated")
            print("[+] authenticated: True")
            return 0

        password = os.environ.get("QOJ_PASSWORD") or getpass.getpass("QOJ password: ")
        t0 = time.time()
        s = login(args.username, password, proxy)
        print(f"[+] logged in as {args.username} in {time.time() - t0:.1f}s")
        print(f"[+] session cookies: {[c.name for c in s.cookies.jar]}")
        if args.save:
            save_cookies(s, args.save)
            print(f"[+] cookie jar saved -> {args.save}")
        return 0
    except QOJAuthError as e:
        print(f"[!] {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
