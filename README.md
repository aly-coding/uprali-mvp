# Uprali: the verifiable approval layer for agent spending

**Live app:** LIVE-APP-LINK (add the link) · **Demo video:** DEMO-VIDEO-LINK (add the link) · **Built for:** NEAR Hackathon, Privacy & Private AI track

> **Judging?** See [For judges](#for-judges). On the live app you sign in with a **NEAR testnet** wallet, run a decision, record it on NEAR, and check it in History: **Match**, with a link to the transaction. Running it locally needs no wallet and no keys (demo mode, below).

**Uprali is the verifiable approval layer for agent spending.** Before an agent buys a tool or builds one, it asks Uprali. Uprali gives it a decision memo where every number has a source and an owner, waits for a person to sign off, and records a proof of the decision on NEAR. The analysis runs privately on **NEAR AI Cloud**, so company finances never leave a verified enclave.

Agents are starting to spend company money: subscriptions, seats, vendors, build time. Finance teams can't approve what they can't check. Uprali makes each spend decision checkable: what the numbers were, who stood behind each one, who approved it, and proof that nothing changed afterwards.

The first decision it covers in depth is the one teams get wrong all the time: **should we build this tool ourselves, or keep paying for one?** A working prototype makes building look cheap. It's usually about 20% of the real job. Uprali works out the full multi-year cost of building, including production hardening, integrations, upkeep, security, hosting, on-call, the knowledge lost when the builder leaves, and the core product work that doesn't get done. Then it sets that against the full cost of buying.

- **Memo, sign-off, proof.** An agent calls the `build_vs_buy` or `business_case` tool and gets a memo. Anything only a person can answer is marked **needs a human**, and a decision that still needs a human can't be recorded. A person approves it, and its fingerprint goes on NEAR with the approver's name in it.
- **Every number has a source and an owner.** Each figure in the memo says where it came from, whether a person or an agent stands behind it, and whether it's a fact or an assumption. Anything only a person can answer is marked **needs a human**.
- **The model runs privately.** By default the analyst runs on **NEAR AI Cloud** inside a hardware enclave. Uprali checks the enclave's attestation with a fresh nonce and shows a **Verified** badge. Claude is the fallback. A built-in rule-based analyst means it works with no keys at all.
- **The decision is provable.** Only a SHA-256 fingerprint of the decision goes on **NEAR testnet**, signed by the decision maker's own NEAR wallet. Anyone with the decision file can later prove nothing in it changed.
- **Agents can use it directly.** The same tool is an **MCP server** (for Claude Desktop, Claude Code or any MCP client), a plain **HTTP API** with API keys, and a **Slack app** (`/uprali`).
- **Every decision is kept.** The **History** page lists past decisions with their date, question, recommendation and proof. Open one to see the full memo, or re-run it with changed numbers as a new version of the same decision.

- **Four decision templates.** Build vs buy is the deepest. Three business cases sit beside it: **Launch a new product**, **Go-to-market expansion** and **AI investment ROI**. Each groups its drivers into the cards of the people who own them (Product, Sales, Finance and so on), each card shows its formula, and each case gets a 3-year model with **Model**, **Unit Economics**, **Summary P&L** and **Scenarios** tabs, plus net present value, return on investment and payback.

**Next step:** settle approved spend with **NEAR Intents**, so the payment an agent makes is tied to the decision that approved it.

Built for the NEAR Hackathon, **Privacy & Private AI** track.

## Templates

| Template | What it decides | Example result |
|---|---|---|
| Build vs buy | Build the tool ourselves or keep paying for one | Buy HubSpot Starter |
| Launch a new product | Revenue from customers × price against build and running costs | Go |
| Go-to-market expansion | New-market revenue against reps, launch and support costs, with a ramp | Go, with a negative downside |
| AI investment ROI | Seats and rollout against time saved | Pilot first |

AI investment keeps **cash** apart from **freed-up time**. Time saved only counts as cash when Finance says how much of it becomes cash, and an estimated baseline (not measured) is cut by 30% until someone measures it. So a case built only on a vendor's claim comes out as **Pilot first**, never as savings.

The models only read the numbers stated in the question and write the prose. Code works out every figure. Scenarios move only the key drivers by 20% in each direction; assumptions stay as they are. Every case memo is fingerprinted, recorded, kept in history and verified the same way as build vs buy.

## Measured on the example cases

Run `npm run measure` to get these yourself. It runs each template's example question (the one in the app's box) 20 times and reads the memo. Measured on Nov 8, 2026, on the build machine, with the **built-in analyst**, because that machine can't reach NEAR AI Cloud. With `NEARAI_API_KEY` set the same command measures the live NEAR AI path (3 runs each).

