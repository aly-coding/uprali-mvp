import type { FieldUnit, FilledBy } from "./types";

export function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000)}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

export function formatValue(value: number | string, unit: FieldUnit): string {
  if (typeof value === "string") return value;
  switch (unit) {
    case "usd":
      return usd(value);
    case "usd_per_year":
      return `${usd(value)} a year`;
    case "weeks":
      return `${trim(value)} week${value === 1 ? "" : "s"}`;
    case "months":
      return `${trim(value)} month${value === 1 ? "" : "s"}`;
    case "years":
      return `${trim(value)} year${value === 1 ? "" : "s"}`;
    case "pct":
      return `${trim(value)}%`;
    case "count":
      return trim(value);
    default:
      return String(value);
  }
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function filledByLabel(f: FilledBy): string {
  if (f.kind === "user") return "You";
  const who = f.provider === "anthropic" ? "Claude" : f.provider === "nearai" ? "NEAR AI" : "Demo analyst";
  return `${who} (${f.model})`;
}

/**
 * Pull a number out of free text: "$12k", "12,500", "3 weeks", "20%", "1.5m".
 * Returns null when there is no number.
 */
export function parseAmount(text: string): number | null {
  const m = text.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(k|m|mm|million|thousand|bn|b)?\b/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const suf = (m[2] || "").toLowerCase();
  if (suf === "k" || suf === "thousand") n *= 1_000;
  else if (suf === "m" || suf === "mm" || suf === "million") n *= 1_000_000;
  else if (suf === "b" || suf === "bn") n *= 1_000_000_000;
  return Number.isFinite(n) ? n : null;
}
