import { afterAll, describe, expect, it } from "vitest";
import { KeyPair, KeyPairSigner } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { connectPostgres, makeEntry, MemoryHistory, type HistoryStore, type PostgresHistory } from "@/lib/history";
import {
  checkNonce,
  makeNonce,
  makeSession,
  readSession,
  SIGN_IN_MESSAGE,
  SignInError,
  verifySignIn,
  webOwner,
  type VerifyNep413,
} from "@/lib/identity";
import { runAndSave } from "@/lib/service";
import { historyText } from "@/lib/slack/app";
import { decide } from "@/lib/engine/decide";
import { buildSnapshot, hashSnapshot } from "@/lib/engine/snapshot";

const env = { SESSION_SECRET: "test-secret-0123456789abcdef" };

async function entry(owner: string, opts: { id?: string; version?: number; decisionId?: string; question?: string } = {}) {
  const memo = await decide({ inputs: { buy_annual_cost: 720, prototype_weeks: 3 }, decisionId: opts.decisionId }, {});
  const snapshot = buildSnapshot(memo, { decidedBy: "t", version: opts.version });
  return makeEntry({ id: opts.id, owner, source: "web", inputs: { buy_annual_cost: 720 }, memo, snapshot, fingerprint: await hashSnapshot(snapshot), verifyUrl: "http://x/verify", question: opts.question ?? "q" });
}

function storeSuite(name: string, make: () => Promise<HistoryStore>) {
  describe(name, () => {
    it("keeps each owner's runs to themselves", async () => {
      const s = await make();
      const a = await entry("near:alice.testnet", { question: "alice's" });
      const b = await entry("near:bob.testnet");
      await s.save(a);
      await s.save(b);
      expect((await s.list("near:alice.testnet")).map((x) => x.id)).toEqual([a.id]);
      expect(await s.get("near:bob.testnet", a.id)).toBeNull();
      expect((await s.get("near:alice.testnet", a.id))!.memo.decisionId).toBe(a.decisionId);
      expect(await s.remove("near:bob.testnet", a.id)).toBe(false);
      await expect(s.save({ ...a, owner: "near:bob.testnet" })).rejects.toThrow();
      expect(await s.remove("near:alice.testnet", a.id)).toBe(true);
      expect(await s.list("near:alice.testnet")).toEqual([]);
    });

    it("numbers versions per decision", async () => {
      const s = await make();
      const owner = `browser:${Math.random()}`;
      const v1 = await entry(owner);
      await s.save(v1);
      expect(await s.nextVersion(owner, v1.decisionId)).toBe(2);
      const v2 = await entry(owner, { decisionId: v1.decisionId, version: 2 });
      await s.save({ ...v2, parentId: v1.id });
      const list = await s.list(owner, { decisionId: v1.decisionId });
      expect(list.map((x) => x.version).sort()).toEqual([1, 2]);
      expect(list.find((x) => x.version === 2)!.parentId).toBe(v1.id);
    });

    it("marks recorded runs and moves a browser's runs to an account", async () => {
      const s = await make();
      const owner = `browser:${Math.random()}`;
      const e = await entry(owner);
      await s.save(e);
      expect(await s.markRecorded(e.fingerprint, { network: "local-demo", by: "x", atMs: 1, txUrl: null })).toBeGreaterThanOrEqual(1);
      // An update with the same fingerprint keeps the recorded mark; a changed one drops it.
      await s.save({ ...e, recorded: null });
      expect((await s.get(owner, e.id))!.recorded).toMatchObject({ by: "x" });
      await s.save({ ...e, fingerprint: "f".repeat(64), recorded: null });
      expect((await s.get(owner, e.id))!.recorded).toBeNull();
      const acct = `near:${Math.random().toString(36).slice(2)}.testnet`;
      expect(await s.moveOwner(owner, acct)).toBe(1);
      expect(await s.get(acct, e.id)).not.toBeNull();
    });
  });
}

storeSuite("memory history", async () => new MemoryHistory());

const pgUrl = process.env.TEST_DATABASE_URL;
let pg: PostgresHistory | null = null;
if (pgUrl) storeSuite("postgres history", async () => (pg ??= await connectPostgres(pgUrl)));
afterAll(async () => pg?.close());

