"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@/lib/browser-webauthn";
import { connectTranslations } from "@/lib/connect-i18n";
import type { Locale } from "@/lib/i18n";

const pairingIdPattern = /^pair_[A-Za-z0-9_-]{22}$/;
const candidateIdPattern = /^cand_[A-Za-z0-9_-]{22}$/;
const accountControlPattern = /^ctl_[A-Za-z0-9_-]{23}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const pairingFingerprintPattern = /^SHA256:[A-Za-z0-9_-]{43}$/;
const pairingVersionPattern =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const userCodePattern = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/;
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const previewStatuses = new Set([
  "incomplete_period",
  "reader_error",
  "ready",
  "unavailable",
  "unsupported_scope",
  "unsupported_version",
]);

interface PairingCandidate {
  readonly candidateId: string;
  readonly fingerprintKind: "stable_opaque" | "unavailable";
  readonly preview: Readonly<{
    currentWeekTokenTotal: string;
    lastUsageDate: string | null;
    status: string;
  }>;
  readonly provider: "codex";
  readonly safeDisplayLabel: string;
  readonly suggestedAgentAccountControl?: string;
}

interface PairingExistingAccount {
  readonly accountControl: string;
  readonly privateLabel: string;
  readonly provider: "codex";
  readonly state: "active" | "paused";
}

interface BatchPairingReview {
  readonly approval: Readonly<{
    manifestDigest: string;
    pairingId: string;
    schemaVersion: 1;
  }>;
  readonly pairing: Readonly<{
    architecture: "aarch64" | "x86_64";
    candidates: readonly PairingCandidate[];
    connectorVersion: string;
    existingAccounts: readonly PairingExistingAccount[];
    expiresAt: string;
    installationLabel: string;
    osFamily: "linux" | "macos" | "windows";
    publicKeyFingerprint: string;
  }>;
}

type PairingDraftAction = "create" | "skip" | `attach:${string}`;

interface PairingDecisionDraft {
  readonly action: PairingDraftAction;
  readonly candidateId: string;
  readonly privateLabel: string;
}

interface BatchPairingApprovalFormProps {
  readonly initialCode?: string;
  readonly locale: Locale;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key)) &&
    keys.length >= required.length &&
    keys.length <= required.length + optional.length
  );
}

function normalizedLabel(value: unknown, maximumCharacters: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value === value.normalize("NFC") &&
    value.length > 0 &&
    value.length <= maximumCharacters &&
    Array.from(value).length <= maximumCharacters &&
    !unsafeLabelPattern.test(value)
  );
}

function exactTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function readCandidate(value: unknown): PairingCandidate | undefined {
  if (
    !plainRecord(value) ||
    !exactKeys(
      value,
      ["candidateId", "fingerprintKind", "preview", "provider", "safeDisplayLabel"],
      ["suggestedAgentAccountControl"],
    ) ||
    typeof value.candidateId !== "string" ||
    !candidateIdPattern.test(value.candidateId) ||
    (value.fingerprintKind !== "stable_opaque" && value.fingerprintKind !== "unavailable") ||
    value.provider !== "codex" ||
    !normalizedLabel(value.safeDisplayLabel, 64) ||
    !plainRecord(value.preview) ||
    !exactKeys(value.preview, ["currentWeekTokenTotal", "lastUsageDate", "status"]) ||
    typeof value.preview.currentWeekTokenTotal !== "string" ||
    !/^(?:0|[1-9][0-9]{0,59})$/.test(value.preview.currentWeekTokenTotal) ||
    (value.preview.lastUsageDate !== null &&
      (typeof value.preview.lastUsageDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.preview.lastUsageDate))) ||
    typeof value.preview.status !== "string" ||
    !previewStatuses.has(value.preview.status) ||
    (value.suggestedAgentAccountControl !== undefined &&
      (value.fingerprintKind !== "stable_opaque" ||
        typeof value.suggestedAgentAccountControl !== "string" ||
        !accountControlPattern.test(value.suggestedAgentAccountControl)))
  ) {
    return undefined;
  }
  return Object.freeze({
    candidateId: value.candidateId,
    fingerprintKind: value.fingerprintKind,
    preview: Object.freeze({
      currentWeekTokenTotal: value.preview.currentWeekTokenTotal,
      lastUsageDate: value.preview.lastUsageDate,
      status: value.preview.status,
    }),
    provider: value.provider,
    safeDisplayLabel: value.safeDisplayLabel,
    ...(value.suggestedAgentAccountControl === undefined
      ? {}
      : { suggestedAgentAccountControl: value.suggestedAgentAccountControl }),
  });
}

