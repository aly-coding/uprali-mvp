/** Calls to Slack's Web API with the workspace's bot token. Only slack.com is ever called. */
export interface SlackApiResult {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

export async function slackApi(method: string, token: string, body: Record<string, unknown>, f: typeof fetch = fetch): Promise<SlackApiResult> {
  if (!/^[a-z]+\.[a-zA-Z]+$/.test(method)) throw new Error("bad Slack method");
  try {
    const res = await f(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as SlackApiResult | null;
    if (!data?.ok) console.error(`slack ${method} failed:`, data?.error ?? res.status);
    return data ?? { ok: false, error: `http_${res.status}` };
  } catch {
    console.error(`slack ${method} failed`);
    return { ok: false, error: "network" };
  }
}
