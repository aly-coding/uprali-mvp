import { headers } from "next/headers";
import { CopyButton } from "@/components/CopyButton";
import { publicBaseUrl } from "@/lib/service";
import { installReady, slackManifest } from "@/lib/slack/install";

export const dynamic = "force-dynamic";
export const metadata = { title: "Uprali for Slack" };

const ERRORS: Record<string, string> = {
  "not-set-up": "The Slack app isn't connected to this site yet. The owner needs to finish the setup below.",
  cancelled: "The install was cancelled in Slack. Nothing was added.",
  expired: "That install link expired. Press Add to Slack again.",
  refused: "Slack didn't accept the install. Press Add to Slack again; if it keeps failing, check the client ID and secret.",
};

export default async function SlackPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const base = publicBaseUrl(new Request(`${proto}://${host}/slack`));
  const ready = installReady();
  const manifest = JSON.stringify(slackManifest(base), null, 2);

  return (
    <main className="page setup">
      <section className="card">
        <h1>Uprali for Slack</h1>
        <p>
          Ask <code>@uprali-mvp</code> in a channel, message it directly, or type <code>/uprali</code>, with any business decision: build vs buy, a
          new product, a go-to-market expansion or an AI investment. Uprali answers in a thread with the 3-year result, where every number came
          from, its own estimates marked Suggestion, verify, and boxes for the numbers only a person can give. Anyone there can fill those in,
          approve, and record the decision&apos;s fingerprint on NEAR testnet. Start with <code>bvb:</code>, <code>product:</code>,{" "}
          <code>gtm:</code> or <code>ai:</code> to pick the template yourself.
        </p>
        {q.installed && <p><strong>Added to {q.installed}.</strong> Invite <code>@uprali-mvp</code> to a channel and ask it a decision, or try <code>/uprali help</code>.</p>}
        {q.error && <p className="error">{ERRORS[q.error] ?? "Something went wrong. Try again."}</p>}
        {ready ? (
          <p><a className="btn primary big" href="/api/slack/install">Add to Slack</a></p>
        ) : (
          <p className="muted">The Add to Slack button appears here once the owner has finished the setup below.</p>
        )}

        <h2>For the owner: create or update the Slack app</h2>
        <ol>
          <li>Open api.slack.com/apps. Open your <strong>uprali-mvp</strong> app and its <strong>App Manifest</strong> page, or press <strong>Create New App</strong>, then <strong>From a manifest</strong>, and pick your workspace.</li>
          <li>Choose <strong>JSON</strong>, delete what&apos;s there, paste the manifest below, and press <strong>Save</strong> (or <strong>Create</strong>). Slack checks the events address and should say <strong>Verified</strong>.</li>
          <li>On <strong>Basic Information</strong>, make sure the <strong>Client ID</strong>, <strong>Client Secret</strong> and <strong>Signing Secret</strong> are in Vercel as <code>SLACK_CLIENT_ID</code>, <code>SLACK_CLIENT_SECRET</code> and <code>SLACK_SIGNING_SECRET</code>.</li>
          <li>Press <strong>Reinstall to Workspace</strong> (or <strong>Install</strong>), then <strong>Allow</strong>.</li>
          <li>On <strong>OAuth &amp; Permissions</strong>, copy the <strong>Bot User OAuth Token</strong> (it starts with <code>xoxb-</code>) into Vercel as <code>SLACK_BOT_TOKEN</code>, then redeploy. That lets <code>@uprali-mvp</code> answer mentions and direct messages.</li>
          <li>In a channel type <code>/invite @uprali-mvp</code>, then <code>@uprali-mvp should we build our own CRM or keep HubSpot?</code></li>
        </ol>
        <p><CopyButton text={manifest} label="Copy the manifest" /></p>
        <pre className="envblock">{manifest}</pre>
      </section>
    </main>
  );
}
