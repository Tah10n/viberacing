"use client";

import { useState } from "react";

interface CopyCommandButtonProps {
  readonly command: string;
}

export function CopyCommandButton({ command }: CopyCommandButtonProps) {
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
        {status === "copied" ? "Copied" : "Copy connect command"}
      </button>
      <span aria-live="polite" className="copy-command-status">
        {status === "error" ? "Copy failed — select the command above." : ""}
      </span>
    </div>
  );
}
