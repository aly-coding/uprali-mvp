import type { AnalystProvider, AnalystTurnInput, AnalystTurnOutput } from "./types";
import { ModelOutput, ProviderError } from "./types";
import { extractJson, sanitizeUpdates, systemPrompt } from "./prompt";

/**
 * NEAR AI Cloud: an OpenAI-compatible chat API with TEE-backed (confidential) inference.
 * Plugged in behind the same interface as Claude, so a case can switch providers mid-way
 * and the model log still shows which model filled each value.
 */
export class NearAiAnalyst implements AnalystProvider {
  name = "nearai" as const;

  constructor(
    private apiKey: string,
    public model: string,
    private baseUrl: string = "https://cloud-api.near.ai/v1",
  ) {}

  async turn(input: AnalystTurnInput): Promise<AnalystTurnOutput> {
    const messages = [
      { role: "system", content: systemPrompt(input) },
      ...input.messages.map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
    ];
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new ProviderError(String(err), "Couldn't reach NEAR AI. Try again, or switch to Claude.");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg =
        res.status === 401 || res.status === 403
          ? "The NEAR AI key was rejected. Check NEARAI_API_KEY."
          : `NEAR AI returned an error (${res.status}). Try again, or switch to Claude.`;
      throw new ProviderError(`NEAR AI ${res.status}: ${body.slice(0, 300)}`, msg);
    }
    const data = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? "";
    let parsed;
    try {
      parsed = ModelOutput.safeParse(extractJson(text));
    } catch {
      parsed = { success: false as const };
    }
    if (!parsed.success) {
      throw new ProviderError("Bad NEAR AI output", "NEAR AI gave an answer I couldn't read. Try again.");
    }
    const { updates, askingKey } = sanitizeUpdates(input, parsed.data);
    return { reply: parsed.data.reply, updates, askingKey, provider: this.name, model: data.model ?? this.model };
  }
}
