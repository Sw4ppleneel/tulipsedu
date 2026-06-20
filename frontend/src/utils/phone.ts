// Indian mobile-number validation, mirrored from backend/core/phone.py.
// Valid = 10 digits, leading digit 6-9. Accepts +91 / 91 / leading-0 prefixes.

export function normalizeIndianMobile(value: string): string | null {
  let digits = (value || '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

export function isValidIndianMobile(value: string): boolean {
  return normalizeIndianMobile(value) !== null
}

export const INVALID_PHONE_MSG = 'Enter a valid 10-digit Indian mobile number'
