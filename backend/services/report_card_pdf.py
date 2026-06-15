"""Report-card PDF (reportlab, pure-Python). Same brand styling as the receipt/payslip."""

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
_RED = colors.HexColor("#dc2626")


def _fmt(v) -> str:
    if v is None:
        return "—"
    return f"{v:g}"


def render_report_card_pdf(ctx: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=20 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm,
        title=f"Report Card {ctx['admission_no']} {ctx['term_name']}",
    )
    base = getSampleStyleSheet()["Normal"]
    school_style = ParagraphStyle("School", parent=base, fontSize=17, leading=20, textColor=_PRIMARY, fontName="Helvetica-Bold")
    sub_style = ParagraphStyle("Sub", parent=base, fontSize=9, textColor=_MUTED)
    term_style = ParagraphStyle("Term", parent=base, fontSize=12, alignment=2, textColor=_PRIMARY, fontName="Helvetica-Bold")
    term_sub = ParagraphStyle("TermSub", parent=base, fontSize=9, alignment=2, textColor=_MUTED)
    cell = ParagraphStyle("Cell", parent=base, fontSize=9.5)
    label = ParagraphStyle("Lbl", parent=base, fontSize=8.5, textColor=_MUTED, fontName="Helvetica-Bold")

    elements = []
    status = "Report Card" if ctx.get("published") else "Report Card (provisional — not yet published)"
    header = Table(
        [[
            [Paragraph(ctx["school_name"], school_style), Paragraph(status, sub_style)],
            [Paragraph(ctx["term_name"], term_style),
             Paragraph(f"Class {ctx['class_name']} {ctx['section_name']}", term_sub)],
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
            [Paragraph("STUDENT", label), Paragraph(ctx["student_name"], cell),
             Paragraph("ADMISSION NO", label), Paragraph(ctx["admission_no"], cell)],
            [Paragraph("ROLL NO", label), Paragraph(ctx["roll_number"], cell),
             Paragraph("CLASS", label), Paragraph(f"{ctx['class_name']} {ctx['section_name']}", cell)],
        ],
        colWidths=[doc.width * 0.2, doc.width * 0.3, doc.width * 0.2, doc.width * 0.3],
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

    lbl = ParagraphStyle("ItemLbl", parent=base, fontSize=8.5, textColor=colors.HexColor("#444"), fontName="Helvetica-Bold")
    lbl_c = ParagraphStyle("ItemLblC", parent=lbl, alignment=1)
    desc = ParagraphStyle("Desc", parent=base, fontSize=9.5)
    ctr = ParagraphStyle("Ctr", parent=base, fontSize=9.5, alignment=1)
    bold = ParagraphStyle("Bold", parent=base, fontSize=10.5, fontName="Helvetica-Bold")
    ctr_bold = ParagraphStyle("CtrBold", parent=base, fontSize=10.5, alignment=1, fontName="Helvetica-Bold")

    data = [[Paragraph("SUBJECT", lbl), Paragraph("MARKS", lbl_c),
             Paragraph("MAX", lbl_c), Paragraph("GRADE", lbl_c), Paragraph("RESULT", lbl_c)]]
    for s in ctx["subjects"]:
        marks = "AB" if s["is_absent"] else _fmt(s["marks_obtained"])
        result = "Pass" if s["passed"] else ("Absent" if s["is_absent"] else "Fail")
        data.append([
            Paragraph(s["name"], desc), Paragraph(marks, ctr), Paragraph(_fmt(s["max_marks"]), ctr),
            Paragraph(s["grade"], ctr), Paragraph(result, ctr),
        ])
    pct = f"{ctx['percentage']:.1f}%" if ctx["percentage"] is not None else "—"
    data.append([
        Paragraph("Total", bold),
        Paragraph(_fmt(ctx["total_obtained"]), ctr_bold),
        Paragraph(_fmt(ctx["total_max"]), ctr_bold),
        Paragraph(ctx["grade"], ctr_bold), Paragraph(pct, ctr_bold),
    ])
    n = len(data)

    tbl = Table(data, colWidths=[doc.width * 0.4, doc.width * 0.15, doc.width * 0.15, doc.width * 0.15, doc.width * 0.15])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _LIGHT),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, _RULE),
        ("LINEBELOW", (0, 1), (-1, n - 2), 0.4, colors.HexColor("#f0f0f0")),
        ("LINEABOVE", (0, n - 1), (-1, n - 1), 1.4, _PRIMARY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements += [tbl, Spacer(1, 16)]

    # Overall pass/fail banner
    passed = ctx["passed"]
    banner = Table([[Paragraph(
        "RESULT: PASS" if passed else "RESULT: NEEDS IMPROVEMENT",
        ParagraphStyle("Banner", parent=base, fontSize=11, alignment=1, fontName="Helvetica-Bold",
                       textColor=colors.HexColor("#065f46") if passed else _RED),
    )]], colWidths=[doc.width])
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#d1fae5") if passed else colors.HexColor("#fee2e2")),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements += [banner, Spacer(1, 16)]

    elements.append(Paragraph(
        "This is a computer-generated report card and does not require a physical signature.",
        ParagraphStyle("Footer", parent=base, fontSize=8, textColor=_MUTED),
    ))

    doc.build(elements)
    return buf.getvalue()
