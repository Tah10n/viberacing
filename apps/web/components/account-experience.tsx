import "server-only";

import Link from "next/link";

import type { PasskeyInventoryItem } from "@/lib/enrollment-database";
import type { Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";

import { PasskeyAddForm, PasskeyRevokeButton } from "./passkey-setup";

interface AccountExperienceProps {
  readonly handle: string;
  readonly locale: Locale;
  readonly passkeys: readonly PasskeyInventoryItem[] | undefined;
}

export function AccountExperience({ handle, locale, passkeys }: AccountExperienceProps) {
  const copy = joinTranslations[locale];
  return (
    <main className="auth-shell" lang={locale}>
      <section aria-labelledby="account-title" className="auth-card">
        <Link className="auth-brand" href="/">
          <span aria-hidden="true">▰</span> {copy.brand}
        </Link>
        <p className="eyebrow">Community · self-reported</p>
        <h1 id="account-title">{copy.accountTitle}</h1>
        <p className="account-handle">@{handle}</p>
        <p>{copy.accountCopy}</p>
        <section aria-labelledby="passkeys-title" className="account-security">
          <h2 id="passkeys-title">{copy.passkeysTitle}</h2>
          <p>{copy.passkeysCopy}</p>
          <p className="auth-status">{copy.passkeyRevokeCopy}</p>
          {passkeys === undefined ? (
            <p className="auth-error" role="status">
              {copy.passkeysUnavailable}
            </p>
          ) : (
            <>
              {passkeys.length < 32 ? <PasskeyAddForm locale={locale} /> : null}
              <ul className="passkey-list">
                {passkeys.map((passkey) => (
                  <li className="passkey-item" key={passkey.passkeyId}>
                    <div className="passkey-item-heading">
                      <strong>{passkey.label}</strong>
                      <span className="passkey-state">
                        {passkey.currentAuthenticator
                          ? copy.currentPasskey
                          : passkey.state === "active"
                            ? copy.activePasskey
                            : copy.revokedPasskey}
                      </span>
                    </div>
                    <p className="auth-status">
                      {copy.passkeyCreated}{" "}
                      <time dateTime={passkey.createdOn}>{passkey.createdOn}</time>
                    </p>
                    {passkey.state === "active" && !passkey.currentAuthenticator ? (
                      <PasskeyRevokeButton
                        label={passkey.label}
                        locale={locale}
                        passkeyId={passkey.passkeyId}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <form action="/auth/logout" method="post">
          <button className="secondary-action" type="submit">
            {copy.logout}
          </button>
        </form>
        <Link href="/">← {copy.backToRace}</Link>
      </section>
    </main>
  );
}
