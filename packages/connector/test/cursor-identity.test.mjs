import assert from "node:assert/strict";
import test from "node:test";
import { resolveCursorAccount } from "../lib/cursor-identity.mjs";

const salt = "s".repeat(43);
const resolve = (identity, accounts) => resolveCursorAccount(identity, salt, accounts);
const conflict = { diagnosticCode: "cursor_account_identity_conflict" };

test("Cursor email identities normalize case, whitespace and Unicode across surfaces", () => {
  const desktop = resolve({ email: "  CAFÉ@example.com  " });
  const cli = resolve({ email: "cafe\u0301@EXAMPLE.COM" }, desktop.accounts);
  assert.equal(desktop.accountKey, cli.accountKey);
  assert.equal(cli.accounts.length, 1);
  assert.match(cli.accountKey, /^acct1_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(
    cli.accountKey,
    resolveCursorAccount({ email: "café@example.com" }, "t".repeat(43)).accountKey,
  );
});

test("Cursor opaque IDs preserve case while normalizing Unicode and whitespace", () => {
  const first = resolve({ accountId: "  Id-É  " });
  assert.equal(first.accountKey, resolve({ accountId: "Id-E\u0301" }).accountKey);
  assert.notEqual(first.accountKey, resolve({ accountId: "id-é" }).accountKey);
  assert.notEqual(first.accountKey, resolve({ email: "Id-É" }).accountKey);
});

test("Cursor A to B to A reuses the original identity", () => {
  const a = resolve({ email: "a@example.test" });
  const b = resolve({ email: "b@example.test" }, a.accounts);
  const again = resolve({ email: "A@EXAMPLE.TEST" }, b.accounts);
  assert.notEqual(a.accountKey, b.accountKey);
  assert.equal(a.accountKey, again.accountKey);
  assert.equal(again.accounts.length, 2);
});

test("Cursor later aliases bind to the first identity in either order", () => {
  for (const first of [{ email: "a@example.test" }, { accountId: "opaque-a" }]) {
    const initial = resolve(first);
    const both = resolve({ email: "a@example.test", accountId: "opaque-a" }, initial.accounts);
    assert.equal(both.accountKey, initial.accountKey);
    assert.equal(
      resolve({ email: "a@example.test" }, both.accounts).accountKey,
      initial.accountKey,
    );
    assert.equal(resolve({ accountId: "opaque-a" }, both.accounts).accountKey, initial.accountKey);
    assert.equal(both.accounts.length, 1);
    assert.equal(Object.keys(initial.accounts[0]).length, 2);
  }
});

test("Cursor alias conflicts fail closed without changing either account", () => {
  const both = resolve({ email: "a@example.test", accountId: "opaque-a" });
  const before = JSON.stringify(both.accounts);
  for (const identity of [
    { email: "a@example.test", accountId: "opaque-b" },
    { email: "b@example.test", accountId: "opaque-a" },
  ])
    assert.throws(() => resolve(identity, both.accounts), conflict);
  assert.equal(JSON.stringify(both.accounts), before);
  const emailOnly = resolve({ email: "a@example.test" });
  const separate = resolve({ accountId: "opaque-a" }, emailOnly.accounts);
  assert.throws(
    () => resolve({ email: "a@example.test", accountId: "opaque-a" }, separate.accounts),
    conflict,
  );
});

test("Cursor rejects invalid identities, salt and alias registries with safe diagnostics", () => {
  for (const identity of [
    {},
    null,
    { email: null },
    { email: " " },
    { accountId: 42 },
    { email: "a\u0000b" },
    { accountId: "a".repeat(1025) },
  ])
    assert.throws(() => resolve(identity), {
      diagnosticCode: "cursor_account_identity_unavailable",
    });
  assert.throws(() => resolveCursorAccount({ email: "a@example.test" }, ""), {
    diagnosticCode: "cursor_account_identity_unavailable",
  });
  const valid = resolve({ email: "a@example.test" }).accounts[0];
  for (const state of [
    null,
    {},
    [null],
    [valid, valid],
    [{ ...valid, prompt: "secret" }],
    [{ accountKey: valid.accountKey }],
    [{ ...valid, emailKey: "raw-email" }],
  ])
    assert.throws(() => resolve({ email: "a@example.test" }, state), conflict);
});

test("Cursor alias registry is bounded but existing identities still resolve at the limit", () => {
  let accounts = [];
  for (let index = 0; index < 8; index++)
    accounts = resolve({ accountId: `account-${index}` }, accounts).accounts;
  assert.equal(resolve({ accountId: "account-0" }, accounts).accounts.length, 8);
  assert.throws(() => resolve({ accountId: "account-8" }, accounts), {
    diagnosticCode: "provider_account_limit_reached",
  });
});

test("Cursor identity output contains only HMACs and ignores content-bearing fields", () => {
  const canaries = {
    email: "private-email@example.test",
    accountId: "private-provider-id",
    prompt: "private-prompt",
    response: "private-response",
    code: "private-code",
    path: "/private/repository",
    model: "private-model",
    apiKey: "private-api-key",
    cost: "private-cost",
    toolArguments: "private-arguments",
  };
  const result = resolve(canaries);
  const serialized = JSON.stringify(result);
  for (const canary of Object.values(canaries)) assert.equal(serialized.includes(canary), false);
  assert.deepEqual(result, resolve({ email: canaries.email, accountId: canaries.accountId }));
  let error;
  try {
    resolve({ email: canaries.email, accountId: "conflicting-private-id" }, result.accounts);
  } catch (caught) {
    error = caught;
  }
  assert.equal(error.message, "cursor_account_identity_conflict");
  assert.equal(error.cause, undefined);
});