function readExistingAccount(value: unknown): PairingExistingAccount | undefined {
  if (
    !plainRecord(value) ||
    !exactKeys(value, ["accountControl", "privateLabel", "provider", "state"]) ||
    typeof value.accountControl !== "string" ||
    !accountControlPattern.test(value.accountControl) ||
    !normalizedLabel(value.privateLabel, 64) ||
    value.provider !== "codex" ||
    (value.state !== "active" && value.state !== "paused")
  ) {
    return undefined;
  }
  return Object.freeze({
    accountControl: value.accountControl,
    privateLabel: value.privateLabel,
    provider: value.provider,
    state: value.state,
  });
}

function readBatchPairingReview(value: unknown): BatchPairingReview | undefined {
  if (
    !plainRecord(value) ||
    !exactKeys(value, ["approval", "pairing"]) ||
    !plainRecord(value.approval) ||
    !exactKeys(value.approval, ["manifestDigest", "pairingId", "schemaVersion"]) ||
    value.approval.schemaVersion !== 1 ||
    typeof value.approval.pairingId !== "string" ||
    !pairingIdPattern.test(value.approval.pairingId) ||
    typeof value.approval.manifestDigest !== "string" ||
    !digestPattern.test(value.approval.manifestDigest) ||
    !plainRecord(value.pairing) ||
    !exactKeys(value.pairing, [
      "architecture",
      "candidates",
      "connectorVersion",
      "existingAccounts",
      "expiresAt",
      "installationLabel",
      "osFamily",
      "publicKeyFingerprint",
    ]) ||
    (value.pairing.architecture !== "aarch64" && value.pairing.architecture !== "x86_64") ||
    typeof value.pairing.connectorVersion !== "string" ||
    !pairingVersionPattern.test(value.pairing.connectorVersion) ||
    !exactTimestamp(value.pairing.expiresAt) ||
    !normalizedLabel(value.pairing.installationLabel, 64) ||
    (value.pairing.osFamily !== "linux" &&
      value.pairing.osFamily !== "macos" &&
      value.pairing.osFamily !== "windows") ||
    typeof value.pairing.publicKeyFingerprint !== "string" ||
    !pairingFingerprintPattern.test(value.pairing.publicKeyFingerprint) ||
    !Array.isArray(value.pairing.candidates) ||
    value.pairing.candidates.length < 1 ||
    value.pairing.candidates.length > 16 ||
    !Array.isArray(value.pairing.existingAccounts) ||
    value.pairing.existingAccounts.length > 128
  ) {
    return undefined;
  }
  const candidates = value.pairing.candidates.map(readCandidate);
  const accounts = value.pairing.existingAccounts.map(readExistingAccount);
  if (
    candidates.some((candidate) => candidate === undefined) ||
    accounts.some((account) => account === undefined)
  ) {
    return undefined;
  }
  const parsedCandidates = candidates as PairingCandidate[];
  const parsedAccounts = accounts as PairingExistingAccount[];
  const candidateIds = parsedCandidates.map((candidate) => candidate.candidateId);
  const accountControls = parsedAccounts.map((account) => account.accountControl);
  if (
    new Set(candidateIds).size !== candidateIds.length ||
    new Set(accountControls).size !== accountControls.length ||
    parsedCandidates.some(
      (candidate) =>
        candidate.suggestedAgentAccountControl !== undefined &&
        !accountControls.includes(candidate.suggestedAgentAccountControl),
    )
  ) {
    return undefined;
  }
  return Object.freeze({
    approval: Object.freeze({
      manifestDigest: value.approval.manifestDigest,
      pairingId: value.approval.pairingId,
      schemaVersion: 1,
    }),
    pairing: Object.freeze({
      architecture: value.pairing.architecture,
      candidates: Object.freeze(parsedCandidates),
      connectorVersion: value.pairing.connectorVersion,
      existingAccounts: Object.freeze(parsedAccounts),
      expiresAt: value.pairing.expiresAt,
      installationLabel: value.pairing.installationLabel,
      osFamily: value.pairing.osFamily,
      publicKeyFingerprint: value.pairing.publicKeyFingerprint,
    }),
  });
}

