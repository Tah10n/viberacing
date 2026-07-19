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

import { connectTranslations } from "@/lib/connect-i18n";
import type { Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";

const recoveryCodePattern =
  /^vrr1_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/;
const pairingFingerprintPattern = /^SHA256:[A-Za-z0-9_-]{43}$/;
const pairingVersionPattern =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

interface PairingReview {
  readonly options: PublicKeyCredentialRequestOptionsJSON;
  readonly pairing: Readonly<{
    architecture: "aarch64" | "x86_64";
    connectorVersion: string;
    deviceLabel: string;
    expiresAt: string;
    osFamily: "linux" | "macos" | "windows";
    publicKeyFingerprint: string;
  }>;
}

export interface PairingExistingSourceChoice {
  readonly deviceLabels: readonly string[];
  readonly sourceControl: string;
  readonly sourceNumber: number;
}

type PairingReviewTarget =
  Readonly<{ kind: "new" }> | Readonly<{ kind: "existing"; sourceNumber: number }>;

interface PairingReviewState {
  readonly review: PairingReview;
  readonly target: PairingReviewTarget;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function readPairingReview(value: unknown): PairingReview | undefined {
  if (!plainRecord(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const options = value.options;
  const pairing = value.pairing;
  if (
    !plainRecord(options) ||
    typeof options.challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(options.challenge) ||
    !plainRecord(pairing) ||
    Object.keys(pairing).length !== 6 ||
    typeof pairing.deviceLabel !== "string" ||
    pairing.deviceLabel.length < 1 ||
    pairing.deviceLabel.length > 128 ||
    pairing.deviceLabel !== pairing.deviceLabel.trim() ||
    pairing.deviceLabel !== pairing.deviceLabel.normalize("NFC") ||
    Array.from(pairing.deviceLabel).length > 64 ||
    typeof pairing.connectorVersion !== "string" ||
    !pairingVersionPattern.test(pairing.connectorVersion) ||
    (pairing.osFamily !== "linux" &&
      pairing.osFamily !== "macos" &&
      pairing.osFamily !== "windows") ||
    (pairing.architecture !== "aarch64" && pairing.architecture !== "x86_64") ||
    typeof pairing.expiresAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(pairing.expiresAt) ||
    !Number.isFinite(new Date(pairing.expiresAt).valueOf()) ||
    typeof pairing.publicKeyFingerprint !== "string" ||
    !pairingFingerprintPattern.test(pairing.publicKeyFingerprint)
  ) {
    return undefined;
  }
  return Object.freeze({
    options: options as unknown as PublicKeyCredentialRequestOptionsJSON,
    pairing: Object.freeze({
      architecture: pairing.architecture,
      connectorVersion: pairing.connectorVersion,
      deviceLabel: pairing.deviceLabel,
      expiresAt: pairing.expiresAt,
      osFamily: pairing.osFamily,
      publicKeyFingerprint: pairing.publicKeyFingerprint,
    }),
  });
}

interface PasskeySetupProps {
  readonly enrollmentEnabled?: boolean;
  readonly handle: string;
  readonly locale: Locale;
}

export function PasskeySetup({ enrollmentEnabled = false, handle, locale }: PasskeySetupProps) {
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
        {enrollmentEnabled ? (
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

interface PairingApprovalFormProps {
  readonly existingSources?: readonly PairingExistingSourceChoice[];
  readonly locale: Locale;
  readonly sourceCreationEnabled: boolean;
}

export function PairingApprovalForm({
  existingSources,
  locale,
  sourceCreationEnabled,
}: PairingApprovalFormProps) {
  const copy = connectTranslations[locale];
  const canCreateSource = sourceCreationEnabled;
  const canChooseSource = canCreateSource || (existingSources?.length ?? 0) > 0;
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"generic" | "unsupported" | undefined>();
  const [reviewState, setReviewState] = useState<PairingReviewState>();

  async function findPairing(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const enteredCode = form.get("userCode");
    const selectedTarget = form.get("sourceTarget");
    formElement.reset();
    if (typeof enteredCode !== "string" || typeof selectedTarget !== "string") {
      setError("generic");
      return;
    }
    const userCode = enteredCode.trim().toUpperCase();
    let requestBody:
      | Readonly<{ sourceChoice: "new"; userCode: string }>
      | Readonly<{ sourceChoice: "existing"; sourceControl: string; userCode: string }>;
    let target: PairingReviewTarget;
    if (selectedTarget === "new") {
      if (!canCreateSource) {
        setError("generic");
        return;
      }
      requestBody = Object.freeze({ sourceChoice: "new", userCode });
      target = Object.freeze({ kind: "new" });
    } else {
      const existingSource = existingSources?.find(
        (source) => source.sourceControl === selectedTarget,
      );
      if (existingSource === undefined) {
        setError("generic");
        return;
      }
      requestBody = Object.freeze({
        sourceChoice: "existing",
        sourceControl: existingSource.sourceControl,
        userCode,
      });
      target = Object.freeze({ kind: "existing", sourceNumber: existingSource.sourceNumber });
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/auth/pairing/options", {
        body: JSON.stringify(requestBody),
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      if (!response.ok) {
        throw new Error("pairing unavailable");
      }
      const parsed = readPairingReview((await response.json()) as unknown);
      if (parsed === undefined) {
        throw new Error("pairing response invalid");
      }
      setReviewState(Object.freeze({ review: parsed, target }));
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  async function approvePairing(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || reviewState === undefined) {
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError("unsupported");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await startAuthentication({ optionsJSON: reviewState.review.options });
      const verification = await fetch("/auth/pairing/verify", {
        body: JSON.stringify({ response }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      if (verification.status !== 204) {
        throw new Error("pairing approval failed");
      }
      setApproved(true);
      setReviewState(undefined);
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  if (approved) {
    return (
      <section aria-labelledby="pairing-approved-title" className="account-security">
        <h2 id="pairing-approved-title">{copy.approvedTitle}</h2>
        <p className="auth-status" role="status">
          {copy.approvedCopy}
        </p>
        <Link href="/account">{copy.backToAccount}</Link>
      </section>
    );
  }

  if (reviewState === undefined) {
    return (
      <form className="auth-form" onSubmit={(event) => void findPairing(event)}>
        <label>
          <span>{copy.codeLabel}</span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            maxLength={14}
            minLength={14}
            name="userCode"
            pattern="[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){2}"
            placeholder="7K9M-P2QR-W4XY"
            required
            spellCheck={false}
            type="text"
          />
          <small>{copy.codeHint}</small>
        </label>
        <fieldset className="pairing-source-options">
          <legend>{copy.sourceChoice}</legend>
          {canCreateSource ? (
            <label className="pairing-source-option">
              <input defaultChecked name="sourceTarget" type="radio" value="new" />
              <span>
                <strong>{copy.newSource}</strong>
                <small>{copy.newSourceCopy}</small>
              </span>
            </label>
          ) : (
            <small className="auth-status">{copy.sourceCreationUnavailable}</small>
          )}
          {existingSources?.map((source, sourceIndex) => (
            <label className="pairing-source-option" key={source.sourceControl}>
              <input
                defaultChecked={!canCreateSource && sourceIndex === 0}
                name="sourceTarget"
                type="radio"
                value={source.sourceControl}
              />
              <span>
                <strong>
                  {copy.existingSource} {source.sourceNumber}
                </strong>
                <small>{copy.existingSourceCopy}</small>
                <small>
                  {source.deviceLabels.length === 0
                    ? copy.noSourceDevices
                    : `${copy.sourceDevices}: ${source.deviceLabels.join(", ")}`}
                </small>
              </span>
            </label>
          ))}
          {existingSources === undefined ? (
            canCreateSource ? (
              <small className="auth-status">{copy.existingSourcesUnavailable}</small>
            ) : null
          ) : existingSources.length === 0 ? (
            <small className="auth-status">{copy.noExistingSources}</small>
          ) : null}
        </fieldset>
        <button className="primary-action" disabled={busy || !canChooseSource} type="submit">
          {busy ? copy.searching : copy.submitCode}
        </button>
        <span aria-live="polite" className={error === undefined ? "auth-status" : "auth-error"}>
          {error === "unsupported" ? copy.unsupported : error === "generic" ? copy.error : ""}
        </span>
      </form>
    );
  }

  const { review, target } = reviewState;

  const platform =
    review.pairing.osFamily === "macos"
      ? "macOS"
      : review.pairing.osFamily === "windows"
        ? "Windows"
        : "Linux";

  return (
    <section aria-labelledby="pairing-review-title" className="account-security">
      <h2 id="pairing-review-title">{copy.reviewTitle}</h2>
      <p>{copy.reviewCopy}</p>
      <dl className="pairing-details">
        <div>
          <dt>{copy.device}</dt>
          <dd>{review.pairing.deviceLabel}</dd>
        </div>
        <div>
          <dt>{copy.connector}</dt>
          <dd>{review.pairing.connectorVersion}</dd>
        </div>
        <div>
          <dt>{copy.platform}</dt>
          <dd>{platform}</dd>
        </div>
        <div>
          <dt>{copy.architecture}</dt>
          <dd>{review.pairing.architecture}</dd>
        </div>
        <div>
          <dt>{copy.source}</dt>
          <dd>
            {target.kind === "new"
              ? copy.newSource
              : `${copy.existingSource} ${String(target.sourceNumber)}`}
          </dd>
        </div>
        <div>
          <dt>{copy.expires}</dt>
          <dd>
            <time dateTime={review.pairing.expiresAt}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(review.pairing.expiresAt))}
            </time>
          </dd>
        </div>
        <div className="pairing-fingerprint">
          <dt>{copy.fingerprint}</dt>
          <dd>
            <code>{review.pairing.publicKeyFingerprint}</code>
          </dd>
        </div>
      </dl>
      <form className="auth-form" onSubmit={(event) => void approvePairing(event)}>
        <button className="primary-action" disabled={busy} type="submit">
          {busy ? copy.approving : copy.approve}
        </button>
        <span aria-live="polite" className={error === undefined ? "auth-status" : "auth-error"}>
          {error === "unsupported" ? copy.unsupported : error === "generic" ? copy.error : ""}
        </span>
      </form>
    </section>
  );
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
