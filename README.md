# Uprali: build or buy, decided with proof

**Live app:** LIVE-APP-LINK (add the link) · **Demo video:** DEMO-VIDEO-LINK (add the link) · **Built for:** NEAR Hackathon, Privacy & Private AI track

> **Judging? 30 seconds, no wallet.** Open the live app's **/sample** page. Read a real decision memo where every number shows its source and owner, with the NEAR AI Cloud **Verified** badge. Press **Verify it yourself**: the page works out the fingerprint in your browser and finds it recorded on NEAR testnet (**Match**). Then press **Try to cheat: make building $50,000 cheaper** and watch it turn into **No match**.

Uprali is a private AI financial analyst for one decision teams get wrong all the time: **should we build this tool ourselves, or keep paying for one?**

A working prototype makes building look cheap. It's usually about 20% of the real job. Uprali works out the full multi-year cost of building, including production hardening, integrations, upkeep, security, hosting, on-call, the knowledge lost when the builder leaves, and the core product work that doesn't get done. Then it sets that against the full cost of buying.

- **Every number has a source and an owner.** Each figure in the memo says where it came from, whether a person or an agent stands behind it, and whether it's a fact or an assumption. Anything only a person can answer is marked **needs a human**.
- **The model runs privately.** By default the analyst runs on **NEAR AI Cloud** inside a hardware enclave. Uprali checks the enclave's attestation with a fresh nonce and shows a **Verified** badge. Claude is the fallback. A built-in rule-based analyst means it works with no keys at all.
- **The decision is provable.** Only a SHA-256 fingerprint of the decision goes on **NEAR testnet**, signed by the decision maker's own NEAR wallet. Anyone with the decision file can later prove nothing in it changed.
- **Agents can use it directly.** The same tool is an **MCP server** (for Claude Desktop, Claude Code or any MCP client), a plain **HTTP API** with API keys, and a **Slack app** (`/uprali`).
- **Every decision is kept.** The **History** page lists past decisions with their date, question, recommendation and proof. Open one to see the full memo, or re-run it with changed numbers as a new version of the same decision.

Built for the NEAR Hackathon, **Privacy & Private AI** track.

## Try it in two minutes (no keys needed)

Needs Node 22.18 or later.

1. Run `npm install`, then `npm run dev`. **You should see** `Ready` and http://localhost:3000.
2. Open http://localhost:3000 and press **Continue in demo mode**. (With the ledger contract configured you'd see **Sign in with NEAR wallet** too.)
3. Leave the example question in the box and press **Run the decision**. **You should see** **Buy HubSpot Starter**, the line "A working prototype costs about $12,000, but it's only 20% of the work", a 3-year cost breakdown, and a table where every number has **Human** or **Agent**, **Fact** or **Assumption**, and its source.
4. Press **Record decision**. **You should see** "Recorded on the local demo ledger" and a **Verify this decision** link.
5. Open the link. **You should see** **Match**. Download the snapshot, change one number in it, paste it in and press **Check**. **You should see** **No match**.
6. Open **History**. **You should see** that decision, with **Recorded**. Open it and press **Re-run with new numbers**: the next run is saved as version 2.
7. Run `npm test`. **You should see** `Tests  74 passed`. Run `npm run attest -- --offline`. **You should see** `VERIFIED` with five ✓ checks, then `✓ replay rejected`.

### The same tool from an agent (MCP)

With the app running, add it to Claude Code:

```bash
claude mcp add --transport http uprali http://localhost:3000/mcp
```

Or to Claude Desktop (Settings → Developer → Edit Config), using `mcp-remote`:

```json
{
  "mcpServers": {
    "uprali": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://YOUR-APP.vercel.app/mcp", "--header", "Authorization:${UPRALI_AUTH}"],
      "env": { "UPRALI_AUTH": "Bearer YOUR-API-KEY" }
    }
  }
}
```

