"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface Grant {
  token: string;
  expiresAt: string;
}

interface SyncState {
  target: string;
  message: string;
  tone: "status" | "error";
}

interface BrowserSyncContextValue {
  ready: boolean;
  launchAccount(accountId: string): void;
  launchInstallation(): void;
  state: SyncState | null;
}

type SyncTarget = { accountId: string } | { scope: "installation" };

const installationSyncTarget = "installation";

const BrowserSyncContext = createContext<BrowserSyncContextValue | null>(null);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

const browserSyncStartTimeoutMs = 90_000;
export const browserSyncRunningTimeoutMs = 10 * 60_000;
export const browserSyncWaitingPollIntervalMs = 2_000;
export const browserSyncRunningPollIntervalMs = 5_000;
const maximumConsecutivePollFailures = 3;
const defaultGrantRetryAfterMs = 60_000;
const maximumGrantRetryAfterMs = 5 * 60_000;
const defaultStatusRetryAfterMs = 5_000;
const maximumStatusRetryAfterMs = 60_000;

function retryAfterMilliseconds(
  value: string | null,
  fallbackMilliseconds: number,
  maximumMilliseconds: number,
  now: number,
): number {
  let milliseconds = fallbackMilliseconds;
  if (value !== null && /^\d+$/.test(value.trim())) {
    milliseconds = Number(value.trim()) * 1_000;
  } else if (value !== null) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) milliseconds = timestamp - now;
  }
  if (!Number.isFinite(milliseconds)) return fallbackMilliseconds;
  return Math.min(maximumMilliseconds, Math.max(1_000, milliseconds));
}

export function grantRetryAfterMilliseconds(value: string | null, now = Date.now()): number {
  return retryAfterMilliseconds(value, defaultGrantRetryAfterMs, maximumGrantRetryAfterMs, now);
}

export function statusRetryAfterMilliseconds(value: string | null, now = Date.now()): number {
  return retryAfterMilliseconds(value, defaultStatusRetryAfterMs, maximumStatusRetryAfterMs, now);
}

type BrowserSyncPollOutcome =
  | { kind: "terminal"; status: "succeeded" | "partial" | "failed"; resultCode: string | null }
  | { kind: "not_started" }
  | { kind: "running_too_long" }
  | { kind: "running_unconfirmed" }
  | { kind: "unreadable" };

interface BrowserSyncPollDependencies {
  fetchStatus(): Promise<Response>;
  now(): number;
  onRunning(): void;
  pause(milliseconds: number): Promise<void>;
}

export async function pollBrowserSyncStatus(
  dependencies: BrowserSyncPollDependencies,
): Promise<BrowserSyncPollOutcome> {
  const startDeadline = dependencies.now() + browserSyncStartTimeoutMs;
  let runningDeadline: number | null = null;
  let consecutiveFailures = 0;
  let nextPollInterval = browserSyncWaitingPollIntervalMs;
  for (;;) {
    await dependencies.pause(nextPollInterval);
    nextPollInterval =
      runningDeadline === null
        ? browserSyncWaitingPollIntervalMs
        : browserSyncRunningPollIntervalMs;
    try {
      const response = await dependencies.fetchStatus();
      if (response.status === 429) {
        consecutiveFailures = 0;
        const deadline = runningDeadline ?? startDeadline;
        const now = dependencies.now();
        if (now >= deadline) {
          return { kind: runningDeadline === null ? "not_started" : "running_unconfirmed" };
        }
        nextPollInterval = Math.min(
          statusRetryAfterMilliseconds(response.headers.get("retry-after"), now),
          deadline - now,
        );
        continue;
      }
      if (response.status === 404) {
        consecutiveFailures = 0;
        if (runningDeadline !== null) return { kind: "running_unconfirmed" };
        if (dependencies.now() >= startDeadline) return { kind: "not_started" };
        continue;
      }
      if (!response.ok) throw new Error("status_failed");
      const result = (await response.json()) as { status?: string; resultCode?: string | null };
      if (result.status === "running") {
        consecutiveFailures = 0;
        if (runningDeadline === null) {
          runningDeadline = dependencies.now() + browserSyncRunningTimeoutMs;
          dependencies.onRunning();
        }
        nextPollInterval = browserSyncRunningPollIntervalMs;
        if (dependencies.now() >= runningDeadline) return { kind: "running_too_long" };
        continue;
      }
      if (
        result.status === "succeeded" ||
        result.status === "partial" ||
        result.status === "failed"
      ) {
        return {
          kind: "terminal",
          status: result.status,
          resultCode: typeof result.resultCode === "string" ? result.resultCode : null,
        };
      }
      throw new Error("status_failed");
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures < maximumConsecutivePollFailures) continue;
      return { kind: runningDeadline === null ? "unreadable" : "running_unconfirmed" };
    }
  }
}

