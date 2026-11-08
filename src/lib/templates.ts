import type { TemplateDef, TemplateResult } from "./types";
import { usd } from "./format";

const num = (v: number | string | undefined, fallback = 0): number => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: number | string | undefined, fallback: string): string =>
  v === undefined || v === "" ? fallback : String(v);
const round1 = (n: number) => Math.round(n * 10) / 10;

export const buildVsBuy: TemplateDef = {
  id: "build_vs_buy",
  name: "Build vs buy",
  description: "Should we buy a tool or build it ourselves?",
  opener:
    "I'll help you decide whether to buy a tool or build it. Uprali already turns your answers into a business case with every assumption sourced and rated, and when you decide, it records a tamper-proof fingerprint of the decision on NEAR. Your conversation with me stays private.",
  fields: [
    {
      key: "option_name",
      label: "Tool you'd buy",
      unit: "text",
      question: "Which tool or vendor would you buy instead of building?",
      hint: "The product name and plan, like HubSpot Starter.",
      benchmark: "the vendor tool",
      required: true,
    },
    {
      key: "buy_annual_cost",
      label: "Subscription cost",
      unit: "usd_per_year",
      question: "What would the subscription cost per year, for all the seats you need?",
      hint: "Check the vendor's pricing page and multiply by seats. Annual billing is usually cheaper.",
      benchmark: 2400,
      required: true,
    },
    {
      key: "buy_setup_cost",
      label: "One-time setup to buy",
      unit: "usd",
      question: "Is there a one-time cost to set it up, like onboarding fees or migration work?",
      hint: "Include vendor onboarding fees and your team's time to migrate data.",
      benchmark: 1000,
      required: true,
    },
    {
      key: "build_weeks",
      label: "Engineer time to build",
      unit: "weeks",
      question: "How many engineer-weeks would it take to build a version you'd actually use?",
      hint: "Ask the engineer who'd build it. Most first estimates run 1.5 to 2 times over.",
      benchmark: 6,
      required: true,
    },
    {
      key: "engineer_weekly_cost",
      label: "Cost of an engineer-week",
      unit: "usd",
      question: "What does one engineer-week cost you, fully loaded with salary, benefits and overhead?",
      hint: "A $160k salary with 25% benefits is roughly $4,000 a week.",
      benchmark: 4000,
      required: true,
    },
    {
      key: "maintenance_pct",
      label: "Yearly upkeep of a build",
      unit: "pct",
      question: "Each year, how much of the build cost goes to upkeep, like fixes, security and small features?",
      hint: "Teams commonly plan 15% to 25% of the build cost per year.",
      benchmark: 20,
      required: true,
    },
    {
      key: "horizon_years",
      label: "Time horizon",
      unit: "years",
      question: "Over how many years should we compare the two options?",
      hint: "Three years is a common horizon for software decisions.",
      benchmark: 3,
      required: true,
    },
  ],
  compute(v): TemplateResult {
    const option = str(v.option_name, "the vendor tool");
    const annual = num(v.buy_annual_cost);
    const setup = num(v.buy_setup_cost);
    const weeks = num(v.build_weeks);
    const rate = num(v.engineer_weekly_cost);
    const maint = num(v.maintenance_pct) / 100;
    const years = Math.max(1, num(v.horizon_years, 3));

    const buildCost = weeks * rate;
    const upkeepPerYear = buildCost * maint;
    const buildTco = buildCost + upkeepPerYear * years;
    const buyTco = setup + annual * years;
    const buy = buyTco <= buildTco;
    const gap = Math.abs(buildTco - buyTco);

    const breakevenAnnual = Math.max(0, (buildTco - setup) / years);
    const breakevenWeeks = rate * (1 + maint * years) > 0 ? buyTco / (rate * (1 + maint * years)) : 0;

    const recommendedOption = buy ? `Buy ${option}` : "Build it ourselves";
    const recommendation = buy
      ? `Buy ${option} and don't build our own.`
      : `Build it ourselves rather than buy ${option}.`;

    const whatIf = buy
      ? `If ${option} cost more than ${usd(breakevenAnnual)} a year, or the build took under ${round1(breakevenWeeks)} engineer-weeks, building would win.`
      : `If the build took more than ${round1(breakevenWeeks)} engineer-weeks, or ${option} cost under ${usd(breakevenAnnual)} a year, buying would win.`;

    return {
      recommendedOption,
      recommendation,
      ask: buy
        ? `Approve ${usd(annual)} a year for ${option}, plus ${usd(setup)} to set it up.`
        : `Approve ${round1(weeks)} engineer-weeks (${usd(buildCost)}) to build, plus about ${usd(upkeepPerYear)} a year of upkeep.`,
      metrics: [
        { label: `Buy over ${years} years`, value: usd(buyTco) },
        { label: `Build over ${years} years`, value: usd(buildTco) },
        { label: "Difference", value: usd(gap) },
        { label: "Engineer time if we build", value: `${round1(weeks)} weeks` },
      ],
      why: buy
        ? [
            `Over ${years} years buying costs ${usd(buyTco)} against ${usd(buildTco)} to build, ${usd(gap)} less.`,
            `Buying frees ${round1(weeks)} engineer-weeks for our own product.`,
            `Upkeep of a build would add about ${usd(upkeepPerYear)} every year.`,
          ]
        : [
            `Over ${years} years building costs ${usd(buildTco)} against ${usd(buyTco)} to buy, ${usd(gap)} less.`,
            `We own the result and pay no subscription after the build.`,
            `The subscription for ${option} adds up to ${usd(annual * years)} over ${years} years.`,
          ],
      costAndPayback: buy
        ? `${usd(buyTco)} over ${years} years. Compared with building, we save ${usd(gap)} and the engineer-weeks.`
        : annual > upkeepPerYear
          ? `${usd(buildTco)} over ${years} years. The build pays for itself against the subscription in about ${round1(
              Math.max(0, (buildCost - setup) / (annual - upkeepPerYear)),
            )} years.`
          : `${usd(buildTco)} over ${years} years.`,
      biggestRisk: buy
        ? `${option} raises its price or we outgrow the plan. Fallback: revisit at renewal and compare again.`
        : `The build runs over. Each extra week adds ${usd(rate)}, and past ${round1(breakevenWeeks)} weeks buying wins. Fallback: switch to ${option}.`,
      changeMyMind: whatIf,
      whatIf,
      preAnswered: buy
        ? [
            {
              q: "Why not just build it?",
              a: `The build is ${usd(buildCost)} of engineer time, and upkeep adds ${usd(upkeepPerYear)} a year on top.`,
            },
            { q: "Are we locked in?", a: `We'd revisit at each renewal. Check that ${option} lets us export our data.` },
            { q: "What are we giving up?", a: "Full control over how it works, which we don't need for this decision." },
          ]
        : [
            {
              q: "Why not just buy it?",
              a: `${option} costs ${usd(buyTco)} over ${years} years, ${usd(gap)} more than building.`,
            },
            {
              q: "What if the build runs late?",
              a: `Past ${round1(breakevenWeeks)} engineer-weeks buying is cheaper, so we'd stop and switch.`,
            },
            { q: "Who maintains it?", a: `We budget ${usd(upkeepPerYear)} a year of upkeep for the team that builds it.` },
          ],
      spoken: buy
        ? `I recommend we buy ${option}. It costs ${usd(annual)} a year and saves our engineers ${round1(weeks)} weeks. The main risk is a price rise, so we'll revisit at renewal.`
        : `I recommend we build it ourselves. It costs ${usd(buildCost)} up front and ${usd(buildTco)} over ${years} years, ${usd(gap)} less than buying. The main risk is the build running late, so we'd switch to ${option} past ${round1(breakevenWeeks)} weeks.`,
    };
  },
};

