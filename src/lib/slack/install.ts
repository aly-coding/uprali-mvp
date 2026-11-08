/**
 * "Add to Slack": the OAuth install flow that lets any workspace add Uprali, and the app manifest
 * Aly pastes into Slack to create or update the app. The bot token Slack returns at install is kept
 * encrypted (see tokens.ts) so @uprali-mvp can answer mentions and direct messages in threads.
 */
import { saveBotToken } from "./tokens";

type Env = Record<string, string | undefined>;

export const STATE_COOKIE = "uprali_slack_state";
/** commands: /uprali. app_mentions:read and im:history: hear @uprali-mvp and direct messages. chat:write: answer in threads. */
export const SCOPES = ["commands", "app_mentions:read", "chat:write", "im:history"];
export const BOT_EVENTS = ["app_mention", "message.im"];
export const BOT_NAME = "uprali-mvp";

export function installReady(env: Env = process.env): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET);
}

export function redirectUri(base: string): string {
  return `${base}/api/slack/oauth`;
}

export function authorizeUrl(clientId: string, base: string, state: string): string {
  const u = new URL("https://slack.com/oauth/v2/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("scope", SCOPES.join(","));
  u.searchParams.set("redirect_uri", redirectUri(base));
  u.searchParams.set("state", state);
  return u.toString();
}

/** Finishes an install. Returns the workspace name, or null when Slack refused. */
export async function exchangeCode(code: string, base: string, env: Env, f: typeof fetch = fetch): Promise<string | null> {
  const res = await f("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID || "",
      client_secret: env.SLACK_CLIENT_SECRET || "",
      code,
      redirect_uri: redirectUri(base),
    }),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; team?: { id?: string; name?: string }; access_token?: string; token_type?: string } | null;
  if (!data?.ok) return null;
  if (data.team?.id && data.access_token?.startsWith("xoxb-")) await saveBotToken(data.team.id, data.access_token, env);
  return (data.team?.name || "your workspace").slice(0, 80);
}

/** The manifest to paste at api.slack.com/apps, with this deploy's address filled in. */
export function slackManifest(base: string) {
  return {
    display_information: {
      name: "Uprali",
      description: "Business decisions with sourced numbers, a human sign-off and proof on NEAR.",
      long_description:
        "Mention @uprali-mvp, message it, or type /uprali with a business decision: build vs buy, a new product, a go-to-market expansion or an AI investment. Uprali works out the 3-year result, shows where every number came from and who owns it, marks its own estimates as suggestions to verify, asks for the numbers only a person can give, and records the approved decision's fingerprint on NEAR testnet so anyone can check it later. It runs on private AI (NEAR AI Cloud) when configured.",
      background_color: "#16294a",
    },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: BOT_NAME, always_online: true },
      slash_commands: [
        {
          command: "/uprali",
          url: `${base}/api/slack/commands`,
          description: "A business decision, costed over 3 years with sources",
          usage_hint: "Should we build our own CRM or keep paying $720 a year for HubSpot?",
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      redirect_urls: [redirectUri(base)],
      scopes: { bot: SCOPES },
    },
    settings: {
      event_subscriptions: { request_url: `${base}/api/slack/events`, bot_events: BOT_EVENTS },
      interactivity: { is_enabled: true, request_url: `${base}/api/slack/interactions` },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
