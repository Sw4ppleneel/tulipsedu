"""Server-side fee-receipt PDF rendering (reportlab, pure-Python — no system libs).

Renders the structured receipt context from `receipt.get_receipt_context` into a
downloadable A4 PDF. The accountant/principal downloads it after a payment is paid
and forwards it to the parent themselves (WhatsApp/email). Mirrors the on-screen
HTML receipt layout in the school brand colours.
"""

import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# School brand palette (matches the SPA theme)
_PRIMARY = colors.HexColor("#14463A")   # chalkboard green
_ACCENT = colors.HexColor("#1F8A5D")
_LIGHT = colors.HexColor("#E7EFEA")
_MUTED = colors.HexColor("#6b7280")
_RULE = colors.HexColor("#e5e7eb")


def render_receipt_pdf(ctx: dict) -> bytes:
    """ctx is the dict returned by receipt.get_receipt_context."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=20 * mm, bottomMargin=18 * mm,
        leftMargin=18 * mm, rightMargin=18 * mm,
        title=f"Receipt {ctx['receipt_number']}",
    )

    base = getSampleStyleSheet()["Normal"]
    school_style = ParagraphStyle(
        "School", parent=base, fontSize=17, leading=20,
        textColor=_PRIMARY, fontName="Helvetica-Bold",
    )
    sub_style = ParagraphStyle("Sub", parent=base, fontSize=9, textColor=_MUTED)
    rcpt_style = ParagraphStyle(
        "Rcpt", parent=base, fontSize=12, alignment=2,
        textColor=_PRIMARY, fontName="Helvetica-Bold",
    )
    rcpt_sub = ParagraphStyle("RcptSub", parent=base, fontSize=9, alignment=2, textColor=_MUTED)

    paid_at: datetime = ctx["paid_at"] or datetime.now(timezone.utc)
    date_display = paid_at.strftime("%d %b %Y, %I:%M %p")
    method_display = (ctx["payment_method"] or "Online").replace("_", " ").title()

    elements = []

    # ── Header: school name (left) + receipt no / date (right) ──
    header = Table(
        [[
            [Paragraph(ctx["school_name"], school_style),
             Paragraph("Fee Payment Receipt", sub_style)],
            [Paragraph(ctx["receipt_number"], rcpt_style),
             Paragraph(date_display, rcpt_sub)],
        ]],
        colWidths=[doc.width * 0.6, doc.width * 0.4],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 1.4, _PRIMARY),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements += [header, Spacer(1, 12)]

    # ── Student / payment info ──
    cell = ParagraphStyle("Cell", parent=base, fontSize=9.5)
    label = ParagraphStyle("Lbl", parent=base, fontSize=8.5, textColor=_MUTED, fontName="Helvetica-Bold")
    info = Table(
        [
            [Paragraph("STUDENT", label), Paragraph(ctx["student_name"], cell),
             Paragraph("ADMISSION NO", label), Paragraph(ctx["admission_no"], cell)],
            [Paragraph("CLASS", label), Paragraph(ctx["class_section"], cell),
             Paragraph("PAYMENT MODE", label), Paragraph(method_display, cell)],
        ],
        colWidths=[doc.width * 0.18, doc.width * 0.32, doc.width * 0.2, doc.width * 0.3],
    )
    info.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), _LIGHT),
        ("BACKGROUND", (2, 0), (2, -1), _LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.white),
    ]))
    elements += [info, Spacer(1, 16)]

    # ── Itemised fees ──
    # Built-in Helvetica lacks the ₹ glyph and the slim image ships no TTF fonts,
    # so use "Rs." (standard on Indian receipts) — guaranteed to render anywhere.
    rupee = "Rs. "
    item_label = ParagraphStyle("ItemLbl", parent=base, fontSize=8.5, textColor=colors.HexColor("#444"), fontName="Helvetica-Bold")
    desc = ParagraphStyle("Desc", parent=base, fontSize=9.5)
    amt = ParagraphStyle("Amt", parent=base, fontSize=9.5, alignment=2)
    amt_bold = ParagraphStyle("AmtBold", parent=base, fontSize=10.5, alignment=2, fontName="Helvetica-Bold")
    desc_bold = ParagraphStyle("DescBold", parent=base, fontSize=10.5, fontName="Helvetica-Bold")

    data = [[Paragraph("DESCRIPTION", item_label), Paragraph("AMOUNT", ParagraphStyle("AmtLbl", parent=item_label, alignment=2))]]
    for it in ctx["items"]:
        data.append([Paragraph(it["description"], desc), Paragraph(f"{rupee}{it['amount']:,.2f}", amt)])
    data.append([Paragraph("Total Paid", desc_bold), Paragraph(f"{rupee}{ctx['total']:,.2f}", amt_bold)])

    n = len(data)
    items_tbl = Table(data, colWidths=[doc.width * 0.72, doc.width * 0.28])
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _LIGHT),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, _RULE),
        ("LINEBELOW", (0, 1), (-1, n - 2), 0.4, colors.HexColor("#f0f0f0")),
        ("LINEABOVE", (0, n - 1), (-1, n - 1), 1.4, _PRIMARY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements += [items_tbl, Spacer(1, 18)]

    # ── PAID badge + footer ──
    badge = Table([[Paragraph("PAID", ParagraphStyle(
        "Badge", parent=base, fontSize=9, textColor=colors.HexColor("#065f46"),
        fontName="Helvetica-Bold", alignment=1))]], colWidths=[26 * mm])
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#d1fae5")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
    ]))
    elements += [badge, Spacer(1, 8)]
    elements.append(Paragraph(
        "This is a computer-generated receipt and does not require a physical signature.",
        ParagraphStyle("Footer", parent=base, fontSize=8, textColor=_MUTED),
    ))

    doc.build(elements)
    return buf.getvalue()
