"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface Grant {
  token: string;
  expiresAt: string;
}

interface SyncState {
  accountId: string;
  message: string;
  tone: "status" | "error";
}

interface BrowserSyncContextValue {
  ready: boolean;
  launch(accountId: string): void;
  state: SyncState | null;
}

const BrowserSyncContext = createContext<BrowserSyncContextValue | null>(null);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

const browserSyncStartTimeoutMs = 90_000;
export const browserSyncRunningTimeoutMs = 10 * 60_000;
const maximumConsecutivePollFailures = 3;

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
  for (;;) {
    await dependencies.pause(1_000);
    try {
      const response = await dependencies.fetchStatus();
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

  const prepare = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch("/api/accounts/sync/grant", {
        credentials: "same-origin",
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
      });
      if (response.ok) setGrant((await response.json()) as Grant);
      else setGrant(null);
    } catch {
      setGrant(null);
    }
  }, [enabled]);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  const poll = useCallback(
    async (accountId: string, requestId: string) => {
      const outcome = await pollBrowserSyncStatus({
        fetchStatus: () =>
          fetch(`/api/accounts/sync/${encodeURIComponent(requestId)}`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: AbortSignal.timeout(10_000),
          }),
        now: Date.now,
        onRunning: () => {
          setState({ accountId, message: "Syncing…", tone: "status" });
        },
        pause: wait,
      });
      if (outcome.kind === "terminal" && outcome.status === "succeeded") {
        window.location.assign("/dashboard?browserSynced=1");
        return;
      }
      if (outcome.kind === "terminal" && outcome.status === "partial") {
        setState({
          accountId,
          message: "Sync completed with warnings. Run viberacing doctor.",
          tone: "error",
        });
        void prepare();
        return;
      }
      if (outcome.kind === "terminal") {
        setState({
          accountId,
          message:
            outcome.resultCode === "busy"
              ? "Another sync is already running."
              : "Sync failed. Run viberacing doctor.",
          tone: "error",
        });
        void prepare();
        return;
      }
      if (outcome.kind === "running_too_long" || outcome.kind === "running_unconfirmed") {
        setState({
          accountId,
          message: "Sync is taking longer than expected. Refresh later to see the latest totals.",
          tone: "status",
        });
        return;
      }
      setState({
        accountId,
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
    (accountId: string) => {
      if (grant === null || new Date(grant.expiresAt).getTime() <= Date.now()) {
        setState({
          accountId,
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
      url.searchParams.set("accountId", accountId);
      setGrant(null);
      setState({ accountId, message: "Waiting for connector…", tone: "status" });
      void poll(accountId, requestId);
      window.location.assign(url.href);
    },
    [grant, poll, prepare],
  );

  const value = useMemo(() => ({ ready: grant !== null, launch, state }), [grant, launch, state]);
  return <BrowserSyncContext.Provider value={value}>{children}</BrowserSyncContext.Provider>;
}

export function AccountControls({
  accountId,
  canSync,
  children,
}: {
  accountId: string;
  canSync: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sync = useContext(BrowserSyncContext);
  const current = sync?.state?.accountId === accountId ? sync.state : null;
  const actionsId = `account-actions-${accountId}`;
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
        {canSync ? (
          <button
            className="button"
            disabled={!sync?.ready || current?.tone === "status"}
            onClick={() => sync?.launch(accountId)}
            type="button"
          >
            Sync
          </button>
        ) : null}
      </div>
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
