import "server-only";

import Link from "next/link";

import type { PasskeyInventoryItem, ProfileVisibility } from "@/lib/enrollment-database";
import type { AccountSourceDeviceInventoryItem } from "@/lib/enrollment-service";
import type { Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";

import {
  PasskeyAddForm,
  PasskeyRevokeButton,
  ProfileDeletionForm,
  SourceReactivationButton,
  SourceUnlinkButton,
} from "./passkey-setup";

interface AccountExperienceProps {
  readonly actionUnavailable?: boolean;
  readonly activeDeviceInventory: readonly AccountSourceDeviceInventoryItem[] | undefined;
  readonly handle: string;
  readonly locale: Locale;
  readonly passkeys: readonly PasskeyInventoryItem[] | undefined;
  readonly visibility: ProfileVisibility | undefined;
}

export function AccountExperience({
  actionUnavailable = false,
  activeDeviceInventory,
  handle,
  locale,
  passkeys,
  visibility,
}: AccountExperienceProps) {
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
        {actionUnavailable ? (
          <p className="auth-error" role="alert">
            {copy.accountActionUnavailable}
          </p>
        ) : null}
        <section aria-labelledby="visibility-title" className="account-security">
          <h2 id="visibility-title">{copy.profileVisibilityTitle}</h2>
          <p>{copy.profileVisibilityCopy}</p>
          {visibility === undefined ? (
            <p className="auth-error" role="status">
              {copy.profileVisibilityUnavailable}
            </p>
          ) : (
            <>
              <p className="auth-status" role="status">
                {visibility === "public" ? copy.profileVisible : copy.profileHidden}
              </p>
              <form action="/auth/profile/visibility" method="post">
                <input
                  name="visibility"
                  type="hidden"
                  value={visibility === "public" ? "hidden" : "public"}
                />
                <button className="secondary-action" type="submit">
                  {visibility === "public" ? copy.hideProfile : copy.publishProfile}
                </button>
              </form>
            </>
          )}
        </section>
        <section aria-labelledby="active-devices-title" className="account-security">
          <h2 id="active-devices-title">{copy.activeDevicesTitle}</h2>
          <p>{copy.activeDevicesCopy}</p>
          {activeDeviceInventory === undefined ? (
            <p className="auth-error" role="status">
              {copy.activeDevicesUnavailable}
            </p>
          ) : activeDeviceInventory.length === 0 ? (
            <p className="auth-status" role="status">
              {copy.noActiveDevices}
            </p>
          ) : (
            <ol className="passkey-list">
              {activeDeviceInventory.map((source, sourceIndex) => (
                <li className="passkey-item" key={source.sourceControl}>
                  <div className="passkey-item-heading">
                    <strong>
                      {copy.sourceLabel} {sourceIndex + 1}
                    </strong>
                    <span className="passkey-state">
                      {source.state === "active"
                        ? copy.sourceActive
                        : source.state === "paused"
                          ? copy.sourcePaused
                          : source.state === "quarantined"
                            ? copy.sourceQuarantined
                            : copy.sourceUnlinked}
                    </span>
                  </div>
                  {source.state === "active" ? (
                    <form action="/auth/sources/pause" method="post">
                      <input name="sourceControl" type="hidden" value={source.sourceControl} />
                      <button className="secondary-action" type="submit">
                        {copy.pauseSource}
                      </button>
                    </form>
                  ) : source.state === "paused" ? (
                    <SourceReactivationButton
                      label={`${copy.sourceLabel} ${String(sourceIndex + 1)}`}
                      locale={locale}
                      sourceControl={source.sourceControl}
                    />
                  ) : null}
                  {source.state !== "unlinked" ? (
                    <SourceUnlinkButton
                      label={`${copy.sourceLabel} ${String(sourceIndex + 1)}`}
                      locale={locale}
                      sourceControl={source.sourceControl}
                    />
                  ) : null}
                  {source.devices.length === 0 ? (
                    <p className="auth-status">{copy.noSourceActiveDevices}</p>
                  ) : (
                    <ul className="passkey-list">
                      {source.devices.map((device) => (
                        <li className="passkey-item" key={device.deviceId}>
                          <strong>{device.label}</strong>
                          <p className="auth-status">
                            {device.osFamily === "macos"
                              ? "macOS"
                              : device.osFamily === "windows"
                                ? "Windows"
                                : "Linux"}{" "}
                            · {device.architecture} · {copy.deviceConnector}{" "}
                            {device.connectorVersion}
                          </p>
                          <p className="auth-status">
                            {copy.deviceConnected}{" "}
                            <time dateTime={device.activatedOn}>{device.activatedOn}</time>
                          </p>
                          <form action="/auth/devices/revoke" method="post">
                            <input name="deviceId" type="hidden" value={device.deviceId} />
                            <button className="danger-action" type="submit">
                              {copy.revokeDevice}
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
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
        <section aria-labelledby="profile-deletion-title" className="account-security">
          <h2 id="profile-deletion-title">{copy.profileDeletionTitle}</h2>
          <p>{copy.profileDeletionCopy}</p>
          <ProfileDeletionForm handle={handle} locale={locale} />
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
