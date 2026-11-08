import type { Metadata } from "next";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uprali: build or buy, decided with proof",
  description: "A private AI financial analyst. Every number shows its source and owner; every decision's fingerprint is recorded on NEAR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            <span className="logo" aria-hidden>U</span>
            Uprali <span className="muted">AI financial analyst</span>
          </a>
          <nav>
            <a href="/">Decide</a>
            <a href="/history">History</a>
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