describe("sessions", () => {
  it("accepts its own token and rejects changed or expired ones", () => {
    const t = makeSession("alice.testnet", env);
    expect(readSession(t, env)).toBe("alice.testnet");
    expect(readSession(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), env)).toBeNull();
    expect(readSession(t, { SESSION_SECRET: "another-secret-0123456789" })).toBeNull();
    expect(readSession(t, env, Date.now() + 31 * 86_400_000)).toBeNull();
    const forged = `v1.${Buffer.from(JSON.stringify({ a: "bob.testnet", e: Date.now() + 1e9 })).toString("base64url")}.${t.split(".")[2]}`;
    expect(readSession(forged, env)).toBeNull();
  });

  it("keys runs by browser until a NEAR account has signed in", () => {
    const r1 = webOwner(new Request("http://x/"), env);
    expect(r1.owner).toMatch(/^browser:[a-f0-9]{32}$/);
    expect(r1.setCookie).toMatch(/uprali_browser=/);
    const cookie = `uprali_browser=${r1.browserId}; uprali_session=${makeSession("alice.testnet", env)}`;
    const r2 = webOwner(new Request("http://x/", { headers: { cookie } }), env);
    expect(r2).toMatchObject({ owner: "near:alice.testnet", account: "alice.testnet", setCookie: null });
  });

  it("only takes fresh nonces it issued", () => {
    const n = makeNonce(env);
    expect(checkNonce(n, env)).toBe(true);
    expect(checkNonce(n, { SESSION_SECRET: "another-secret-0123456789" })).toBe(false);
    expect(checkNonce(n, env, Date.now() + 11 * 60_000)).toBe(false);
    const bad = Buffer.from(n);
    bad[0] ^= 1;
    expect(checkNonce(bad, env)).toBe(false);
  });
});

describe("NEAR sign-in for history", () => {
  const recipient = "uprali.example";

  async function signed(accountId: string, kp = KeyPair.fromRandom("ed25519")) {
    const nonce = makeNonce(env);
    const signer = new KeyPairSigner(kp);
    const s = await signer.signNep413Message(accountId, { message: SIGN_IN_MESSAGE, recipient, nonce });
    return { kp, body: { accountId, publicKey: kp.getPublicKey().toString(), signature: Buffer.from(s.signature).toString("base64"), nonce: nonce.toString("base64") } };
  }

  // The real NEP-413 check from near-api-js, with the chain lookup faked.
  const verifierFor = (keys: Record<string, { key: string; full: boolean }>): VerifyNep413 => async ({ accountId, publicKey, signature, payload }) => {
    const provider = {
      viewAccessKey: async ({ accountId: a, publicKey: p }: { accountId: string; publicKey: string }) => {
        const k = keys[a];
        if (!k || k.key !== String(p)) throw new Error("no such key");
        return { permission: k.full ? "FullAccess" : { FunctionCall: {} } };
      },
    };
    await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, signature, payload, provider: provider as never });
  };

  it("signs in when the wallet signed with a full-access key", async () => {
    const { kp, body } = await signed("alice.testnet");
    const v = verifierFor({ "alice.testnet": { key: kp.getPublicKey().toString(), full: true } });
    expect(await verifySignIn(body, recipient, v, env)).toBe("alice.testnet");
  });

  it("refuses someone else's account, a function-call key, another site and a changed nonce", async () => {
    const { kp, body } = await signed("alice.testnet");
    const pub = kp.getPublicKey().toString();
    await expect(verifySignIn({ ...body, accountId: "bob.testnet" }, recipient, verifierFor({ "bob.testnet": { key: "other", full: true } }), env)).rejects.toThrow(SignInError);
    await expect(verifySignIn(body, recipient, verifierFor({ "alice.testnet": { key: pub, full: false } }), env)).rejects.toThrow(SignInError);
    const ok = verifierFor({ "alice.testnet": { key: pub, full: true } });
    await expect(verifySignIn(body, "evil.example", ok, env)).rejects.toThrow(SignInError);
    await expect(verifySignIn({ ...body, nonce: makeNonce(env).toString("base64") }, recipient, ok, env)).rejects.toThrow(SignInError);
  });
});

describe("saving runs", () => {
  const base = "http://localhost:3000";
  const req = { inputs: { buy_annual_cost: { value: 720 }, prototype_weeks: { value: 3 } }, decidedBy: "t", question: "CRM?" };

  it("saves a run and re-runs it as the next version of the same decision", async () => {
    const owner = `browser:${Math.random()}`;
    const first = await runAndSave(req, base, { owner, source: "web" }, {});
    expect(first.runId).toMatch(/^run_/);
    const again = await runAndSave({ ...req, inputs: { ...req.inputs, prototype_weeks: { value: 6 } } }, base, { owner, source: "web", parentId: first.runId }, {});
    expect(again.parentId).toBe(first.runId);
    expect(again.snapshot.decisionId).toBe(first.snapshot.decisionId);
    expect(again.snapshot.version).toBe(2);
  });

  it("ignores a parent from someone else's history", async () => {
    const mine = await runAndSave(req, base, { owner: "near:alice.testnet", source: "web" }, {});
    const theirs = await runAndSave(req, base, { owner: "near:mallory.testnet", source: "web", parentId: mine.runId }, {});
    expect(theirs.parentId).toBeNull();
    expect(theirs.snapshot.decisionId).not.toBe(mine.snapshot.decisionId);
    expect(theirs.snapshot.version).toBe(1);
  });

  it("doesn't save without an owner", async () => {
    expect((await runAndSave(req, base, { owner: null, source: "api" }, {})).runId).toBeNull();
  });

  it("lists a Slack user's own decisions", async () => {
    await runAndSave(req, base, { owner: "slack:T1:U1", source: "slack", runId: "slack_T1_x" }, {});
    expect(await historyText("T1", "U1", {})).toMatch(/Your last 1 decisions/);
    expect(await historyText("T1", "U2", {})).toMatch(/haven't run any/);
  });
});
