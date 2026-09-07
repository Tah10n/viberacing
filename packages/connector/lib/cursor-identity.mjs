import { createHmac } from "node:crypto";

const digestPattern = /^[A-Za-z0-9_-]{43}$/;
const accountPattern = /^acct1_[A-Za-z0-9_-]{43}$/;
const aliasPattern = /^alias1_[A-Za-z0-9_-]{43}$/;
const maximumAccounts = 8;

function fail(code) {
  const error = new Error(code);
  error.diagnosticCode = code;
  throw error;
}

function normalize(value, email) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 1_024)
    fail("cursor_account_identity_unavailable");
  const normalized = value.trim().normalize("NFC");
  if (!normalized || /[\p{Cc}\p{Cs}]/u.test(normalized))
    fail("cursor_account_identity_unavailable");
  return email ? normalized.toLowerCase() : normalized;
}

function validateAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length > maximumAccounts)
    fail("cursor_account_identity_conflict");
  const seen = new Set();
  for (const account of accounts) {
    if (
      account === null ||
      typeof account !== "object" ||
      Array.isArray(account) ||
      Object.keys(account).some((key) => !["accountKey", "emailKey", "idKey"].includes(key)) ||
      !accountPattern.test(account.accountKey) ||
      (account.emailKey === undefined && account.idKey === undefined)
    )
      fail("cursor_account_identity_conflict");
    for (const key of ["accountKey", "emailKey", "idKey"]) {
      const value = account[key];
      if (value === undefined) continue;
      if ((key !== "accountKey" && !aliasPattern.test(value)) || seen.has(value))
        fail("cursor_account_identity_conflict");
      seen.add(value);
    }
  }
}

/**
 * Resolve already-extracted identity fields without retaining their raw values.
 * The capture transaction must persist the returned alias registry together with
 * its event before exposing either to account routing. This function does no I/O.
 */
export function resolveCursorAccount(identity, providerIdentitySalt, accounts = []) {
  if (typeof providerIdentitySalt !== "string" || !digestPattern.test(providerIdentitySalt))
    fail("cursor_account_identity_unavailable");
  validateAccounts(accounts);
  const email = normalize(identity?.email, true);
  const accountId = normalize(identity?.accountId, false);
  if (email === undefined && accountId === undefined) fail("cursor_account_identity_unavailable");
  const subkey = createHmac("sha256", providerIdentitySalt)
    .update("viberacing/cursor/identity/v1")
    .digest();
  const digest = (domain, value) =>
    createHmac("sha256", subkey).update(domain).update("\0").update(value).digest("base64url");
  const emailKey = email === undefined ? undefined : `alias1_${digest("email", email)}`;
  const idKey = accountId === undefined ? undefined : `alias1_${digest("id", accountId)}`;
  const matches = accounts.filter(
    (account) =>
      (emailKey !== undefined && account.emailKey === emailKey) ||
      (idKey !== undefined && account.idKey === idKey),
  );
  if (matches.length > 1) fail("cursor_account_identity_conflict");
  const existing = matches[0];
  if (
    existing &&
    ((emailKey !== undefined &&
      existing.emailKey !== undefined &&
      existing.emailKey !== emailKey) ||
      (idKey !== undefined && existing.idKey !== undefined && existing.idKey !== idKey))
  )
    fail("cursor_account_identity_conflict");
  if (!existing && accounts.length >= maximumAccounts) fail("provider_account_limit_reached");
  const accountKey =
    existing?.accountKey ??
    `acct1_${digest(accountId === undefined ? "account-email" : "account-id", accountId ?? email)}`;
  const resolved = {
    ...(existing ?? { accountKey }),
    ...(emailKey === undefined ? {} : { emailKey }),
    ...(idKey === undefined ? {} : { idKey }),
  };
  const nextAccounts = accounts.map((account) => ({
    ...(account === existing ? resolved : account),
  }));
  if (!existing) nextAccounts.push(resolved);
  return { accountKey, accounts: nextAccounts };
}
