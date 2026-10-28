const LEGAL_SUFFIXES = new Set(["private", "pvt", "limited", "ltd", "llp", "opc", "llc", "inc", "co", "corp", "corporation", "company"]);

/** Lowercases, strips diacritics and punctuation, and collapses whitespace. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Normalizes a company name for duplicate comparison. Only trailing legal-form words are removed,
 * so "Textiles India Pvt Ltd" becomes "textiles india" while the word "India" inside a name is kept.
 */
export function normalizeCompanyName(name: string): string {
  const tokens = normalizeText(name).split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

export function normalizeCity(city: string | null | undefined): string {
  return city ? normalizeText(city) : "";
}

/**
 * Normalizes a single Indian mobile or landline number to E.164 (+91XXXXXXXXXX).
 * Returns null for anything ambiguous, for example several numbers in one field, extensions, or
 * non-Indian numbers. Ambiguous input is never guessed at.
 */
export function normalizePhoneIN(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return null;
  if (/[a-zA-Z/,;]/.test(trimmed)) return null;

  let digits = trimmed.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) {
    if (!digits.startsWith("+91")) return null;
    digits = digits.slice(3);
  } else if (digits.startsWith("0091")) {
    digits = digits.slice(4);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/**
 * Validates and canonicalises a source URL. Only public https URLs with a host name are accepted.
 * Credentials, fragments, IP literals, localhost and tracking parameters are removed or rejected.
 * The URL is only ever stored and displayed; the server never fetches it.
 */
export function normalizeSourceUrl(raw: string): string | null {
  const candidate = raw.trim();
  if (candidate.length === 0 || candidate.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost")) return null;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;

  url.hostname = host;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  const normalized = url.toString();
  return normalized.length <= 2048 ? normalized : null;
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index += 1) {
    const gram = value.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice similarity over character bigrams, from 0 to 1. Used for conservative name matching. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b && a.length > 0) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const countsA = bigramCounts(a);
  const countsB = bigramCounts(b);
  let shared = 0;
  for (const [gram, countA] of countsA) {
    shared += Math.min(countA, countsB.get(gram) ?? 0);
  }
  const totalA = a.length - 1;
  const totalB = b.length - 1;
  return (2 * shared) / (totalA + totalB);
}