Then ask: *"Use Uprali to decide whether we should build our own CRM or keep paying $720 a year for HubSpot Starter. Our prototype took 3 weeks and an engineer costs us $3,800 a week."* **You should see** the agent call `build_vs_buy` and return the memo with its sources, owners and fingerprint. Ask it to record the decision and it calls the tool with `record: true`. `verify_decision` checks a fingerprint or snapshot.

### The same tool over HTTP

```bash
curl -s -X POST localhost:3000/api/v1/build-vs-buy \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR-API-KEY' \
  -d @samples/acme-crm-request.json
```

**You should see** JSON with `memo`, `markdown`, `snapshot`, `fingerprint`, `verifyUrl` and, because the sample sets `"record": true`, `recorded`. The API key header is only needed when `UPRALI_API_KEYS` is set.

| Endpoint | What it does | Key? |
|---|---|---|
| `GET /api/v1/build-vs-buy` | Lists every field the tool takes, with its question and benchmark | No |
| `POST /api/v1/build-vs-buy` | Runs a decision. Body: `question`, `inputs` (by field, each a number, text, or `{value, source, owner, is_assumption}`), `record`, `approved_by`, `decided_by` | Yes |
| `POST /api/v1/decisions/record` | Records a snapshot's fingerprint with the server's relayer account | Yes |
| `POST /api/v1/decisions/verify` | Checks a `snapshot` or a `fingerprint` against the ledger | No |
| `GET /api/v1/decisions` | Past decisions made with this API key, newest first (`?limit=`, `?decision_id=` for one decision's versions) | Yes |
| `GET /api/v1/decisions/{id}` | One past decision in full: memo, the numbers it was given, snapshot | Yes |
| `POST /api/v1/advise` | Suggests existing tools that may cost less. Body: `question`, `answers` (`must_haves`, `seats`, `budget_per_year`, `current_tool`, `integrations`). Every suggestion is labelled "Suggestion, verify". `GET` lists the questions | Yes |
| `GET /api/sample` | The sample decision for judges, already recorded | No |
| `GET /api/attestation` | Fetches NEAR AI Cloud's attestation report with a fresh nonce and checks it | No |
| `GET /api/config` | Shows what's configured, never a secret | No |
| `/mcp` | MCP server with `build_vs_buy`, `suggest_tools`, `verify_decision` and `list_decisions` | Yes |

`POST /api/v1/build-vs-buy` and the MCP `build_vs_buy` tool also take `parent_id`: the run id of an earlier decision, to re-run it with changed numbers as its next version. Agent history is kept per API key, so it needs `UPRALI_API_KEYS` set; with an open API nothing is kept.

## Demo script (about 2 minutes)

The full script, with the shot list and the words to say, is in the Claude Doc "Uprali NEAR hackathon demo script". In short:

1. **The question (15 s).** "Our engineer built a CRM prototype in three weeks. Do we build our own, or keep paying for HubSpot?"
2. **The memo (30 s).** Run it signed in with a NEAR wallet. Show the **NEAR AI Cloud: Verified** badge, the prototype trap, and the table where every number has a source and an owner.
3. **The proof (30 s).** **Sign and record**, open the transaction, then **Verify**: **Match**. Try to cheat: **No match**.
4. **Agents and Slack (30 s).** The same question from Claude Desktop through MCP, then `/uprali` in Slack.
5. **History (15 s).** The History page: every decision kept, re-run as a new version.

## Uprali for Slack

An extra on top of the hackathon build: people type `/uprali` and a build or buy question in any Slack channel.

- Uprali answers in the channel with the 3-year cost of each side, why, the prototype trap, and how many numbers came from people versus the analyst's benchmarks.
- The numbers only a person can give show as boxes in the message. Anyone types a number and presses Enter, and the decision updates, with that number owned by them.
- **Approve** adds the person to the decision's approvers. **Record on NEAR** records the fingerprint through the relayer and adds a **Verify this decision** link.
- Every request from Slack is checked against the app's signing secret and refused if it's older than 5 minutes. Replies go to the request's own Slack reply address (only `hooks.slack.com` is accepted), so the app only needs the `commands` permission and keeps no workspace tokens or messages. The decision's state lives in the message itself.
- It stays off until `SLACK_SIGNING_SECRET` is set, so it can't affect the rest of the app.
- `@Uprali` mentions aren't included: they need a stored token per workspace, so a database.

**Setting it up (for Aly, about 10 minutes):**

1. Open `/slack` on the live app and press **Copy the manifest**. It already has the live app's address in it. (`slack/manifest.json` in the repo is the same, with `YOUR-APP` to replace.)
2. At api.slack.com/apps press **Create New App**, then **From a manifest**, pick your test workspace, choose **JSON**, paste, and press **Create**.
3. On the app's **Basic Information** page copy **Client ID**, **Client Secret** and **Signing Secret** into Vercel as `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`, then redeploy.
4. Open `/slack` again and press **Add to Slack**, then **Allow**. **You should see** "Added to" your workspace's name.
5. In any channel type `/uprali help`, then the example CRM question.
6. To let other workspaces install it: in the Slack app, open **Manage Distribution**, tick the checklist and press **Activate Public Distribution**. Then anyone can use the **Add to Slack** button on `/slack`.

## Advice and voice

- **The form.** Numbers are grouped: **Buy an existing tool** (which product and plan, its yearly subscription for every seat, setup, price rises, admin time) and **Build it yourself** (prototype, engineer cost, integrations, upkeep), with a line under each box saying what goes in it.
- **Advice before you decide.** Press **Not sure what to buy? Get advice first** and answer five questions: what it must do, how many people use it, the budget, what you use today and what it must connect to. Uprali suggests two to four existing tools that may cover that for less, cheapest first, with a rough price per seat, what each covers and what it may not. The model runs privately on NEAR AI Cloud when it's set up; with no model it uses a rough built-in list.
- **Suggestions are never facts.** Every suggested tool, price and line of advice carries a **Suggestion, verify** tag. Press **Compare this one** to fill the buy fields with it; those numbers go into the memo as the agent's, with the same tag and the source "verify the price on the vendor's site". Typing over a field makes it yours again.
- **Voice.** A mic button on the decision box and on each advisor question uses the browser's own speech recognition (Chrome, Edge, Safari). **Read it aloud** reads the memo's 30-second version. Agents get the same advice through the MCP tool `suggest_tools`.

## Decision history

Every decision is saved with its memo, the numbers it was given, its snapshot, fingerprint and whether it was recorded. Open **History** in the app to see them.

- **Whose history.** A NEAR account counts once it confirms it's you: a free signed message (NEP-413) from a full-access key, checked on NEAR, with nothing sent on chain. Until then runs belong to this browser and move to the account when it confirms. Slack runs belong to the Slack user (`/uprali history` shows your last 10, only to you). API and MCP runs belong to the API key.
- **Re-run.** Open a decision and press **Re-run with new numbers**. The new run keeps the decision id and takes the next version, linked to the one before. The older version stays as it was.
- **Where it's kept.** In Postgres when `POSTGRES_URL` or `DATABASE_URL` is set (Vercel's Neon or Supabase integration sets one). The table `uprali_decisions` is made on first use. With no database it's kept in the server's memory, which resets on restart, and the page says so.
- **What's kept.** Decision memos only, never chat transcripts. You can delete any decision from your history; its fingerprint stays on the ledger.

