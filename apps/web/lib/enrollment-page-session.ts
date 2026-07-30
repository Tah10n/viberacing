import "server-only";

import { headers } from "next/headers";

import { readCookie } from "./enrollment-cookie";
import type { AccountCarRecipeState } from "./car-proposal-service";
import type { PasskeyInventoryItem } from "./enrollment-database";
import type { EnrollmentSession } from "./enrollment-domain";
import { getEnrollmentRuntime } from "./enrollment-runtime";
import { enrollmentCookieNames, type AccountDashboard } from "./enrollment-service";

export async function readEnrollmentPageSession(): Promise<EnrollmentSession | undefined> {
  try {
    const requestHeaders = await headers();
    const sessionCookie = readCookie(requestHeaders.get("cookie"), enrollmentCookieNames.session);
    if (sessionCookie === undefined) {
      return undefined;
    }
    return getEnrollmentRuntime().service.readSession(sessionCookie);
  } catch {
    return undefined;
  }
}

export interface EnrollmentPageConnect {
  readonly session: EnrollmentSession;
}

export async function readEnrollmentPageConnect(): Promise<EnrollmentPageConnect | undefined> {
  try {
    const requestHeaders = await headers();
    const sessionCookie = readCookie(requestHeaders.get("cookie"), enrollmentCookieNames.session);
    if (sessionCookie === undefined) {
      return undefined;
    }
    const service = getEnrollmentRuntime().service;
    const session = service.readSession(sessionCookie);
    if (session === undefined) {
      return undefined;
    }
    return Object.freeze({ session });
  } catch {
    return undefined;
  }
}

export interface EnrollmentPageAccount {
  readonly carRecipeState: AccountCarRecipeState | undefined;
  readonly dashboard: AccountDashboard | undefined;
  readonly passkeys: readonly PasskeyInventoryItem[] | undefined;
  readonly session: EnrollmentSession;
}

export async function readEnrollmentPageAccount(): Promise<EnrollmentPageAccount | undefined> {
  try {
    const requestHeaders = await headers();
    const sessionCookie = readCookie(requestHeaders.get("cookie"), enrollmentCookieNames.session);
    if (sessionCookie === undefined) {
      return undefined;
    }
    const runtime = getEnrollmentRuntime();
    const service = runtime.service;
    const session = service.readSession(sessionCookie);
    if (session === undefined) {
      return undefined;
    }
    const [carRecipeState, dashboard, passkeys] = await Promise.all([
      runtime.carProposalService.read(sessionCookie),
      service.readAccountDashboard(sessionCookie),
      service.readPasskeyInventory(sessionCookie),
    ]);
    return Object.freeze({
      carRecipeState,
      dashboard,
      passkeys,
      session,
    });
  } catch {
    return undefined;
  }
}
