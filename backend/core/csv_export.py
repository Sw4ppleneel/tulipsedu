import csv
import io

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

# Roles permitted to download CSV exports
EXPORT_ROLES = frozenset({"admin", "principal", "superadmin"})


def require_export_role(request: Request) -> None:
    role = getattr(request.state, "user_role", None)
    if role not in EXPORT_ROLES:
        raise HTTPException(
            status_code=403,
            detail="CSV export requires admin, principal, or superadmin role",
        )


def csv_response(headers: list[str], rows: list, filename: str) -> StreamingResponse:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
