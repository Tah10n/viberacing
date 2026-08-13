"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface AppHeaderProps {
  readonly handle: string | null;
  readonly weekLabel: string;
  readonly weekNumber: number;
}

function currentPage(pathname: string, route: "account" | "leaderboard"): "page" | undefined {
  const isLeaderboard = pathname === "/" || pathname.startsWith("/u/");
  const isAccount = pathname === "/dashboard" || pathname.startsWith("/connect");
  return (route === "leaderboard" ? isLeaderboard : isAccount) ? "page" : undefined;
}

export function AppHeader({ handle, weekLabel, weekNumber }: AppHeaderProps) {
  const pathname = usePathname();
  return (
    <header className="app-header">
      <Link aria-label="Vibe Racing leaderboard" className="brand" href="/">
        <span>Vibe</span> Racing
      </Link>
      <div className="race-meta" aria-label="Current race">
        <span className="live-label">Live</span>
        <strong>Week {weekNumber}</strong>
        <span>{weekLabel}</span>
      </div>
      <nav
        className={`app-nav app-nav-${handle === null ? "guest" : "signed-in"}`}
        aria-label="Main navigation"
      >
        <Link aria-current={currentPage(pathname, "leaderboard")} href="/">
          Leaderboard
        </Link>
        {handle === null ? (
          <a className="button button-small" href="/api/auth/github/start">
            Join with GitHub
          </a>
        ) : (
          <>
            <Link aria-current={currentPage(pathname, "account")} href="/dashboard">
              @{handle}
            </Link>
            <form action="/api/auth/logout" method="post">
              <button className="link-button" type="submit">
                Log out
              </button>
            </form>
          </>
        )}
      </nav>
    </header>
  );
}
