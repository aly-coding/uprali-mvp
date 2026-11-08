# Uprali: an AI financial analyst you can audit

Uprali helps people who aren't in finance, like PMs and engineers, build a business case their CFO will trust. You talk to the analyst by text or voice. It asks for one number at a time, suggests a benchmark when you don't know, and rates how sure each number is. It then writes a decision memo with a recommendation, the cost and payback, the biggest risk, what would change its mind, and a 30-second spoken version.

**Conversations stay private. Decisions are provable.** The chat never leaves your browser's storage and is never put on a ledger. When a decision is made, Uprali records only a SHA-256 fingerprint of the final snapshot on NEAR testnet. The snapshot holds the case version, assumptions, approvers, time and which AI models helped. Anyone holding the snapshot can later prove that it is exactly what was approved, and when, without the data itself ever touching a chain.

Built at NEAR HACKATHON, **Privacy & Private AI** track.

## Try it in two minutes (no keys needed)

Needs Node 22.18 or later.

1. Run `npm install`, then `npm run dev`. **You should see** `Ready` and a local URL, http://localhost:3000.
2. Open http://localhost:3000. **You should see** three panels (Case, Analyst, Decision memo) and the analyst's first question. With no keys set, the analyst is the scripted demo analyst and the ledger is a local demo ledger that the UI labels "not on chain".
3. Answer with the fictional numbers in `samples/acme-crm-answers.md`. **You should see** each answer appear as an assumption card with a confidence badge, and the memo say **Buy HubSpot Starter**.
4. Type an approver name and press **Record on NEAR**. **You should see** a 64-character fingerprint and a "Download snapshot" link.
5. Open **Verify a decision**, then drop in the snapshot. **You should see** **Match**. Change one number in the file and drop it again. **You should see** **No match**.
6. Run `npm run attest -- --offline`. **You should see** `VERIFIED` with five ✓ checks, then `✓ replay rejected`. With a `NEARAI_API_KEY` set, `npm run attest` runs the same checks against NEAR AI Cloud's live attestation report.
7. Run `npm test`. **You should see** `Tests  26 passed`.

## What's in the MVP

| Piece | Where |
|---|---|
| Analyst chat with text and voice (browser speech-to-text and read-aloud) | `src/components/Workspace.tsx` |
| Pluggable analyst: NEAR AI Cloud (private TEE inference, the default when its key is set), Claude (Anthropic) or a scripted demo analyst | `src/lib/llm/` |
| "Verify the enclave" panel and `npm run attest`: checks NEAR AI's attestation report against a fresh nonce | `src/lib/attest.ts`, `src/app/api/attestation/`, `scripts/attest-check.mjs` |
| Two decision templates: build vs buy, and new hire payback | `src/lib/templates.ts` |
| Deterministic decision memo: every number is computed in code, never by the model | `src/lib/memo.ts` |
| Canonical snapshot and SHA-256 fingerprint, identical in browser and server | `src/lib/snapshot.ts` |
| NEAR ledger contract in Rust: owner and writer allowlist, no overwrites, NEP-297 events | `contract/` |
| Record and verify APIs, plus a public "Verify a decision" page | `src/app/api/ledger/`, `src/app/verify/` |
| Audit log of which model filled each assumption | memo panel, and `modelsUsed` in the snapshot |

### How the pieces fit

```
Browser (private)                       Next.js server (stateless)            NEAR testnet
-----------------                       --------------------------            ------------
chat + assumptions in localStorage ---> /api/analyst --> Claude | NEAR AI
                                          (returns structured updates only)
memo computed locally
"Record on NEAR": snapshot JSON  -----> /api/ledger/record
                                          re-hashes snapshot (SHA-256)
                                          relayer signs record(hash, kind,  --> uprali-ledger contract
                                          case_id, version)                      stores hash + time + block
Verify page: hash snapshot locally ---> /api/ledger/verify --> get(hash) -----> view call
```

The server never stores the conversation or the snapshot. A relayer account signs the transaction, so finance users don't need a crypto wallet. This follows the plan of Google sign-in first, with a wallet as an option.

The record kinds are `decision`, `approval` and `outcome_review`, so the same case can anchor its approvals and its later outcome review.

## Privacy: what is and isn't kept

