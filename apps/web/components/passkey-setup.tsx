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

interface PasskeyAddFormProps {
  readonly locale: Locale;
}

interface PasskeyAddOptions {
  readonly authenticationOptions: PublicKeyCredentialRequestOptionsJSON;
  readonly registrationOptions: PublicKeyCredentialCreationOptionsJSON;
}

export function PasskeyAddForm({ locale }: PasskeyAddFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const copy = joinTranslations[locale];

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError(true);
      return;
    }
    const form = new FormData(event.currentTarget);
    const label = form.get("label");
    if (typeof label !== "string") {
      setError(true);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const optionsResponse = await fetch("/auth/passkeys/add/options", {
        body: JSON.stringify({ label }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      if (!optionsResponse.ok) {
        throw new Error("options unavailable");
      }
      const options = (await optionsResponse.json()) as PasskeyAddOptions;
      const authentication = await startAuthentication({
        optionsJSON: options.authenticationOptions,
      });
      const registration = await startRegistration({
        optionsJSON: options.registrationOptions,
      });
      const verification = await fetch("/auth/passkeys/add/verify", {
        body: JSON.stringify({ authentication, registration }),
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
      setError(true);
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>
        {copy.passkeyLabel}
        <input autoComplete="off" maxLength={64} name="label" required type="text" />
        <small>{copy.addPasskeyCopy}</small>
      </label>
      <button className="primary-action" disabled={busy} type="submit">
        {busy ? copy.addingPasskey : copy.addPasskey}
      </button>
      <span aria-live="polite" className={error ? "auth-error" : "auth-status"}>
        {error ? copy.genericError : ""}
      </span>
    </form>
  );
}

interface PasskeyRevokeButtonProps {
  readonly label: string;
  readonly locale: Locale;
  readonly passkeyId: string;
}

export function PasskeyRevokeButton({ label, locale, passkeyId }: PasskeyRevokeButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const copy = joinTranslations[locale];

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError(true);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const optionsResponse = await fetch("/auth/passkeys/revoke/options", {
        body: JSON.stringify({ passkeyId }),
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
      const verification = await fetch("/auth/passkeys/revoke/verify", {
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
      setError(true);
      setBusy(false);
    }
  }

  return (
    <form className="passkey-revoke" onSubmit={(event) => void submit(event)}>
      <button
        aria-label={`${copy.revokePasskey}: ${label}`}
        className="danger-action"
        disabled={busy}
        type="submit"
      >
        {busy ? copy.revokingPasskey : copy.revokePasskey}
      </button>
      <span aria-live="polite" className={error ? "auth-error" : "auth-status"}>
        {error ? copy.genericError : ""}
      </span>
    </form>
  );
}

interface SourcePasskeyActionButtonProps {
  readonly action: "reactivate" | "unlink";
  readonly label: string;
  readonly locale: Locale;
  readonly sourceControl: string;
}

function SourcePasskeyActionButton({
  action,
  label,
  locale,
  sourceControl,
}: SourcePasskeyActionButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const copy = joinTranslations[locale];
  const unlink = action === "unlink";
  const optionsPath = unlink ? "/auth/sources/unlink/options" : "/auth/sources/reactivate/options";
  const verifyPath = unlink ? "/auth/sources/unlink/verify" : "/auth/sources/reactivate/verify";
  const actionLabel = unlink ? copy.unlinkSource : copy.reactivateSource;
  const busyLabel = unlink ? copy.unlinkingSource : copy.reactivatingSource;

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError(true);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const optionsResponse = await fetch(optionsPath, {
        body: JSON.stringify({ sourceControl }),
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
      const verification = await fetch(verifyPath, {
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
      setError(true);
      setBusy(false);
    }
  }

  return (
    <form className="passkey-revoke" onSubmit={(event) => void submit(event)}>
      <button
        aria-label={`${actionLabel}: ${label}`}
        className={unlink ? "danger-action" : "secondary-action"}
        disabled={busy}
        type="submit"
      >
        {busy ? busyLabel : actionLabel}
      </button>
      <span aria-live="polite" className={error ? "auth-error" : "auth-status"}>
        {error ? copy.genericError : ""}
      </span>
    </form>
  );
}

interface SourceActionButtonProps {
  readonly label: string;
  readonly locale: Locale;
  readonly sourceControl: string;
}

export function SourceReactivationButton(props: SourceActionButtonProps) {
  return <SourcePasskeyActionButton action="reactivate" {...props} />;
}

export function SourceUnlinkButton(props: SourceActionButtonProps) {
  return <SourcePasskeyActionButton action="unlink" {...props} />;
}

interface ProfileDeletionFormProps {
  readonly handle: string;
  readonly locale: Locale;
}

export function ProfileDeletionForm({ handle, locale }: ProfileDeletionFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"generic" | "mismatch" | undefined>();
  const copy = joinTranslations[locale];

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const typedHandle = form.get("handle");
    if (typedHandle !== handle) {
      setError("mismatch");
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError("generic");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const optionsResponse = await fetch("/auth/profile/delete/options", {
        body: JSON.stringify({ handle: typedHandle }),
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
      const verification = await fetch("/auth/profile/delete/verify", {
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
      window.location.assign("/");
    } catch {
      setError("generic");
      setBusy(false);
    }
  }

  const errorMessage =
    error === "mismatch"
      ? copy.profileDeletionMismatch
      : error === "generic"
        ? copy.genericError
        : "";

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>
        {copy.profileDeletionHandleLabel}
        <input
          autoCapitalize="none"
          autoComplete="off"
          maxLength={24}
          minLength={3}
          name="handle"
          pattern="[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]"
          required
          spellCheck={false}
          type="text"
        />
        <small>
          {copy.profileDeletionHandleHelp} {handle}
        </small>
      </label>
      <button className="danger-action" disabled={busy} type="submit">
        {busy ? copy.deletingProfile : copy.deleteProfile}
      </button>
      <span aria-live="polite" className={error === undefined ? "auth-status" : "auth-error"}>
        {errorMessage}
      </span>
    </form>
  );
}
