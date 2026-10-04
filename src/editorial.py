import urllib.request

from fastapi import APIRouter
from fastapi.responses import RedirectResponse, Response

router = APIRouter(prefix="/api/editorial", tags=["editorial"])

# QOJ serves contest attachments with a Content-Disposition that makes browsers download
# them. Re-serve editorial PDFs inline so they open in a browser tab. Only QOJ contest
# attachments can be fetched (ids are ints), so this isn't an open proxy. Anything that
# isn't a PDF, or any fetch failure, falls back to QOJ's own (download) link.
QOJ_ATTACHMENT = "https://qoj.ac/download.php?type=attachments&id={cid}&r={r}"
# QOJ answers 403 to non-browser user agents.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)


@router.get("/{contest_id}")
def editorial(contest_id: int, r: int = 1):
    url = QOJ_ATTACHMENT.format(cid=contest_id, r=r)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.headers.get_content_type() != "application/pdf":
                return RedirectResponse(url)
            body = resp.read()
    except Exception:
        return RedirectResponse(url)
    return Response(
        body,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="editorial-{contest_id}.pdf"',
            "Cache-Control": "public, max-age=604800",
        },
    )
