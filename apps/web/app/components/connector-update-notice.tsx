import { CopyCommandButton } from "./copy-command-button";
import { Badge } from "./ui";

interface ConnectorUpdateNoticeProps {
  readonly command: string;
  readonly minimumVersion: string;
  readonly scope: "computer" | "computers";
}

export function ConnectorUpdateNotice({
  command,
  minimumVersion,
  scope,
}: ConnectorUpdateNoticeProps) {
  return (
    <section
      aria-label="Connector update required"
      className={`connector-update${scope === "computers" ? " connector-update-prominent" : ""}`}
    >
      <div className="connector-update-heading">
        <Badge tone="warning">Required</Badge>
        <strong>Connector update required</strong>
      </div>
      <p>
        Connector {minimumVersion} or newer and the current Browser Sync handler are required to
        restore supported automatic and browser Sync.
      </p>
      <pre>
        <code>{command}</code>
      </pre>
      <CopyCommandButton
        command={command}
        copiedLabel="Update command copied"
        label="Copy update command"
      />
      <p className="muted">
        Run this one-line command{" "}
        {scope === "computers" ? "on each affected computer" : "on this computer"}. Repair refreshes
        the installed runtime and hooks without collecting or uploading token totals.
      </p>
    </section>
  );
}
