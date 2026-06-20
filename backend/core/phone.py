"""Indian mobile-number normalisation, shared across data-entry models.

A valid Indian mobile number is 10 digits with a leading digit of 6-9.
Inputs may arrive with formatting, a +91 / 91 country code, or a trunk 0
(e.g. "+91 98765-43210", "098765 43210") — these are stripped before
validation. Anything that does not resolve to a valid 10-digit mobile
raises ValueError so the API surfaces a clean 422/400 instead of storing junk.
"""

INVALID_PHONE = "Enter a valid 10-digit Indian mobile number"


def normalize_indian_mobile(value: str) -> str:
    digits = "".join(c for c in (value or "") if c.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise ValueError(INVALID_PHONE)
    return digits
