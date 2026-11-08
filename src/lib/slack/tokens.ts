/**
 * Bot tokens, so @uprali-mvp can answer mentions and direct messages. A token comes from "Add to Slack"
 * (kept per workspace, encrypted with AES-256-GCM under a key derived from SLACK_TOKEN_KEY or the
 * Slack client secret, in Postgres when a database is set up), or from SLACK_BOT_TOKEN for a single
 * workspace. Tokens are never logged or sent anywhere but slack.com.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { databaseUrl } from "@/lib/history";

type Env = Record<string, string | undefined>;

function key(env: Env): Buffer | null {
  const secret = env.SLACK_TOKEN_KEY || env.SLACK_CLIENT_SECRET;
  return secret ? createHash("sha256").update(`uprali-slack-token-v1:${secret}`).digest() : null;
}

export function sealToken(token: string, env: Env): string | null {
  const k = key(env);
  if (!k) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function openToken(sealed: string, env: Env): string | null {
  const k = key(env);
  const [v, iv, tag, enc] = sealed.split(".");
  if (!k || v !== "v1" || !iv || !tag || !enc) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

interface Store {
  get(team: string): Promise<string | null>;
  set(team: string, sealed: string): Promise<void>;
}

const memory = new Map<string, string>();
const memoryStore: Store = { get: async (t) => memory.get(t) ?? null, set: async (t, s) => void memory.set(t, s) };

const g = globalThis as unknown as { __upraliSlackTokens?: { url: string; store: Promise<Store> } };

async function postgresStore(url: string): Promise<Store> {
  const { default: postgres } = await import("postgres");
  const local = /\/\/[^/]*(localhost|127\.0\.0\.1)/.test(url) || /sslmode=disable/.test(url);
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, ssl: local ? false : "require", onnotice: () => {} });
  await sql`create table if not exists uprali_slack_installs (team_id text primary key, token_sealed text not null, updated_at timestamptz not null default now())`;
  return {
    get: async (team) => {
      const rows = await sql<{ token_sealed: string }[]>`select token_sealed from uprali_slack_installs where team_id = ${team}`;
      return rows[0]?.token_sealed ?? null;
    },
    set: async (team, sealed) => {
      await sql`insert into uprali_slack_installs (team_id, token_sealed) values (${team}, ${sealed})
        on conflict (team_id) do update set token_sealed = excluded.token_sealed, updated_at = now()`;
    },
  };
}

function store(env: Env): Promise<Store> {
  const url = databaseUrl(env);
  if (!url) return Promise.resolve(memoryStore);
  if (!g.__upraliSlackTokens || g.__upraliSlackTokens.url !== url) g.__upraliSlackTokens = { url, store: postgresStore(url) };
  return g.__upraliSlackTokens.store;
}

/** Keeps a workspace's bot token from "Add to Slack". Returns false when it couldn't be kept. */
export async function saveBotToken(team: string, token: string, env: Env = process.env): Promise<boolean> {
  const sealed = sealToken(token, env);
  if (!sealed || !team) return false;
  try {
    await (await store(env)).set(team, sealed);
    return true;
  } catch (err) {
    console.error("slack token save failed:", err instanceof Error ? err.message.slice(0, 80) : "unknown");
    return false;
  }
}

/** The bot token for a workspace: the one kept at install, else SLACK_BOT_TOKEN. */
export async function botToken(team: string, env: Env = process.env): Promise<string | null> {
  try {
    const sealed = await (await store(env)).get(team);
    const token = sealed ? openToken(sealed, env) : null;
    if (token) return token;
  } catch (err) {
    console.error("slack token read failed:", err instanceof Error ? err.message.slice(0, 80) : "unknown");
  }
  return env.SLACK_BOT_TOKEN?.startsWith("xoxb-") ? env.SLACK_BOT_TOKEN : null;
}
