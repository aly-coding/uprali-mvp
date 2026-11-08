# Uprali: build or buy, decided with proof

Uprali is a private AI financial analyst for one decision teams get wrong all the time: **should we build this tool ourselves, or keep paying for one?**

A working prototype makes building look cheap. It's usually about 20% of the real job. Uprali works out the full multi-year cost of building, including production hardening, integrations, upkeep, security, hosting, on-call, the knowledge lost when the builder leaves, and the core product work that doesn't get done. Then it sets that against the full cost of buying.

- **Every number has a source and an owner.** Each figure in the memo says where it came from, whether a person or an agent stands behind it, and whether it's a fact or an assumption. Anything only a person can answer is marked **needs a human**.
- **The model runs privately.** By default the analyst runs on **NEAR AI Cloud** inside a hardware enclave. Uprali checks the enclave's attestation with a fresh nonce and shows a **Verified** badge. Claude is the fallback. A built-in rule-based analyst means it works with no keys at all.
- **The decision is provable.** Only a SHA-256 fingerprint of the decision goes on **NEAR testnet**, signed by the decision maker's own NEAR wallet. Anyone with the decision file can later prove nothing in it changed.
- **Agents can use it directly.** The same tool is an **MCP server** (for Claude Desktop, Claude Code or any MCP client) and a plain **HTTP API**, with API keys.

Built for the NEAR Hackathon, **Privacy & Private AI** track.

## Try it in two minutes (no keys needed)

Needs Node 22.18 or later.

1. Run `npm install`, then `npm run dev`. **You should see** `Ready` and http://localhost:3000.
2. Open http://localhost:3000 and press **Continue in demo mode**. (With the ledger contract configured you'd see **Sign in with NEAR wallet** too.)
3. Leave the example question in the box and press **Run the decision**. **You should see** **Buy HubSpot Starter**, the line "A working prototype costs about $12,000, but it's only 20% of the work", a 3-year cost breakdown, and a table where every number has **Human** or **Agent**, **Fact** or **Assumption**, and its source.
4. Press **Record decision**. **You should see** "Recorded on the local demo ledger" and a **Verify this decision** link.
5. Open the link. **You should see** **Match**. Download the snapshot, change one number in it, paste it in and press **Check**. **You should see** **No match**.
6. Run `npm test`. **You should see** `Tests  31 passed`. Run `npm run attest -- --offline`. **You should see** `VERIFIED` with five ✓ checks, then `✓ replay rejected`.

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
| `GET /api/attestation` | Fetches NEAR AI Cloud's attestation report with a fresh nonce and checks it | No |
| `GET /api/config` | Shows what's configured, never a secret | No |
| `/mcp` | MCP server with `build_vs_buy` and `verify_decision` | Yes |

## Demo script (about 3 minutes)

1. **The problem (20 s).** "Our engineer built a CRM prototype in three weeks, so building looks cheaper than HubSpot. Is it?"
2. **Sign in (15 s).** Open the live app, press **Sign in with NEAR wallet**, approve in MyNearWallet on testnet. The app shows your account, for example `aly-uprali.testnet`.
3. **Run the decision (40 s).** Paste the example question and press **Run the decision**. Point at:
   - the green **NEAR AI Cloud: Verified** badge, then open it to show the five attestation checks;
   - "the prototype is $12,000, but it's only 20% of the work; the full 3-year build is about $200,000";
   - the table: the numbers you typed are **Human / Fact**, the benchmarks are **Agent / Assumption**, and the engineer cost is flagged **Needs a human**.
4. **Record it (30 s).** Press **Sign and record as aly-uprali.testnet**. Open **See the transaction** on NEAR Blocks: the contract call shows the fingerprint and your account as the signer. Nothing else about the decision is on chain.
5. **Verify it (30 s).** Press **Verify this decision**: **Match**, recorded by your account at that time. Change one number in the snapshot and check again: **No match**.
6. **Agents (40 s).** Switch to Claude Desktop with the Uprali MCP server and ask the same question in plain words. Claude calls `build_vs_buy` and gets the same memo, sources and fingerprint. "Same engine, for people and for agents, with every number traceable."

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

