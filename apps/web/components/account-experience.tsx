import "server-only";

import Link from "next/link";

import { AccountAppearancePreferences } from "@/components/account-appearance-preferences";
import type { AccountCarRecipeState } from "@/lib/car-proposal-service";
import { carRecipeFieldLabels, formatCarPart } from "@/lib/car-recipe-i18n";
import {
  carChassis,
  carCockpits,
  carNoses,
  carPalettes,
  carTrails,
  carWheels,
  carWings,
} from "@/lib/car-recipe";
import { connectTranslations } from "@/lib/connect-i18n";
import type {
  AgentAccountQuarantineReason,
  AgentAccountStatus,
  AgentProviderCode,
  PasskeyInventoryItem,
} from "@/lib/enrollment-database";
import type { AccountDashboard, AccountDashboardInstallation } from "@/lib/enrollment-service";
import { formatExactTokenTotal, type Locale } from "@/lib/i18n";
import { joinTranslations } from "@/lib/join-i18n";

import { CarRecipePreview } from "./car-recipe-preview";
import {
  AccountReactivationButton,
  AccountUnlinkButton,
  DeviceRevokeButton,
  InstallationRevokeButton,
  PasskeyAddForm,
  PasskeyRevokeButton,
  ProfileDeletionForm,
  RecoveryCodeRotation,
} from "./passkey-setup";

const providerLabels: Readonly<Record<AgentProviderCode, string>> = {
  aider: "Aider",
  claude_code: "Claude Code",
  cline: "Cline",
  codex: "Codex",
  opencode: "OpenCode",
  qwen_code: "Qwen Code",
};

function installationPlatform(installation: AccountDashboardInstallation): string {
  const operatingSystem =
    installation.osFamily === "macos"
      ? "macOS"
      : installation.osFamily === "windows"
        ? "Windows"
        : "Linux";
  return `${operatingSystem} · ${installation.architecture}`;
}

interface CarAppearanceProps {
  readonly carProposalsEnabled: boolean;
  readonly carRecipeState: AccountCarRecipeState | undefined;
  readonly locale: Locale;
  readonly providerBreakdownVisible: boolean | undefined;
}

