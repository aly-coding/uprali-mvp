/**
 * Agents authenticate with an API key. Keys live in UPRALI_API_KEYS (comma separated) on the
 * server. With no keys set the API is open, which is what the keyless demo needs.
 */
type Env = Record<string, string | undefined>;

export function apiKeys(env: Env = process.env): string[] {
  return (env.UPRALI_API_KEYS || "").split(",").map((k) => k.trim()).filter((k) => k.length >= 16);
}

export function authRequired(env: Env = process.env): boolean {
  return apiKeys(env).length > 0;
}

export function presentedKey(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return (m?.[1] || req.headers.get("x-api-key") || "").trim() || null;
}

function sameText(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function isAuthorized(req: Request, env: Env = process.env): boolean {
  const keys = apiKeys(env);
  if (keys.length === 0) return true;
  const k = presentedKey(req);
  if (!k) return false;
  let ok = false;
  for (const key of keys) ok = sameText(k, key) || ok;
  return ok;
}

export function unauthorized(): Response {
  return Response.json(
    { error: "Missing or wrong API key. Send it as 'Authorization: Bearer <key>'." },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="uprali"' } },
  );
}
