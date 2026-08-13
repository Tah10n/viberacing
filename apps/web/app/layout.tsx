import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
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
        <header className="topbar">
          <Link className="brand" href="/">
            <span>VIBE</span> RACING
          </Link>
          <nav aria-label="Main navigation">
            <Link href="/">Leaderboard</Link>
            {current === null ? (
              <a className="button small" href="/api/auth/github/start">
                Join with GitHub
              </a>
            ) : (
              <>
                <Link href="/dashboard">@{current.handle}</Link>
                <form action="/api/auth/logout" method="post">
                  <button className="link-button" type="submit">
                    Log out
                  </button>
                </form>
              </>
            )}
          </nav>
        </header>
        {children}
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
