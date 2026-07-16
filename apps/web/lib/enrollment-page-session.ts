import "server-only";

import { headers } from "next/headers";

import { readCookie } from "./enrollment-cookie";
import type { PasskeyInventoryItem } from "./enrollment-database";
import type { EnrollmentSession } from "./enrollment-domain";
import { getEnrollmentRuntime } from "./enrollment-runtime";
import { enrollmentCookieNames } from "./enrollment-service";

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

export interface EnrollmentPageAccount {
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
    const service = getEnrollmentRuntime().service;
    const session = service.readSession(sessionCookie);
    if (session === undefined) {
      return undefined;
    }
    const passkeys = await service.readPasskeyInventory(sessionCookie);
    return Object.freeze({ passkeys, session });
  } catch {
    return undefined;
  }
}
