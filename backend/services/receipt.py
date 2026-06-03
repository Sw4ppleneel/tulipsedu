from datetime import datetime
from typing import Optional


MONTH_NAMES = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}


def period_label(month: Optional[int], year: int) -> str:
    if month is None:
        return f"Annual {year}"
    return f"{MONTH_NAMES[month]} {year}"


def generate_receipt_html(
    receipt_number: str,
    school_name: str,
    student_name: str,
    admission_no: str,
    class_section: str,
    payment_method: Optional[str],
    paid_at: datetime,
    items: list[dict],   # [{description, amount}]
    total: float,
) -> str:
    method_display = (payment_method or "Online").replace("_", " ").title()
    date_display = paid_at.strftime("%d %b %Y, %I:%M %p")

    rows_html = "\n".join(
        f'<tr><td>{i["description"]}</td>'
        f'<td style="text-align:right">&#8377;{float(i["amount"]):,.2f}</td></tr>'
        for i in items
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt {receipt_number}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:28px;color:#222;font-size:14px}}
  .header{{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a56db;padding-bottom:14px;margin-bottom:18px}}
  .school-name{{font-size:1.3em;font-weight:700;color:#1a56db}}
  .receipt-no{{font-size:1.1em;font-weight:700;color:#1a56db;text-align:right}}
  .meta{{color:#555;font-size:0.82em;margin-top:3px}}
  .info-table{{width:100%;border-collapse:collapse;margin-bottom:18px}}
  .info-table th{{text-align:left;padding:6px 10px;background:#f5f7ff;font-size:0.82em;color:#444;width:25%}}
  .info-table td{{padding:6px 10px;font-size:0.9em}}
  .items-table{{width:100%;border-collapse:collapse;margin-bottom:4px}}
  .items-table thead th{{background:#f5f7ff;padding:8px 10px;text-align:left;font-size:0.82em;color:#444;border-bottom:1px solid #ddd}}
  .items-table tbody td{{padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:0.9em}}
  .total-row td{{padding:10px;font-weight:700;font-size:1em;border-top:2px solid #1a56db}}
  .badge{{display:inline-block;padding:3px 12px;background:#d1fae5;color:#065f46;border-radius:9999px;font-weight:700;font-size:0.82em;margin-right:8px}}
  .footer{{margin-top:22px;font-size:0.78em;color:#888;border-top:1px solid #eee;padding-top:12px}}
  .print-btn{{margin-top:18px;padding:8px 20px;background:#1a56db;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.875em}}
  @media print{{.print-btn{{display:none}}body{{padding:12px}}}}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="school-name">{school_name}</div>
    <div class="meta">Fee Payment Receipt</div>
  </div>
  <div>
    <div class="receipt-no">{receipt_number}</div>
    <div class="meta" style="text-align:right">{date_display}</div>
  </div>
</div>

<table class="info-table">
  <tr><th>Student</th><td>{student_name}</td><th>Admission No</th><td>{admission_no}</td></tr>
  <tr><th>Class</th><td>{class_section}</td><th>Payment Mode</th><td>{method_display}</td></tr>
</table>

<table class="items-table">
  <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>{rows_html}</tbody>
  <tfoot>
    <tr class="total-row">
      <td>Total Paid</td>
      <td style="text-align:right">&#8377;{total:,.2f}</td>
    </tr>
  </tfoot>
</table>

<div class="footer">
  <span class="badge">PAID</span>
  This is a computer-generated receipt and does not require a physical signature.
</div>

<button class="print-btn" onclick="window.print()">&#128438; Print Receipt</button>
</body>
</html>"""