**Where each number comes from**, in order: a value the caller gave (with its own source and owner), a fact stated in the question (owner: human, source: the quote), or a labelled benchmark (owner: agent, assumption, low confidence). Numbers with no sensible benchmark, like the subscription price or the prototype time, stay empty and are marked **needs a human**. A memo is **complete** when no number still needs a human, **draft** when some do, and **needs a human** when it can't be computed yet. A decision that needs a human can't be recorded.

**Guards on the models.** An extracted fact is kept only if its quote is really in the question and its number really is in the quote. Prose from a model is kept only if every dollar amount in it is one the engine computed; otherwise the built-in wording is used. Instructions inside the question are ignored.

## Privacy

| What | Where it goes |
|---|---|
| The question and the numbers | To the model for one request (NEAR AI Cloud's enclave by default), then gone. The server keeps nothing and logs only error types. |
| The memo and the snapshot | Returned to the caller. The demo screen keeps the snapshot in the browser so the verify page can check it. |
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
3. **A NEAR testnet wallet for you.** In MyNearWallet, switch to **testnet** and create an account, for example `aly-uprali.testnet`. This is the wallet you sign in with during the demo. Testnet tokens are free and worthless.
4. **A testnet account for the server, and the contract.** On a laptop with Node installed, in the project folder:
   ```bash
   npx near-cli-rs account create-account sponsor-by-faucet-service uprali-relayer.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
   ```
   This command wasn't run from this build machine, so if NEAR CLI asks something different, follow its prompts to create a testnet account funded by the faucet. The account's key is saved in `~/.near-credentials/testnet/uprali-relayer.testnet.json`. Put the account and its `private_key` into a file called `.env.local` as `NEAR_ACCOUNT_ID=` and `NEAR_PRIVATE_KEY=`, then run `npm run contract:deploy`. It prints a line like `NEAR_CONTRACT_ID=ledger.uprali-relayer.testnet`.
5. **Vercel.** Import the GitHub repo in Vercel (it detects Next.js). Under **Settings → Environment Variables** add:
   - `NEARAI_API_KEY`: from step 2
   - `NEAR_CONTRACT_ID`, `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`: from step 4
   - `UPRALI_API_KEYS`: any long random text, for example 32 letters and digits. This is the key agents use.
   - `ANTHROPIC_API_KEY`: optional, so Claude can step in if NEAR AI is down.

   Then redeploy. Open the app: you should see **Sign in with NEAR wallet**, and `/api/config` should list `nearai` first.
6. **Submit.** Post the demo video on X, then submit the repo, the live link and the post in the hackathon form before **Nov 14, 2026 at 23:59 UTC (3:59 PM Pacific)**.

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

## What's tested, and what isn't yet

Tested here: the cost model, where each number comes from, the extraction and prose guards, fallback from NEAR AI to the built-in analyst, API keys, the HTTP API end to end (decide, record, verify, tamper detection), the MCP server (`tools/list` and `build_vs_buy`), the attestation checks against a synthetic report (`npm test`, 31 tests), the contract (`npm run contract:test`, 8 tests), a production build, and a curl run of the API and MCP server in demo mode.

**Not tested yet**, because this build machine can't reach NEAR or NEAR AI: live NEAR AI Cloud calls and its live attestation report, live Claude calls, the contract deploy script and recording on testnet, and wallet sign-in and signing in a real browser. Run the demo script once on the live deploy before recording the video.

## Project layout

```
src/lib/engine/      decision engine: cost model, extraction and narration, providers, snapshot, markdown
src/lib/attest.ts    NEAR AI Cloud attestation checks
src/lib/ledger/      NEAR ledger client and the local demo ledger
src/lib/service.ts   shared by the API, MCP server and demo screen
src/app/mcp/         MCP server
src/app/api/         HTTP API
src/components/      demo screen, wallet sign-in, memo and verify page
contract/            Rust ledger contract
scripts/             contract build and deploy, attestation check
samples/             fictional example data
```

MIT licensed.