| Template | Median time, question to memo | Numbers in the memo | With a source and owner | Flagged **needs a human** | Labelled benchmarks |
|---|---|---|---|---|---|
| Buy vs Build | about 2 ms | 30 | 30 | 2 | 17 |
| Launch a new product | under 1 ms | 11 | 11 | 3 | 8 |
| Go-to-market expansion | under 1 ms | 11 | 11 | 1 | 8 |
| AI investment ROI | under 1 ms | 13 | 13 | 1 | 8 |

- **Every number has a source and an owner:** 65 of 65 across the four cases.
- **What it refuses to guess** on the examples: the cost of an engineer-week and the value lost on the core product (Buy vs Build); growth in new customers, the cost to acquire a customer and the team to run it (new product); setup cost (go-to-market); the share of saved time that becomes cash (AI ROI). Each memo comes back as a **draft** until a person fills those in.
- The times are the engine's own work. A run on NEAR AI Cloud adds the model calls on top, and that hasn't been measured yet.

## For judges

The live app uses **NEAR wallet sign-in**, so each decision you make is saved to your history and recorded on NEAR under your own account.

1. Open the live app and press **Connect NEAR wallet** (step 1 on the first page). Pick Intear or Meteor.
2. Pick **Buy vs Build**, keep the example question and press **Run the decision**. **You should see** the memo, where every number shows its source and owner.
   Ran a decision before signing in? Press **Connect NEAR wallet to save** under the result: you come straight back to it, then press **Sign and record**. The live site never saves to a throwaway ledger.
3. Press **Sign and record as** your account and approve in the wallet. **You should see** "Recorded on NEAR testnet" and **See the transaction on the NEAR explorer**.
4. Press **See it in History**, open the decision and press **Verify**. **You should see** **Match**. Press **Try to cheat: make building $50,000 cheaper** and it turns into **No match**.

**Only have a mainnet account (name.near)?** Uprali records on NEAR testnet, where mainnet accounts don't exist. Making a free testnet account takes about a minute:

