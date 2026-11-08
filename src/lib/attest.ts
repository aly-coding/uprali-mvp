/**
 * NEAR AI Cloud attestation checks. Self-contained (no imports) so the CLI script
 * scripts/attest-check.mjs can load this same file with Node's built-in type stripping.
 *
 * Report shape: GET {base}/attestation/report?model=..&signing_algo=ecdsa&nonce=<64 hex>
 *   -> { gateway_attestation, model_attestations: [{ model_name, signing_address, signing_algo,
 *        intel_quote (hex TDX quote), nvidia_payload (JSON string), request_nonce, info, event_log }] }
 * The TDX quote's report_data (bytes 568..632) is: signing address (20 bytes), 12 zero bytes, nonce (32 bytes).
 *
 * What this checks locally: the nonce is fresh and echoed, the quote is an Intel TDX quote that binds this
 * nonce and the node's signing key, and the GPU evidence carries the same nonce. What it does not do: verify
 * Intel's signature chain on the quote or NVIDIA's on the GPU evidence. Those need Intel's and NVIDIA's
 * verification services and are listed as "not checked here" so nobody mistakes this for a full audit.
 */

export interface AttestationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface AttestationResult {
  verified: boolean;
  model: string;
  nonce: string;
  checkedAt: string;
  node: { signingAddress: string; composeHash?: string; appId?: string } | null;
  checks: AttestationCheck[];
  notCheckedHere: string[];
}

interface ModelAttestation {
  model_name?: string;
  signing_address?: string;
  signing_algo?: string;
  intel_quote?: string;
  nvidia_payload?: string;
  request_nonce?: string;
  info?: { app_id?: string; compose_hash?: string };
}

const HEX64 = /^[0-9a-f]{64}$/;

