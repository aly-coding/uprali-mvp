#!/usr/bin/env node
// Proves NEAR AI Cloud's private inference, end to end, with fictional data:
//  1. sends one chat completion about the fictional Acme case to the TEE-hosted model,
//  2. asks for an attestation report with a fresh random nonce,
//  3. checks that the hardware quote binds that nonce and the node's signing key.
//
// Usage:  NEARAI_API_KEY=... npm run attest
//         npm run attest -- --offline     (no key or network: runs the same checks on a synthetic report)
//
// Nothing is saved. The key is read from the environment or .env.local and never printed.
import fs from "node:fs";
import path from "node:path";
import { attestationUrl, checkNearAiReport, freshNonce, syntheticReport } from "../src/lib/attest.ts";

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const offline = process.argv.includes("--offline");
const key = process.env.NEARAI_API_KEY;
const base = (process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1").replace(/\/+$/, "");
const model = process.env.NEARAI_MODEL || "zai-org/GLM-5.1-FP8";

function print(result) {
  console.log(`\n${result.verified ? "VERIFIED" : "NOT VERIFIED"}: ${result.model}, nonce ${result.nonce.slice(0, 16)}…`);
  for (const c of result.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  for (const n of result.notCheckedHere) console.log(`  ○ Not checked here: ${n}`);
  return result.verified ? 0 : 1;
}

if (offline) {
  console.log("Offline self-test: checking a synthetic report built in NEAR AI's real layout (no network).");
  const nonce = freshNonce();
  const ok = print(checkNearAiReport(syntheticReport({ model, nonce, signingAddress: "ab".repeat(20) }), { model, nonce }));
  console.log("\nReplay test: the same report checked against a new nonce should fail.");
  const replay = checkNearAiReport(syntheticReport({ model, nonce, signingAddress: "ab".repeat(20) }), { model, nonce: freshNonce() });
  console.log(`  ${replay.verified ? "✗ replay was accepted" : "✓ replay rejected"}`);
  process.exit(ok === 0 && !replay.verified ? 0 : 1);
}

if (!key) {
  console.error("Set NEARAI_API_KEY in .env.local (or run with --offline to see the checks without a key).");
  process.exit(1);
}

const sample = fs.readFileSync(path.resolve("samples/acme-crm-answers.md"), "utf8");
console.log(`1. Sending one fictional question to ${model} on NEAR AI Cloud...`);
const chat = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({
    model,
    max_tokens: 200,
    messages: [
      { role: "system", content: "You are a finance analyst. Answer in two sentences." },
      { role: "user", content: `Using this fictional case, should Acme build or buy?\n\n${sample}` },
    ],
  }),
});
if (!chat.ok) {
  console.error(`   NEAR AI returned ${chat.status}.`);
  process.exit(1);
}
const answer = (await chat.json()).choices?.[0]?.message?.content ?? "";
console.log(`   Answer: ${answer.trim().slice(0, 300)}`);

const nonce = freshNonce();
console.log("2. Requesting an attestation report with a fresh random nonce...");
const rep = await fetch(attestationUrl(base, model, nonce), { headers: { authorization: `Bearer ${key}` } });
if (!rep.ok) {
  console.error(`   NEAR AI returned ${rep.status} for the attestation report.`);
  process.exit(1);
}
console.log("3. Checking the report...");
process.exit(print(checkNearAiReport(await rep.json(), { model, nonce })));
