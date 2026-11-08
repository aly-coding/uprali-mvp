import type { AnchorKind, CaseState, DecisionSnapshot } from "./types";
import { buildMemo } from "./memo";
import { filledByLabel } from "./format";

/**
 * Canonical JSON: object keys sorted at every level, no whitespace. The same
 * snapshot always produces the same bytes, so anyone can recompute the hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite number in snapshot");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** SHA-256 as lowercase hex. Uses Web Crypto, so it runs the same in the browser and on the server. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashSnapshot(s: DecisionSnapshot): Promise<string> {
  return sha256Hex(canonicalJson(s));
}

export function buildSnapshot(
  c: CaseState,
  opts: { kind?: AnchorKind; approvers: string[]; decidedAt?: string; decision?: string; modelsUsed?: string[] },
): DecisionSnapshot {
  const memo = buildMemo(c);
  const assumptions = Object.values(c.assumptions)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((a) => ({
      key: a.key,
      value: a.value,
      source: a.source,
      confidence: a.confidence,
      filledBy: filledByLabel(a.filledBy),
    }));
  const modelsUsed = Array.from(
    new Set(
      Object.values(c.assumptions)
        .map((a) => a.filledBy)
        .filter((f) => f.kind === "model")
        .map((f) => filledByLabel(f))
        .concat(opts.modelsUsed ?? []),
    ),
  ).sort();
  return {
    schema: "uprali.decision.v1",
    kind: opts.kind ?? "decision",
    caseId: c.id,
    caseTitle: c.title,
    caseVersion: c.version,
    templateId: c.templateId,
    decidedAt: opts.decidedAt ?? new Date().toISOString(),
    decision: opts.decision ?? memo.recommendation,
    approvers: [...opts.approvers].map((a) => a.trim()).filter(Boolean),
    assumptions,
    modelsUsed,
  };
}

const KINDS: AnchorKind[] = ["decision", "approval", "outcome_review"];

/** Light structural check for snapshots that arrive over the network or from a file. */
export function validateSnapshot(x: unknown): x is DecisionSnapshot {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    s.schema === "uprali.decision.v1" &&
    typeof s.kind === "string" &&
    KINDS.includes(s.kind as AnchorKind) &&
    typeof s.caseId === "string" &&
    s.caseId.length > 0 &&
    s.caseId.length <= 64 &&
    typeof s.caseVersion === "number" &&
    Number.isInteger(s.caseVersion) &&
    s.caseVersion >= 0 &&
    typeof s.decision === "string" &&
    Array.isArray(s.approvers) &&
    Array.isArray(s.assumptions) &&
    Array.isArray(s.modelsUsed)
  );
}
