import Link from "next/link";

interface RacerLinkProps {
  readonly handle: string;
  readonly periodSearch: string;
}

export function RacerLink({ handle, periodSearch }: RacerLinkProps) {
  const label = `@${handle}`;

  return (
    <Link
      aria-label={`${label} leaderboard profile`}
      className="leaderboard-profile-link"
      href={`/u/${encodeURIComponent(handle)}?${periodSearch}`}
    >
      {label}
    </Link>
  );
}
