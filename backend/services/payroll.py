"""Consolidated payroll service (ADR-011).

No statutory PF/ESI/TDS engine: a salary structure holds a gross plus recurring
allowance/deduction lines, a monthly run snapshots a payslip per staff, and
payslips are editable until the run is finalized.

  net = gross + SUM(allowances) − SUM(deductions)

JSONB columns come back as strings (no global codec), so we json.loads on read
and json.dumps on write, mirroring services/homework.py.
"""

import json
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

import asyncpg

from core.events import emit
from models.payroll import (
    PayrollRunResponse,
    PayslipResponse,
    SalaryStructureResponse,
)


class PayrollError(Exception):
    pass


def _loads(v) -> list:
    if v is None:
        return []
    return json.loads(v) if isinstance(v, str) else v


def _money(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


def _split_components(components: list[dict]) -> tuple[list[dict], list[dict]]:
    """Salary-structure components → (allowance lines, deduction lines)."""
    allowances = [{"name": c["name"], "amount": str(_money(c["amount"]))}
                  for c in components if c.get("type") == "allowance"]
    deductions = [{"name": c["name"], "amount": str(_money(c["amount"]))}
                  for c in components if c.get("type") == "deduction"]
    return allowances, deductions


def _net(gross: Decimal, allowances: list[dict], deductions: list[dict]) -> Decimal:
    add = sum((_money(a["amount"]) for a in allowances), Decimal("0"))
    sub = sum((_money(d["amount"]) for d in deductions), Decimal("0"))
    return (_money(gross) + add - sub).quantize(Decimal("0.01"))


# ── Salary structure ──────────────────────────────────────────────────────────

async def get_salary_structure(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID
) -> Optional[SalaryStructureResponse]:
    row = await conn.fetchrow(
        """
        SELECT id, staff_id, gross_salary, components, effective_from, updated_at
        FROM staff_salary_structures
        WHERE tenant_id = $1 AND staff_id = $2
        """,
        tenant_id, staff_id,
    )
    if not row:
        return None
    return SalaryStructureResponse(
        id=row["id"], staff_id=row["staff_id"], gross_salary=row["gross_salary"],
        components=_loads(row["components"]),
        effective_from=row["effective_from"], updated_at=row["updated_at"],
    )


async def upsert_salary_structure(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID,
    gross_salary: Decimal, components: list[dict], effective_from: Optional[date],
) -> SalaryStructureResponse:
    staff = await conn.fetchrow(
        "SELECT id FROM staff WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE",
        staff_id, tenant_id,
    )
    if not staff:
        raise PayrollError("Staff member not found")

    comp_json = json.dumps([
        {"name": c["name"], "type": c["type"], "amount": str(_money(c["amount"]))}
        for c in components
    ])
    eff = effective_from or date.today()
    row = await conn.fetchrow(
        """
        INSERT INTO staff_salary_structures
            (tenant_id, staff_id, gross_salary, components, effective_from)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, staff_id) DO UPDATE
            SET gross_salary = EXCLUDED.gross_salary,
                components = EXCLUDED.components,
                effective_from = EXCLUDED.effective_from,
                updated_at = NOW()
        RETURNING id, staff_id, gross_salary, components, effective_from, updated_at
        """,
        tenant_id, staff_id, _money(gross_salary), comp_json, eff,
    )
    await emit(conn, "SALARY_STRUCTURE_SET", tenant_id, {
        "staff_id": str(staff_id), "gross_salary": str(_money(gross_salary)),
    })
    return SalaryStructureResponse(
        id=row["id"], staff_id=row["staff_id"], gross_salary=row["gross_salary"],
        components=_loads(row["components"]),
        effective_from=row["effective_from"], updated_at=row["updated_at"],
    )


# ── Payroll runs ────────────────────────────────────────────────────────────--

async def list_runs(conn: asyncpg.Connection, tenant_id: uuid.UUID) -> list[PayrollRunResponse]:
    rows = await conn.fetch(
        """
        SELECT r.id, r.period_month, r.period_year, r.status, r.created_at, r.finalized_at,
               COUNT(p.id)::int AS payslip_count,
               COALESCE(SUM(p.net_salary), 0) AS total_net
        FROM staff_payroll_runs r
        LEFT JOIN staff_payslips p ON p.run_id = r.id AND p.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1
        GROUP BY r.id
        ORDER BY r.period_year DESC, r.period_month DESC
        """,
        tenant_id,
    )
    return [PayrollRunResponse(**dict(r)) for r in rows]


async def create_run(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, user_id: uuid.UUID,
    period_month: int, period_year: int,
) -> PayrollRunResponse:
    """Create a draft run and snapshot a payslip for every active staff member
    who has a salary structure. One explicit transaction."""
    async with conn.transaction():
        existing = await conn.fetchval(
            "SELECT id FROM staff_payroll_runs WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3",
            tenant_id, period_year, period_month,
        )
        if existing:
            raise PayrollError("A payroll run for this month already exists")

        run_id = await conn.fetchval(
            """
            INSERT INTO staff_payroll_runs (tenant_id, period_month, period_year, created_by)
            VALUES ($1, $2, $3, $4) RETURNING id
            """,
            tenant_id, period_month, period_year, user_id,
        )

        structures = await conn.fetch(
            """
            SELECT ss.staff_id, ss.gross_salary, ss.components
            FROM staff_salary_structures ss
            JOIN staff s ON s.id = ss.staff_id AND s.tenant_id = ss.tenant_id
            WHERE ss.tenant_id = $1 AND s.is_active = TRUE
            """,
            tenant_id,
        )
        if not structures:
            raise PayrollError("No staff have a salary set up yet — set salaries first")

        payslips = []
        for s in structures:
            allowances, deductions = _split_components(_loads(s["components"]))
            net = _net(s["gross_salary"], allowances, deductions)
            payslips.append((
                tenant_id, run_id, s["staff_id"], _money(s["gross_salary"]),
                json.dumps(allowances), json.dumps(deductions), net,
            ))
        await conn.executemany(
            """
            INSERT INTO staff_payslips
                (tenant_id, run_id, staff_id, gross_salary, allowances, deductions, net_salary)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            payslips,
        )
        await emit(conn, "PAYROLL_RUN_CREATED", tenant_id, {
            "run_id": str(run_id), "period": f"{period_year}-{period_month:02d}",
            "payslips": len(payslips),
        })

    runs = await list_runs(conn, tenant_id)
    return next(r for r in runs if str(r.id) == str(run_id))


async def get_run_payslips(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, run_id: uuid.UUID
) -> list[PayslipResponse]:
    rows = await conn.fetch(
        """
        SELECT p.id, p.run_id, p.staff_id, p.gross_salary, p.allowances, p.deductions,
               p.net_salary, p.note,
               s.first_name || ' ' || s.last_name AS staff_name,
               s.employee_no, s.designation
        FROM staff_payslips p
        JOIN staff s ON s.id = p.staff_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.run_id = $2
        ORDER BY s.employee_no
        """,
        tenant_id, run_id,
    )
    return [
        PayslipResponse(
            id=r["id"], run_id=r["run_id"], staff_id=r["staff_id"],
            staff_name=r["staff_name"], employee_no=r["employee_no"],
            designation=r["designation"], gross_salary=r["gross_salary"],
            allowances=_loads(r["allowances"]), deductions=_loads(r["deductions"]),
            net_salary=r["net_salary"], note=r["note"],
        )
        for r in rows
    ]


async def update_payslip(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, payslip_id: uuid.UUID,
    allowances: list[dict], deductions: list[dict], note: Optional[str],
) -> PayslipResponse:
    """Adjust a single payslip (LOP, bonus, advance, …). Only while run is draft."""
    async with conn.transaction():
        row = await conn.fetchrow(
            """
            SELECT p.gross_salary, r.status
            FROM staff_payslips p
            JOIN staff_payroll_runs r ON r.id = p.run_id AND r.tenant_id = p.tenant_id
            WHERE p.id = $1 AND p.tenant_id = $2
            FOR UPDATE OF p
            """,
            payslip_id, tenant_id,
        )
        if not row:
            raise PayrollError("Payslip not found")
        if row["status"] != "draft":
            raise PayrollError("This payroll run is finalized and can no longer be edited")

        a = [{"name": x["name"], "amount": str(_money(x["amount"]))} for x in allowances]
        d = [{"name": x["name"], "amount": str(_money(x["amount"]))} for x in deductions]
        net = _net(row["gross_salary"], a, d)
        await conn.execute(
            """
            UPDATE staff_payslips
               SET allowances = $1, deductions = $2, net_salary = $3, note = $4
             WHERE id = $5 AND tenant_id = $6
            """,
            json.dumps(a), json.dumps(d), net, note, payslip_id, tenant_id,
        )
    slips = await _payslips_by_id(conn, tenant_id, [payslip_id])
    return slips[0]


async def finalize_run(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, user_id: uuid.UUID, run_id: uuid.UUID
) -> PayrollRunResponse:
    async with conn.transaction():
        row = await conn.fetchrow(
            "SELECT status FROM staff_payroll_runs WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
            run_id, tenant_id,
        )
        if not row:
            raise PayrollError("Payroll run not found")
        if row["status"] == "finalized":
            raise PayrollError("Payroll run is already finalized")
        await conn.execute(
            "UPDATE staff_payroll_runs SET status = 'finalized', finalized_at = $1 WHERE id = $2 AND tenant_id = $3",
            datetime.now(timezone.utc), run_id, tenant_id,
        )
        await emit(conn, "PAYROLL_FINALIZED", tenant_id, {"run_id": str(run_id)})
    runs = await list_runs(conn, tenant_id)
    return next(r for r in runs if str(r.id) == str(run_id))


# ── Payslip detail / PDF context ────────────────────────────────────────────--

async def _payslips_by_id(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[PayslipResponse]:
    rows = await conn.fetch(
        """
        SELECT p.id, p.run_id, p.staff_id, p.gross_salary, p.allowances, p.deductions,
               p.net_salary, p.note,
               s.first_name || ' ' || s.last_name AS staff_name,
               s.employee_no, s.designation
        FROM staff_payslips p
        JOIN staff s ON s.id = p.staff_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.id = ANY($2::uuid[])
        """,
        tenant_id, ids,
    )
    return [
        PayslipResponse(
            id=r["id"], run_id=r["run_id"], staff_id=r["staff_id"],
            staff_name=r["staff_name"], employee_no=r["employee_no"],
            designation=r["designation"], gross_salary=r["gross_salary"],
            allowances=_loads(r["allowances"]), deductions=_loads(r["deductions"]),
            net_salary=r["net_salary"], note=r["note"],
        )
        for r in rows
    ]


async def list_staff_payslips(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID
) -> list[dict]:
    """Recent payslips for one staff member (for the staff detail drawer)."""
    rows = await conn.fetch(
        """
        SELECT p.id, p.net_salary, p.gross_salary, r.period_month, r.period_year, r.status
        FROM staff_payslips p
        JOIN staff_payroll_runs r ON r.id = p.run_id AND r.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.staff_id = $2
        ORDER BY r.period_year DESC, r.period_month DESC
        LIMIT 24
        """,
        tenant_id, staff_id,
    )
    return [dict(r) for r in rows]


async def get_payslip_context(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, payslip_id: uuid.UUID
) -> Optional[dict]:
    """Structured data for the payslip PDF."""
    row = await conn.fetchrow(
        """
        SELECT p.gross_salary, p.allowances, p.deductions, p.net_salary, p.note,
               r.period_month, r.period_year, r.status,
               t.name AS school_name,
               s.first_name || ' ' || s.last_name AS staff_name,
               s.employee_no, s.designation, s.department
        FROM staff_payslips p
        JOIN staff_payroll_runs r ON r.id = p.run_id AND r.tenant_id = p.tenant_id
        JOIN tenants t ON t.id = p.tenant_id
        JOIN staff s ON s.id = p.staff_id AND s.tenant_id = p.tenant_id
        WHERE p.id = $1 AND p.tenant_id = $2
        """,
        payslip_id, tenant_id,
    )
    if not row:
        return None
    return {
        "school_name": row["school_name"],
        "staff_name": row["staff_name"],
        "employee_no": row["employee_no"],
        "designation": row["designation"],
        "department": row["department"],
        "period_month": row["period_month"],
        "period_year": row["period_year"],
        "status": row["status"],
        "gross_salary": float(row["gross_salary"]),
        "allowances": [{"name": a["name"], "amount": float(a["amount"])} for a in _loads(row["allowances"])],
        "deductions": [{"name": d["name"], "amount": float(d["amount"])} for d in _loads(row["deductions"])],
        "net_salary": float(row["net_salary"]),
        "note": row["note"],
    }
