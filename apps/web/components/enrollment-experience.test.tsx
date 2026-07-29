import { Buffer } from "node:buffer";

import axe from "axe-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { joinTranslations } from "@/lib/join-i18n";

import { AccountExperience } from "./account-experience";
import { ConnectExperience } from "./connect-experience";
import { JoinExperience } from "./join-experience";
import { PasskeyLogin, PasskeySetup, RecoveryExperience } from "./passkey-setup";

const webauthn = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => false),
  startAuthentication: vi.fn(() => Promise.resolve({ id: "synthetic-login" })),
  startRegistration: vi.fn(() => Promise.resolve({ id: "synthetic" })),
}));

vi.mock("@simplewebauthn/browser", () => webauthn);

interface Mounted {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

function mount(node: React.ReactNode): Mounted {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

function changeInput(input: HTMLInputElement, value: string): void {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setter = descriptor === undefined ? undefined : Reflect.get(descriptor, "set");
    if (typeof setter !== "function") {
      throw new Error("input value setter is unavailable");
    }
    Reflect.apply(setter, input, [value]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function batchPairingReviewFixture() {
  const accountControl = `ctl_${"D".repeat(23)}`;
  return {
    accountControl,
    response: {
      approval: {
        manifestDigest: "1".repeat(64),
        pairingId: `pair_${"A".repeat(22)}`,
        schemaVersion: 1,
      },
      pairing: {
        architecture: "x86_64",
        candidates: [
          {
            candidateId: `cand_${"A".repeat(22)}`,
            fingerprintKind: "stable_opaque",
            preview: {
              currentWeekTokenTotal: "9".repeat(60),
              lastUsageDate: "2026-07-28",
              status: "ready",
            },
            provider: "codex",
            safeDisplayLabel: "Codex personal",
            suggestedAgentAccountControl: accountControl,
          },
          {
            candidateId: `cand_${"B".repeat(22)}`,
            fingerprintKind: "unavailable",
            preview: {
              currentWeekTokenTotal: "400",
              lastUsageDate: "2026-07-27",
              status: "ready",
            },
            provider: "codex",
            safeDisplayLabel: "Codex work",
          },
          {
            candidateId: `cand_${"C".repeat(22)}`,
            fingerprintKind: "unavailable",
            preview: {
              currentWeekTokenTotal: "0",
              lastUsageDate: null,
              status: "unavailable",
            },
            provider: "codex",
            safeDisplayLabel: "Codex lab",
          },
        ],
        connectorVersion: "0.0.0",
        existingAccounts: [
          {
            accountControl,
            privateLabel: "Personal account",
            provider: "codex",
            state: "active",
          },
        ],
        expiresAt: "2026-07-28T12:09:00.000Z",
        installationLabel: "Studio PC",
        osFamily: "windows",
        publicKeyFingerprint: `SHA256:${Buffer.alloc(32, 0x32).toString("base64url")}`,
      },
    },
  } as const;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("enrollment experience", () => {
  it("keeps join copy in EN/RU parity and submits the exact closed field set", async () => {
    expect(Object.keys(joinTranslations.en)).toEqual(Object.keys(joinTranslations.ru));
    localStorage.setItem("viberacing.locale", "ru");
    const mounted = mount(<JoinExperience enrollmentEnabled error="invalid" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mounted.container.textContent).toContain("Присоединиться к гонке сообщества");
    expect(mounted.container.querySelector("main")?.getAttribute("lang")).toBe("ru");
    expect(mounted.container.querySelector('input[name="locale"]')?.getAttribute("value")).toBe(
      "ru",
    );
    expect(
      [...mounted.container.querySelectorAll("form [name]")].map((element) =>
        element.getAttribute("name"),
      ),
    ).toEqual(["locale"]);
    expect(renderToStaticMarkup(<JoinExperience enrollmentEnabled inviteGateEnabled />)).toContain(
      'name="inviteCode"',
    );
    expect(mounted.container.querySelector('[name="handle"]')).toBeNull();
    expect(mounted.container.querySelector('[name="theme"]')).toBeNull();
    expect(mounted.container.querySelector("form")?.getAttribute("action")).toBe(
      "/auth/github/start",
    );
    expect(mounted.container.querySelector('a[href="/login"]')).not.toBeNull();
    act(() => {
      mounted.root.unmount();
    });
  });

  it("keeps EN/RU login and recovery guidance visible while enrollment controls are disabled", async () => {
    localStorage.setItem("viberacing.locale", "ru");
    const mounted = mount(<JoinExperience enrollmentEnabled={false} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mounted.container.textContent).toContain(
      "Регистрация новых участников временно недоступна",
    );
    expect(mounted.container.querySelector('form[action="/auth/github/start"]')).toBeNull();
    expect(mounted.container.querySelector('a[href="/login"]')).not.toBeNull();

    for (const [locale, unavailable] of [
      ["en", "Enrollment is temporarily unavailable"],
      ["ru", "Регистрация временно недоступна"],
    ] as const) {
      const markup = renderToStaticMarkup(
        <PasskeySetup enrollmentEnabled={false} initialHandle="pixel_driver" locale={locale} />,
      );
      expect(markup).toContain(unavailable);
      expect(markup).not.toContain("<form");
    }
    act(() => {
      mounted.root.unmount();
    });
  });

  it("reports unsupported passkeys without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    webauthn.browserSupportsWebAuthn.mockReturnValue(false);
    const mounted = mount(
      <PasskeySetup enrollmentEnabled initialHandle="pixel_driver" locale="en" />,
    );
    expect(mounted.container.querySelector("main")?.getAttribute("lang")).toBe("en");
    const form = mounted.container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain("does not support WebAuthn passkeys");
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      mounted.root.unmount();
    });
  });

  it("uses the official browser adapter and shows one generic verification failure", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "synthetic" }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <PasskeySetup enrollmentEnabled initialHandle="pixel_driver" locale="en" />,
    );
    await act(async () => {
      mounted.container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startRegistration).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/auth/passkey/options",
      "/auth/passkey/verify",
    ]);
    expect(fetchMock.mock.calls[0]?.[1].body).toBe('{"handle":"pixel_driver"}');
    expect(fetchMock.mock.calls[1]?.[1].body).toBe('{"response":{"id":"synthetic"}}');
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("starts returning login with the official passkey adapter and no profile identifier", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "synthetic" }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("viberacing.locale", "ru");
    const mounted = mount(<PasskeyLogin />);
    await act(async () => {
      await Promise.resolve();
      mounted.container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mounted.container.querySelector("main")?.getAttribute("lang")).toBe("ru");
    expect(webauthn.startAuthentication).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/auth/login/options",
      "/auth/login/verify",
    ]);
    expect(fetchMock.mock.calls[0]?.[1].body).toBe("{}");
    const verificationBody = fetchMock.mock.calls[1]?.[1].body;
    expect(typeof verificationBody).toBe("string");
    if (typeof verificationBody !== "string") {
      throw new Error("expected a serialized login verification body");
    }
    expect(JSON.parse(verificationBody)).toEqual({
      response: { id: "synthetic-login" },
    });
    expect(mounted.container.textContent).toContain("Не удалось завершить запрос");
    expect(mounted.container.querySelector('a[href="/recover"]')).not.toBeNull();
    act(() => {
      mounted.root.unmount();
    });
  });

  it("keeps a recovery code transient and registers a replacement passkey", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "synthetic-recovery" }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(<RecoveryExperience />);
    const code =
      `vrr1_00000000-0000-4000-8000-000000000701_` + Buffer.alloc(32, 0x71).toString("base64url");
    const codeInput = mounted.container.querySelector<HTMLInputElement>('input[name="code"]');
    const labelInput = mounted.container.querySelector<HTMLInputElement>('input[name="label"]');
    if (codeInput === null || labelInput === null) {
      throw new Error("expected recovery fields");
    }
    codeInput.value = code;
    labelInput.value = "Replacement passkey";

    await act(async () => {
      mounted.container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/auth/recovery/options",
      "/auth/recovery/verify",
    ]);
    const startBody = fetchMock.mock.calls[0]?.[1].body;
    const verificationBody = fetchMock.mock.calls[1]?.[1].body;
    if (typeof startBody !== "string" || typeof verificationBody !== "string") {
      throw new Error("expected serialized recovery bodies");
    }
    expect(JSON.parse(startBody)).toEqual({
      code,
      label: "Replacement passkey",
    });
    expect(JSON.parse(verificationBody)).toEqual({
      response: { id: "synthetic" },
    });
    expect(webauthn.startRegistration).toHaveBeenCalledOnce();
    expect(codeInput.value).toBe("");
    expect(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)),
    ).not.toContain("recoveryCode");
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("shows only bounded passkey and active-device fields on the account page", () => {
    const passkeyId = "00000000-0000-4000-8000-000000000511";
    const deviceId = `dev_${"A".repeat(22)}`;
    const sourceId = `src_${"B".repeat(22)}`;
    const sourceControl = "opaque-source-control";
    const markup = renderToStaticMarkup(
      <AccountExperience
        activeDeviceInventory={[
          {
            devices: [
              {
                activatedOn: "2026-07-14",
                architecture: "x86_64",
                connectorVersion: "1.2.3",
                deviceId,
                label: "Studio PC",
                osFamily: "windows",
              },
            ],
            sourceControl,
            state: "active",
          },
        ]}
        handle="pixel_driver"
        locale="en"
        passkeys={[
          {
            createdOn: "2026-07-15",
            currentAuthenticator: true,
            label: "Primary passkey",
            passkeyId,
            state: "active",
          },
          {
            createdOn: "2026-07-16",
            currentAuthenticator: false,
            label: "Retired key",
            passkeyId: "00000000-0000-4000-8000-000000000512",
            state: "revoked",
          },
        ]}
        score={{
          activeDays: 7,
          dailyScores: [100, 200, 300, 400, 500, 600, 700],
          seasonEnd: "2026-07-19",
          seasonFinalized: false,
          seasonStart: "2026-07-13",
          sourceCount: 2,
          weeklyScore: 2800,
        }}
        visibility="public"
      />,
    );
    expect(markup).toContain("Your passkeys");
    expect(markup).toContain("Recovery codes");
    expect(markup).toContain("Sources and connected devices");
    expect(markup).toContain("Studio PC");
    expect(markup).toContain('action="/auth/devices/revoke"');
    expect(markup).toContain(`name="deviceId" value="${deviceId}"`);
    expect(markup).toContain(`name="sourceControl" value="${sourceControl}"`);
    expect(markup).toContain('action="/auth/sources/pause"');
    expect(markup).toContain("Unlink source permanently");
    expect(markup).toContain('dateTime="2026-07-14"');
    expect(markup).not.toContain(sourceId);
    expect(markup).not.toContain("vrr1_");
    expect(markup).toContain("Public profile");
    expect(markup).toContain("Delete profile");
    expect(markup).toContain('name="handle"');
    expect(markup).toContain("Eligible scores can appear in the Community race");
    expect(markup).toContain('href="/?profile=pixel_driver#profile"');
    expect(markup).toContain("View public profile");
    expect(markup).toContain('action="/auth/profile/visibility"');
    expect(markup).toContain('type="hidden" name="visibility" value="hidden"');
    expect(markup).toContain("Current-week score");
    expect(markup).toContain("2,800 pts");
    expect(markup).toContain('aria-label="Mon: 100 pts"');
    expect(markup).toContain('aria-label="Sun: 700 pts"');
    expect(markup.match(/<progress/g)).toHaveLength(7);
    expect(markup).toContain("Exact token totals and per-source values stay private");
    expect(markup).not.toContain("raw_tokens");
    expect(markup).toContain("Current session");
    expect(markup).toContain("Revoked");
    expect(markup).toContain('dateTime="2026-07-15"');
    expect(markup).not.toContain(passkeyId);
  });

  it("renders hidden and unavailable profile states without client-side persistence", () => {
    const hidden = renderToStaticMarkup(
      <AccountExperience
        actionUnavailable
        activeDeviceInventory={[
          {
            devices: [],
            sourceControl: "opaque-source-control",
            state: "paused",
          },
          {
            devices: [],
            sourceControl: "opaque-unlinked-source-control",
            state: "unlinked",
          },
        ]}
        handle="pixel_driver"
        locale="ru"
        passkeys={[]}
        score={null}
        visibility="hidden"
      />,
    );
    expect(hidden).toContain("Публичный профиль выключен");
    expect(hidden).toContain("Возобновить источник");
    expect(hidden.match(/aria-label="Отключить источник навсегда:/g)).toHaveLength(1);
    expect(hidden).toContain("не осталось активных прав устройства");
    expect(hidden).toContain('type="hidden" name="visibility" value="public"');
    expect(hidden).not.toContain("Открыть публичный профиль");
    expect(hidden).toContain("Не удалось изменить аккаунт");
    expect(hidden).toContain("Для скрытого профиля текущий результат не показывается");

    const unavailable = renderToStaticMarkup(
      <AccountExperience
        activeDeviceInventory={undefined}
        handle="pixel_driver"
        locale="en"
        passkeys={undefined}
        visibility={undefined}
      />,
    );
    expect(unavailable).toContain("Profile visibility is temporarily unavailable");
    expect(unavailable).toContain("Current score is temporarily unavailable");
    expect(unavailable).toContain("Source and device details are temporarily unavailable");
    expect(unavailable).not.toContain('action="/auth/profile/visibility"');
  });

  it("uses an existing assertion before creating one backup passkey", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticationOptions: { challenge: "authentication" },
            registrationOptions: { challenge: "registration" },
          }),
          { headers: { "content-type": "application/json; charset=utf-8" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <AccountExperience
        activeDeviceInventory={[]}
        handle="pixel_driver"
        locale="en"
        visibility="public"
        passkeys={[
          {
            createdOn: "2026-07-15",
            currentAuthenticator: true,
            label: "Primary passkey",
            passkeyId: "00000000-0000-4000-8000-000000000511",
            state: "active",
          },
        ]}
      />,
    );
    const input = mounted.container.querySelector<HTMLInputElement>('input[name="label"]');
    if (input === null) {
      throw new Error("expected backup passkey label input");
    }
    input.value = "Laptop backup";
    await act(async () => {
      input
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "authentication" },
    });
    expect(webauthn.startRegistration).toHaveBeenCalledWith({
      optionsJSON: { challenge: "registration" },
    });
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/auth/passkeys/add/options",
      "/auth/passkeys/add/verify",
    ]);
    expect(fetchMock.mock.calls[0]?.[1].body).toBe('{"label":"Laptop backup"}');
    const verificationBody = fetchMock.mock.calls[1]?.[1].body;
    expect(typeof verificationBody).toBe("string");
    if (typeof verificationBody !== "string") {
      throw new Error("expected serialized add request body");
    }
    expect(JSON.parse(verificationBody)).toEqual({
      authentication: { id: "synthetic-login" },
      registration: { id: "synthetic" },
    });
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("shows a validated recovery-code batch only after a fresh browser assertion", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    webauthn.startAuthentication.mockClear();
    const recoveryCodes = Array.from(
      { length: 10 },
      (_, index) =>
        `vrr1_50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}_${Buffer.from(
          new Uint8Array(32).fill(index + 1),
        ).toString("base64url")}`,
    );
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "recovery" }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ recoveryCodes }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <AccountExperience
        activeDeviceInventory={[]}
        handle="pixel_driver"
        locale="en"
        passkeys={[]}
        visibility="public"
      />,
    );
    const button = [...mounted.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Generate new recovery codes",
    );
    await act(async () => {
      button
        ?.closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "recovery" },
    });
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/auth/recovery-codes/options",
      "/auth/recovery-codes/verify",
    ]);
    expect(fetchMock.mock.calls[0]?.[1].body).toBe("{}");
    const verificationBody = fetchMock.mock.calls[1]?.[1].body;
    expect(typeof verificationBody).toBe("string");
    if (typeof verificationBody !== "string") {
      throw new Error("expected serialized recovery-code request body");
    }
    expect(JSON.parse(verificationBody)).toEqual({
      response: { id: "synthetic-login" },
    });
    expect(mounted.container.querySelectorAll(".recovery-code-list code")).toHaveLength(10);
    expect(mounted.container.textContent).toContain(recoveryCodes[0]);
    expect(mounted.container.textContent).toContain(
      "Previous recovery codes are invalid. Save these ten new codes now.",
    );
    act(() => {
      mounted.root.unmount();
    });
  });

  it("uses a fresh browser passkey assertion before revoking a non-current key", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const targetPasskeyId = "00000000-0000-4000-8000-000000000512";
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "synthetic" }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <AccountExperience
        activeDeviceInventory={[]}
        handle="pixel_driver"
        locale="en"
        visibility="public"
        passkeys={[
          {
            createdOn: "2026-07-15",
            currentAuthenticator: true,
            label: "Primary passkey",
            passkeyId: "00000000-0000-4000-8000-000000000511",
            state: "active",
          },
          {
            createdOn: "2026-07-16",
            currentAuthenticator: false,
            label: "Backup passkey",
            passkeyId: targetPasskeyId,
            state: "active",
          },
        ]}
      />,
    );
    await act(async () => {
      mounted.container
        .querySelector(".passkey-revoke")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startAuthentication).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/auth/passkeys/revoke/options",
      "/auth/passkeys/revoke/verify",
    ]);
    const optionsBody = fetchMock.mock.calls[0]?.[1].body;
    const verificationBody = fetchMock.mock.calls[1]?.[1].body;
    expect(typeof optionsBody).toBe("string");
    expect(typeof verificationBody).toBe("string");
    if (typeof optionsBody !== "string" || typeof verificationBody !== "string") {
      throw new Error("expected serialized revoke request bodies");
    }
    expect(JSON.parse(optionsBody)).toEqual({ passkeyId: targetPasskeyId });
    expect(JSON.parse(verificationBody)).toEqual({
      response: { id: "synthetic-login" },
    });
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("uses only an opaque source control before fresh-passkey reactivation", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const sourceControl = "opaque-source-control";
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "synthetic" }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <AccountExperience
        activeDeviceInventory={[
          {
            devices: [],
            sourceControl,
            state: "paused",
          },
        ]}
        handle="pixel_driver"
        locale="en"
        passkeys={[]}
        visibility="hidden"
      />,
    );
    await act(async () => {
      mounted.container
        .querySelector(".passkey-revoke")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startAuthentication).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/auth/sources/reactivate/options",
      "/auth/sources/reactivate/verify",
    ]);
    const optionsBody = fetchMock.mock.calls[0]?.[1].body;
    const verificationBody = fetchMock.mock.calls[1]?.[1].body;
    expect(typeof optionsBody).toBe("string");
    expect(typeof verificationBody).toBe("string");
    if (typeof optionsBody !== "string" || typeof verificationBody !== "string") {
      throw new Error("expected serialized source reactivation request bodies");
    }
    expect(JSON.parse(optionsBody)).toEqual({ sourceControl });
    expect(JSON.parse(verificationBody)).toEqual({ response: { id: "synthetic-login" } });
    expect(optionsBody).not.toContain("src_");
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("uses only an opaque source control before permanent fresh-passkey unlink", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const sourceControl = "opaque-source-control";
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "synthetic" }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <AccountExperience
        activeDeviceInventory={[{ devices: [], sourceControl, state: "quarantined" }]}
        handle="pixel_driver"
        locale="en"
        passkeys={[]}
        visibility="hidden"
      />,
    );
    await act(async () => {
      mounted.container
        .querySelector('button[aria-label^="Unlink source permanently"]')
        ?.closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startAuthentication).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/auth/sources/unlink/options",
      "/auth/sources/unlink/verify",
    ]);
    const optionsBody = fetchMock.mock.calls[0]?.[1].body;
    const verificationBody = fetchMock.mock.calls[1]?.[1].body;
    expect(typeof optionsBody).toBe("string");
    expect(typeof verificationBody).toBe("string");
    if (typeof optionsBody !== "string" || typeof verificationBody !== "string") {
      throw new Error("expected serialized source unlink request bodies");
    }
    expect(JSON.parse(optionsBody)).toEqual({ sourceControl });
    expect(JSON.parse(verificationBody)).toEqual({ response: { id: "synthetic-login" } });
    expect(optionsBody).not.toContain("src_");
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("requires the exact handle and a fresh passkey before deleting the profile", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "synthetic" }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <AccountExperience
        activeDeviceInventory={[]}
        handle="pixel_driver"
        locale="en"
        passkeys={[]}
        visibility="public"
      />,
    );
    const input = mounted.container.querySelector<HTMLInputElement>('input[name="handle"]');
    if (input === null) {
      throw new Error("expected deletion confirmation input");
    }
    input.value = "other_driver";
    await act(async () => {
      input
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain("Type your exact handle");

    input.value = "pixel_driver";
    await act(async () => {
      input
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startAuthentication).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/auth/profile/delete/options",
      "/auth/profile/delete/verify",
    ]);
    expect(fetchMock.mock.calls[0]?.[1].body).toBe('{"handle":"pixel_driver"}');
    const verificationBody = fetchMock.mock.calls[1]?.[1].body;
    expect(typeof verificationBody).toBe("string");
    if (typeof verificationBody !== "string") {
      throw new Error("expected serialized deletion verification body");
    }
    expect(JSON.parse(verificationBody)).toEqual({ response: { id: "synthetic-login" } });
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("reviews a full batch and approves ordered attach, create, and skip decisions once", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const challenge = Buffer.alloc(32, 0x31).toString("base64url");
    const fixture = batchPairingReviewFixture();
    const fetchMock = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fixture.response), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ options: { challenge } }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <ConnectExperience initialCode="7K9M-P2QR-W4XY" initialLocale="en" signedIn />,
    );
    const codeInput = mounted.container.querySelector<HTMLInputElement>('input[name="userCode"]');
    if (codeInput === null) {
      throw new Error("expected pairing code input");
    }

    await act(async () => {
      codeInput.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain("Studio PC");
    expect(mounted.container.textContent).toContain("Codex personal");
    expect(mounted.container.textContent).toContain("Codex work");
    expect(mounted.container.textContent).toContain("Codex lab");
    expect(mounted.container.textContent).toContain("9".repeat(60));
    expect(mounted.container.innerHTML).not.toContain("acc_");

    const selectors = mounted.container.querySelectorAll<HTMLSelectElement>(
      ".pairing-source-option select",
    );
    expect(selectors).toHaveLength(3);
    expect(selectors[0]?.value).toBe(`attach:${fixture.accountControl}`);
    expect(selectors[1]?.value).toBe("create");
    await act(async () => {
      const skipSelector = selectors[2];
      if (skipSelector === undefined) {
        throw new Error("expected the third candidate selector");
      }
      skipSelector.value = "skip";
      skipSelector.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      mounted.container
        .querySelector(".account-security form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge },
    });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/auth/pairing/review",
      "/auth/pairing/options",
      "/auth/pairing/verify",
    ]);
    expect(fetchMock.mock.calls[0]?.[1].body).toBe('{"userCode":"7K9M-P2QR-W4XY"}');
    const approvalBody = fetchMock.mock.calls[1]?.[1].body;
    if (typeof approvalBody !== "string") {
      throw new Error("Expected a serialized batch approval.");
    }
    expect(JSON.parse(approvalBody)).toEqual({
      ...fixture.response.approval,
      decisions: [
        {
          action: "attach_existing",
          candidateId: `cand_${"A".repeat(22)}`,
          targetAgentAccountControl: fixture.accountControl,
        },
        {
          action: "create",
          candidateId: `cand_${"B".repeat(22)}`,
          privateLabel: "Codex work",
        },
        { action: "skip", candidateId: `cand_${"C".repeat(22)}` },
      ],
    });
    expect(fetchMock.mock.calls[2]?.[1].body).toBe('{"response":{"id":"synthetic-login"}}');
    expect(mounted.container.textContent).toContain("Device approved");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("contains an invalid private label without starting passkey approval", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const fixture = batchPairingReviewFixture();
    const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify(fixture.response), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(
      <ConnectExperience initialCode="7K9M-P2QR-W4XY" initialLocale="en" signedIn />,
    );
    const codeInput = mounted.container.querySelector<HTMLInputElement>('input[name="userCode"]');
    if (codeInput === null) {
      throw new Error("expected pairing code input");
    }
    await act(async () => {
      codeInput.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const privateLabel = mounted.container.querySelector<HTMLInputElement>(
      '.pairing-source-option input[type="text"]',
    );
    if (privateLabel === null) {
      throw new Error("expected a private label input");
    }
    changeInput(privateLabel, "\u0001");
    await act(async () => {
      mounted.container
        .querySelector(".account-security form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("requires sign-in in EN and RU before exposing batch pairing controls", () => {
    const english = renderToStaticMarkup(
      <ConnectExperience initialCode="7K9M-P2QR-W4XY" initialLocale="en" signedIn={false} />,
    );
    const russian = renderToStaticMarkup(<ConnectExperience initialLocale="ru" signedIn={false} />);

    expect(english).toContain("Sign in");
    expect(russian).toContain("Войти");
    expect(english).toContain('href="/login?returnTo=%2Fconnect%3Fcode%3D7K9M-P2QR-W4XY"');
    expect(russian).toContain('href="/login"');
    expect(english).not.toContain('name="userCode"');
    expect(russian).not.toContain('name="userCode"');
  });

  it("rejects malformed pairing review data before invoking WebAuthn", async () => {
    webauthn.browserSupportsWebAuthn.mockReturnValue(true);
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ approval: {}, pairing: {} }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mount(<ConnectExperience initialLocale="en" signedIn />);
    const codeInput = mounted.container.querySelector<HTMLInputElement>('input[name="userCode"]');
    if (codeInput === null) {
      throw new Error("expected pairing code input");
    }
    codeInput.value = "7K9M-P2QR-W4XY";
    await act(async () => {
      codeInput.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(webauthn.startAuthentication).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain("could not be completed");
    act(() => {
      mounted.root.unmount();
    });
  });

  it("renders semantic join and passkey forms without automated violations", async () => {
    document.documentElement.lang = "en";
    document.title = "Vibe Racing enrollment test";
    for (const markup of [
      renderToStaticMarkup(<JoinExperience enrollmentEnabled />),
      renderToStaticMarkup(
        <AccountExperience
          activeDeviceInventory={[]}
          handle="pixel_driver"
          locale="en"
          visibility="public"
          passkeys={[
            {
              createdOn: "2026-07-15",
              currentAuthenticator: true,
              label: "Primary passkey",
              passkeyId: "00000000-0000-4000-8000-000000000511",
              state: "active",
            },
          ]}
        />,
      ),
      renderToStaticMarkup(<PasskeyLogin />),
      renderToStaticMarkup(<RecoveryExperience />),
      renderToStaticMarkup(
        <PasskeySetup enrollmentEnabled initialHandle="pixel_driver" locale="en" />,
      ),
      renderToStaticMarkup(<ConnectExperience initialLocale="en" signedIn />),
    ]) {
      document.body.innerHTML = markup;
      const results = await axe.run(document.documentElement, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(results.violations).toEqual([]);
      expect(document.querySelectorAll("h1")).toHaveLength(1);
    }
  });
});
