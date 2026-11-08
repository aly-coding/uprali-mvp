import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uprali: your AI financial analyst",
  description: "Build a business case your CFO trusts. Conversations stay private; decisions are fingerprinted on NEAR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            <span className="logo" aria-hidden>
              U
            </span>
            Uprali <span className="muted">AI financial analyst</span>
          </a>
          <nav>
            <a href="/">Analyst</a>
            <a href="/verify">Verify a decision</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