- **In your browser only:** the conversation and the working case, in localStorage under `uprali.workspace.v1`. "New case" clears it.
- **On the server:** nothing after a response. The routes have no database, cache or session. Errors are logged by type only, never with request content. See the comments at the top of `src/app/api/analyst/route.ts` and `src/app/api/ledger/record/route.ts`.
- **On the model provider:** the turn being answered. With NEAR AI, that runs inside a TEE, and the **Verify the enclave** panel checks NEAR AI's attestation report with a fresh random nonce. It confirms the nonce is echoed, that the Intel TDX quote binds the nonce and the node's signing key, and that the NVIDIA GPU evidence carries the same nonce. It doesn't verify Intel's or NVIDIA's signature chains. The panel lists those as "not checked here".
- **On NEAR testnet:** only the fingerprint, the kind, the case id and the version.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no keys set, the app runs in **demo mode**: a scripted analyst walks you through the case, and "Record on NEAR" writes to a local, off-chain demo ledger stored in `.data/ledger.json`. The UI labels this clearly as not on chain.

```bash
npm test            # 26 unit and API tests (vitest)
npm run attest -- --offline   # attestation checks on a synthetic report, no key needed
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in what you need. Never commit real keys.

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on Claude as the analyst |
| `ANTHROPIC_MODEL` | Default `claude-opus-5-5` |
| `NEARAI_API_KEY` | Turns on NEAR AI Cloud (private inference in a TEE) |
| `NEARAI_BASE_URL`, `NEARAI_MODEL` | Default `https://cloud-api.near.ai/v1` and `zai-org/GLM-5.1-FP8` |
| `LLM_PROVIDER` | `nearai`, `anthropic` or `demo`. Empty means NEAR AI, else Claude, else demo. The chat also has a picker. |
| `NEAR_NETWORK` | Must be `testnet`. The app refuses mainnet. |
| `NEAR_RPC_URL` | Default `https://test.rpc.fastnear.com` |
| `NEAR_CONTRACT_ID` | The deployed ledger, e.g. `ledger.youraccount.testnet`. Empty means the local demo ledger. |
| `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY` | The testnet relayer account that signs records. Server-side only. |
| `RECORD_ACCESS_CODE` | Optional. If set, the Record button asks for this code, so strangers can't spend your relayer's testnet gas. |
| `LOCAL_LEDGER_PATH` | Optional path for the demo ledger file |

The Claude call uses structured JSON output and enables the API's server-side fallback (`fallbacks: "default"`). If the primary model declines a request, the API retries it on a fallback model, and the app handles a final refusal with a plain message.

## Put the ledger on NEAR testnet

1. **Make a testnet account.** Create a `.testnet` account in a testnet wallet (for example MyNearWallet on testnet) or with `near-cli-rs`, and fund it from the testnet faucet. You need about 3 test NEAR. Copy its account id and private key (`ed25519:...`) into `.env.local` as `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY`.
2. **Deploy the contract.**
   ```bash
   npm run contract:deploy
   ```
   This creates `ledger.<your account>`, funds it with 3 NEAR, deploys `contract/res/uprali_ledger.wasm`, sets your account as owner, and prints the `NEAR_CONTRACT_ID=` line to add.
3. Add `NEAR_CONTRACT_ID` to `.env.local`, restart, and record a decision. The app shows the transaction link on testnet.nearblocks.io.

### Build and test the contract yourself (optional)

The compiled wasm is committed, so you don't need Rust to deploy. To rebuild it:

```bash
npm run contract:test    # 6 Rust unit tests (needs stable Rust)
npm run contract:build   # needs Rust 1.81.0 with the wasm32-unknown-unknown target
```

`near-sdk` is pinned to 5.5.0, and the wasm is built with Rust 1.81 because newer compilers emit wasm features that NEAR's runtime rejects. The build prints the wasm's sha256 so judges can match it to the deployed code.

Contract methods: `new(owner)`, `record(hash, kind, case_id, version)`, `get(hash)`, `count()`, `owner()`, `add_writer` / `remove_writer` / `is_writer`.

## Deploy to Vercel

1. Push this folder to a public GitHub repo.
2. In Vercel, import the repo. The framework is detected as Next.js, and no settings need changing.
3. Add the environment variables above in Project Settings > Environment Variables, at least `ANTHROPIC_API_KEY`. For on-chain records also add `NEAR_CONTRACT_ID`, `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY` and ideally `RECORD_ACCESS_CODE`.
4. Deploy. For the Privacy track, set `NEARAI_API_KEY` so the private chat runs on NEAR AI and the enclave check works. Without NEAR variables, Vercel's read-only filesystem keeps the demo ledger in memory only, so set up testnet for the live demo.

## Two-minute demo script

