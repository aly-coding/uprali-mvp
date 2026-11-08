import Anthropic from "@anthropic-ai/sdk";
import type { AnalystProvider, AnalystTurnInput, AnalystTurnOutput } from "./types";
import { ModelOutput, ProviderError } from "./types";
import { extractJson, jsonSchema, sanitizeUpdates, systemPrompt } from "./prompt";
import type { ChatMessage } from "../types";

/** The Messages API wants the conversation to open with the user and alternate roles. */
export function toApiMessages(messages: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    const content = m.content.slice(0, 4000);
    if (out.length === 0 && m.role === "assistant") {
      out.push({ role: "user", content: "Let's start the case." });
    }
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${content}`;
    } else {
      out.push({ role: m.role, content });
    }
  }
  if (out.length === 0 || out[out.length - 1].role !== "user") {
    out.push({ role: "user", content: "Continue." });
  }
  return out;
}

export class AnthropicAnalyst implements AnalystProvider {
  name = "anthropic" as const;
  private client: Anthropic;

  constructor(
    apiKey: string,
    public model: string = "claude-opus-5-5",
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async turn(input: AnalystTurnInput): Promise<AnalystTurnOutput> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 4000,
        system: systemPrompt(input),
        messages: toApiMessages(input.messages),
        // Short, conversational turns: low effort keeps replies fast.
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: jsonSchema(input.template.fields.map((f) => f.key)) },
        },
        // If the primary model declines a request, the API retries it on a suitable fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ProviderError(String(err), "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ProviderError(String(err), "The AI analyst is busy right now. Try again in a moment.");
      }
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError(String(err), `The AI analyst hit an error (${err.status ?? "network"}). Try again.`);
      }
      throw err;
    }

    if (response.stop_reason === "refusal") {
      return {
        reply: "I can't help with that request. Let's keep working on the business case.",
        updates: [],
        askingKey: input.pendingKey,
        provider: this.name,
        model: response.model,
      };
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = ModelOutput.safeParse(extractJson(text));
    if (!parsed.success) {
      throw new ProviderError(`Bad model output: ${parsed.error.message}`, "The AI analyst gave an answer I couldn't read. Try again.");
    }
    const { updates, askingKey } = sanitizeUpdates(input, parsed.data);
    return { reply: parsed.data.reply, updates, askingKey, provider: this.name, model: response.model };
  }
}