export function BrowserSyncProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [grant, setGrant] = useState<Grant | null>(null);
  const [state, setState] = useState<SyncState | null>(null);
  const [grantRetryAt, setGrantRetryAt] = useState<number | null>(null);
  const grantRetryTimer = useRef<number | null>(null);

  const prepare = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch("/api/accounts/sync/grant", {
        credentials: "same-origin",
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
      });
      if (response.ok) {
        setGrant((await response.json()) as Grant);
        setGrantRetryAt(null);
      } else {
        setGrant(null);
        setGrantRetryAt(
          response.status === 429
            ? Date.now() + grantRetryAfterMilliseconds(response.headers.get("retry-after"))
            : null,
        );
      }
    } catch {
      setGrant(null);
      setGrantRetryAt(null);
    }
  }, [enabled]);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  useEffect(() => {
    if (grantRetryTimer.current !== null) window.clearTimeout(grantRetryTimer.current);
    grantRetryTimer.current = null;
    if (grantRetryAt === null) return;
    grantRetryTimer.current = window.setTimeout(
      () => {
        grantRetryTimer.current = null;
        setGrantRetryAt(null);
        void prepare();
      },
      Math.max(0, grantRetryAt - Date.now()),
    );
    return () => {
      if (grantRetryTimer.current !== null) window.clearTimeout(grantRetryTimer.current);
      grantRetryTimer.current = null;
    };
  }, [grantRetryAt, prepare]);

  const poll = useCallback(
    async (target: string, requestId: string) => {
      const outcome = await pollBrowserSyncStatus({
        fetchStatus: () =>
          fetch(`/api/accounts/sync/${encodeURIComponent(requestId)}`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: AbortSignal.timeout(10_000),
          }),
        now: Date.now,
        onRunning: () => {
          setState({ target, message: "Syncing…", tone: "status" });
        },
        pause: wait,
      });
      if (outcome.kind === "terminal" && outcome.status === "succeeded") {
        window.location.assign("/dashboard?browserSynced=1");
        return;
      }
      if (outcome.kind === "terminal" && outcome.status === "partial") {
        setState({
          target,
          message:
            outcome.resultCode === "partial_accounts_inactive"
              ? "Active accounts were synced. Switch Codex accounts to refresh the inactive ones."
              : outcome.resultCode === "account_setup_pending"
                ? "Codex account setup is pending. Try Sync again."
                : "Sync completed with warnings. Run viberacing doctor.",
          tone: "error",
        });
        void prepare();
        return;
      }
      if (outcome.kind === "terminal") {
        setState({
          target,
          message:
            outcome.resultCode === "busy"
              ? "Another sync is already running."
              : outcome.resultCode === "account_not_active"
                ? "Switch Codex to this account and try again."
                : "Sync failed. Run viberacing doctor.",
          tone: "error",
        });
        void prepare();
        return;
      }
      if (outcome.kind === "running_too_long" || outcome.kind === "running_unconfirmed") {
        setState({
          target,
          message: "Sync is taking longer than expected. Refresh later to see the latest totals.",
          tone: "status",
        });
        return;
      }
      setState({
        target,
        message:
          outcome.kind === "not_started"
            ? "Connector did not respond. Reconnect this computer and try again."
            : "Could not read the sync result. Refresh and try again.",
        tone: "error",
      });
      void prepare();
    },
    [prepare],
  );

  const launch = useCallback(
    (target: SyncTarget) => {
      const targetKey = "accountId" in target ? target.accountId : installationSyncTarget;
      if (grant === null || new Date(grant.expiresAt).getTime() <= Date.now()) {
        setState({
          target: targetKey,
          message: "Sync is not ready. Refresh and try again.",
          tone: "error",
        });
        void prepare();
        return;
      }
      const requestId = crypto.randomUUID();
      const url = new URL("viberacing://sync");
      url.searchParams.set("grant", grant.token);
      url.searchParams.set("requestId", requestId);
      if ("accountId" in target) url.searchParams.set("accountId", target.accountId);
      else url.searchParams.set("scope", target.scope);
      setGrant(null);
      setState({ target: targetKey, message: "Waiting for connector…", tone: "status" });
      void poll(targetKey, requestId);
      window.location.assign(url.href);
    },
    [grant, poll, prepare],
  );

  const value = useMemo(
    () => ({
      ready: grant !== null,
      launchAccount: (accountId: string) => {
        launch({ accountId });
      },
      launchInstallation: () => {
        launch({ scope: "installation" });
      },
      state,
    }),
    [grant, launch, state],
  );
  return <BrowserSyncContext.Provider value={value}>{children}</BrowserSyncContext.Provider>;
}

