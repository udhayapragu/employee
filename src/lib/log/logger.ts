type LogLevel = "info" | "warn" | "error";
type LogValue = string | number | boolean | null | undefined;

const SENSITIVE_KEY = /pass|secret|token|cookie|authorization|api[_-]?key|database|connection|dsn|hash|session/i;

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /postgres(ql)?:\/\/\S+/gi,
  /sk-ant-[A-Za-z0-9_-]+/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

/** Removes secrets from log text: connection strings, API key shapes and bearer tokens. */
export function redactText(text: string): string {
  return SENSITIVE_VALUE_PATTERNS.reduce((result, pattern) => result.replace(pattern, "[redacted]"), text);
}

function sanitize(fields: Record<string, LogValue>): Record<string, LogValue> {
  const output: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = "[redacted]";
    } else if (typeof value === "string") {
      output[key] = redactText(value).slice(0, 300);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/** Writes one structured JSON log line. Fields whose names look sensitive are replaced by a marker. */
export function logEvent(level: LogLevel, event: string, fields: Record<string, LogValue> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitize(fields) });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