1. **(0:00) The problem.** "PMs and engineers have to justify spend to finance, but they don't speak finance, and ChatGPT will happily invent numbers. Uprali is an analyst that asks the right questions and leaves an audit trail."
2. **(0:15) Start a case.** With Claude as the analyst, pick **Build vs buy** and type "Should we build our own CRM or keep paying for HubSpot?". The analyst asks one question at a time.
3. **(0:30) Use voice.** Tap the mic and say "about 720 dollars a year". The assumption card fills in as *You*, rated medium because you said "about".
4. **(0:45) Don't know a number.** For engineer cost, say "not sure". The analyst offers a benchmark, marks it **low confidence** and logs which model suggested it.
5. **(1:00) The memo.** Show the recommendation, cost and payback, biggest risk, "what would change my mind", the CFO cheat sheet and the what-if line. Tap **Read aloud** for the 30-second version. Point out that the numbers come from code, not the LLM.
6. **(1:20) Prove the AI is private.** Switch the analyst to **NEAR AI**, answer one question, then press **Verify the enclave**. "The model runs in a hardware enclave, and we just checked its attestation with a fresh nonce, so this proof can't be replayed."
7. **(1:30) Record the decision.** Add approver "Aly (CFO)", press **Record on NEAR**, and open the nearblocks link. "Only a fingerprint went on chain. The conversation never left this browser."
8. **(1:45) Prove it.** Download the snapshot, open **Verify a decision**, and drop it in: **Match**. Change one number in the file and drop it again: **No match**. "That's an audit trail finance can trust, without putting private data on a public chain."

## Who it's for

- **Buyer:** finance teams. The first customers are CFOs and financial analysts.
- **Users:** the PMs and engineers who bring them spending requests, so each of them has an analyst in their pocket.
- **Why now:** teams already ask general chatbots for business cases, but those invent numbers, leave no trail and send private figures to a third party.
- **Pricing (planned):** a free plugin with one template, a 30-day trial, then Basic at $29 a month (3 templates, 9 decisions a month), Executive at $100 per seat (all templates, integrations, unlimited decisions), and a sales-led Enterprise plan.
- **Roadmap:** Google sign-in, then optional NEAR wallet sign-in; recording approvals and outcome reviews from the UI; more templates; full Intel and NVIDIA signature checks in the enclave panel.

## Built with

Next.js 16, React 19, TypeScript 5, zod, vitest, `@anthropic-ai/sdk`, `near-api-js`, and `near-sdk` 5.5 in Rust. NEAR AI Cloud and the Anthropic API for the analyst, and NEAR testnet for the ledger.

Most of this code was written with AI help, using Claude, then reviewed and tested as described below.

## What was tested, honestly

Tested in the build environment:
- 26 vitest tests pass. They cover both templates' math, memo building, the canonical JSON and SHA-256 fingerprint (including a known test vector and tamper detection), the demo analyst over a full case, cleanup of the model's output, provider selection, Anthropic message shaping, the local ledger, the NEAR ledger's read path against a mocked RPC, and the analyst, record and verify API routes, and the attestation checks (a good report, a replayed report, a quote that doesn't bind the nonce or the key, and an empty report).
- `npm run attest -- --offline` passes.
- 6 Rust contract tests pass. The wasm builds with Rust 1.81.
- TypeScript strict typecheck and `next build` pass.
- The production server runs. The demo-mode analyst, record, duplicate refusal (409) and verify endpoints were checked with curl, and both pages return 200.

Not tested yet, because the build environment couldn't reach these services or had no keys:
- Live Claude and NEAR AI calls, including the live attestation report. The checker follows NEAR AI's published report layout, but it hasn't seen a real report yet.
- Deploying the contract and recording on NEAR testnet (`scripts/deploy-contract.mjs` and the record path in `src/lib/ledger/near.ts`).
- Clicking through the UI in a real browser, including voice input, which needs Chrome or Edge.

## Not built yet

- Google sign-in, and optional NEAR wallet sign-in. The app works without accounts today.
- Saving cases to a server or sharing them with teammates. Cases live in your browser on purpose.
- More templates, such as pricing changes or vendor renewals.

## Hackathon submission checklist

- [ ] Public GitHub repo with this README and LICENSE, kept public through judging, with no secrets anywhere in its history (AI judges first check that it runs as described here)
- [ ] `npm run attest` passing against live NEAR AI, with a screenshot of the **Verified** panel
- [ ] One or two measured numbers from a live run, such as time from first question to finished memo
- [ ] Live Vercel URL with `ANTHROPIC_API_KEY` and the NEAR testnet variables set
- [ ] One real decision recorded on testnet, with its nearblocks link in the submission
- [ ] Demo video of about 2 minutes, following the script above
- [ ] Public post on X that says "built at NEAR HACKATHON", tags @NEARProtocol and #NEARHackathon, and has the video or screenshots
- [ ] A mainnet NEAR account ready for the payout (the app itself stays on testnet)
- [ ] Submission form filled in once (it can't be edited) before **Nov 14, 2026, 23:59 UTC** (3:59 PM Pacific)

## License

MIT