export function AccountControls({
  accountId,
  syncUnavailableReason,
  children,
}: {
  accountId: string;
  syncUnavailableReason: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const unavailableDescriptionId = useId();
  const sync = useContext(BrowserSyncContext);
  const current = sync?.state?.target === accountId ? sync.state : null;
  const actionsId = `account-actions-${accountId}`;
  const canSync = syncUnavailableReason === null;
  return (
    <div className="account-controls">
      <div className="account-control-buttons">
        <button
          aria-controls={actionsId}
          aria-expanded={open}
          className="button button-secondary"
          onClick={() => {
            setOpen((value) => !value);
          }}
          type="button"
        >
          Manage account
        </button>
        <button
          aria-describedby={canSync ? undefined : unavailableDescriptionId}
          className={canSync ? "button" : "button sync-unavailable"}
          disabled={!canSync || !sync?.ready || current?.tone === "status"}
          onClick={() => sync?.launchAccount(accountId)}
          type="button"
        >
          Sync
        </button>
      </div>
      {canSync ? null : (
        <p className="browser-sync-message status" id={unavailableDescriptionId}>
          {syncUnavailableReason}
        </p>
      )}
      {current === null ? null : (
        <p
          className={`browser-sync-message ${current.tone}`}
          role={current.tone === "error" ? "alert" : "status"}
        >
          {current.message}
        </p>
      )}
      <div className="account-actions" hidden={!open} id={actionsId}>
        {children}
      </div>
    </div>
  );
}

export function InstallationSyncControl({
  syncUnavailableReason,
}: {
  syncUnavailableReason: string | null;
}) {
  const unavailableDescriptionId = useId();
  const sync = useContext(BrowserSyncContext);
  const current = sync?.state?.target === installationSyncTarget ? sync.state : null;
  const canSync = syncUnavailableReason === null;
  return (
    <div className="installation-sync-control">
      <button
        aria-describedby={canSync ? undefined : unavailableDescriptionId}
        className={canSync ? "button" : "button sync-unavailable"}
        disabled={!canSync || !sync?.ready || current?.tone === "status"}
        onClick={() => sync?.launchInstallation()}
        type="button"
      >
        Sync all agents
      </button>
      {canSync ? null : (
        <p className="browser-sync-message status" id={unavailableDescriptionId}>
          {syncUnavailableReason}
        </p>
      )}
      {current === null ? null : (
        <p
          className={`browser-sync-message ${current.tone}`}
          role={current.tone === "error" ? "alert" : "status"}
        >
          {current.message}
        </p>
      )}
    </div>
  );
}
