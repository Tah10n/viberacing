"use client";

import { PageHeader, Panel } from "./components/ui";

export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="narrow state-page">
      <PageHeader
        description="Your account and race data were not changed."
        eyebrow="Temporary problem"
        title="The timing board stalled"
      />
      <Panel className="state-panel state-panel-error">
        <p>Try the request once more. If the problem continues, return to the standings.</p>
        <button className="button" onClick={reset} type="button">
          Try again
        </button>
      </Panel>
    </main>
  );
}
