import "server-only";

import { headers } from "next/headers";

import { readCookie } from "./enrollment-cookie";
import type { AccountScore, PasskeyInventoryItem, ProfileVisibility } from "./enrollment-database";
import type { EnrollmentSession } from "./enrollment-domain";
import { getEnrollmentRuntime } from "./enrollment-runtime";
import { enrollmentCookieNames, type AccountSourceDeviceInventoryItem } from "./enrollment-service";

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
  readonly activeDeviceInventory: readonly AccountSourceDeviceInventoryItem[] | undefined;
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
    let activeDeviceInventory: readonly AccountSourceDeviceInventoryItem[] | undefined;
    if (session.passkeyRegistered) {
      try {
        activeDeviceInventory = await service.readActiveDeviceInventory(sessionCookie);
      } catch {
        activeDeviceInventory = undefined;
      }
    }
    return Object.freeze({ activeDeviceInventory, session });
  } catch {
    return undefined;
  }
}

export interface EnrollmentPageAccount {
  readonly activeDeviceInventory: readonly AccountSourceDeviceInventoryItem[] | undefined;
  readonly passkeys: readonly PasskeyInventoryItem[] | undefined;
  readonly score: AccountScore | null | undefined;
  readonly session: EnrollmentSession;
  readonly visibility: ProfileVisibility | undefined;
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
    const [activeDeviceInventory, overview, passkeys] = await Promise.all([
      service.readActiveDeviceInventory(sessionCookie),
      service.readAccountOverview(sessionCookie),
      service.readPasskeyInventory(sessionCookie),
    ]);
    return Object.freeze({
      activeDeviceInventory,
      passkeys,
      score: overview?.score,
      session,
      visibility: overview?.visibility,
    });
  } catch {
    return undefined;
  }
}
