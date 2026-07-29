"use client";

import Link from "next/link";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@/lib/browser-webauthn";
import type { Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";

const recoveryCodePattern =
  /^vrr1_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/;

function readRecoveryCodesResponse(value: unknown): readonly string[] | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const candidateCodes = record.recoveryCodes;
  if (
    Object.keys(record).length !== 1 ||
    !Array.isArray(candidateCodes) ||
    candidateCodes.length !== 10
  ) {
    return undefined;
  }
  const recoveryCodes = candidateCodes as readonly unknown[];
  if (
    recoveryCodes.some((code) => typeof code !== "string" || !recoveryCodePattern.test(code)) ||
    new Set(recoveryCodes).size !== recoveryCodes.length
  ) {
    return undefined;
  }
  return Object.freeze([...recoveryCodes]) as readonly string[];
}

interface PasskeySetupProps {
  readonly enrollmentEnabled?: boolean;
  readonly initialHandle?: string;
  readonly locale: Locale;
}

export function PasskeySetup({
  enrollmentEnabled = false,
  initialHandle = "",
  locale,
}: PasskeySetupProps) {
  const copy = joinTranslations[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!enrollmentEnabled || busy) {
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError(copy.unsupportedPasskey);
      return;
    }
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const handle = form.get("handle");
    try {
      if (
        typeof handle !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/.test(handle) ||
        handle.startsWith("pending_")
      ) {
        throw new Error("invalid handle");
      }
      const optionsResponse = await fetch("/auth/passkey/options", {
        body: JSON.stringify({ handle }),
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
      window.location.assign("/connect");
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
        {initialHandle === "" ? null : <p className="eyebrow">@{initialHandle}</p>}
        <h1 id="passkey-title">{copy.passkeyTitle}</h1>
        <p>{copy.passkeyCopy}</p>
        {enrollmentEnabled ? (
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>{copy.handleLabel}</span>
              <input
                autoComplete="nickname"
                defaultValue={initialHandle}
                maxLength={24}
                minLength={3}
                name="handle"
                pattern="[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]"
                required
                spellCheck={false}
              />
              <small>{copy.handleHint}</small>
            </label>
            <p className="auth-status">{copy.primaryPasskey}</p>
            <button className="primary-action" disabled={busy} type="submit">
              {busy ? copy.creatingPasskey : copy.createPasskey}
            </button>
          </form>
        ) : (
          <p className="auth-status" role="status">
            {copy.enrollmentCompletionUnavailable}
          </p>
        )}
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
  readonly returnTo?: string;
}

export function PasskeyLogin({ initialError = false, returnTo = "/account" }: PasskeyLoginProps) {
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
      window.location.assign(returnTo);
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
        <Link href="/recover">{copy.recoverAccount}</Link>
        <Link href="/join">{copy.needInvite}</Link>
      </section>
    </main>
  );
}

export function RecoveryExperience() {
  const [locale, setLocale] = useState<Locale>("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"generic" | "unsupported" | undefined>();
  const copy = joinTranslations[locale];

  useEffect(() => {
    try {
      const storedLocale = localStorage.getItem("viberacing.locale");
      if (storedLocale === "en" || storedLocale === "ru") {
        setLocale(storedLocale);
      }
    } catch {
      // Recovery remains usable with the English default when local preferences are blocked.
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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const code = form.get("code");
    const label = form.get("label");
    if (typeof code !== "string" || typeof label !== "string") {
      setError("generic");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const optionsResponse = await fetch("/auth/recovery/options", {
        body: JSON.stringify({ code, label }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      const codeInput = formElement.querySelector<HTMLInputElement>('input[name="code"]');
      if (codeInput !== null) {
        codeInput.value = "";
      }
      if (!optionsResponse.ok) {
        throw new Error("recovery unavailable");
      }
      const options = (await optionsResponse.json()) as PublicKeyCredentialCreationOptionsJSON;
      const response = await startRegistration({ optionsJSON: options });
      const verification = await fetch("/auth/recovery/verify", {
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
      <section aria-labelledby="recovery-title" className="auth-card">
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
        <h1 id="recovery-title">{copy.recoverySignInTitle}</h1>
        <p>{copy.recoverySignInCopy}</p>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>{copy.recoveryCodeLabel}</span>
            <input
              aria-describedby="recovery-code-help"
              autoCapitalize="none"
              autoComplete="off"
              maxLength={128}
              minLength={1}
              name="code"
              required
              spellCheck={false}
            />
          </label>
          <small id="recovery-code-help">{copy.recoveryCodeHelp}</small>
          <label>
            <span>{copy.recoveryPasskeyLabel}</span>
            <input maxLength={64} minLength={1} name="label" required />
          </label>
          <button className="primary-action" disabled={busy} type="submit">
            {busy ? copy.recovering : copy.recoveryContinue}
          </button>
        </form>
        <p aria-live="polite" className={errorMessage === undefined ? "auth-status" : "auth-error"}>
          {errorMessage ?? ""}
        </p>
        <p className="auth-privacy">{copy.privacyNote}</p>
        <Link href="/login">{copy.signInWithPasskey}</Link>
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

interface RecoveryCodeRotationProps {
  readonly locale: Locale;
}

export function RecoveryCodeRotation({ locale }: RecoveryCodeRotationProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>();
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
    setRecoveryCodes(undefined);
    try {
      const optionsResponse = await fetch("/auth/recovery-codes/options", {
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
      const verification = await fetch("/auth/recovery-codes/verify", {
        body: JSON.stringify({ response }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      if (!verification.ok) {
        throw new Error("verification failed");
      }
      const codes = readRecoveryCodesResponse((await verification.json()) as unknown);
      if (codes === undefined) {
        throw new Error("response invalid");
      }
      setRecoveryCodes(codes);
      setBusy(false);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <button className="primary-action" disabled={busy} type="submit">
          {busy ? copy.recoveryCodesGenerating : copy.recoveryCodesGenerate}
        </button>
        <span aria-live="polite" className={error ? "auth-error" : "auth-status"}>
          {error ? copy.genericError : ""}
        </span>
      </form>
      {recoveryCodes === undefined ? null : (
        <div className="recovery-code-result">
          <p className="auth-status" role="status">
            {copy.recoveryCodesReplaced}
          </p>
          <ol className="recovery-code-list">
            {recoveryCodes.map((code) => (
              <li key={code}>
                <code dir="ltr">{code}</code>
              </li>
            ))}
          </ol>
          <p className="auth-privacy">{copy.recoveryCodesOnce}</p>
        </div>
      )}
    </>
  );
}

type AccountTargetAction = "reactivate" | "unlink" | "revoke-device" | "revoke-installation";

interface AccountTargetPasskeyActionButtonProps {
  readonly action: AccountTargetAction;
  readonly label: string;
  readonly locale: Locale;
  readonly targetControl: string;
}

function AccountTargetPasskeyActionButton({
  action,
  label,
  locale,
  targetControl,
}: AccountTargetPasskeyActionButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const copy = joinTranslations[locale];
  const actionConfig: Record<
    AccountTargetAction,
    Readonly<{
      actionLabel: string;
      busyLabel: string;
      optionsPath: string;
      verifyPath: string;
    }>
  > = {
    reactivate: {
      actionLabel: copy.reactivateAccount,
      busyLabel: copy.reactivatingAccount,
      optionsPath: "/auth/accounts/reactivate/options",
      verifyPath: "/auth/accounts/reactivate/verify",
    },
    unlink: {
      actionLabel: copy.unlinkAccount,
      busyLabel: copy.unlinkingAccount,
      optionsPath: "/auth/accounts/unlink/options",
      verifyPath: "/auth/accounts/unlink/verify",
    },
    "revoke-device": {
      actionLabel: copy.revokeDevice,
      busyLabel: copy.revokingDevice,
      optionsPath: "/auth/devices/revoke/options",
      verifyPath: "/auth/devices/revoke/verify",
    },
    "revoke-installation": {
      actionLabel: copy.revokeInstallation,
      busyLabel: copy.revokingInstallation,
      optionsPath: "/auth/installations/revoke/options",
      verifyPath: "/auth/installations/revoke/verify",
    },
  };
  const config = actionConfig[action];
  const destructive = action !== "reactivate";

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
      const optionsResponse = await fetch(config.optionsPath, {
        body: JSON.stringify({ targetControl }),
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
      const verification = await fetch(config.verifyPath, {
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
        aria-label={`${config.actionLabel}: ${label}`}
        className={destructive ? "danger-action" : "secondary-action"}
        disabled={busy}
        type="submit"
      >
        {busy ? config.busyLabel : config.actionLabel}
      </button>
      <span aria-live="polite" className={error ? "auth-error" : "auth-status"}>
        {error ? copy.genericError : ""}
      </span>
    </form>
  );
}

interface AccountTargetActionButtonProps {
  readonly label: string;
  readonly locale: Locale;
  readonly targetControl: string;
}

export function AccountReactivationButton(props: AccountTargetActionButtonProps) {
  return <AccountTargetPasskeyActionButton action="reactivate" {...props} />;
}

export function AccountUnlinkButton(props: AccountTargetActionButtonProps) {
  return <AccountTargetPasskeyActionButton action="unlink" {...props} />;
}

export function DeviceRevokeButton(props: AccountTargetActionButtonProps) {
  return <AccountTargetPasskeyActionButton action="revoke-device" {...props} />;
}

export function InstallationRevokeButton(props: AccountTargetActionButtonProps) {
  return <AccountTargetPasskeyActionButton action="revoke-installation" {...props} />;
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
