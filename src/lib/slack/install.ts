/**
 * "Add to Slack": the OAuth install flow that lets any workspace add Uprali, and the app manifest
 * Aly pastes into Slack to create the app. Uprali only asks for the `commands` scope and answers
 * through each request's response_url, so the token Slack returns at install is not kept.
 */
type Env = Record<string, string | undefined>;

export const STATE_COOKIE = "uprali_slack_state";
export const SCOPES = ["commands"];

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
  const data = (await res.json().catch(() => null)) as { ok?: boolean; team?: { name?: string } } | null;
  if (!data?.ok) return null;
  return (data.team?.name || "your workspace").slice(0, 80);
}

/** The manifest to paste at api.slack.com/apps, with this deploy's address filled in. */
export function slackManifest(base: string) {
  return {
    display_information: {
      name: "Uprali",
      description: "Build or buy, decided with proof.",
      long_description:
        "Ask /uprali a build or buy question. Uprali works out the 3-year cost of each side, shows where every number came from and who owns it, flags the numbers only a person can give, and records the decision's fingerprint on NEAR testnet so anyone can check it later. It runs on private AI (NEAR AI Cloud) when configured.",
      background_color: "#1d4ed8",
    },
    features: {
      slash_commands: [
        {
          command: "/uprali",
          url: `${base}/api/slack/commands`,
          description: "Build or buy? Get a costed decision with sources",
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
      interactivity: { is_enabled: true, request_url: `${base}/api/slack/interactions` },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
