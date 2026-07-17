import "server-only";

import { Buffer } from "node:buffer";
import {
  argon2,
  randomBytes as nodeRandomBytes,
  randomUUID as nodeRandomUuid,
  timingSafeEqual,
  type Argon2Parameters,
} from "node:crypto";

const recoveryCodeCount = 10;
const recoveryCodeSecretBytes = 32;
const recoveryCodeSaltBytes = 16;
const recoveryCodeTagBytes = 32;
const recoveryCodeVersion = 1;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const recoveryCodePattern = new RegExp(
  `^vrr${String(recoveryCodeVersion)}_(${uuidV4Pattern.source.slice(1, -1)})_([A-Za-z0-9_-]{43})$`,
);
const recoveryPhcPattern =
  /^\$argon2id\$v=19\$m=([1-9][0-9]{0,5}),t=([1-9][0-9]?),p=([1-9][0-9]?)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/;
const associatedData = Buffer.from("viberacing-recovery-code-v1", "ascii");
const dummySalt = Buffer.from("viberacing-dummy", "ascii");

export interface RecoveryArgon2Configuration {
  readonly memoryKib: number;
  readonly parallelism: number;
  readonly passes: number;
}

export interface RecoveryCodeRecord {
  readonly codeId: string;
  readonly plaintext: string;
  readonly verifierPhc: string;
}

export interface ParsedRecoveryCode {
  readonly codeId: string;
  readonly secret: Buffer;
}

export type RecoveryCodeGenerator = () => Promise<readonly RecoveryCodeRecord[]>;
export type RecoveryCodeVerifier = (
  secret: Uint8Array | undefined,
  verifierPhc: string | undefined,
) => Promise<boolean>;

type RecoveryRandomBytes = (size: number) => Uint8Array;
type RecoveryRandomUuid = () => string;
type RecoveryArgon2 = (parameters: Argon2Parameters) => Promise<Uint8Array>;

interface RecoveryCodeGeneratorDependencies {
  readonly argon2?: RecoveryArgon2;
  readonly randomBytes?: RecoveryRandomBytes;
  readonly randomUuid?: RecoveryRandomUuid;
}

interface RecoveryCodeVerifierDependencies {
  readonly argon2?: RecoveryArgon2;
}

interface ParsedRecoveryPhc {
  readonly configuration: RecoveryArgon2Configuration;
  readonly salt: Buffer;
  readonly tag: Buffer;
}

function unavailable(): never {
  throw new Error("Recovery codes are unavailable.");
}

export function validRecoveryArgon2Configuration(
  memoryKib: number,
  passes: number,
  parallelism: number,
): boolean {
  return (
    Number.isSafeInteger(memoryKib) &&
    memoryKib >= 19_456 &&
    memoryKib <= 65_536 &&
    Number.isSafeInteger(passes) &&
    passes >= 2 &&
    passes <= 5 &&
    Number.isSafeInteger(parallelism) &&
    parallelism >= 2 &&
    parallelism <= 4 &&
    memoryKib > 8 * parallelism &&
    memoryKib % (4 * parallelism) === 0
  );
}

function deriveArgon2(parameters: Argon2Parameters): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", parameters, (error, derivedKey) => {
      if (error === null) {
        resolve(derivedKey);
      } else {
        reject(error);
      }
    });
  });
}

function phcBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64").replace(/=+$/u, "");
}

function canonicalPhcBytes(value: string, expectedLength: number): Buffer | undefined {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedLength || phcBase64(decoded) !== value) {
    decoded.fill(0);
    return undefined;
  }
  return decoded;
}

function parseRecoveryPhc(value: string | undefined): ParsedRecoveryPhc | undefined {
  if (value === undefined || value.length > 255) {
    return undefined;
  }
  const match = recoveryPhcPattern.exec(value);
  if (match === null) {
    return undefined;
  }
  const memoryKib = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  if (!validRecoveryArgon2Configuration(memoryKib, passes, parallelism)) {
    return undefined;
  }
  const salt = canonicalPhcBytes(match[4] ?? "", recoveryCodeSaltBytes);
  const tag = canonicalPhcBytes(match[5] ?? "", recoveryCodeTagBytes);
  if (salt === undefined || tag === undefined) {
    salt?.fill(0);
    tag?.fill(0);
    return undefined;
  }
  return Object.freeze({
    configuration: Object.freeze({ memoryKib, parallelism, passes }),
    salt,
    tag,
  });
}

export function readRecoveryCode(value: unknown): ParsedRecoveryCode | undefined {
  if (typeof value !== "string" || value.trim() !== value) {
    return undefined;
  }
  const match = recoveryCodePattern.exec(value);
  if (match === null) {
    return undefined;
  }
  const secret = Buffer.from(match[2] ?? "", "base64url");
  if (secret.length !== recoveryCodeSecretBytes || secret.toString("base64url") !== match[2]) {
    secret.fill(0);
    return undefined;
  }
  return Object.freeze({ codeId: match[1] ?? "", secret });
}

