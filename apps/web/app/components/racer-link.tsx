interface RacerLinkProps {
  readonly handle: string;
}

export function RacerLink({ handle }: RacerLinkProps) {
  const label = `@${handle}`;

  return (
    <a
      aria-label={`${label} on GitHub (opens in a new tab)`}
      className="github-profile-link"
      href={`https://github.com/${encodeURIComponent(handle)}`}
      rel="noreferrer"
      target="_blank"
    >
      {label}
    </a>
  );
}