## How the decision is worked out

Every dollar figure is computed in code (`src/lib/engine/buildVsBuy.ts`). Models only do two narrow jobs: read stated facts out of the question, and write the risk, CFO questions and 30-second summary.

**Buy:** subscription each year, rising by the vendor's yearly price increase (benchmark 7%), plus one-time setup (benchmark 10% of year one) and admin time.

**Build:**

| Cost line | How |
|---|---|
| Working prototype | prototype engineer-weeks × cost of an engineer-week |
| Making it production-ready | the prototype is ~20% of the work, so the full build is prototype weeks ÷ 20%, minus the prototype |
| Integrations | number of integrations × engineer-weeks each |
| Upkeep | ~20% of the build cost every year |
| Security and compliance | a yearly budget |
| Hosting | a yearly budget |
| On-call | hours a week × 52 × hourly cost |
| Knowledge lost if the builder leaves | yearly chance they leave (~15%) × engineer-weeks to take over |
| Core product work not done | engineer-weeks spent on the build × how much more core work returns than it costs (~50%) |

The memo also gives the subscription price at which buying stops being cheaper, and the inputs that would flip the answer and at what value.

**Return on investment, against keeping things as they are.** The rules come from Aly's finance playbook (`src/lib/engine/value.ts`):

- Three options: keep things as they are (the baseline, no new spend and no new benefit), buy, and build.
- Cash and freed-up time are kept apart. Only savings Finance confirms count as cash, for **net ROI** and **payback**. The value of time people get back (hours a year × time saved × adoption × hourly cost) is capacity, not cash; it shows only in **gross ROI**.
- Spend is incremental: what each option costs minus what you pay today for the job.
- Benefits start after time to value (about 3 months to roll out a bought tool, the build's length for a build), so year 1 counts only the months after launch.
- Opportunity cost (the project that waits while you build) is recorded with the decision, but kept out of ROI and payback.
- Payback is interpolated inside the year cumulative cash turns positive. Past 36 months it reads "Beyond 36 months", with no number.
- Conservative, base and optimistic scenarios halve or raise time saved and adoption (for example 10%/60%, 20%/80%, 30%/90%).
- A missing input is never treated as zero: the memo lists what the ROI case still needs, and these inputs never block the cost comparison.
- If confirmed cash is given and neither option pays back within 36 months, and nobody says the return is strategic or risk (or freed-up time doesn't carry it), the recommendation is **Not now: keep things as they are**.

The memo then runs the CFO funding check (reduces a major cost driver, protects downside, improves retention or pricing, has a leading indicator), the reasons for "not now" (no causal link, diffuse benefit, heavy upkeep, cannibalizing a higher-margin line, added complexity), and sets **kill criteria**: the metric that must move, the minimum effect, the date to check by, the owner who can stop it, and the fallback. The playbook's worked example is a regression test (`tests/value.test.ts`).

**Where each number comes from**, in order: a value the caller gave (with its own source and owner), a fact stated in the question (owner: human, source: the quote), or a labelled benchmark (owner: agent, assumption, low confidence). Numbers with no sensible benchmark, like the subscription price or the prototype time, stay empty and are marked **needs a human**. A memo is **complete** when no number still needs a human, **draft** when some do, and **needs a human** when it can't be computed yet. A decision that needs a human can't be recorded.

**Guards on the models.** An extracted fact is kept only if its quote is really in the question and its number really is in the quote. Prose from a model is kept only if every dollar amount in it is one the engine computed; otherwise the built-in wording is used. Instructions inside the question are ignored.

## Privacy

| What | Where it goes |
|---|---|
| The question and the numbers | To the model for one request (NEAR AI Cloud's enclave by default). The model keeps nothing. The server logs only error types. |
| The memo and the snapshot | Returned to the caller, and kept in the owner's history (memo, the numbers given, snapshot, fingerprint) so it can be opened and re-run. Only the owner can list or open it. No chat transcripts are kept. |
| On chain | Only the SHA-256 fingerprint, the kind (`decision`), the decision id, the version, the signer's account and the block time. |

**NEAR AI Cloud attestation** (`src/lib/attest.ts`). Uprali asks NEAR AI Cloud for its attestation report with a fresh random nonce and checks five things: the report is for the model in use, it echoes the nonce (so it isn't replayed), it contains an Intel TDX quote, the quote's report data binds the enclave's signing key and the nonce, and NVIDIA GPU evidence is present and bound to the same nonce. **Not checked here:** the Intel and NVIDIA signature chains themselves, and whether the enclave's code hash is one you expect. Those need Intel's and NVIDIA's own verification services. The badge says **Verified** only when all five checks pass and the model really was NEAR AI.

## NEAR ledger contract

`contract/` is a small Rust contract (near-sdk 5.5):

- `record(hash, kind, case_id, version)` stores an anchor and refuses the same fingerprint twice, so a record can never be overwritten. It emits a NEP-297 style event.
- Recording is **open**, so any wallet can sign its own decisions and appears as `recorded_by`. The owner can close it to the owner and an allowlist with `set_open(false)` and `add_writer`.
- `get(hash)`, `count()`, `owner()`, `is_open()`, `is_writer(account_id)` are free reads.

`npm run contract:test` runs its 8 tests. `npm run contract:build` builds `contract/res/uprali_ledger.wasm` (Rust 1.81). `npm run contract:deploy` creates `ledger.<your account>` on testnet, funds it with 3 NEAR, deploys the wasm and initialises it, all in one transaction. It refuses anything but testnet.

## Setting it up for the live demo (for Aly)

You don't need to touch code. Each step is a few clicks; the terminal steps can be done by anyone you trust with a laptop.

1. **GitHub.** The code lives in the public repo `aly-coding/uprali-mvp`.
2. **NEAR AI Cloud key.** Sign up at NEAR AI Cloud and create an API key. Keep it to yourself: you'll paste it into Vercel in step 5, never into a chat.
3. **A NEAR testnet wallet for you.** Done: you made `uprali.testnet` in Intear Wallet. Meteor Wallet also works on testnet. It doesn't need any testnet NEAR: it only signs in and becomes the ledger's owner.
4. **The ledger, from your browser (2 minutes, no terminal, no testnet NEAR).** Open the live app at `/setup`.
   - Press **Sign in with NEAR wallet** and sign in as `uprali.testnet`, or just type `uprali.testnet` in **Owner account**.
   - Press **Create the ledger**. There's nothing to approve: NEAR's testnet faucet service (the one `near-cli`'s `sponsor-by-faucet-service` uses, no CAPTCHA) creates and funds two new accounts, `uprali-ledger-<code>.testnet` for the contract and `uprali-relayer-<code>.testnet` for recording. Our server passes on only their public keys; the keys themselves are made in your browser and never leave it.
   - The page then puts the contract on the ledger account and deletes its only key, so nobody can change it. It swaps the relayer's key for one that can only record decisions, with up to 1 NEAR of fees.
   - If it stops partway, press the button again; it picks up where it stopped.
   - **You should see** six lines to copy. Press **Copy all six**.
5. **Vercel.** In the Vercel project, open **Settings → Environment Variables**, click into the first **Key** box and paste: Vercel splits the six lines into six rows (`NEAR_NETWORK`, `NEAR_CONTRACT_ID`, `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`, `RECORD_ACCESS_CODE`, `UPRALI_API_KEYS`). Keep **Production** ticked and press **Save**. `NEARAI_API_KEY` from step 2 should already be there. `ANTHROPIC_API_KEY` is optional, so Claude can step in if NEAR AI is down.

   Then open **Deployments**, open the menu on the top one and press **Redeploy**. Back on `/setup`, press **I've saved them in Vercel**. Open the app: you should see **Sign in with NEAR wallet**, and `/api/config` should list `nearai` first.

   `RECORD_ACCESS_CODE` is the fallback for a live demo: if a wallet won't sign in, press **Continue in demo mode**, type that code next to **Record decision**, and the relayer records it on testnet. `UPRALI_API_KEYS` is the key agents use for `/mcp` and `/api/v1`.

   For engineers: `npm run contract:deploy` does the same from a terminal with your own testnet key.
6. **Database for the history (3 minutes).** In the Vercel project, open the **Storage** tab, press **Create Database** (or **Browse Marketplace**), pick **Neon** (or **Supabase**) on the free plan, and connect it to this project for **Production**. Vercel adds the database address as an environment variable by itself. Then **Redeploy**. **You should see** on the **History** page: "Saved in this app's database." Nothing else to set: the app makes its own table.
7. **Submit.** Post the demo video on X, then submit the repo, the live link and the post in the hackathon form before **Nov 14, 2026 at 23:59 UTC (3:59 PM Pacific)**.

## Environment variables

See `.env.example`. Everything is optional; with nothing set Uprali runs in demo mode.

| Variable | What it's for |
|---|---|
| `NEARAI_API_KEY`, `NEARAI_BASE_URL`, `NEARAI_MODEL` | Private inference on NEAR AI Cloud (default `zai-org/GLM-5.1-FP8`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude fallback (default `claude-opus-5-5`, with Anthropic's server-side fallbacks on) |
| `LLM_PROVIDER` | `demo` forces the built-in analyst; `anthropic` tries Claude first |
| `UPRALI_API_KEYS` | Comma-separated API keys for `/mcp` and `/api/v1` |
| `PUBLIC_BASE_URL` | Address used in verify links (Vercel's is picked up automatically) |
| `NEAR_CONTRACT_ID`, `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`, `NEAR_RPC_URL` | Ledger contract and the relayer agents record through (testnet only) |
| `RECORD_ACCESS_CODE` | Lets the demo screen record through the relayer without a wallet when this code is typed |
| `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Uprali for Slack (see `/slack`) |
| `POSTGRES_URL` or `DATABASE_URL` | Postgres for decision history (set by Vercel's Neon or Supabase integration). Without it, history is kept in memory |
| `SESSION_SECRET` | Optional: signs the history sign-in cookie. Without it, a key is derived from the database address |

## What's tested, and what isn't yet

Tested here: the cost model, where each number comes from, the extraction and prose guards, fallback from NEAR AI to the built-in analyst, API keys, the HTTP API end to end (decide, record, verify, tamper detection), the MCP server (`tools/list` and `build_vs_buy`), the attestation checks against a synthetic report (`npm test`, 84 tests, including the advisor's suggestions and their labels, including decision history against a real Postgres (set `TEST_DATABASE_URL` to run those) and in memory, NEP-413 sign-in with real ed25519 signatures and the chain lookup faked, owners only seeing their own runs, re-runs as versions, `list_decisions` per API key, the sample decision's Match and No match, the return-on-investment rules against the playbook's worked example, recording through the relayer with the access code and no wallet, and the Slack app's signature checks, command, buttons and install with Slack faked), the contract (`npm run contract:test`, 8 tests), a production build, and a curl run of the API and MCP server in demo mode.

**Not tested yet**, because this build machine can't reach NEAR or NEAR AI: live NEAR AI Cloud calls and its live attestation report, live Claude calls, the contract deploy script and recording on testnet, wallet sign-in and signing in a real browser, the `/setup` page's faucet request and contract deploy, the sample decision recorded on testnet, a wallet's sign-in message for history, and the Slack app against real Slack. Run the demo script once on the live deploy before recording the video.

`npm audit` reports one high finding left in Meteor Wallet's SDK (`decode-uri-component` under `query-string` 7). The SDK only calls `stringify`, never the decoder the advisory is about, and the newer `query-string` breaks its import, so it stays until Meteor updates.

## Project layout

```
src/lib/engine/      decision engine: cost model, extraction and narration, providers, snapshot, markdown
src/lib/attest.ts    NEAR AI Cloud attestation checks
src/lib/ledger/      NEAR ledger client and the local demo ledger
src/lib/service.ts   shared by the API, MCP server and demo screen
src/lib/history.ts   decision history: Postgres, or memory when no database is set
src/lib/identity.ts  whose history: NEAR sign-in message (NEP-413), browser, Slack user, API key
src/lib/sample.ts    the sample decision for judges
src/app/mcp/         MCP server
src/app/api/         HTTP API, and Slack under api/slack
src/lib/slack/       Uprali for Slack: signatures, messages, install
slack/manifest.json  Slack app manifest
src/components/      demo screen, wallet sign-in (Intear, Meteor), memo, verify page, /setup page
src/lib/setup.ts     helpers for the no-terminal ledger setup
public/              the built contract, served for /setup
contract/            Rust ledger contract
scripts/             contract build and deploy, attestation check
samples/             fictional example data
```

MIT licensed.
