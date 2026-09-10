import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppHeader } from "./components/app-header";
import { viewer } from "@/lib/session";
import { publicPageMetadata, siteDescription, siteTitle } from "@/lib/seo";
import { publicOrigin } from "@/lib/config";
import "./styles.css";

export function generateMetadata(): Metadata {
  return {
    ...publicPageMetadata(siteTitle, siteDescription),
    icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
    verification: {
      google:
        process.env.VIBERACING_GOOGLE_SITE_VERIFICATION ||
        // Public ownership proof supplied by the maintainer's Search Console account.
        (publicOrigin().origin === "https://viberacing.up.railway.app"
          ? "C__amjwDCo_CrfK-5Y2raodeKafPUc0kTTrXwo6Lx1E"
          : undefined),
    },
  };
}

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
            <span>Coding-agent token standings by UTC period.</span>
          </div>
          <p>Totals are self-reported. Rankings are for fun, not proof of cost or productivity.</p>
        </footer>
      </body>
    </html>
  );
}
