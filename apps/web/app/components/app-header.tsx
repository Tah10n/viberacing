"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SameOriginActionForm } from "./same-origin-action-form";

interface AppHeaderProps {
  readonly handle: string | null;
}

function currentPage(pathname: string, route: "account" | "leaderboard"): "page" | undefined {
  const isLeaderboard = pathname === "/" || pathname.startsWith("/u/");
  const isAccount = pathname === "/dashboard" || pathname.startsWith("/connect");
  return (route === "leaderboard" ? isLeaderboard : isAccount) ? "page" : undefined;
}

export function AppHeader({ handle }: AppHeaderProps) {
  const pathname = usePathname();
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <Link aria-label="Vibe Racing leaderboard" className="brand" href="/">
          <span>Vibe</span> Racing
        </Link>
        <a
          aria-label="Vibe Racing repository on GitHub (opens in a new tab)"
          className="repository-link"
          href="https://github.com/Tah10n/viberacing"
          rel="noreferrer"
          target="_blank"
          title="View Vibe Racing on GitHub"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.08.55-.17.55-.38l-.01-1.49c-2.23.49-2.7-1.08-2.7-1.08-.37-.93-.9-1.18-.9-1.18-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.96 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.72a7.6 7.6 0 0 1 2 .27c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.08-1.87 3.75-3.66 3.95.29.25.54.74.54 1.5l-.01 2.22c0 .21.14.46.55.38A8 8 0 0 0 8 0Z" />
          </svg>
        </a>
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
            <SameOriginActionForm action="/api/auth/logout">
              <button className="link-button" type="submit">
                Log out
              </button>
            </SameOriginActionForm>
          </>
        )}
      </nav>
    </header>
  );
}
