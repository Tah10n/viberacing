"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";

import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";

import type { Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";

interface PasskeySetupProps {
  readonly handle: string;
  readonly locale: Locale;
}

export function PasskeySetup({ handle, locale }: PasskeySetupProps) {
  const copy = joinTranslations[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError(copy.unsupportedPasskey);
      return;
    }
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const label = form.get("label");
    try {
      if (typeof label !== "string") {
        throw new Error("invalid label");
      }
      const optionsResponse = await fetch("/auth/passkey/options", {
        body: "{}",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      if (!optionsResponse.ok) {
        throw new Error("options unavailable");
      }
      const options = (await optionsResponse.json()) as PublicKeyCredentialCreationOptionsJSON;
      const response = await startRegistration({ optionsJSON: options });
      const verification = await fetch("/auth/passkey/verify", {
        body: JSON.stringify({ label, response }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      if (verification.status !== 204) {
        throw new Error("verification failed");
      }
      window.location.assign("/account");
    } catch {
      setError(copy.genericError);
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell" lang={locale}>
      <section aria-labelledby="passkey-title" className="auth-card">
        <Link className="auth-brand" href="/">
          <span aria-hidden="true">▰</span> {copy.brand}
        </Link>
        <p className="eyebrow">@{handle}</p>
        <h1 id="passkey-title">{copy.passkeyTitle}</h1>
        <p>{copy.passkeyCopy}</p>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>{copy.passkeyLabel}</span>
            <input
              defaultValue={copy.primaryPasskey}
              maxLength={64}
              minLength={1}
              name="label"
              required
            />
          </label>
          <button className="primary-action" disabled={busy} type="submit">
            {busy ? copy.creatingPasskey : copy.createPasskey}
          </button>
        </form>
        <p aria-live="polite" className={error === undefined ? "auth-status" : "auth-error"}>
          {error ?? ""}
        </p>
        <p className="auth-privacy">{copy.privacyNote}</p>
      </section>
    </main>
  );
}
