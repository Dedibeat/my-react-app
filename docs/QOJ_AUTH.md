# Browserless QOJ authentication and status reconciliation

The working recipe and helper from `../p1/qoj/BROWSERLESS_AUTH.md` and
`qoj_auth.py` are saved here as `scripts/qoj_auth.py`. The login protocol was
verified upstream against QOJ 4.5.46 on 2026-10-04. Cloudflare can still block
it; a successful HTTP response alone does not prove authentication.

## Setup

From this repository's root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r scripts/requirements-qoj.txt
.venv/bin/python scripts/qoj_auth.py TEAM_R3 --save .qoj/team-r3-cookies.json
.venv/bin/python scripts/qoj_auth.py TEAM_R3 --reuse .qoj/team-r3-cookies.json
```

The helper prompts for the password, or reads `QOJ_PASSWORD`. Passwords are
never command-line arguments. Cookies are credentials: the default `.qoj/`
directory is git-ignored, and saved cookie files have mode `0600`. Keep custom
cookie paths outside version control too.

The helper uses `curl_cffi` with Chrome 136 TLS impersonation, reads the
60-character `_token` literal from the login page's JavaScript, and posts
`_token`, `login`, `username`, and the password's MD5 hex digest. QOJ requires
this digest; it is itself a credential. The POST body must be exactly `ok`.
The helper then checks for `My Profile` on the authenticated profile page.
It retries Cloudflare challenge responses and fails if the challenge persists.

`--tor` uses the upstream recipe's existing local SOCKS proxy at
`127.0.0.1:9050`. It does not install or start Tor; availability depends on the
local service and its exit. Cookie login and reuse must use the same route.

## Preview and apply a targeted cleanup

```bash
.venv/bin/python scripts/reconcile_qoj_status.py TEAM_R3
# Inspect the listed IDs, then apply:
.venv/bin/python scripts/reconcile_qoj_status.py TEAM_R3 --apply
# Or reuse the helper's authenticated session:
.venv/bin/python scripts/reconcile_qoj_status.py TEAM_R3 \
  --reuse .qoj/team-r3-cookies.json --apply
```

This script uses the deployed app API, logs into the specified app account,
and reads that account's linked QOJ handle. It prompts separately for the app
and QOJ passwords (`APP_PASSWORD` and `QOJ_PASSWORD` can supply them instead).
It never changes the account's linked handle.

Only app **ACs in the ICPC catalog** that are absent from QOJ's accepted list
qualify for clearing. That includes synthetic XCPC problems, which have no
QOJ problem ID. Non-AC statuses, Codeforces problems, and unknown IDs remain
untouched. If QOJ login or profile parsing fails, nothing is cleared.

Before applying, it writes the complete status snapshot, QOJ accepted IDs,
and candidate IDs to a timestamped mode-`0600` JSON file in `.qoj/`. It rechecks
statuses before deleting and verifies cleared IDs afterwards. Use this with
no concurrent status edits: the app API has no conditional-delete operation.
The backup records original timestamps, but restoring through the app's PUT
API would assign new timestamps.

This is a one-off reconciliation tool. The server's ordinary sync remains
additive so it can preserve manually recorded solves from other judges.

## Verification in this session (2026-11-16)

App authentication for `TEAM_R3` succeeded and confirmed linked QOJ handle
`TEAM_R3`. The status snapshot contained 227 rows, including 204 ACs.
QOJ returned a Cloudflare HTTP 403 to the server, direct Chrome-impersonated
requests, and the browser. The upstream helper's direct retries failed; its
documented local Tor route timed out, then returned a challenge on retry. Do not interpret a blocked/empty page as
an empty accepted list. Live cleanup was deferred by user request; the XCPC
display fix can be deployed independently.
