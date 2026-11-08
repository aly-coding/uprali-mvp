import { z } from "zod";
import type { Assumption, ChatMessage, ProviderName, TemplateDef } from "../types";

export interface AnalystTurnInput {
  template: TemplateDef;
  assumptions: Record<string, Assumption>;
  messages: ChatMessage[];
  /** The field the analyst asked about last, if any. */
  pendingKey: string | null;
}

/** What a model returns. Values are strings; numeric fields are parsed in code. */
export const ModelOutput = z.object({
  reply: z.string().min(1).max(2000),
  updates: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
        source: z.string().max(200),
        confidence: z.enum(["high", "medium", "low"]),
        origin: z.enum(["user_stated", "model_estimate"]),
      }),
    )
    .max(12),
  asking_key: z.string().nullable(),
});
export type ModelOutput = z.infer<typeof ModelOutput>;

export interface AnalystUpdate {
  key: string;
  value: number | string;
  source: string;
  confidence: "high" | "medium" | "low";
  origin: "user_stated" | "model_estimate";
}

export interface AnalystTurnOutput {
  reply: string;
  updates: AnalystUpdate[];
  askingKey: string | null;
  provider: ProviderName;
  model: string;
}

export interface AnalystProvider {
  name: ProviderName;
  model: string;
  turn(input: AnalystTurnInput): Promise<AnalystTurnOutput>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}
