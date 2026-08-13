import { connection } from "next/server";
import { digest, normalizePairingCode } from "@/lib/crypto";
import { query } from "@/lib/db";
import { viewer } from "@/lib/session";

interface ConnectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}
interface PairingRow {
  agents: string[];
}

export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  await connection();
  const params = await searchParams;
  const code = normalizePairingCode(typeof params.code === "string" ? params.code : "");
  const [current, rows] = await Promise.all([
    viewer(),
    code.length === 8
      ? query<PairingRow>(
          "SELECT agents FROM connections WHERE code_hash = $1 AND status = 'pending' AND expires_at > now() LIMIT 1",
          [digest(code)],
        )
      : Promise.resolve([]),
  ]);
  const pairing = rows[0];
  const returnPath = `/connect?code=${encodeURIComponent(code)}`;
  return (
    <main className="narrow connect-page">
      <header className="page-heading">
        <p className="eyebrow">PAIR CONNECTOR</p>
        <h1>Approve this computer</h1>
        <p>Review what was detected before adding this computer to your race setup.</p>
      </header>
      {pairing === undefined ? (
        <section className="panel error">
          <h2>Pairing code expired</h2>
          <p>Run the connect command again to get a fresh link.</p>
        </section>
      ) : (
        <section className="panel">
          <dl className="pairing-details">
            <div>
              <dt>Agents detected</dt>
              <dd>{pairing.agents.map((agent) => agent.replaceAll("_", " ")).join(", ")}</dd>
            </div>
            <div>
              <dt>Code</dt>
              <dd>{code}</dd>
            </div>
          </dl>
          <p>
            The computer will be allowed to upload daily totals for these agents. It cannot access
            your GitHub account.
          </p>
          <p className="muted">
            A neutral label such as Computer 2 is assigned automatically; the computer hostname
            stays private.
          </p>
          {current === null ? (
            <a
              className="button"
              href={`/api/auth/github/start?next=${encodeURIComponent(returnPath)}`}
            >
              Sign in with GitHub to approve
            </a>
          ) : (
            <form action="/api/pairing/approve" method="post">
              <input name="code" type="hidden" value={code} />
              <button className="button" type="submit">
                Approve for @{current.handle}
              </button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
