import type { Metadata } from "next";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uprali: the verifiable approval layer for agent spending",
  description: "Before an agent buys or builds anything, it gets a memo with sourced numbers, a human sign-off and a proof on NEAR. Private inference on NEAR AI Cloud.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            <span className="logo" aria-hidden>U</span>
            Uprali <span className="muted">Approvals for agent spending</span>
          </a>
          <nav>
            <a href="/">Decide</a>
            <a href="/history">History</a>
            <a href="/sample">Sample</a>
            <a href="/verify">Verify a decision</a>
            <a href="/slack">Slack</a>
            <a href="https://github.com/aly-coding/uprali-mvp" target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