export function freshNonce(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function attestationUrl(baseUrl: string, model: string, nonce: string): string {
  const u = new URL(`${baseUrl.replace(/\/+$/, "")}/attestation/report`);
  u.searchParams.set("model", model);
  u.searchParams.set("signing_algo", "ecdsa");
  u.searchParams.set("nonce", nonce);
  return u.toString();
}

function hexToBytes(hex: string): Uint8Array | null {
  const h = hex.trim().replace(/^0x/i, "");
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const NOT_CHECKED_HERE = [
  "Intel's signature chain on the TDX quote (verify with Intel's or Phala's quote verifier)",
  "NVIDIA's signature on the GPU evidence (verify with NVIDIA's attestation service)",
  "That the compose hash matches NEAR AI's published build",
];

/** NEAR AI names a model by its catalog id or its Hugging Face id (z-ai/glm-5.3-flash, zai-org/GLM-5.3-Flash). */
export function sameModel(a: string, b: string): boolean {
  const n = (x: string) => x.toLowerCase().split("/").pop()!.replace(/-fp8$/, "");
  return a === b || n(a) === n(b);
}

function checkNode(m: ModelAttestation, model: string, nonce: string): AttestationCheck[] {
  const checks: AttestationCheck[] = [];
  checks.push({
    name: "Model matches",
    ok: !m.model_name || sameModel(m.model_name, model),
    detail: m.model_name ? `Report is for ${m.model_name}` : "Report doesn't name a model",
  });
  checks.push({
    name: "Fresh nonce echoed",
    ok: (m.request_nonce ?? "").toLowerCase() === nonce,
    detail: m.request_nonce ? "The report repeats the random nonce we just sent" : "No nonce in the report",
  });

  const quote = m.intel_quote ? hexToBytes(m.intel_quote) : null;
  const isTdx = !!quote && quote.length >= 632 && (quote[0] | (quote[1] << 8)) >= 4 && quote[4] === 0x81;
  checks.push({
    name: "Intel TDX quote",
    ok: isTdx,
    detail: isTdx ? `Quote v${quote![0] | (quote![1] << 8)}, ${quote!.length} bytes, TEE type TDX` : "Missing or not a TDX quote",
  });

  const addr = (m.signing_address ?? "").toLowerCase().replace(/^0x/, "");
  let bound = false;
  let boundDetail = "Couldn't read report_data from the quote";
  if (isTdx && /^[0-9a-f]{40}$/.test(addr)) {
    const rd = quote!.slice(568, 632);
    const addrOk = toHex(rd.slice(0, 20)) === addr && rd.slice(20, 32).every((x) => x === 0);
    const nonceOk = toHex(rd.slice(32, 64)) === nonce;
    bound = addrOk && nonceOk;
    boundDetail = bound
      ? "The hardware report binds this nonce and the node's signing key 0x" + addr
      : `report_data ${addrOk ? "has the signing key" : "doesn't match the signing key"} and ${nonceOk ? "has the nonce" : "doesn't have our nonce"}`;
  } else if (!/^[0-9a-f]{40}$/.test(addr)) {
    boundDetail = "No valid signing address in the report";
  }
  checks.push({ name: "Quote binds nonce and signing key", ok: bound, detail: boundDetail });

  let gpuOk = false;
  let gpuDetail = "No GPU evidence in the report";
  if (m.nvidia_payload) {
    try {
      const p = JSON.parse(m.nvidia_payload) as { nonce?: string; evidence_list?: unknown[] };
      gpuOk = (p.nonce ?? "").toLowerCase() === nonce;
      gpuDetail = gpuOk
        ? `GPU evidence for ${Array.isArray(p.evidence_list) ? p.evidence_list.length : "?"} GPU(s) carries the same nonce`
        : "GPU evidence doesn't carry our nonce";
    } catch {
      gpuDetail = "GPU evidence isn't valid JSON";
    }
  }
  checks.push({ name: "NVIDIA GPU evidence", ok: gpuOk, detail: gpuDetail });
  return checks;
}

/** Checks a report against the nonce we generated. Passes if any node passes every local check. */
export function checkNearAiReport(report: unknown, opts: { model: string; nonce: string; checkedAt?: string }): AttestationResult {
  const nonce = opts.nonce.toLowerCase();
  const base = { model: opts.model, nonce, checkedAt: opts.checkedAt ?? new Date().toISOString(), notCheckedHere: NOT_CHECKED_HERE };
  if (!HEX64.test(nonce)) {
    return { ...base, verified: false, node: null, checks: [{ name: "Fresh nonce", ok: false, detail: "Nonce must be 32 random bytes in hex" }] };
  }
  const nodes = (report as { model_attestations?: ModelAttestation[] } | null)?.model_attestations;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ...base, verified: false, node: null, checks: [{ name: "Attestation report", ok: false, detail: "The report has no model attestations" }] };
  }
  let best: { m: ModelAttestation; checks: AttestationCheck[] } | null = null;
  for (const m of nodes) {
    const checks = checkNode(m, opts.model, nonce);
    if (!best || checks.filter((c) => c.ok).length > best.checks.filter((c) => c.ok).length) best = { m, checks };
    if (checks.every((c) => c.ok)) break;
  }
  const { m, checks } = best!;
  return {
    ...base,
    verified: checks.every((c) => c.ok),
    node: { signingAddress: m.signing_address ?? "", composeHash: m.info?.compose_hash, appId: m.info?.app_id },
    checks,
  };
}

/** Builds a synthetic report in the real layout. Used by tests and the offline self-test only. */
export function syntheticReport(opts: { model: string; nonce: string; signingAddress: string; tamper?: "nonce" | "address" }): unknown {
  const quote = new Uint8Array(1024);
  quote[0] = 4; // version 4, little endian
  quote[4] = 0x81; // TEE type: TDX
  const addr = hexToBytes(opts.signingAddress.replace(/^0x/, ""))!;
  quote.set(addr, 568);
  const n = hexToBytes(opts.nonce)!;
  if (opts.tamper === "nonce") n[0] ^= 0xff;
  quote.set(n, 600);
  return {
    gateway_attestation: {},
    model_attestations: [
      {
        model_name: opts.model,
        signing_address: opts.tamper === "address" ? "0x" + "11".repeat(20) : "0x" + opts.signingAddress.replace(/^0x/, ""),
        signing_algo: "ecdsa",
        intel_quote: toHex(quote),
        nvidia_payload: JSON.stringify({ nonce: opts.nonce, evidence_list: [{}], arch: "HOPPER" }),
        request_nonce: opts.nonce,
        info: { app_id: "demo-app", compose_hash: "00".repeat(32) },
      },
    ],
  };
}
