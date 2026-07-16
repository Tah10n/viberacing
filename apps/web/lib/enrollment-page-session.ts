import "server-only";

import { headers } from "next/headers";

import { readCookie } from "./enrollment-cookie";
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
