// One phone rule for every public form. The normalised number is also the key that links a survey
// submission to Roundtable and Webinar registrations, so all forms must produce the same value:
// a Vietnamese number "0901234567" becomes "+84901234567"; other numbers must already start with
// "+" and a country code. Spaces, dots, dashes and brackets are ignored. Returns null if invalid.
export function normalizePhoneNumber(value: string): string | null {
  const compact = value.replace(/[\s().-]/g, '')
  if (/^0\d{9,10}$/.test(compact)) return `+84${compact.slice(1)}`
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact
  return null
}
