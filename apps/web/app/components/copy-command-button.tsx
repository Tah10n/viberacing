"use client";

import { useState } from "react";

interface CopyCommandButtonProps {
  readonly command: string;
  readonly copiedLabel?: string;
  readonly label?: string;
}

export function CopyCommandButton({
  command,
  copiedLabel = "Copied",
  label = "Copy connect command",
}: CopyCommandButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="copy-command-action">
      <button
        className="button"
        onClick={() => {
          void copyCommand();
        }}
        type="button"
      >
        {status === "copied" ? copiedLabel : label}
      </button>
      <span aria-live="polite" className="copy-command-status">
        {status === "error" ? "Copy failed — select the command above." : ""}
      </span>
    </div>
  );
}
