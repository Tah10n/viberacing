"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";

interface SameOriginActionFormProps {
  readonly action: string;
  readonly children: ReactNode;
  readonly className?: string;
}

function actionError(status: number, code: unknown): string {
  if (status === 403) return "The action was rejected. Refresh the page and try again.";
  if (code === "primary_account_has_linked_accounts")
    return "This is the physical profile for other accounts. Delete those linked accounts first.";
  return `The action failed (${status.toString()}). Please try again.`;
}

function authenticationPath(): string {
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/api/auth/github/start?next=${encodeURIComponent(next)}`;
}

export function SameOriginActionForm({ action, children, className }: SameOriginActionFormProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitForm(form: HTMLFormElement): Promise<void> {
    if (!form.reportValidity()) return;
    const actionUrl = new URL(action, window.location.href);
    if (actionUrl.origin !== window.location.origin) {
      setError("The action location was invalid. Refresh the page.");
      return;
    }

    const body = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string") body.append(key, value);
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(actionUrl, {
        body,
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        redirect: "follow",
      });
      if (response.status === 401) {
        window.location.assign(authenticationPath());
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
        setError(actionError(response.status, payload?.error));
        return;
      }

      const destination = new URL(response.url, window.location.href);
      if (!response.redirected || destination.origin !== window.location.origin) {
        setError("The action completed, but the return location was invalid. Refresh the page.");
        return;
      }
      window.location.assign(destination.href);
    } catch {
      setError("The server could not be reached. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    if (pending) return;
    void submitForm(event.currentTarget);
  }

  return (
    <form action={action} aria-busy={pending} className={className} method="post" onSubmit={submit}>
      {children}
      {error === null ? null : (
        <p className="action-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
