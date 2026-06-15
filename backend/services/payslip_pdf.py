"""Payslip PDF (reportlab, pure-Python). Mirrors the fee-receipt styling."""

import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

_PRIMARY = colors.HexColor("#14463A")
_LIGHT = colors.HexColor("#E7EFEA")
_MUTED = colors.HexColor("#6b7280")
_RULE = colors.HexColor("#e5e7eb")

_MONTHS = ["", "January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]


def render_payslip_pdf(ctx: dict) -> bytes:
    buf = io.BytesIO()
    period = f"{_MONTHS[ctx['period_month']]} {ctx['period_year']}"
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=20 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm,
        title=f"Payslip {ctx['employee_no']} {period}",
    )
    base = getSampleStyleSheet()["Normal"]
    school_style = ParagraphStyle("School", parent=base, fontSize=17, leading=20, textColor=_PRIMARY, fontName="Helvetica-Bold")
    sub_style = ParagraphStyle("Sub", parent=base, fontSize=9, textColor=_MUTED)
    period_style = ParagraphStyle("Period", parent=base, fontSize=12, alignment=2, textColor=_PRIMARY, fontName="Helvetica-Bold")
    period_sub = ParagraphStyle("PeriodSub", parent=base, fontSize=9, alignment=2, textColor=_MUTED)
    cell = ParagraphStyle("Cell", parent=base, fontSize=9.5)
    label = ParagraphStyle("Lbl", parent=base, fontSize=8.5, textColor=_MUTED, fontName="Helvetica-Bold")

    status_label = "FINALIZED" if ctx.get("status") == "finalized" else "DRAFT — not finalized"

    elements = []
    header = Table(
        [[
            [Paragraph(ctx["school_name"], school_style), Paragraph("Salary Payslip", sub_style)],
            [Paragraph(period, period_style), Paragraph(status_label, period_sub)],
        ]],
        colWidths=[doc.width * 0.6, doc.width * 0.4],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 1.4, _PRIMARY),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements += [header, Spacer(1, 12)]

    info = Table(
        [
            [Paragraph("EMPLOYEE", label), Paragraph(ctx["staff_name"], cell),
             Paragraph("EMP NO", label), Paragraph(ctx["employee_no"], cell)],
            [Paragraph("DESIGNATION", label), Paragraph(ctx.get("designation") or "—", cell),
             Paragraph("DEPARTMENT", label), Paragraph(ctx.get("department") or "—", cell)],
        ],
        colWidths=[doc.width * 0.2, doc.width * 0.3, doc.width * 0.18, doc.width * 0.32],
    )
    info.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), _LIGHT),
        ("BACKGROUND", (2, 0), (2, -1), _LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.white),
    ]))
    elements += [info, Spacer(1, 16)]

    rs = "Rs. "
    lbl = ParagraphStyle("ItemLbl", parent=base, fontSize=8.5, textColor=colors.HexColor("#444"), fontName="Helvetica-Bold")
    lbl_r = ParagraphStyle("ItemLblR", parent=lbl, alignment=2)
    desc = ParagraphStyle("Desc", parent=base, fontSize=9.5)
    amt = ParagraphStyle("Amt", parent=base, fontSize=9.5, alignment=2)
    bold = ParagraphStyle("Bold", parent=base, fontSize=10.5, fontName="Helvetica-Bold")
    amt_bold = ParagraphStyle("AmtBold", parent=base, fontSize=10.5, alignment=2, fontName="Helvetica-Bold")

    data = [[Paragraph("EARNINGS", lbl), Paragraph("AMOUNT", lbl_r)]]
    data.append([Paragraph("Gross Salary", desc), Paragraph(f"{rs}{ctx['gross_salary']:,.2f}", amt)])
    for a in ctx["allowances"]:
        data.append([Paragraph(a["name"], desc), Paragraph(f"{rs}{a['amount']:,.2f}", amt)])
    earn_end = len(data) - 1

    data.append([Paragraph("DEDUCTIONS", lbl), Paragraph("AMOUNT", lbl_r)])
    ded_start = len(data) - 1
    if ctx["deductions"]:
        for d in ctx["deductions"]:
            data.append([Paragraph(d["name"], desc), Paragraph(f"{rs}{d['amount']:,.2f}", amt)])
    else:
        data.append([Paragraph("None", desc), Paragraph(f"{rs}0.00", amt)])

    data.append([Paragraph("Net Pay", bold), Paragraph(f"{rs}{ctx['net_salary']:,.2f}", amt_bold)])
    n = len(data)

    tbl = Table(data, colWidths=[doc.width * 0.72, doc.width * 0.28])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _LIGHT),
        ("BACKGROUND", (0, ded_start), (-1, ded_start), _LIGHT),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, _RULE),
        ("LINEBELOW", (0, 1), (-1, earn_end), 0.4, colors.HexColor("#f0f0f0")),
        ("LINEBELOW", (0, ded_start), (-1, n - 2), 0.4, colors.HexColor("#f0f0f0")),
        ("LINEABOVE", (0, n - 1), (-1, n - 1), 1.4, _PRIMARY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements += [tbl, Spacer(1, 14)]

    if ctx.get("note"):
        elements.append(Paragraph(f"<b>Note:</b> {ctx['note']}", ParagraphStyle("Note", parent=base, fontSize=8.5, textColor=_MUTED)))
        elements.append(Spacer(1, 6))
    elements.append(Paragraph(
        "This is a computer-generated payslip and does not require a physical signature.",
        ParagraphStyle("Footer", parent=base, fontSize=8, textColor=_MUTED),
    ))

    doc.build(elements)
    return buf.getvalue()
