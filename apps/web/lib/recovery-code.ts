import "server-only";

import { Buffer } from "node:buffer";
import {
  argon2,
  randomBytes as nodeRandomBytes,
  randomUUID as nodeRandomUuid,
  type Argon2Parameters,
} from "node:crypto";

const recoveryCodeCount = 10;
const recoveryCodeSecretBytes = 32;
const recoveryCodeSaltBytes = 16;
const recoveryCodeTagBytes = 32;
const recoveryCodeVersion = 1;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const associatedData = Buffer.from("viberacing-recovery-code-v1", "ascii");

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

export type RecoveryCodeGenerator = () => Promise<readonly RecoveryCodeRecord[]>;

type RecoveryRandomBytes = (size: number) => Uint8Array;
type RecoveryRandomUuid = () => string;
type RecoveryArgon2 = (parameters: Argon2Parameters) => Promise<Uint8Array>;

interface RecoveryCodeGeneratorDependencies {
  readonly argon2?: RecoveryArgon2;
  readonly randomBytes?: RecoveryRandomBytes;
  readonly randomUuid?: RecoveryRandomUuid;
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
