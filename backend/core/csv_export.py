import csv
import io

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

# Roles permitted to download CSV exports. Module-level router guards further
# constrain which exports each role can actually reach (e.g. accountant only
# reaches the fee export router).
EXPORT_ROLES = frozenset({"principal", "vice_principal", "accountant", "superadmin"})


def require_export_role(request: Request) -> None:
    role = getattr(request.state, "user_role", None)
    if role not in EXPORT_ROLES:
        raise HTTPException(
            status_code=403,
            detail="CSV export not permitted for this role",
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
