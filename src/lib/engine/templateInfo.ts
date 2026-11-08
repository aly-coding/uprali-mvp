import { FIELDS, TEMPLATE } from "./buildVsBuy";
import { CASE_TEMPLATES, CASE_TEMPLATE_IDS, templateList } from "./cases";
import type { FieldDef } from "./buildVsBuy";

const field = (f: FieldDef & { card?: string; kind?: string }) => ({
  key: f.key,
  label: f.label,
  unit: f.unit,
  ask: f.ask,
  card: f.card ?? f.group ?? null,
  keyDriver: f.kind === "keyDriver",
  benchmark: typeof f.benchmark === "function" ? "computed" : (f.benchmark ?? null),
  benchmarkSource: f.benchmarkSource ?? null,
  onlyAHumanCanAnswer: f.benchmark === undefined || !!f.humanShouldConfirm,
});

/** Every template with its owner cards and fields, for agents and the API. */
export function describeTemplates() {
  const list = templateList();
  return {
    templates: [
      { ...list[0], version: TEMPLATE.version, endpoint: "/api/v1/build-vs-buy", mcpTool: "build_vs_buy", cards: [], fields: FIELDS.map(field) },
      ...CASE_TEMPLATE_IDS.map((id) => {
        const t = CASE_TEMPLATES[id];
        return {
          id,
          title: t.title,
          description: t.description,
          prompt: t.prompt,
          version: t.version,
          endpoint: "/api/v1/business-case",
          mcpTool: "business_case",
          cards: t.cards.map((c) => ({ id: c.id, title: c.title, owner: c.owner, description: c.description, formula: c.formula })),
          fields: t.drivers.map(field),
        };
      }),
    ],
  };
}
