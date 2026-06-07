from api._db import get_conn
from api._util import ok, preflight


def handler(request):
    if request.get("method") == "OPTIONS":
        return preflight()
    get_conn()
    return ok({"status": "ok"})
