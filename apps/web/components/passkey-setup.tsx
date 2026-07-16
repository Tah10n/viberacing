"use client";

import Link from "next/link";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
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

interface PasskeyLoginProps {
  readonly initialError?: boolean;
}

export function PasskeyLogin({ initialError = false }: PasskeyLoginProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"generic" | "unsupported" | undefined>(
    initialError ? "generic" : undefined,
  );
  const copy = joinTranslations[locale];

  useEffect(() => {
    try {
      const storedLocale = localStorage.getItem("viberacing.locale");
      if (storedLocale === "en" || storedLocale === "ru") {
        setLocale(storedLocale);
      }
    } catch {
      // Login remains usable with the English default when local preferences are blocked.
    }
  }, []);

  function selectLocale(nextLocale: Locale): void {
    setLocale(nextLocale);
    try {
      localStorage.setItem("viberacing.locale", nextLocale);
    } catch {
      // Locale persistence is optional.
    }
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError("unsupported");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const optionsResponse = await fetch("/auth/login/options", {
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
      const options = (await optionsResponse.json()) as PublicKeyCredentialRequestOptionsJSON;
      const response = await startAuthentication({ optionsJSON: options });
      const verification = await fetch("/auth/login/verify", {
        body: JSON.stringify({ response }),
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
      setError("generic");
      setBusy(false);
    }
  }

  const errorMessage =
    error === "unsupported"
      ? copy.unsupportedPasskey
      : error === "generic"
        ? copy.genericError
        : undefined;

  return (
    <main className="auth-shell" lang={locale}>
      <section aria-labelledby="login-title" className="auth-card">
        <Link className="auth-brand" href="/">
          <span aria-hidden="true">▰</span> {copy.brand}
        </Link>
        <div aria-label={copy.language} className="auth-language">
          <button
            aria-pressed={locale === "en"}
            onClick={() => {
              selectLocale("en");
            }}
            type="button"
          >
            {copy.english}
          </button>
          <button
            aria-pressed={locale === "ru"}
            onClick={() => {
              selectLocale("ru");
            }}
            type="button"
          >
            {copy.russian}
          </button>
        </div>
        <p className="eyebrow">Community · self-reported</p>
        <h1 id="login-title">{copy.loginTitle}</h1>
        <p>{copy.loginCopy}</p>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <button className="primary-action" disabled={busy} type="submit">
            {busy ? copy.signingIn : copy.signInWithPasskey}
          </button>
        </form>
        <p aria-live="polite" className={errorMessage === undefined ? "auth-status" : "auth-error"}>
          {errorMessage ?? ""}
        </p>
        <p className="auth-privacy">{copy.privacyNote}</p>
        <Link href="/join">{copy.needInvite}</Link>
      </section>
    </main>
  );
}
