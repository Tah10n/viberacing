import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomUUID as nodeRandomUuid } from "node:crypto";

import { validateCarRecipeV1, type CarRecipeV1 } from "@viberacing/contracts";

import type { EnrollmentCookieCodec } from "./enrollment-cookie";
import type { CarRecipeState, EnrollmentDatabase } from "./enrollment-database";
import { enrollmentPatterns, type EnrollmentSession } from "./enrollment-domain";

const proposalLifetimeSeconds = 24 * 60 * 60;
const controlKeys = new Set(["expiresAt", "proposalId", "sessionId", "version"]);

interface ProposalControl {
  readonly expiresAt: number;
  readonly proposalId: string;
  readonly sessionId: string;
  readonly version: 1;
}

export interface AccountCarRecipeProposal {
  readonly control: string;
  readonly recipe: CarRecipeV1;
}

export interface AccountCarRecipeState {
  readonly active: CarRecipeV1 | null;
  readonly proposal: AccountCarRecipeProposal | null;
}

export interface CarProposalService {
  approve(
    sessionCookie: string,
    proposalControl: string,
    carProposalsEnabled: unknown,
  ): Promise<boolean>;
  propose(sessionCookie: string, value: unknown, carProposalsEnabled: unknown): Promise<boolean>;
  read(sessionCookie: string): Promise<AccountCarRecipeState | undefined>;
  reject(sessionCookie: string, proposalControl: string): Promise<boolean>;
}

interface CarProposalServiceDependencies {
  readonly cookieCodec: EnrollmentCookieCodec;
  readonly database: Pick<
    EnrollmentDatabase,
    "approveCarRecipe" | "proposeCarRecipe" | "readCarRecipeState" | "rejectCarRecipe"
  >;
  readonly now?: () => Date;
  readonly randomUuid?: () => string;
  readonly readSession: (sessionCookie: string) => EnrollmentSession | undefined;
}

function canonicalVerifier(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    decoded.fill(0);
    return undefined;
  }
  return decoded;
}

function exactControl(
  value: unknown,
  nowSeconds: number,
  sessionId: string,
): ProposalControl | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== controlKeys.size ||
    keys.some((key) => !controlKeys.has(key)) ||
    record.version !== 1 ||
    record.sessionId !== sessionId ||
    typeof record.proposalId !== "string" ||
    !enrollmentPatterns.uuidV4.test(record.proposalId) ||
    typeof record.expiresAt !== "number" ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt <= nowSeconds ||
    record.expiresAt > nowSeconds + proposalLifetimeSeconds
  ) {
    return undefined;
  }
  return Object.freeze({
    expiresAt: record.expiresAt,
    proposalId: record.proposalId,
    sessionId,
    version: 1,
  });
}

function proposalControl(
  state: CarRecipeState,
  cookieCodec: EnrollmentCookieCodec,
  session: EnrollmentSession,
  nowSeconds: number,
): AccountCarRecipeState | undefined {
  if (state.proposal === null) {
    return Object.freeze({ active: state.active, proposal: null });
  }
  const proposalExpiry = new Date(state.proposal.expiresAt).valueOf();
  if (!Number.isFinite(proposalExpiry)) {
    return undefined;
  }
  const expiresAt = Math.min(session.expiresAt, Math.floor(proposalExpiry / 1000));
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + proposalLifetimeSeconds) {
    return undefined;
  }
  const control = cookieCodec.seal("car-proposal", {
    expiresAt,
    proposalId: state.proposal.proposalId,
    sessionId: session.sessionId,
    version: 1,
  } satisfies ProposalControl);
  return Object.freeze({
    active: state.active,
    proposal: Object.freeze({ control, recipe: state.proposal.recipe }),
  });
}

