/**
 * An amount of money as a person types it: "60000", "60,000", "$60,000",
 * "60k", "1.5M". Null when it is not one: a field that cannot be read is
 * said to be wrong, never read as something else ("60k" is not $60).
 */
export function parseMoney(text: string): number | null {
  const plain = text.trim().toLowerCase().replace(/[$,\s]/g, "");
  const m = plain.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return null;
  const value = Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Number.isFinite(value) ? Math.round(value) : null;
}
