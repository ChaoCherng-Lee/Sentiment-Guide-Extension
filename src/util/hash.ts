/** Short, stable, non-cryptographic hash. Used to key per-chat data without storing names. */
export function hashString(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0
  }
  return Math.abs(h).toString(36)
}