export const newHire: TemplateDef = {
  id: "new_hire",
  name: "New hire",
  description: "Does a new role pay for itself, and how fast?",
  opener:
    "I'll help you make the case for a new hire. Uprali already turns your answers into a business case with every assumption sourced and rated, and when you decide, it records a tamper-proof fingerprint of the decision on NEAR. Your conversation with me stays private.",
  fields: [
    {
      key: "role",
      label: "Role",
      unit: "text",
      question: "What role are you hiring for?",
      hint: "The job title, like account executive or data engineer.",
      benchmark: "the new role",
      required: true,
    },
    {
      key: "annual_salary",
      label: "Base salary",
      unit: "usd_per_year",
      question: "What base salary do you expect to pay?",
      hint: "Use the middle of the salary band for the role and location.",
      benchmark: 120000,
      required: true,
    },
    {
      key: "benefits_pct",
      label: "Benefits and taxes",
      unit: "pct",
      question: "What do benefits, payroll taxes and equipment add, as a percent of salary?",
      hint: "In the US this is commonly 20% to 30% of salary.",
      benchmark: 25,
      required: true,
    },
    {
      key: "recruiting_cost",
      label: "Recruiting cost",
      unit: "usd",
      question: "What will it cost to recruit, like agency fees, job ads and interview time?",
      hint: "Agencies often charge 15% to 25% of first-year salary.",
      benchmark: 20000,
      required: true,
    },
    {
      key: "ramp_months",
      label: "Time to ramp",
      unit: "months",
      question: "How many months until the new person is fully productive?",
      hint: "Three months is common. Sales and senior roles often take longer.",
      benchmark: 3,
      required: true,
    },
    {
      key: "annual_value",
      label: "Value once ramped",
      unit: "usd_per_year",
      question: "Once ramped, how much revenue or savings a year will this person bring?",
      hint: "For sales, their quota. For other roles, the cost of work they take over or the revenue they unblock.",
      benchmark: 250000,
      required: true,
    },
    {
      key: "payback_target_months",
      label: "Payback target",
      unit: "months",
      question: "How fast does the hire need to pay for itself, in months?",
      hint: "Many teams look for payback within 12 months.",
      benchmark: 12,
      required: true,
    },
  ],
  compute(v): TemplateResult {
    const role = str(v.role, "the new role");
    const salary = num(v.annual_salary);
    const benefits = num(v.benefits_pct) / 100;
    const recruiting = num(v.recruiting_cost);
    const ramp = Math.max(0, num(v.ramp_months));
    const value = num(v.annual_value);
    const target = Math.max(1, num(v.payback_target_months, 12));

    const loaded = salary * (1 + benefits);
    const mCost = loaded / 12;
    const mValue = value / 12;
    const payback = mValue > mCost ? (recruiting + mValue * ramp) / (mValue - mCost) : Infinity;
    const firstYearNet = mValue * Math.max(0, 12 - ramp) - loaded - recruiting;
    const hire = payback <= target;
    const neededValue = target > ramp ? ((recruiting + mCost * target) / (target - ramp)) * 12 : Infinity;
    const paybackText = Number.isFinite(payback) ? `${round1(payback)} months` : "never at these numbers";

    const whatIf = Number.isFinite(neededValue)
      ? hire
        ? `If the ${role} brought in less than ${usd(neededValue)} a year, payback would slip past ${target} months and the answer would flip to waiting.`
        : `If the ${role} brought in more than ${usd(neededValue)} a year, payback would land inside ${target} months and the answer would flip to hiring.`
      : `The payback target of ${target} months is shorter than the ${ramp}-month ramp, so no value meets it.`;

    return {
      recommendedOption: hire ? `Hire the ${role}` : "Wait on this hire",
      recommendation: hire
        ? `Hire the ${role}. They pay for themselves in ${paybackText}, inside the ${target}-month target.`
        : `Don't hire the ${role} yet. Payback is ${paybackText}, past the ${target}-month target.`,
      ask: hire
        ? `Approve a ${role} at ${usd(salary)} base, ${usd(loaded)} a year fully loaded, plus ${usd(recruiting)} to recruit.`
        : `Agree to revisit the ${role} once expected value reaches ${Number.isFinite(neededValue) ? usd(neededValue) : "a level that pays back"} a year.`,
      metrics: [
        { label: "Fully loaded cost", value: `${usd(loaded)} a year` },
        { label: "Payback", value: paybackText },
        { label: "First-year net", value: usd(firstYearNet) },
        { label: "Value needed for target", value: Number.isFinite(neededValue) ? `${usd(neededValue)} a year` : "n/a" },
      ],
      why: [
        `Fully loaded, the ${role} costs ${usd(loaded)} a year plus ${usd(recruiting)} to recruit.`,
        `Once ramped after ${ramp} months, they bring about ${usd(value)} a year.`,
        `That puts payback at ${paybackText} against a ${target}-month target.`,
      ],
      costAndPayback: `${usd(loaded + recruiting)} in the first year. Payback in ${paybackText}; first-year net is ${usd(firstYearNet)} compared with not hiring.`,
      biggestRisk: `The ramp takes longer than ${ramp} months or the value comes in low. Fallback: set a ${Math.round(
        ramp + 3,
      )}-month check on actual results.`,
      changeMyMind: whatIf,
      whatIf,
      preAnswered: [
        {
          q: "Why not a contractor?",
          a: `Compare a contractor's rate with ${usd(mCost)} a month fully loaded, and with what we lose if they leave.`,
        },
        { q: "How sure are we about the value?", a: "It's the least certain number here, so it's the one to watch in the first quarter." },
        { q: "What if they don't work out?", a: `We'd have spent about ${usd(recruiting + mCost * Math.min(ramp + 3, 12))} by the first review.` },
      ],
      spoken: hire
        ? `I recommend we hire the ${role}. It costs ${usd(loaded)} a year fully loaded and pays back in ${paybackText}. The main risk is a slow ramp, so we'll check actual results after ${Math.round(ramp + 3)} months.`
        : `I recommend we wait on the ${role}. At ${usd(loaded)} a year fully loaded, payback is ${paybackText}, past our ${target}-month target. We'd revisit if expected value reaches ${Number.isFinite(neededValue) ? usd(neededValue) : "a higher level"} a year.`,
    };
  },
};

export const TEMPLATES: TemplateDef[] = [buildVsBuy, newHire];

export function getTemplate(id: string): TemplateDef {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}
