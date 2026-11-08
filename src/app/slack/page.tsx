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
          Type <code>/uprali</code> and a build or buy question in any channel. Uprali answers in the channel with the 3-year cost of each side,
          where every number came from, and the numbers only a person can give. Anyone there can fill those in, approve, and record the
          decision&apos;s fingerprint on NEAR testnet.
        </p>
        {q.installed && <p><strong>Added to {q.installed}.</strong> Try <code>/uprali help</code> in any channel.</p>}
        {q.error && <p className="error">{ERRORS[q.error] ?? "Something went wrong. Try again."}</p>}
        {ready ? (
          <p><a className="btn primary big" href="/api/slack/install">Add to Slack</a></p>
        ) : (
          <p className="muted">The Add to Slack button appears here once the owner has finished the setup below.</p>
        )}

        <h2>For the owner: create the Slack app</h2>
        <ol>
          <li>Open api.slack.com/apps, press <strong>Create New App</strong>, then <strong>From a manifest</strong>, and pick your test workspace.</li>
          <li>Choose <strong>JSON</strong>, delete what&apos;s there, paste the manifest below, and press <strong>Create</strong>.</li>
          <li>On <strong>Basic Information</strong>, copy the <strong>Client ID</strong>, <strong>Client Secret</strong> and <strong>Signing Secret</strong> into Vercel as <code>SLACK_CLIENT_ID</code>, <code>SLACK_CLIENT_SECRET</code> and <code>SLACK_SIGNING_SECRET</code>, then redeploy.</li>
          <li>Come back to this page and press <strong>Add to Slack</strong>.</li>
        </ol>
        <p><CopyButton text={manifest} label="Copy the manifest" /></p>
        <pre className="envblock">{manifest}</pre>
      </section>
    </main>
  );
}
