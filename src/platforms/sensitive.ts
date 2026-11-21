// Places Sentiment Guide stays out of (Plan 11.2, Spec NFR-4).
//
// Fields: passwords, card details, one-time codes and addresses, and any box
// in a form that has a password in it (a login or sign-up form). Only
// textareas and rich editors are ever checked, never <input>, so these
// catch the odd textarea or editor used for them.
//
// Sites: banks, health services and government, off until the user turns
// them on (from the badge's menu, or Settings → Sites).

const SENSITIVE_AUTOCOMPLETE = /^(cc-|one-time-code|current-password|new-password|street-address|address-|postal-code|bday|tel)/

/** Words in a field's name, id, label or placeholder that mark it as sensitive */
const SENSITIVE_WORDS = /pass(word|code|phrase)|\bpin\b|card ?number|\bcvc\b|\bcvv\b|security code|\biban\b|account number|routing|\bssn\b|social security|street address|home address|billing address|shipping address|one[- ]time code|verification code/i

export function isSensitiveField(el: HTMLElement): boolean {
  const auto = (el.getAttribute("autocomplete") ?? "").toLowerCase().trim().split(/\s+/)
  if (auto.some(a => SENSITIVE_AUTOCOMPLETE.test(a))) return true
  const words = [el.getAttribute("name"), el.id, el.getAttribute("aria-label"), el.getAttribute("placeholder")]
    .filter(Boolean).join(" ")
  if (SENSITIVE_WORDS.test(words)) return true
  // A box in a login or sign-up form
  const form = el.closest("form")
  return !!form?.querySelector('input[type="password"]')
}

/** Government (.gov, .gov.uk, .gouv.fr, .gob.mx, .go.jp…) and military domains */
const GOVERNMENT = /(^|\.)(gov|gouv|gob|go|govt|mil)(\.[a-z]{2})?$/
/** Banking, payments and health, by name in the hostname */
const NAMED = /(^|[.-])([a-z]*bank(ing)?|paypal|venmo|wise|revolut|monzo|chase|wellsfargo|citi|hsbc|barclays|santander|health|hospital|clinic|medical|pharmacy|mychart|nhs|patient)([.-]|$)/

export function isSensitiveSite(host: string): boolean {
  const h = host.toLowerCase()
  return GOVERNMENT.test(h) || NAMED.test(h)
}