export function clearRecoveryCode(value: ParsedRecoveryCode | undefined): void {
  value?.secret.fill(0);
}

export function createRecoveryCodeVerifier(
  configuration: RecoveryArgon2Configuration,
  pepperValue: Uint8Array,
  dependencies: RecoveryCodeVerifierDependencies = {},
): RecoveryCodeVerifier {
  if (
    !validRecoveryArgon2Configuration(
      configuration.memoryKib,
      configuration.passes,
      configuration.parallelism,
    ) ||
    pepperValue.byteLength !== 32
  ) {
    unavailable();
  }
  const pepper = Buffer.from(pepperValue);
  const derive = dependencies.argon2 ?? deriveArgon2;

  return async (secretValue, verifierPhc): Promise<boolean> => {
    const parsed = parseRecoveryPhc(verifierPhc);
    const suppliedSecret =
      secretValue?.byteLength === recoveryCodeSecretBytes ? Buffer.from(secretValue) : undefined;
    const message = suppliedSecret ?? Buffer.alloc(recoveryCodeSecretBytes);
    const salt = Buffer.from(parsed?.salt ?? dummySalt);
    const expectedTag = Buffer.from(parsed?.tag ?? Buffer.alloc(recoveryCodeTagBytes));
    const selected = parsed?.configuration ?? configuration;
    let derived: Uint8Array | undefined;
    let tag: Buffer | undefined;
    try {
      derived = await derive({
        associatedData,
        memory: selected.memoryKib,
        message,
        nonce: salt,
        parallelism: selected.parallelism,
        passes: selected.passes,
        secret: pepper,
        tagLength: recoveryCodeTagBytes,
      });
      tag = Buffer.from(derived);
      return (
        suppliedSecret !== undefined &&
        parsed !== undefined &&
        tag.length === recoveryCodeTagBytes &&
        timingSafeEqual(tag, expectedTag)
      );
    } finally {
      parsed?.salt.fill(0);
      parsed?.tag.fill(0);
      suppliedSecret?.fill(0);
      if (message !== suppliedSecret) {
        message.fill(0);
      }
      salt.fill(0);
      expectedTag.fill(0);
      derived?.fill(0);
      tag?.fill(0);
    }
  };
}

export function createRecoveryCodeGenerator(
  configuration: RecoveryArgon2Configuration,
  pepperValue: Uint8Array,
  dependencies: RecoveryCodeGeneratorDependencies = {},
): RecoveryCodeGenerator {
  if (
    !validRecoveryArgon2Configuration(
      configuration.memoryKib,
      configuration.passes,
      configuration.parallelism,
    ) ||
    pepperValue.byteLength !== 32
  ) {
    unavailable();
  }
  const pepper = Buffer.from(pepperValue);
  const derive = dependencies.argon2 ?? deriveArgon2;
  const randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  const randomUuid = dependencies.randomUuid ?? nodeRandomUuid;

  return async (): Promise<readonly RecoveryCodeRecord[]> => {
    const records: RecoveryCodeRecord[] = [];
    const codeIds = new Set<string>();
    const plaintextValues = new Set<string>();
    const phcs = new Set<string>();

    for (let position = 0; position < recoveryCodeCount; position += 1) {
      const codeId = randomUuid();
      const secret = Buffer.from(randomBytes(recoveryCodeSecretBytes));
      const salt = Buffer.from(randomBytes(recoveryCodeSaltBytes));
      let derived: Uint8Array | undefined;
      let tag: Buffer | undefined;
      try {
        if (
          !uuidV4Pattern.test(codeId) ||
          codeIds.has(codeId) ||
          secret.length !== recoveryCodeSecretBytes ||
          salt.length !== recoveryCodeSaltBytes
        ) {
          unavailable();
        }
        derived = await derive({
          associatedData,
          memory: configuration.memoryKib,
          message: secret,
          nonce: salt,
          parallelism: configuration.parallelism,
          passes: configuration.passes,
          secret: pepper,
          tagLength: recoveryCodeTagBytes,
        });
        tag = Buffer.from(derived);
        if (tag.length !== recoveryCodeTagBytes) {
          unavailable();
        }
        const plaintext = `vrr${String(recoveryCodeVersion)}_${codeId}_${secret.toString("base64url")}`;
        const verifierPhc =
          `$argon2id$v=19$m=${String(configuration.memoryKib)},t=${String(configuration.passes)},` +
          `p=${String(configuration.parallelism)}$${phcBase64(salt)}$${phcBase64(tag)}`;
        if (plaintextValues.has(plaintext) || phcs.has(verifierPhc) || verifierPhc.length > 255) {
          unavailable();
        }
        codeIds.add(codeId);
        plaintextValues.add(plaintext);
        phcs.add(verifierPhc);
        records.push(Object.freeze({ codeId, plaintext, verifierPhc }));
      } finally {
        derived?.fill(0);
        tag?.fill(0);
        secret.fill(0);
        salt.fill(0);
      }
    }

    return Object.freeze(records);
  };
}