1. Open [wallet.near.org](https://wallet.near.org) and pick **Intear Wallet** (Meteor works too).
2. Switch the wallet to **testnet** and create a name that ends in **.testnet**.
3. Save the recovery phrase it shows you.
4. Come back to Uprali and press **Connect NEAR wallet**.

The app spots a `.near` account at sign-in and shows the same steps. If something doesn't work, `/api/health` lists what's set up on the server (setting names only, never values).

## Try it in two minutes (no keys needed)

Needs Node 22.18 or later.

1. Run `npm install`, then `npm run dev`. **You should see** `Ready` and http://localhost:3000.
2. Open http://localhost:3000 and press **Continue in demo mode**. (This shows only when running locally. The live site always starts with **Connect NEAR wallet**.)
3. Pick **Build vs buy**, leave the example question in the box and press **Run the decision**. **You should see** **Buy HubSpot Starter**, the line "A working prototype costs about $12,000, but it's only 20% of the work", a 3-year cost breakdown, and a table where every number has **Human** or **Agent**, **Fact** or **Assumption**, and its source.
4. Press **Record decision**. **You should see** "Recorded on the local demo ledger" and a **Verify this decision** link.
5. Open the link. **You should see** **Match**. Download the snapshot, change one number in it, paste it in and press **Check**. **You should see** **No match**.
6. Open **History**. **You should see** that decision, with **Recorded**. Open it and press **Re-run with new numbers**: the next run is saved as version 2.
7. Press **+ New case**, pick **AI investment ROI** and press **Build the case**. **You should see** **Pilot first**, the owner cards with their formulas, and the model in the panel on the right.
8. Run `npm test`. **You should see** `Tests  107 passed`. Run `npm run attest -- --offline`. **You should see** `VERIFIED` with five ✓ checks, then `✓ replay rejected`.

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
| `GET /api/v1/templates` | Lists every template with its owner cards and fields | No |
| `GET /api/v1/business-case` | Lists the four business-case templates and their fields | No |
| `POST /api/v1/business-case` | Builds a business case. Body: `template` (`new_product`, `gtm_expansion`, `ai_investment`), `question`, `inputs` (that template's fields only), `record`, `approved_by`, `decided_by`, `parent_id` | Yes |
| `POST /api/v1/decisions/record` | Records a snapshot's fingerprint with the server's relayer account | Yes |
| `POST /api/v1/decisions/verify` | Checks a `snapshot` or a `fingerprint` against the ledger | No |
| `GET /api/v1/decisions` | Past decisions made with this API key, newest first (`?limit=`, `?decision_id=` for one decision's versions) | Yes |
| `GET /api/v1/decisions/{id}` | One past decision in full: memo, the numbers it was given, snapshot | Yes |
| `POST /api/v1/advise` | Suggests existing tools that may cost less. Body: `question`, `answers` (`must_haves`, `seats`, `budget_per_year`, `current_tool`, `integrations`). Every suggestion is labelled "Suggestion, verify". `GET` lists the questions | Yes |
| `GET /api/health` | What's set up on the server: NEAR settings (names only), whether the ledger contract answers, NEAR AI and the database | No |
| `GET /api/attestation` | Fetches NEAR AI Cloud's attestation report with a fresh nonce and checks it | No |
| `GET /api/config` | Shows what's configured, never a secret | No |
| `/mcp` | MCP server with `build_vs_buy`, `business_case`, `list_templates`, `suggest_tools`, `verify_decision` and `list_decisions` | Yes |

`POST /api/v1/build-vs-buy` and the MCP `build_vs_buy` tool also take `parent_id`: the run id of an earlier decision, to re-run it with changed numbers as its next version. Agent history is kept per API key, so it needs `UPRALI_API_KEYS` set; with an open API nothing is kept.

## Demo script (about 2 minutes)

The full script, with the shot list and the words to say, is in the Claude Doc "Uprali NEAR hackathon demo script". In short:

1. **The question (15 s).** "Our engineer built a CRM prototype in three weeks. Do we build our own, or keep paying for HubSpot?"
2. **The memo (30 s).** Run it signed in with a NEAR wallet. Show the **NEAR AI Cloud: Verified** badge, the prototype trap, and the table where every number has a source and an owner.
3. **The proof (30 s).** **Sign and record**, open the transaction, then **Verify**: **Match**. Try to cheat: **No match**.
4. **Agents and Slack (30 s).** The same question from Claude Desktop through MCP, then `/uprali` in Slack.
5. **History (15 s).** The History page: every decision kept, re-run as a new version.

## Uprali for Slack

People ask **@uprali-mvp** in a channel, message it directly, or type `/uprali`, with any business decision: build vs buy, a new product, a go-to-market expansion or an AI investment.

- It picks the template from the question. A prefix makes it certain: `bvb:`, `product:`, `gtm:` or `ai:`. When the question isn't clear, it asks which kind of decision it is, with a button for each.
- It answers in a thread with the 3-year result (net cash, NPV, ROI, payback), the year-by-year numbers, the scenarios, why, and the biggest risk. The numbers it estimated itself are marked **Suggestion, verify**.
- The numbers only a person can give show as boxes in the message. Anyone types a number and presses Enter, and the decision updates, with that number owned by them.
- **Approve** adds the person to the decision's approvers. **Record on NEAR** records the fingerprint through the relayer and adds a **Verify this decision** link. Every run is kept in history; `/uprali history` shows your last 10.
- Every request from Slack is checked against the app's signing secret and refused if it's older than 5 minutes. Retries and repeated events are ignored. The decision's state lives in the message itself.
- Mentions and direct messages need the bot's token. It's kept encrypted after **Add to Slack**, or set as `SLACK_BOT_TOKEN`. The app asks Slack for `commands`, `app_mentions:read`, `chat:write` and `im:history` only.
- It stays off until `SLACK_SIGNING_SECRET` is set, so it can't affect the rest of the app.

**Setting it up or updating it (for Aly, about 10 minutes):**

1. Open `/slack` on the live app and press **Copy the manifest**. It already has the live app's address in it. (`slack/manifest.json` in the repo is the same, with `YOUR-APP` to replace.)
2. At api.slack.com/apps open the **uprali-mvp** app (or press **Create New App**, then **From a manifest**), open **App Manifest**, paste, and press **Save**. Slack checks the events address and should say **Verified**.
3. On **Basic Information** make sure **Client ID**, **Client Secret** and **Signing Secret** are in Vercel as `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`.
4. Press **Reinstall to Workspace** (or **Install**), then **Allow**.
5. On **OAuth & Permissions** copy the **Bot User OAuth Token** (it starts with `xoxb-`) into Vercel as `SLACK_BOT_TOKEN`, then redeploy.
6. In a channel type `/invite @uprali-mvp`, then `@uprali-mvp should we build our own CRM or keep HubSpot?`. **You should see** a reply in the thread with the 3-year result, estimates marked **Suggestion, verify**, boxes for missing numbers, and **Approve** and **Record on NEAR**.

## Advice

- **The form.** Numbers are grouped: **Buy an existing tool** (which product and plan, its yearly subscription for every seat, setup, price rises, admin time) and **Build it yourself** (prototype, engineer cost, integrations, upkeep), with a line under each box saying what goes in it.
- **Advice before you decide.** Press **Not sure what to buy? Get advice first** and answer five questions: what it must do, how many people use it, the budget, what you use today and what it must connect to. Uprali suggests two to four existing tools that may cover that for less, cheapest first, with a rough price per seat, what each covers and what it may not. The model runs privately on NEAR AI Cloud when it's set up; with no model it uses a rough built-in list.
- **Suggestions are never facts.** Every suggested tool, price and line of advice carries a **Suggestion, verify** tag. Press **Compare this one** to fill the buy fields with it; those numbers go into the memo as the agent's, with the same tag and the source "verify the price on the vendor's site". Typing over a field makes it yours again.
- **Voice (coming next, off for now).** A mic button and **Read it aloud** are built on the browser's own speech tools but are switched off for the hackathon, because they weren't checked in a real browser in time. Set `NEXT_PUBLIC_UPRALI_VOICE=on` to try them. Agents get the same advice through the MCP tool `suggest_tools`.

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

What Uprali keeps, and where. The code was checked against this list (see the files named).

| What | Where it goes | Kept? |
|---|---|---|
| The question and the numbers | Sent for one request to the analyst model: by default **NEAR AI Cloud**, inside an attested Intel TDX and NVIDIA GPU enclave (`src/lib/engine/providers.ts`). | Not by the Uprali server's model calls. Uprali keeps no prompt or model reply on its own. |
| If NEAR AI is down | Only if `ANTHROPIC_API_KEY` is set, the same request goes to Claude instead. The memo then says which model ran and the badge does **not** say Verified. With neither key, the built-in analyst runs on the server and nothing leaves it. | Same as above. |
| The memo, the question, the numbers given, the snapshot and fingerprint | **Postgres** (`src/lib/history.ts`), so the owner can open and re-run a decision. | Yes, until the owner deletes it. Only the owner can list or open it: the NEAR account that signed in (NEP-413 signed message), or before sign-in this browser's random cookie id, the Slack user, or the API key. |
| On chain (NEAR testnet) | Only the SHA-256 fingerprint, the kind (`decision`), the decision id, the version, the signer's account and the block time (`contract/`). | Yes, for good. No numbers or text from the memo. The decision id is a random one like `UP-20261108-3fa9c1d2`, unless an API caller sets its own. |
| Server logs | Only error types and codes, never messages, questions or numbers (`src/lib/service.ts`, `src/lib/history.ts`). | Vercel's own request logs (address, path, status). The rate limit keeps request times per IP address in memory for a few minutes (`src/lib/ratelimit.ts`). |
| In your browser | The snapshot of a decision you ran, so **Verify** can check it (`localStorage`). | Until you clear it. |
| Slack | A Slack bot token, encrypted, if the app was installed with **Add to Slack** (`src/lib/slack/tokens.ts`). The decision's state lives in the Slack message itself. | Yes, encrypted. |
| Voice (off by default) | Uses the browser's own speech recognition, which some browsers send to their maker's speech service. Off unless `NEXT_PUBLIC_UPRALI_VOICE=on`. | Not by Uprali. |

Uprali keeps no chat transcripts. Unlike a stateless demo, it does keep decision history on the server, because a decision someone approved has to be opened again later. That history is visible only to its owner, and deleting a decision removes it from the database (its fingerprint stays on NEAR, which reveals nothing about it).

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
   - Press **Connect NEAR wallet** and sign in as `uprali.testnet`, or just type `uprali.testnet` in **Owner account**.
   - Press **Create the ledger**. There's nothing to approve: NEAR's testnet faucet service (the one `near-cli`'s `sponsor-by-faucet-service` uses, no CAPTCHA) creates and funds two new accounts, `uprali-ledger-<code>.testnet` for the contract and `uprali-relayer-<code>.testnet` for recording. Our server passes on only their public keys; the keys themselves are made in your browser and never leave it.
   - The page then puts the contract on the ledger account and deletes its only key, so nobody can change it. It swaps the relayer's key for one that can only record decisions, with up to 1 NEAR of fees.
   - If it stops partway, press the button again; it picks up where it stopped.
   - **You should see** six lines to copy. Press **Copy all six**.
5. **Vercel.** In the Vercel project, open **Settings → Environment Variables**, click into the first **Key** box and paste: Vercel splits the six lines into six rows (`NEAR_NETWORK`, `NEAR_CONTRACT_ID`, `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`, `RECORD_ACCESS_CODE`, `UPRALI_API_KEYS`). Under **Environments**, tick **Production** and **Preview**, then press **Save**. `NEARAI_API_KEY` from step 2 should already be there. `ANTHROPIC_API_KEY` is optional, so Claude can step in if NEAR AI is down.

   Then open **Deployments**, open the menu on the top one and press **Redeploy**. Back on `/setup`, press **I've saved them in Vercel**. Open the app: you should see step 1, **Connect NEAR wallet**, and `/api/config` should list `nearai` first.

   `RECORD_ACCESS_CODE` is the fallback for a live demo: if a wallet won't sign in, run the decision, open **Have the demo access code instead?** under the result, type the code and the relayer records it on testnet. `UPRALI_API_KEYS` is the key agents use for `/mcp` and `/api/v1`.

   For engineers: `npm run contract:deploy` does the same from a terminal with your own testnet key.
6. **Database for the history (3 minutes).** In the Vercel project, open the **Storage** tab, press **Create Database** (or **Browse Marketplace**), pick **Neon** (or **Supabase**) on the free plan, and connect it to this project for **Production** and **Preview**. Vercel adds the database address as an environment variable by itself. Then **Redeploy**. **You should see** on the **History** page: "Saved in this app's database." Nothing else to set: the app makes its own table.
7. **Submit.** Post the demo video on X, then submit the repo, the live link and the post in the hackathon form before **Nov 14, 2026 at 23:59 UTC (3:59 PM Pacific)**.

## Plan

- **Who buys it.** Finance teams and CFOs who have to approve AI and agent spending: tools, seats, vendors and build time. Next to them, the people who ask for that spend (product managers, engineers, team leads), so every request reaches Finance as a checkable memo.
- **How people find it.** A free plugin inside the AI assistants teams already use (Claude and ChatGPT), with one free template. It signs in to an Uprali account with a work email, and the first 30 days are free with every template.
- **Paid tiers.**
  - **Basic:** the 3 main templates and a monthly number of decisions. Price: **[PRICE: Aly to fill in]**.
  - **Executive:** priced per seat, with every template, integrations and unlimited decisions. Price: **[PRICE: Aly to fill in]**.
  - **Enterprise:** sales-led, starting from a demo, set up around the customer's own approval rules.
- **Traction so far.** **[NUMBER: Aly to fill in]** customer interviews and **[NUMBER: Aly to fill in]** design partners.
- **Next on NEAR.** Settle approved spend with **NEAR Intents**: an agent's payment carries the fingerprint of the decision that approved it, so Finance can see that every payment was approved, and by whom.

## Built with

- **Libraries:** Next.js 16 and React 19, TypeScript, near-api-js and `@near-js/*` for NEAR, NEAR Wallet Selector with Intear and Meteor wallets, the Anthropic SDK for the Claude fallback, the MCP server SDK and `mcp-handler`, `postgres` for history, `zod` for input checks, and Vitest for tests. The ledger contract uses `near-sdk` 5.5 in Rust. Full list in `package.json` and `contract/Cargo.toml`.
- **NEAR services:** NEAR AI Cloud for private inference and its attestation report, NEAR testnet RPC, and NEAR's testnet faucet service for the no-terminal setup.
- **AI-written code:** most of the code, tests and this README were written with Claude Code (Anthropic), directed and reviewed by the Uprali team. The decision rules come from Uprali's own build vs buy and ROI playbooks. The app's look follows a design mock-up the team made in Lovable; no Lovable code is in this repo.
- **Baseline:** none. The repo starts on Nov 8, 2026, during the hackathon; no code from before Nov 1 was brought in.
- **Secrets:** none in the repo or its history. Keys live only in the host's environment variables (see `.env.example`, which has names only). The full git history was searched for private keys, API keys, Slack tokens and database passwords on Nov 8; the only matches are fake values in tests.

## Environment variables

See `.env.example`. Everything is optional; with nothing set Uprali runs in demo mode.

| Variable | What it's for |
|---|---|
| `NEARAI_API_KEY`, `NEARAI_BASE_URL`, `NEARAI_MODEL` | Private inference on NEAR AI Cloud (default `z-ai/glm-5.3-flash`, which runs in NEAR AI's attested TEE) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude fallback (default `claude-opus-5-5`, with Anthropic's server-side fallbacks on) |
| `LLM_PROVIDER` | `demo` forces the built-in analyst; `anthropic` tries Claude first |
| `UPRALI_API_KEYS` | Comma-separated API keys for `/mcp` and `/api/v1` |
| `PUBLIC_BASE_URL` | Address used in verify links (Vercel's is picked up automatically) |
| `NEAR_CONTRACT_ID`, `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`, `NEAR_RPC_URL` | Ledger contract and the relayer agents record through (testnet only) |
| `RECORD_ACCESS_CODE` | Lets the demo screen record through the relayer without a wallet when this code is typed |
| `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Uprali for Slack (see `/slack`) |
| `SLACK_BOT_TOKEN`, `SLACK_TOKEN_KEY` | The bot token (`xoxb-…`) that lets @uprali-mvp answer mentions and direct messages, if it wasn't installed through **Add to Slack**; and an optional key for encrypting stored bot tokens |
| `NEXT_PUBLIC_UPRALI_VOICE` | `on` brings back the mic and read-aloud buttons (off by default) |
| `POSTGRES_URL` or `DATABASE_URL` | Postgres for decision history (set by Vercel's Neon or Supabase integration). Without it, history is kept in memory |
| `SESSION_SECRET` | Optional: signs the history sign-in cookie. Without it, a key is derived from the database address |

## Uprali for Excel

A side panel in Excel (web, Windows and Mac) that builds a live build vs buy model in a new sheet.

- Pick **Build vs buy**, fill in what you know, press **Build the sheet**. Blank boxes get Uprali's benchmarks, marked as such.
- The sheet has yellow input cells with names (`buy_annual_cost`, `prototype_weeks` and so on, scoped to the sheet), a year-by-year cost table for each side with real formulas, totals, the break-even subscription and the recommendation. Change any input and everything recalculates.
- The formulas copy `src/lib/engine/buildVsBuy.ts` line by line, rounded the same way, so the sheet and the web app agree. `tests/excel.test.ts` loads the sheet into a formula engine and checks it against the engine for the sample CRM case and 40 random cases.
- **Explain this sheet** reads the inputs back, runs the analyst, checks the sheet's totals against Uprali's, and writes notes under the model. AI text is marked **Suggestion, verify**. Nothing is saved to history or recorded on NEAR from Excel yet.
- No new keys or settings: it uses the same deployment and the same AI keys as the web app.
- Checked here with a stand-in for Excel backed by a formula engine (build, rename on a second build, edit an input, explain). Not yet run in real Excel, and Microsoft's online manifest check couldn't be reached from the build machine.

How to load it: open `/excel/help.html` on the live app. The add-in file is `/excel/manifest.xml`; every address in it points at the site that serves it.

Files: `public/excel/` (panel, help page, icons), `src/lib/excel/` (sheet layout and manifest), `src/app/api/excel/` (layout and explain), `src/app/excel/manifest.xml/`.

## What's tested, and what isn't yet

Tested here: the cost model, where each number comes from, the extraction and prose guards, fallback from NEAR AI to the built-in analyst, API keys, the HTTP API end to end (decide, record, verify, tamper detection), the MCP server (`tools/list` and `build_vs_buy`), the attestation checks against a synthetic report (`npm test`, 107 tests, including all four business-case templates, their scenarios, payback and NPV, the AI cash and capacity split, including the advisor's suggestions and their labels, including decision history against a real Postgres (set `TEST_DATABASE_URL` to run those) and in memory, NEP-413 sign-in with real ed25519 signatures and the chain lookup faked, owners only seeing their own runs, re-runs as versions, `list_decisions` per API key, the return-on-investment rules against the playbook's worked example, recording through the relayer with the access code and no wallet, the health page, and the Slack app's signature checks, command, mentions, direct messages, template picking, buttons and install with Slack faked), the contract (`npm run contract:test`, 8 tests), a production build, and a curl run of the API and MCP server in demo mode.

**Not tested yet**, because this build machine can't reach NEAR or NEAR AI: live NEAR AI Cloud calls and its live attestation report, live Claude calls, the contract deploy script and recording on testnet, wallet sign-in and signing in a real browser, the `/setup` page's faucet request and contract deploy, a wallet's sign-in message for history, the Slack app against real Slack, and the new workspace look in a real browser. Run the demo script once on the live deploy before recording the video.

`npm audit` reports one high finding left in Meteor Wallet's SDK (`decode-uri-component` under `query-string` 7). The SDK only calls `stringify`, never the decoder the advisory is about, and the newer `query-string` breaks its import, so it stays until Meteor updates.

## Project layout

```
src/lib/engine/      decision engine: cost model, extraction and narration, providers, snapshot, markdown
src/lib/attest.ts    NEAR AI Cloud attestation checks
src/lib/ledger/      NEAR ledger client and the local demo ledger
src/lib/service.ts   shared by the API, MCP server and demo screen
src/lib/history.ts   decision history: Postgres, or memory when no database is set
src/lib/identity.ts  whose history: NEAR sign-in message (NEP-413), browser, Slack user, API key
src/app/mcp/         MCP server
src/app/api/         HTTP API, and Slack under api/slack
src/lib/slack/       Uprali for Slack: signatures, messages, install
slack/manifest.json  Slack app manifest
src/lib/excel/       Uprali for Excel: sheet layout with formulas, add-in manifest
public/excel/        the Excel side panel and its help page
src/components/      demo screen, wallet sign-in (Intear, Meteor), memo, verify page, /setup page
src/lib/setup.ts     helpers for the no-terminal ledger setup
public/              the built contract, served for /setup
contract/            Rust ledger contract
scripts/             contract build and deploy, attestation check
samples/             fictional example data
```

MIT licensed: see [LICENSE](LICENSE).
