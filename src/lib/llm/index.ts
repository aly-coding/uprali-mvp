import type { ProviderName } from "../types";
import type { AnalystProvider } from "./types";
import { AnthropicAnalyst } from "./anthropic";
import { NearAiAnalyst } from "./nearai";
import { DemoAnalyst } from "./demo";

type Env = Record<string, string | undefined>;

export function availableProviders(env: Env = process.env): ProviderName[] {
  // NEAR AI comes first: its models run in a TEE, so the private chat stays private by default.
  const list: ProviderName[] = [];
  if (env.NEARAI_API_KEY) list.push("nearai");
  if (env.ANTHROPIC_API_KEY) list.push("anthropic");
  list.push("demo");
  return list;
}

export function defaultProvider(env: Env = process.env): ProviderName {
  const wanted = (env.LLM_PROVIDER || "").toLowerCase() as ProviderName;
  const avail = availableProviders(env);
  if (wanted && avail.includes(wanted)) return wanted;
  return avail[0];
}

/** Returns the requested provider if it is configured, otherwise the default. */
export function getProvider(requested?: string | null, env: Env = process.env): AnalystProvider {
  const avail = availableProviders(env);
  const name = requested && avail.includes(requested as ProviderName) ? (requested as ProviderName) : defaultProvider(env);
  switch (name) {
    case "anthropic":
      return new AnthropicAnalyst(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_MODEL || "claude-opus-5-5");
    case "nearai":
      return new NearAiAnalyst(
        env.NEARAI_API_KEY!,
        env.NEARAI_MODEL || "zai-org/GLM-5.1-FP8",
        env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1",
      );
    default:
      return new DemoAnalyst();
  }
}
