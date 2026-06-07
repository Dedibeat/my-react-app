from api._auth import require_user, AuthError
from api._util import ok, err, preflight


def handler(request):
    if request.get("method") == "OPTIONS":
        return preflight()
    try:
        user = require_user(request.get("headers") or {})
    except AuthError as e:
        return err(e.message, e.status)
    return ok(user)