function CarAppearance({
  carProposalsEnabled,
  carRecipeState,
  locale,
  providerBreakdownVisible,
}: CarAppearanceProps) {
  const copy = joinTranslations[locale];
  const carCopy = carRecipeFieldLabels[locale];
  return (
    <section aria-labelledby="appearance-title" className="account-security" id="car-proposal">
      <h2 id="appearance-title">{copy.appearanceTitle}</h2>
      <p>{copy.appearanceCopy}</p>
      <AccountAppearancePreferences locale={locale} />
      <div className="account-preferences">
        <h3>{copy.providerBreakdownTitle}</h3>
        <p>{copy.providerBreakdownCopy}</p>
        {providerBreakdownVisible === undefined ? (
          <p className="auth-error" role="status">
            {copy.profileVisibilityUnavailable}
          </p>
        ) : (
          <>
            <p className="auth-status" role="status">
              {providerBreakdownVisible
                ? copy.providerBreakdownShown
                : copy.providerBreakdownHidden}
            </p>
            <form action="/auth/profile/provider-breakdown" method="post">
              <input
                name="providerBreakdown"
                type="hidden"
                value={providerBreakdownVisible ? "hidden" : "shown"}
              />
              <button className="secondary-action" type="submit">
                {providerBreakdownVisible
                  ? copy.removeProviderBreakdown
                  : copy.publishProviderBreakdown}
              </button>
            </form>
          </>
        )}
      </div>
      <div className="account-preferences">
        <h3>{copy.carProposalTitle}</h3>
        <p>{copy.carProposalCopy}</p>
        {carRecipeState === undefined ? (
          <p className="auth-error" role="status">
            {copy.carRecipeUnavailable}
          </p>
        ) : (
          <>
            <h4>{copy.carActiveTitle}</h4>
            <p>{copy.carActiveCopy}</p>
            {carRecipeState.active === null ? (
              <p className="auth-status">{copy.carActiveEmpty}</p>
            ) : (
              <CarRecipePreview
                label={copy.carPreviewLabel}
                locale={locale}
                recipe={carRecipeState.active}
              />
            )}
            {!carProposalsEnabled ? (
              <p className="auth-status">{copy.carProposalsUnavailable}</p>
            ) : null}
            {carRecipeState.proposal === null ? (
              <p className="auth-status">{copy.carProposalEmpty}</p>
            ) : (
              <div className="car-proposal-review">
                <CarRecipePreview
                  label={copy.carPreviewLabel}
                  locale={locale}
                  recipe={carRecipeState.proposal.recipe}
                />
                <div className="form-actions">
                  {carProposalsEnabled ? (
                    <form action="/auth/cars/proposals/approve" method="post">
                      <input
                        name="proposalControl"
                        type="hidden"
                        value={carRecipeState.proposal.control}
                      />
                      <button className="primary-action" type="submit">
                        {copy.carApprove}
                      </button>
                    </form>
                  ) : null}
                  <form action="/auth/cars/proposals/reject" method="post">
                    <input
                      name="proposalControl"
                      type="hidden"
                      value={carRecipeState.proposal.control}
                    />
                    <button className="secondary-action" type="submit">
                      {copy.carProposalReject}
                    </button>
                  </form>
                </div>
              </div>
            )}
            {carProposalsEnabled ? (
              <form
                action="/auth/cars/proposals"
                className="auth-form car-recipe-form"
                method="post"
              >
                <p>{copy.carFormCopy}</p>
                <input name="schemaVersion" type="hidden" value="1" />
                <label>
                  {carCopy.chassis}
                  <select
                    defaultValue={carRecipeState.active?.chassis ?? "roadster"}
                    name="chassis"
                  >
                    {carChassis.map((value) => (
                      <option key={value} value={value}>
                        {formatCarPart(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {carCopy.nose}
                  <select defaultValue={carRecipeState.active?.nose ?? "classic"} name="nose">
                    {carNoses.map((value) => (
                      <option key={value} value={value}>
                        {formatCarPart(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {carCopy.cockpit}
                  <select defaultValue={carRecipeState.active?.cockpit ?? "canopy"} name="cockpit">
                    {carCockpits.map((value) => (
                      <option key={value} value={value}>
                        {formatCarPart(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {carCopy.wing}
                  <select defaultValue={carRecipeState.active?.wing ?? "none"} name="wing">
                    {carWings.map((value) => (
                      <option key={value} value={value}>
                        {formatCarPart(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {carCopy.wheels}
                  <select defaultValue={carRecipeState.active?.wheels ?? "street"} name="wheels">
                    {carWheels.map((value) => (
                      <option key={value} value={value}>
                        {formatCarPart(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {carCopy.palette}
                  <select defaultValue={carRecipeState.active?.palette ?? "magenta"} name="palette">
                    {carPalettes.map((value) => (
                      <option key={value} value={value}>
                        {formatCarPart(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {carCopy.trail}
                  <select defaultValue={carRecipeState.active?.trail ?? "none"} name="trail">
                    {carTrails.map((value) => (
                      <option key={value} value={value}>
                        {formatCarPart(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {carCopy.seed}
                  <input
                    defaultValue={carRecipeState.active?.seed ?? 0}
                    inputMode="numeric"
                    max={65535}
                    min={0}
                    name="seed"
                    required
                    step={1}
                    type="number"
                  />
                </label>
                <button className="secondary-action" type="submit">
                  {copy.carProposalSubmit}
                </button>
              </form>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

interface AccountExperienceProps {
  readonly actionUnavailable?: boolean;
  readonly carProposalsEnabled?: boolean;
  readonly carRecipeState?: AccountCarRecipeState | undefined;
  readonly dashboard: AccountDashboard | undefined;
  readonly handle: string;
  readonly locale: Locale;
  readonly passkeys: readonly PasskeyInventoryItem[] | undefined;
}

export function AccountExperience({
  actionUnavailable = false,
  carProposalsEnabled = false,
  carRecipeState,
  dashboard,
  handle,
  locale,
  passkeys,
}: AccountExperienceProps) {
  const copy = joinTranslations[locale];
  const connectCopy = connectTranslations[locale];
  const statusLabels: Readonly<Record<AgentAccountStatus, string>> = {
    connected: copy.statusConnected,
    needs_login: copy.statusNeedsLogin,
    paused: copy.statusPaused,
    quarantined: copy.statusQuarantined,
    reader_outdated: copy.statusReaderOutdated,
    removed: copy.statusRemoved,
    syncing: copy.statusSyncing,
    unsupported_agent_version: copy.statusUnsupportedAgentVersion,
  };
  const quarantineLabels: Readonly<Record<AgentAccountQuarantineReason, string>> = {
    account_state: copy.quarantineAccount,
    accounting_revision_mismatch: copy.quarantineAccounting,
    anomaly_review: copy.quarantineReview,
    date_out_of_range: copy.quarantineDate,
    decrease: copy.quarantineDecrease,
    numeric_out_of_range: copy.quarantineNumeric,
    overlap_detected: copy.quarantineOverlap,
    season_closed: copy.quarantineSeason,
  };
  const accounts = dashboard?.accounts ?? [];
  const installations = dashboard?.installations ?? [];
  const providers = Array.from(new Set(accounts.map((account) => account.provider)));
  const attentionCount = accounts.filter(
    (account) =>
      account.status === "needs_login" ||
      account.status === "quarantined" ||
      account.status === "reader_outdated" ||
      account.status === "unsupported_agent_version",
  ).length;
  const syncingCount = accounts.filter((account) => account.status === "syncing").length;
  const syncSummary =
    attentionCount > 0
      ? `${String(attentionCount)} ${copy.syncNeedsAttention}`
      : syncingCount > 0
        ? copy.syncWaiting
        : copy.syncHealthy;
  const ranking = dashboard?.ranking;

  return (
    <main className="auth-shell" lang={locale}>
      <article aria-labelledby="account-title" className="auth-card account-dashboard">
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

        <section aria-labelledby="current-ranking-title" className="account-security">
          <h2 id="current-ranking-title">{copy.currentRankingTitle}</h2>
          <p>{copy.currentRankingCopy}</p>
          {ranking === undefined ? (
            <p className="auth-error" role="status">
              {copy.currentRankingUnavailable}
            </p>
          ) : (
            <>
              <p className="auth-status">
                <time dateTime={ranking.seasonStart}>{ranking.seasonStart}</time> –{" "}
                <time dateTime={ranking.seasonEnd}>{ranking.seasonEnd}</time> ·{" "}
                {ranking.seasonState === "finalized"
                  ? copy.seasonFinalized
                  : ranking.seasonState === "grace"
                    ? copy.seasonGrace
                    : ranking.seasonState === "pending"
                      ? copy.seasonPending
                      : copy.seasonOpen}
              </p>
              <dl className="account-metric-grid">
                <div>
                  <dt>{copy.weeklyTotal}</dt>
                  <dd>
                    {ranking.weeklyTokenTotal === null
                      ? copy.snapshotPending
                      : `${formatExactTokenTotal(ranking.weeklyTokenTotal, locale)} ${copy.tokens}`}
                  </dd>
                </div>
                <div>
                  <dt>{copy.rankLabel}</dt>
                  <dd>
                    {ranking.rankPosition === null
                      ? copy.noPublishedRank
                      : `#${String(ranking.rankPosition)}`}
                  </dd>
                </div>
                <div>
                  <dt>{copy.snapshotUpdated}</dt>
                  <dd>
                    {ranking.snapshotGeneratedAt === null ? (
                      copy.snapshotPending
                    ) : (
                      <time dateTime={ranking.snapshotGeneratedAt}>
                        {ranking.snapshotGeneratedAt}
                      </time>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{copy.connectedAccountsTitle}</dt>
                  <dd>
                    {providers.length} {copy.agentProviders} · {accounts.length}{" "}
                    {copy.agentAccounts}
                  </dd>
                </div>
                <div>
                  <dt>{copy.syncHealthTitle}</dt>
                  <dd>{syncSummary}</dd>
                </div>
                <div>
                  <dt>{copy.participantCount}</dt>
                  <dd>{ranking.participantCount ?? "—"}</dd>
                </div>
              </dl>
            </>
          )}
        </section>

        <section aria-labelledby="connected-accounts-title" className="account-security">
          <h2 id="connected-accounts-title">{copy.connectedAccountsTitle}</h2>
          <p>{copy.connectedAccountsCopy}</p>
          <p>
            <Link href="/connect">{connectCopy.title}</Link>
          </p>
          {dashboard === undefined ? (
            <p className="auth-error" role="status">
              {copy.connectedAccountsUnavailable}
            </p>
          ) : accounts.length === 0 ? (
            <p className="auth-status" role="status">
              {copy.noConnectedAccounts}
            </p>
          ) : (
            providers.map((provider) => (
              <div className="account-provider-group" key={provider}>
                <h3>{providerLabels[provider]}</h3>
                <ul className="account-card-grid">
                  {accounts
                    .filter((account) => account.provider === provider)
                    .map((account) => (
                      <li className="account-dashboard-card" key={account.control}>
                        <div className="passkey-item-heading">
                          <h4>{account.privateLabel}</h4>
                          <span className="passkey-state">{statusLabels[account.status]}</span>
                        </div>
                        <p className="auth-status">
                          {account.identityAssurance === "provider_verified"
                            ? copy.verifiedAssurance
                            : copy.communityAssurance}
                        </p>
                        <dl className="account-detail-grid">
                          <div>
                            <dt>{copy.weeklyTotal}</dt>
                            <dd>
                              {formatExactTokenTotal(account.weeklyTokenTotal, locale)}{" "}
                              {copy.tokens}
                            </dd>
                          </div>
                          <div>
                            <dt>{copy.todayTotal}</dt>
                            <dd>
                              {formatExactTokenTotal(account.todayTokenTotal, locale)} {copy.tokens}
                            </dd>
                          </div>
                          <div>
                            <dt>{copy.lastSuccessfulSync}</dt>
                            <dd>
                              {account.lastSuccessfulSyncDate === null ? (
                                copy.neverSynced
                              ) : (
                                <time dateTime={account.lastSuccessfulSyncDate}>
                                  {account.lastSuccessfulSyncDate}
                                </time>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>{copy.readerVersion}</dt>
                            <dd>{account.observedReaderVersion ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>{copy.expectedReaderVersion}</dt>
                            <dd>{account.expectedReaderVersion}</dd>
                          </div>
                          <div>
                            <dt>{copy.accountingRevision}</dt>
                            <dd>{account.accountingRevision}</dd>
                          </div>
                          <div>
                            <dt>{copy.connectedDevices}</dt>
                            <dd>{account.connectedDeviceCount}</dd>
                          </div>
                          <div>
                            <dt>{copy.privateAccountLabel}</dt>
                            <dd>{account.privateLabel}</dd>
                          </div>
                        </dl>
                        {account.status === "quarantined" && account.quarantineReason !== null ? (
                          <div className="account-quarantine" role="status">
                            <strong>{copy.needsAttention}</strong>
                            <p>{quarantineLabels[account.quarantineReason]}</p>
                            <p>{copy.quarantineRecovery}</p>
                          </div>
                        ) : null}
                        {account.state === "active" ? (
                          <form action="/auth/accounts/pause" method="post">
                            <input name="targetControl" type="hidden" value={account.control} />
                            <button className="secondary-action" type="submit">
                              {copy.pauseAccount}
                            </button>
                          </form>
                        ) : account.state === "paused" ? (
                          <AccountReactivationButton
                            label={account.privateLabel}
                            locale={locale}
                            targetControl={account.control}
                          />
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section aria-labelledby="sync-health-title" className="account-security">
          <h2 id="sync-health-title">{copy.syncHealthTitle}</h2>
          <p>{copy.syncHealthCopy}</p>
          <p className={attentionCount > 0 ? "auth-error" : "auth-status"} role="status">
            {syncSummary}
          </p>
          <h3>{copy.installationInventoryTitle}</h3>
          <p>{copy.installationInventoryCopy}</p>
          {dashboard === undefined ? (
            <p className="auth-error" role="status">
              {copy.connectedAccountsUnavailable}
            </p>
          ) : installations.length === 0 ? (
            <p className="auth-status">{copy.noInstallations}</p>
          ) : (
            <ul className="account-card-grid">
              {installations.map((installation) => (
                <li className="account-dashboard-card" key={installation.control}>
                  <div className="passkey-item-heading">
                    <h4>{installation.label}</h4>
                    <span className="passkey-state">
                      {installation.state === "active"
                        ? copy.deviceActive
                        : copy.installationRevoked}
                    </span>
                  </div>
                  <dl className="account-detail-grid">
                    <div>
                      <dt>{copy.deviceConnector}</dt>
                      <dd>{installation.connectorVersion}</dd>
                    </div>
                    <div>
                      <dt>{copy.deviceLocalAppearanceTitle}</dt>
                      <dd>{installationPlatform(installation)}</dd>
                    </div>
                    <div>
                      <dt>{copy.connectedOn}</dt>
                      <dd>
                        <time dateTime={installation.connectedDate}>
                          {installation.connectedDate}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt>{copy.lastSeen}</dt>
                      <dd>
                        {installation.lastSeenDate === null ? (
                          "—"
                        ) : (
                          <time dateTime={installation.lastSeenDate}>
                            {installation.lastSeenDate}
                          </time>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <p className="auth-status">{copy.installationConnectedAccounts}</p>
                  <ul className="account-label-list">
                    {installation.accounts.map((account, accountIndex) => (
                      <li key={`${installation.control}:${String(accountIndex)}`}>
                        {account.privateLabel} ·{" "}
                        {account.deviceState === "active" ? copy.deviceActive : copy.deviceRevoked}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="visibility-title" className="account-security">
          <h2 id="visibility-title">{copy.profileVisibilityTitle}</h2>
          <p>{copy.profileVisibilityCopy}</p>
          {ranking === undefined ? (
            <p className="auth-error" role="status">
              {copy.profileVisibilityUnavailable}
            </p>
          ) : (
            <>
              <p className="auth-status" role="status">
                {ranking.publicVisibility === "public" ? copy.profileVisible : copy.profileHidden}
              </p>
              {ranking.publicVisibility === "public" ? (
                <p>
                  <Link href={`/?profile=${encodeURIComponent(handle)}#profile`}>
                    {copy.viewPublicProfile}
                  </Link>
                </p>
              ) : null}
              <form action="/auth/profile/visibility" method="post">
                <input
                  name="visibility"
                  type="hidden"
                  value={ranking.publicVisibility === "public" ? "hidden" : "public"}
                />
                <button className="secondary-action" type="submit">
                  {ranking.publicVisibility === "public" ? copy.hideProfile : copy.publishProfile}
                </button>
              </form>
            </>
          )}
        </section>

        <CarAppearance
          carProposalsEnabled={carProposalsEnabled}
          carRecipeState={carRecipeState}
          locale={locale}
          providerBreakdownVisible={ranking?.providerBreakdownVisible}
        />

        <section aria-labelledby="passkeys-title" className="account-security">
          <h2 id="passkeys-title">{copy.passkeysTitle}</h2>
          <p>{copy.passkeysCopy}</p>
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
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 id="recovery-codes-title">{copy.recoveryCodesTitle}</h3>
          <p>{copy.recoveryCodesCopy}</p>
          <RecoveryCodeRotation locale={locale} />
        </section>

        <section
          aria-labelledby="destructive-actions-title"
          className="account-security destructive-actions"
        >
          <h2 id="destructive-actions-title">{copy.destructiveActionsTitle}</h2>
          <p>{copy.destructiveActionsCopy}</p>
          {accounts
            .filter((account) => account.state !== "unlinked")
            .map((account) => (
              <AccountUnlinkButton
                key={`unlink:${account.control}`}
                label={`${providerLabels[account.provider]} · ${account.privateLabel}`}
                locale={locale}
                targetControl={account.control}
              />
            ))}
          {installations
            .filter((installation) => installation.state === "active")
            .map((installation) => (
              <InstallationRevokeButton
                key={`installation:${installation.control}`}
                label={installation.label}
                locale={locale}
                targetControl={installation.control}
              />
            ))}
          {installations.flatMap((installation) =>
            installation.accounts
              .filter(
                (
                  account,
                ): account is AccountDashboardInstallation["accounts"][number] & {
                  readonly deviceControl: string;
                } => account.deviceState === "active" && account.deviceControl !== null,
              )
              .map((account) => (
                <DeviceRevokeButton
                  key={`device:${account.deviceControl}`}
                  label={`${installation.label} · ${account.privateLabel}`}
                  locale={locale}
                  targetControl={account.deviceControl}
                />
              )),
          )}
          {passkeys
            ?.filter((passkey) => passkey.state === "active" && !passkey.currentAuthenticator)
            .map((passkey) => (
              <PasskeyRevokeButton
                key={`passkey:${passkey.passkeyId}`}
                label={passkey.label}
                locale={locale}
                passkeyId={passkey.passkeyId}
              />
            ))}
          <div className="profile-deletion">
            <h3>{copy.profileDeletionTitle}</h3>
            <p>{copy.profileDeletionCopy}</p>
            <ProfileDeletionForm handle={handle} locale={locale} />
          </div>
        </section>

        <form action="/auth/logout" method="post">
          <button className="secondary-action" type="submit">
            {copy.logout}
          </button>
        </form>
        <Link href="/">← {copy.backToRace}</Link>
      </article>
    </main>
  );
}