function readPasskeyOptions(value: unknown): PublicKeyCredentialRequestOptionsJSON | undefined {
  if (
    !plainRecord(value) ||
    !exactKeys(value, ["options"]) ||
    !plainRecord(value.options) ||
    typeof value.options.challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.options.challenge)
  ) {
    return undefined;
  }
  return value.options as unknown as PublicKeyCredentialRequestOptionsJSON;
}

function initialDrafts(review: BatchPairingReview): readonly PairingDecisionDraft[] {
  return Object.freeze(
    review.pairing.candidates.map((candidate) =>
      Object.freeze({
        action:
          candidate.suggestedAgentAccountControl === undefined
            ? "create"
            : (`attach:${candidate.suggestedAgentAccountControl}` as const),
        candidateId: candidate.candidateId,
        privateLabel: candidate.safeDisplayLabel,
      }),
    ),
  );
}

function platformLabel(osFamily: BatchPairingReview["pairing"]["osFamily"]): string {
  return osFamily === "macos" ? "macOS" : osFamily === "windows" ? "Windows" : "Linux";
}

export function BatchPairingApprovalForm({
  initialCode = "",
  locale,
}: BatchPairingApprovalFormProps) {
  const copy = connectTranslations[locale];
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"generic" | "unsupported" | undefined>();
  const [review, setReview] = useState<BatchPairingReview>();
  const [drafts, setDrafts] = useState<readonly PairingDecisionDraft[]>([]);

  async function findPairing(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const enteredCode = form.get("userCode");
    const userCode = typeof enteredCode === "string" ? enteredCode.trim().toUpperCase() : undefined;
    if (userCode === undefined || !userCodePattern.test(userCode)) {
      setError("generic");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/auth/pairing/review", {
        body: JSON.stringify({ userCode }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      const parsed = response.ok
        ? readBatchPairingReview((await response.json()) as unknown)
        : undefined;
      if (parsed === undefined) {
        throw new Error("pairing unavailable");
      }
      setReview(parsed);
      setDrafts(initialDrafts(parsed));
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  function updateAction(candidateId: string, action: PairingDraftAction): void {
    setDrafts((current) =>
      Object.freeze(
        current.map((draft) =>
          draft.candidateId === candidateId ? Object.freeze({ ...draft, action }) : draft,
        ),
      ),
    );
  }

  function updateLabel(candidateId: string, privateLabel: string): void {
    setDrafts((current) =>
      Object.freeze(
        current.map((draft) =>
          draft.candidateId === candidateId ? Object.freeze({ ...draft, privateLabel }) : draft,
        ),
      ),
    );
  }

  async function approvePairing(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || drafts.length !== review?.pairing.candidates.length) {
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError("unsupported");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const decisions = drafts.map((draft) => {
        if (draft.action === "skip") {
          return Object.freeze({ action: "skip" as const, candidateId: draft.candidateId });
        }
        if (draft.action === "create") {
          const privateLabel = draft.privateLabel.trim().normalize("NFC");
          if (!normalizedLabel(privateLabel, 64)) {
            throw new Error("private label invalid");
          }
          return Object.freeze({
            action: "create" as const,
            candidateId: draft.candidateId,
            privateLabel,
          });
        }
        return Object.freeze({
          action: "attach_existing" as const,
          candidateId: draft.candidateId,
          targetAgentAccountControl: draft.action.slice("attach:".length),
        });
      });
      const approval = Object.freeze({ ...review.approval, decisions: Object.freeze(decisions) });
      const optionsResponse = await fetch("/auth/pairing/options", {
        body: JSON.stringify(approval),
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
      });
      const options = optionsResponse.ok
        ? readPasskeyOptions((await optionsResponse.json()) as unknown)
        : undefined;
      if (options === undefined) {
        throw new Error("options unavailable");
      }
      const response = await startAuthentication({ optionsJSON: options });
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
      setReview(undefined);
      setDrafts([]);
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

  if (review === undefined) {
    return (
      <form className="auth-form" onSubmit={(event) => void findPairing(event)}>
        <label>
          <span>{copy.codeLabel}</span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            defaultValue={initialCode}
            inputMode="text"
            maxLength={14}
            minLength={14}
            name="userCode"
            pattern="[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}"
            placeholder="7K9M-P2QR-W4XY"
            required
            spellCheck={false}
            type="text"
          />
          <small>{copy.codeHint}</small>
        </label>
        <button className="primary-action" disabled={busy} type="submit">
          {busy ? copy.searching : copy.submitCode}
        </button>
        <span aria-live="polite" className={error === undefined ? "auth-status" : "auth-error"}>
          {error === "generic" ? copy.error : ""}
        </span>
      </form>
    );
  }

  return (
    <section aria-labelledby="pairing-review-title" className="account-security">
      <h2 id="pairing-review-title">{copy.reviewTitle}</h2>
      <p>{copy.reviewCopy}</p>
      <dl className="pairing-details">
        <div>
          <dt>{copy.installation}</dt>
          <dd>{review.pairing.installationLabel}</dd>
        </div>
        <div>
          <dt>{copy.connector}</dt>
          <dd>{review.pairing.connectorVersion}</dd>
        </div>
        <div>
          <dt>{copy.platform}</dt>
          <dd>{platformLabel(review.pairing.osFamily)}</dd>
        </div>
        <div>
          <dt>{copy.architecture}</dt>
          <dd>{review.pairing.architecture}</dd>
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
        <fieldset className="pairing-source-options">
          <legend>{copy.candidateChoices}</legend>
          {review.pairing.candidates.map((candidate, candidateIndex) => {
            const draft = drafts.find((item) => item.candidateId === candidate.candidateId);
            if (draft === undefined) {
              return null;
            }
            return (
              <section className="pairing-source-option" key={candidate.candidateId}>
                <div>
                  <strong>
                    {copy.accountCandidate} {String(candidateIndex + 1)} ·{" "}
                    {candidate.safeDisplayLabel}
                  </strong>
                  <small>
                    {copy.provider}: {candidate.provider} · {copy.currentWeek}:{" "}
                    {candidate.preview.currentWeekTokenTotal}
                  </small>
                  <small>
                    {copy.lastUsage}: {candidate.preview.lastUsageDate ?? copy.notAvailable} ·{" "}
                    {copy.readerStatus}: {candidate.preview.status}
                  </small>
                  <small>
                    {copy.identityEvidence}:{" "}
                    {candidate.fingerprintKind === "stable_opaque"
                      ? copy.stableFingerprint
                      : copy.fingerprintUnavailable}
                  </small>
                </div>
                <label>
                  <span>{copy.accountChoice}</span>
                  <select
                    onChange={(event) => {
                      updateAction(
                        candidate.candidateId,
                        event.currentTarget.value as PairingDraftAction,
                      );
                    }}
                    value={draft.action}
                  >
                    <option value="create">{copy.createAccount}</option>
                    {review.pairing.existingAccounts.map((account) => (
                      <option
                        key={account.accountControl}
                        value={`attach:${account.accountControl}`}
                      >
                        {copy.attachAccount}: {account.privateLabel} ({account.state})
                      </option>
                    ))}
                    <option value="skip">{copy.skipAccount}</option>
                  </select>
                  {candidate.suggestedAgentAccountControl === undefined ? (
                    <small>{copy.noSafeSuggestion}</small>
                  ) : (
                    <small>{copy.safeSuggestion}</small>
                  )}
                </label>
                {draft.action === "create" ? (
                  <label>
                    <span>{copy.privateLabel}</span>
                    <input
                      maxLength={64}
                      minLength={1}
                      onChange={(event) => {
                        updateLabel(candidate.candidateId, event.currentTarget.value);
                      }}
                      required
                      type="text"
                      value={draft.privateLabel}
                    />
                    <small>{copy.privateLabelHint}</small>
                  </label>
                ) : null}
              </section>
            );
          })}
        </fieldset>
        <button className="primary-action" disabled={busy} type="submit">
          {busy ? copy.approving : copy.approveBatch}
        </button>
        <span aria-live="polite" className={error === undefined ? "auth-status" : "auth-error"}>
          {error === "unsupported" ? copy.unsupported : error === "generic" ? copy.error : ""}
        </span>
      </form>
    </section>
  );
}
