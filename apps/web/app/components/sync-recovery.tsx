import { CopyCommandButton } from "./copy-command-button";

export function SyncRecovery({
  repairCommand,
  connectCommand,
  syncCommand,
  computer,
}: {
  readonly repairCommand: string;
  readonly connectCommand: string;
  readonly syncCommand: string;
  readonly computer: string;
}) {
  return (
    <details className="sync-recovery">
      <summary>Sync options</summary>
      <p>
        On {computer}, use the same local installation you connected. If you set{" "}
        <code>VIBERACING_STATE_DIR</code>, keep it set to that same value for every command below.
        Omitting it selects the default installation in <code>~/.viberacing</code> instead.
      </p>
      <p>
        <strong>Sync from the terminal</strong>
        <br />
        Browser Sync is unavailable for custom state directories. Repairing or reconnecting cannot
        enable it there. Use this command to sync the selected installation from the terminal.
      </p>
      <pre>
        <code>{syncCommand}</code>
      </pre>
      <CopyCommandButton
        command={syncCommand}
        label="Copy sync command"
        copiedLabel="Sync command copied"
      />
      <p>
        <strong>Restore Browser Sync for the default installation</strong>
        <br />
        Only if this installation uses <code>~/.viberacing</code>, run this command to repair its
        connector and Browser Sync handler.
      </p>
      <pre>
        <code>{repairCommand}</code>
      </pre>
      <CopyCommandButton
        command={repairCommand}
        label="Copy repair command"
        copiedLabel="Repair command copied"
      />
      <p>
        Then reconnect and approve the detected agents in this browser to link it to that computer.
      </p>
      <pre>
        <code>{connectCommand}</code>
      </pre>
      <CopyCommandButton
        command={connectCommand}
        label="Copy reconnect command"
        copiedLabel="Reconnect command copied"
      />
    </details>
  );
}
