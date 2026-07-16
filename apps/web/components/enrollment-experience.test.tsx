import axe from "axe-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { joinTranslations } from "@/lib/join-i18n";

import { AccountExperience } from "./account-experience";
import { JoinExperience } from "./join-experience";
import { PasskeyLogin, PasskeySetup } from "./passkey-setup";

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

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("enrollment experience", () => {
  it("keeps join copy in EN/RU parity and submits the exact closed field set", async () => {
    expect(Object.keys(joinTranslations.en)).toEqual(Object.keys(joinTranslations.ru));
    localStorage.setItem("viberacing.locale", "ru");
    localStorage.setItem("viberacing.theme", "cyber-rally");
    localStorage.setItem("viberacing.motion", "off");
    const mounted = mount(<JoinExperience error="invalid" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mounted.container.textContent).toContain("Присоединиться к гонке сообщества");
    expect(mounted.container.querySelector("main")?.getAttribute("lang")).toBe("ru");
    expect(mounted.container.querySelector('input[name="locale"]')?.getAttribute("value")).toBe(
      "ru",
    );
    expect(mounted.container.querySelector<HTMLSelectElement>('select[name="theme"]')!.value).toBe(
      "cyber-rally",
    );
    expect(
      [...mounted.container.querySelectorAll("form [name]")].map((element) =>
        element.getAttribute("name"),
      ),
    ).toEqual(["locale", "inviteCode", "handle", "theme", "motionPreference", "streakVisible"]);
    expect(mounted.container.querySelector("form")?.getAttribute("action")).toBe(
      "/auth/github/start",
    );
    expect(mounted.container.querySelector('a[href="/login"]')).not.toBeNull();
    act(() => {
      mounted.root.unmount();
    });
  });

  it("reports unsupported passkeys without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    webauthn.browserSupportsWebAuthn.mockReturnValue(false);
    const mounted = mount(<PasskeySetup handle="pixel_driver" locale="en" />);
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
    const mounted = mount(<PasskeySetup handle="pixel_driver" locale="en" />);
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
    act(() => {
      mounted.root.unmount();
    });
  });

  it("shows only bounded passkey inventory fields on the account page", () => {
    const passkeyId = "00000000-0000-4000-8000-000000000511";
    const markup = renderToStaticMarkup(
      <AccountExperience
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
      />,
    );
    expect(markup).toContain("Your passkeys");
    expect(markup).toContain("Current session");
    expect(markup).toContain("Revoked");
    expect(markup).toContain('dateTime="2026-07-15"');
    expect(markup).not.toContain(passkeyId);
  });

  it("renders semantic join and passkey forms without automated violations", async () => {
    document.documentElement.lang = "en";
    document.title = "Vibe Racing enrollment test";
    for (const markup of [
      renderToStaticMarkup(<JoinExperience />),
      renderToStaticMarkup(
        <AccountExperience
          handle="pixel_driver"
          locale="en"
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
      renderToStaticMarkup(<PasskeySetup handle="pixel_driver" locale="en" />),
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
