import { ActionLink, PageHeader, PageShell, Panel } from "./components/ui";

export default function NotFound() {
  return (
    <PageShell className="state-page" width="narrow">
      <PageHeader
        description="This route is not on the current race map."
        eyebrow="Route not found"
        title="Lost the racing line"
      />
      <Panel className="state-panel">
        <p>The racer or page may have moved, left the leaderboard, or never existed.</p>
        <ActionLink href="/">Return to standings</ActionLink>
      </Panel>
    </PageShell>
  );
}
