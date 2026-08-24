import { afterEach, describe, expect, it, vi } from "vitest";

const { clientQueryMock, cookieDeleteMock, cookieGetMock, cookieSetMock, transactionMock } =
  vi.hoisted(() => ({
    clientQueryMock: vi.fn(),
    cookieDeleteMock: vi.fn(),
    cookieGetMock: vi.fn(),
    cookieSetMock: vi.fn(),
    transactionMock: vi.fn(),
  }));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ delete: cookieDeleteMock, get: cookieGetMock, set: cookieSetMock }),
}));
vi.mock("./config", () => ({ secureCookies: () => true }));
vi.mock("./db", () => ({
  query: vi.fn(),
  transaction: transactionMock,
}));

import { createSession, hasAccountDeletionReceipt, issueAccountDeletionReceipt } from "./session";

function runTransaction(
  callback: (client: { query: typeof clientQueryMock }) => Promise<unknown>,
): Promise<unknown> {
  return callback({ query: clientQueryMock });
}

describe("browser session creation", () => {
  afterEach(() => {
    clientQueryMock.mockReset();
    cookieDeleteMock.mockReset();
    cookieGetMock.mockReset();
    cookieSetMock.mockReset();
    transactionMock.mockReset();
  });

  it("serializes login and retains at most ten active sessions per user", async () => {
    cookieGetMock.mockReturnValue(undefined);
    clientQueryMock.mockResolvedValue({ rows: [{ id: "42" }] });
    transactionMock.mockImplementation(runTransaction);

    await createSession("42");

    expect(clientQueryMock).toHaveBeenNthCalledWith(
      1,
      "SELECT id FROM users WHERE id = $1 FOR UPDATE",
      ["42"],
    );
    expect(clientQueryMock).toHaveBeenCalledWith(expect.stringContaining("OFFSET $2"), ["42", 9]);
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM agent_accounts[\s\S]+a\.merged_into_account_id IS NULL[\s\S]+OR NOT EXISTS[\s\S]+event\.status = 'active'/,
      ),
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO sessions"),
      expect.arrayContaining([expect.any(String), "42"]),
    );
    expect(cookieSetMock).toHaveBeenCalledWith(
      "vr_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, maxAge: 2_592_000, secure: true }),
    );
    expect(cookieDeleteMock).toHaveBeenCalledWith("vr_account_deleted");
  });

  it("removes the browser's previous session before enforcing the user cap", async () => {
    cookieGetMock.mockReturnValue({ value: "previous-session-token-that-is-long-enough" });
    clientQueryMock.mockResolvedValue({ rows: [{ id: "42" }] });
    transactionMock.mockImplementation(runTransaction);

    await createSession("42");

    const previousDelete = clientQueryMock.mock.calls.findIndex(
      ([sql]) =>
        typeof sql === "string" && sql.startsWith("DELETE FROM sessions WHERE token_hash ="),
    );
    const capDelete = clientQueryMock.mock.calls.findIndex(
      ([sql]) => typeof sql === "string" && sql.includes("OFFSET $2"),
    );
    expect(previousDelete).toBeGreaterThan(-1);
    expect(capDelete).toBeGreaterThan(previousDelete);
  });

  it("issues a short-lived server-only account deletion receipt", async () => {
    await issueAccountDeletionReceipt();

    expect(cookieSetMock).toHaveBeenCalledWith("vr_account_deleted", "1", {
      httpOnly: true,
      maxAge: 300,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    cookieGetMock.mockReturnValueOnce({ value: "1" }).mockReturnValueOnce({ value: "invalid" });
    await expect(hasAccountDeletionReceipt()).resolves.toBe(true);
    await expect(hasAccountDeletionReceipt()).resolves.toBe(false);
  });
});
