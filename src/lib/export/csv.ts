/**
 * Formula-injection guard. Spreadsheet apps execute cells beginning with = + - @ | or whitespace
 * followed by one of these characters. Such cells are prefixed with an apostrophe so they are read as text.
 */
const FORMULA_START = /^\s*[=+\-@|]/;

export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Builds CSV text with CRLF line endings. Every cell passes through the formula guard. */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers, ...rows].map((cells) => cells.map((cell) => toCsvCell(cell)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
