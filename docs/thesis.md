# Uprali thesis update: the decision brain, not the dashboard

**One-pager · November 15, 2026 · Aly**

## The thesis in one line

Uprali exists to become the brain that advises companies on business decisions, learned from millions of tracked business cases. Dashboards are a feature, not the moat.

## What the moat is

- **Business-case knowledge and data.** Every case built in Uprali is tracked from assumptions to approval to real outcome.
- **Our own learning environment.** We gather millions of cases and analyze them to find the variables that drove success or failure.
- **Advice, not just reporting.** Uprali points out what to be aware of before a company commits, and suggests detailed execution steps.

## What the moat is not

- **The dashboard.** We should still offer one, but LLMs and BI tools can generate dashboards on request. No one picks a vendor for another dashboard.

## How we get the data: be like jelly

The learning loop only works if Uprali is everywhere decisions happen. So Uprali must be effortless to get into any organization's systems: Claude and ChatGPT plugins, Excel and Google Sheets add-ins, MCP for agents, and integrations into existing tools.

## Why: people build their own dashboards

- Companies already assemble their own combination of dashboards and don't want hundreds more.
- A financial analyst may spend more time inside Uprali itself.
- Most others will see Uprali as one part of their main board. A PM builds a dashboard of product metrics, and Uprali's financials sit inside it.

## What this means for what we build

- Prioritize headless delivery and embeddability over our own UI.
- Capture outcome data on every case, so each decision feeds the learning environment.
- Measure success by cases tracked and outcomes recorded, not time spent in the Uprali app.

## Open questions and proposed answers

### 1. How do we learn across customers' cases while keeping each company's data private?

- **Learn from the structure of a case, not the company's numbers.** Store case type, industry, size band, the assumptions used, how far estimates drifted, and success or failure. Keep raw financials inside each company's own space.
- **Make benchmark sharing opt-in, and give something back.** "See how your build vs buy compares to 200 similar companies" is a strong reason to say yes.
- **Pool data only in groups large enough that no single company can be identified.** Later, the NEAR audit trail can show customers exactly what was shared.
- **Put this in contracts from day one.** It is much harder to add after the fact.

### 2. What is the minimum number of tracked cases before the advice is credible?

- **Count per template and segment, not overall.** A few hundred completed cases per template and segment is a working assumption for pattern-based advice, not a researched figure.
- **Start the brain with expert knowledge.** Use Ruslana's finance judgment, best practices and public benchmarks. Label advice "expert guidance" until it can say "learned from N similar cases."
- **Outcomes are the real bottleneck.** A case only teaches something once its result is known, so build in 90-day and 6-month "did this deliver?" check-ins.

### 3. Which integrations bring in cases fastest?

1. **Claude and ChatGPT plugins:** already the top of the funnel; users get started in minutes.
2. **Excel and Google Sheets add-ins:** analysts already build cases there, so Uprali captures work that is happening anyway.
3. **Slack:** approvals and decisions happen there, which makes it a natural place to record outcomes.
4. **Later, ERP and FP&A tools (NetSuite, Pigment) and BI tools:** slower deals, but richer data, and they deliver the "one panel in their dashboard" view.

Measure each channel by cases created and outcomes recorded per week, and put effort where those numbers are highest.