export function createCarProposalService(
  dependencies: CarProposalServiceDependencies,
): CarProposalService {
  const now = dependencies.now ?? (() => new Date());
  const randomUuid = dependencies.randomUuid ?? nodeRandomUuid;

  function currentSession(sessionCookie: string):
    | {
        readonly nowDate: Date;
        readonly nowSeconds: number;
        readonly session: EnrollmentSession;
      }
    | undefined {
    const nowDate = now();
    const timestamp = nowDate.valueOf();
    const session = dependencies.readSession(sessionCookie);
    if (!Number.isFinite(timestamp) || !session?.passkeyRegistered) {
      return undefined;
    }
    return Object.freeze({ nowDate, nowSeconds: Math.floor(timestamp / 1000), session });
  }

  async function withSession<Result>(
    sessionCookie: string,
    operation: (
      session: EnrollmentSession,
      sessionVerifierDigest: Buffer,
      nowDate: Date,
      nowSeconds: number,
    ) => Promise<Result>,
  ): Promise<Result | undefined> {
    const current = currentSession(sessionCookie);
    if (current === undefined) {
      return undefined;
    }
    let verifier: Buffer | undefined;
    let verifierDigest: Buffer | undefined;
    try {
      verifier = canonicalVerifier(current.session.sessionVerifier);
      if (verifier === undefined) {
        return undefined;
      }
      verifierDigest = createHash("sha256").update(verifier).digest();
      return await operation(current.session, verifierDigest, current.nowDate, current.nowSeconds);
    } catch {
      return undefined;
    } finally {
      verifier?.fill(0);
      verifierDigest?.fill(0);
    }
  }

  async function decide(
    sessionCookie: string,
    encodedControl: string,
    action: "approve" | "reject",
  ): Promise<boolean> {
    if (encodedControl.length < 1 || encodedControl.length > 1024) {
      return false;
    }
    return (
      (await withSession(
        sessionCookie,
        async (session, sessionVerifierDigest, _nowDate, nowSeconds) => {
          const control = exactControl(
            dependencies.cookieCodec.open("car-proposal", encodedControl),
            nowSeconds,
            session.sessionId,
          );
          if (control === undefined) {
            return false;
          }
          const input = {
            proposalId: control.proposalId,
            sessionId: session.sessionId,
            sessionVerifierDigest,
          };
          return action === "approve"
            ? await dependencies.database.approveCarRecipe(input)
            : await dependencies.database.rejectCarRecipe(input);
        },
      )) ?? false
    );
  }

  return Object.freeze({
    approve(
      sessionCookie: string,
      encodedControl: string,
      carProposalsEnabled: unknown,
    ): Promise<boolean> {
      return carProposalsEnabled === true
        ? decide(sessionCookie, encodedControl, "approve")
        : Promise.resolve(false);
    },
    async propose(
      sessionCookie: string,
      value: unknown,
      carProposalsEnabled: unknown,
    ): Promise<boolean> {
      if (carProposalsEnabled !== true) {
        return false;
      }
      const validated = validateCarRecipeV1(value);
      if (!validated.ok) {
        return false;
      }
      return (
        (await withSession(sessionCookie, async (session, sessionVerifierDigest, nowDate) => {
          const proposalId = randomUuid();
          if (!enrollmentPatterns.uuidV4.test(proposalId)) {
            return false;
          }
          const expiresAt = new Date(
            nowDate.valueOf() + proposalLifetimeSeconds * 1000,
          ).toISOString();
          return await dependencies.database.proposeCarRecipe({
            expiresAt,
            proposalId,
            recipe: validated.value,
            sessionId: session.sessionId,
            sessionVerifierDigest,
          });
        })) ?? false
      );
    },
    async read(sessionCookie: string): Promise<AccountCarRecipeState | undefined> {
      return await withSession(
        sessionCookie,
        async (session, sessionVerifierDigest, _nowDate, nowSeconds) => {
          const state = await dependencies.database.readCarRecipeState({
            sessionId: session.sessionId,
            sessionVerifierDigest,
          });
          return proposalControl(state, dependencies.cookieCodec, session, nowSeconds);
        },
      );
    },
    reject(sessionCookie: string, encodedControl: string): Promise<boolean> {
      return decide(sessionCookie, encodedControl, "reject");
    },
  });
}
