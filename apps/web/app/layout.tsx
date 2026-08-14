import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppHeader } from "./components/app-header";
import { viewer } from "@/lib/session";
import "./styles.css";

export const metadata: Metadata = {
  title: "Vibe Racing — weekly AI coding token leaderboard",
  description: "A privacy-first community leaderboard for tokens used in Codex and Claude Code.",
};

export default async function Layout({ children }: Readonly<{ children: ReactNode }>) {
  const current = await viewer();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AppHeader handle={current?.handle ?? null} />
        <div id="main-content">{children}</div>
        <footer>
          <div>
            <strong>Vibe Racing</strong>
            <span>Weekly coding-agent token standings.</span>
          </div>
          <p>Totals are self-reported. Rankings are for fun, not proof of cost or productivity.</p>
        </footer>
      </body>
    </html>
  );
}
