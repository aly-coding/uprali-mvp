import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks Slack's request signature (https://api.slack.com/authentication/verifying-requests-from-slack):
 * v0=HMAC-SHA256(signing secret, "v0:{timestamp}:{raw body}"), and refuses requests older than 5 minutes
 * so a captured request can't be replayed.
 */
export function verifySlackSignature(opts: {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
}): boolean {
  const { secret, timestamp, signature, body } = opts;
  if (!secret || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signForTest(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

/** Slack's response_url always points at hooks.slack.com. Anything else is refused, so a request can't make us post elsewhere. */
export function isSlackResponseUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}
