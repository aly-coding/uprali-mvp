import Anthropic from "@anthropic-ai/sdk";
import type { ModelUse } from "./types";

/**
 * The model behind the analyst. Order: NEAR AI Cloud (private, TEE-hosted), then Claude as a
 * fallback, then a deterministic demo analyst so everything works with no keys at all.
 * Models only extract stated facts and write prose. They never produce the numbers.
 */

export type Env = Record<string, string | undefined>;
export type ProviderName = ModelUse["provider"];

export interface JsonTask {
  task: ModelUse["task"];
  system: string;
  user: string;
  /** JSON Schema of the expected object. */
  schema: Record<string, unknown>;
}

export interface JsonResult {
  data: unknown;
  use: ModelUse;
}

export class ProviderError extends Error {}

export function providerOrder(env: Env = process.env): ProviderName[] {
  const order: ProviderName[] = [];
  const wanted = (env.LLM_PROVIDER || "").toLowerCase();
  const nearai = !!nearAiConfig(env).apiKey;
  const anthropic = !!env.ANTHROPIC_API_KEY;
  if (wanted === "demo") return ["demo"];
  if (wanted === "anthropic" && anthropic) order.push("anthropic");
  if (nearai) order.push("nearai");
  if (anthropic && !order.includes("anthropic")) order.push("anthropic");
  order.push("demo");
  return order;
}

export function nearAiConfig(env: Env = process.env) {
  return {
    // Trimmed: a key pasted with a stray space or line break makes fetch throw before it sends anything.
    // A value with spaces or line breaks inside isn't a key (for example the /setup lines pasted here by mistake): never send it.
    apiKey: env.NEARAI_API_KEY?.trim() && !/\s/.test(env.NEARAI_API_KEY.trim()) ? env.NEARAI_API_KEY.trim() : undefined,
    baseUrl: (env.NEARAI_BASE_URL?.trim() || "https://cloud-api.near.ai/v1").replace(/\/+$/, ""),
    model: env.NEARAI_MODEL?.trim() || "z-ai/glm-5.3-flash",
  };
}

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new ProviderError("No JSON in model output");
  }
}

async function nearAi(t: JsonTask, env: Env): Promise<JsonResult> {
  const c = nearAiConfig(env);
  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({
      model: c.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${t.system}\n\nReply with one JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(t.schema)}` },
        { role: "user", content: t.user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new ProviderError(`NEAR AI returned ${res.status}`);
  const data = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
  return {
    data: extractJson(data.choices?.[0]?.message?.content ?? ""),
    use: { provider: "nearai", model: data.model ?? c.model, task: t.task, private: true },
  };
}

async function claude(t: JsonTask, env: Env): Promise<JsonResult> {
  const model = env.ANTHROPIC_MODEL || "claude-opus-5-5";
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      system: t.system,
      messages: [{ role: "user", content: t.user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: t.schema } },
      // If the primary model declines a request, the API retries it on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) throw new ProviderError(`Claude returned ${err.status ?? "a network error"}`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new ProviderError("Claude declined the request");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { data: extractJson(text), use: { provider: "anthropic", model: response.model, task: t.task, private: false } };
}

/**
 * Runs one JSON task on the first provider that works. `demo` is the caller's deterministic
 * answer for the same task, used when no model is configured or every model failed.
 */
export async function runJsonTask(t: JsonTask, demo: () => unknown, env: Env = process.env): Promise<JsonResult> {
  const order = providerOrder(env);
  let fellBackFrom: string | undefined;
  for (const p of order) {
    try {
      if (p === "nearai") {
        const r = await nearAi(t, env);
        return fellBackFrom ? { ...r, use: { ...r.use, fallbackFrom: fellBackFrom } } : r;
      }
      if (p === "anthropic") {
        const r = await claude(t, env);
        return fellBackFrom ? { ...r, use: { ...r.use, fallbackFrom: fellBackFrom } } : r;
      }
      return { data: demo(), use: { provider: "demo", model: "scripted-v2", task: t.task, private: false, fallbackFrom: fellBackFrom } };
    } catch (err) {
      // Record only the reason's type, never the request content.
      fellBackFrom = `${fellBackFrom ? fellBackFrom + ", then " : ""}${p} (${err instanceof ProviderError ? err.message : "error"})`;
    }
  }
  return { data: demo(), use: { provider: "demo", model: "scripted-v2", task: t.task, private: false, fallbackFrom: fellBackFrom } };
}
