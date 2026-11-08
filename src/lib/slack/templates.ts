/**
 * Picks the decision template from what someone wrote in Slack. A clear prefix ("product: ...") wins;
 * otherwise a few plain patterns. When nothing fits well, Slack asks which kind of decision it is.
 */
import { CASE_TEMPLATES, type TemplateId } from "@/lib/engine/cases";

export const TEMPLATE_TITLES: Record<TemplateId, string> = {
  build_vs_buy: "Build vs buy",
  new_product: CASE_TEMPLATES.new_product.title,
  gtm_expansion: CASE_TEMPLATES.gtm_expansion.title,
  ai_investment: CASE_TEMPLATES.ai_investment.title,
};

const PREFIXES: Array<[RegExp, TemplateId]> = [
  [/^(build\s*(vs\.?|or)\s*buy|buy\s*(vs\.?|or)\s*build|bvb)\s*[:\-]\s*/i, "build_vs_buy"],
  [/^(new\s+)?product\s*[:\-]\s*/i, "new_product"],
  [/^(gtm|go[- ]to[- ]market|expansion|new\s+market)\s*[:\-]\s*/i, "gtm_expansion"],
  [/^(ai(\s+(investment|roi))?)\s*[:\-]\s*/i, "ai_investment"],
];

/** Returns the template and the question with any prefix taken off, or a null template when it isn't clear. */
export function detectTemplate(text: string): { template: TemplateId | null; question: string } {
  const t = text.trim();
  for (const [re, id] of PREFIXES) {
    const m = t.match(re);
    if (m) return { template: id, question: t.slice(m[0].length).trim() || t };
  }
  const has = (re: RegExp) => re.test(t);
  // "build X or buy/keep paying for Y" is build vs buy, even when X is an AI tool.
  if (has(/\bbuild\b[^.?!]{0,80}\bor\b[^.?!]{0,40}\b(buy|keep|pay|paying|subscribe|license|use)\b/i) || has(/\bbuy\b[^.?!]{0,60}\bor\b[^.?!]{0,40}\bbuild\b/i) || has(/\b(build|make)\s*(vs\.?|versus)\s*buy\b/i)) {
    return { template: "build_vs_buy", question: t };
  }
  if (has(/\b(AI|A\.I\.)\b/) || has(/\b(copilot|llm|chatgpt|gpt|claude|ai assistant|ai tool|automation)\b/i)) return { template: "ai_investment", question: t };
  if (has(/\b(go[- ]to[- ]market|gtm|new market|expan(d|ding|sion)|new (region|country|geography|segment)|enter(ing)? (the )?[\w-]+ market)\b/i)) {
    return { template: "gtm_expansion", question: t };
  }
  if (has(/\b(new product|launch(ing)? (a |an |our )?(new )?([\w-]+ ){0,2}(product|app|saas|platform))\b/i)) return { template: "new_product", question: t };
  if (has(/\b(keep paying|subscription|vendor|licen[cs]e|prototype|in-house|seats?)\b/i)) return { template: "build_vs_buy", question: t };
  return { template: null, question: t };
}
