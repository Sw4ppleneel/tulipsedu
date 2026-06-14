from fastapi import APIRouter, Depends, Request

from core.rbac import require_roles

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(require_roles("principal", "vice_principal", "accountant"))],
)


@router.get("")
async def stats(request: Request):
    pool = request.app.state.pool
    tid = request.state.tenant_id
    role = getattr(request.state, "user_role", "")
    async with pool.acquire() as conn:
        students = await conn.fetchval(
            "SELECT COUNT(*) FROM students WHERE tenant_id=$1 AND is_active=TRUE", tid
        )
        staff = await conn.fetchval(
            "SELECT COUNT(*) FROM staff WHERE tenant_id=$1 AND is_active=TRUE", tid
        )
        fee_outstanding = await conn.fetchval(
            "SELECT COALESCE(SUM(amount_due),0) FROM fee_ledger WHERE tenant_id=$1 AND status IN ('pending','due','overdue')",
            tid,
        )

        # Fee recovery (accountant + principal)
        fee_rec = await conn.fetchrow(
            """
            SELECT
              COALESCE(SUM(amount_due) FILTER (WHERE status = 'paid'), 0)   AS collected,
              COALESCE(SUM(amount_due) FILTER (WHERE status != 'waived'), 0) AS expected
            FROM fee_ledger
            WHERE tenant_id = $1
            """,
            tid,
        )
        collected = float(fee_rec["collected"] or 0)
        expected = float(fee_rec["expected"] or 0)
        fee_recovery = {
            "collected": collected,
            "expected": expected,
            "rate_pct": round(collected / expected * 100, 1) if expected else 0,
        }

        # Per-class fee recovery (top 8 for chart)
        class_recovery = await conn.fetch(
            """
            SELECT c.name AS class_name,
                   COALESCE(SUM(fl.amount_due) FILTER (WHERE fl.status = 'paid'), 0)   AS collected,
                   COALESCE(SUM(fl.amount_due) FILTER (WHERE fl.status != 'waived'), 0) AS expected
            FROM fee_ledger fl
            JOIN students st ON st.id = fl.student_id AND st.tenant_id = fl.tenant_id
            JOIN classes c  ON c.id = st.class_id
            WHERE fl.tenant_id = $1
              AND st.is_active = TRUE
            GROUP BY c.id, c.name
            ORDER BY c.name
            LIMIT 8
            """,
            tid,
        )

        # 30-day attendance trend — join sessions for date, use P/A status codes
        att_trend = await conn.fetch(
            """
            SELECT s.date::text,
                   COUNT(*) FILTER (WHERE ar.status = 'P') AS present,
                   COUNT(*) FILTER (WHERE ar.status = 'A') AS absent,
                   COUNT(*) AS total
            FROM attendance_records ar
            JOIN attendance_sessions s ON s.id = ar.session_id
            WHERE ar.tenant_id = $1
              AND s.date >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY s.date
            ORDER BY s.date
            """,
            tid,
        )

        # Students with attendance < 75% this academic year
        ay_start = await conn.fetchval(
            "SELECT start_date FROM academic_years WHERE tenant_id=$1 AND is_current=TRUE LIMIT 1",
            tid,
        )
        low_att: list = []
        if ay_start:
            low_att = await conn.fetch(
                """
                WITH sa AS (
                  SELECT ar.student_id,
                         COUNT(*) FILTER (WHERE ar.status = 'P') AS present_count,
                         COUNT(*) AS total_days
                  FROM attendance_records ar
                  JOIN attendance_sessions s ON s.id = ar.session_id
                  WHERE ar.tenant_id = $1
                    AND s.date >= $2
                  GROUP BY ar.student_id
                  HAVING COUNT(*) >= 5
                )
                SELECT s.id::text AS student_id,
                       s.first_name || ' ' || s.last_name AS student_name,
                       s.admission_no,
                       c.name AS class_name, sec.name AS section_name,
                       sa.present_count, sa.total_days,
                       ROUND(sa.present_count::numeric / sa.total_days * 100, 1) AS pct
                FROM sa
                JOIN students s   ON s.id = sa.student_id AND s.tenant_id = $1
                JOIN classes c    ON c.id = s.class_id
                JOIN sections sec ON sec.id = s.section_id
                WHERE sa.present_count::numeric / sa.total_days < 0.75
                  AND s.is_active = TRUE
                ORDER BY pct, c.name, sec.name
                LIMIT 50
                """,
                tid, ay_start,
            )

        recent_hw = await conn.fetch(
            """
            SELECT hp.id, hp.title, hp.subject, hp.post_type, hp.due_date, hp.created_at,
                   c.name AS class_name, sec.name AS section_name
            FROM homework_posts hp
            JOIN classes c ON c.id = hp.class_id
            JOIN sections sec ON sec.id = hp.section_id
            WHERE hp.tenant_id=$1 AND hp.is_active=TRUE
            ORDER BY hp.created_at DESC LIMIT 6
            """,
            tid,
        )
        tenantrow = await conn.fetchrow(
            "SELECT name FROM tenants WHERE id=$1", tid
        )
        defaulter_count = await conn.fetchval(
            "SELECT COUNT(DISTINCT student_id) FROM fee_ledger WHERE tenant_id=$1 AND status='overdue'",
            tid,
        )

    is_principal = role in ("principal", "vice_principal")

    return {
        "school_name":      tenantrow["name"] if tenantrow else "",
        "total_students":   students or 0,
        "total_staff":      staff or 0,
        "fee_outstanding":  float(fee_outstanding or 0),
        "fee_recovery":     fee_recovery,
        "defaulter_count":  int(defaulter_count or 0),
        "class_recovery":   [
            {
                "class_name": r["class_name"],
                "collected": float(r["collected"]),
                "expected": float(r["expected"]),
                "rate_pct": round(float(r["collected"]) / float(r["expected"]) * 100, 1) if r["expected"] else 0,
            }
            for r in class_recovery
        ] if is_principal else [],
        "attendance_trend":  [
            {"date": r["date"], "present": r["present"], "absent": r["absent"], "total": r["total"]}
            for r in att_trend
        ] if is_principal else [],
        "low_attendance":   [
            {
                "student_id": r["student_id"],
                "student_name": r["student_name"],
                "admission_no": r["admission_no"],
                "class_name": r["class_name"],
                "section_name": r["section_name"],
                "pct": float(r["pct"]),
            }
            for r in low_att
        ] if is_principal else [],
        "recent_homework":  [dict(r) for r in recent_hw],
    }
