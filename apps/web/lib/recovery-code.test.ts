import { Buffer } from "node:buffer";
import { argon2, type Argon2Parameters } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  clearRecoveryCode,
  createRecoveryCodeGenerator,
  createRecoveryCodeVerifier,
  readRecoveryCode,
  validRecoveryArgon2Configuration,
} from "./recovery-code";

const configuration = Object.freeze({ memoryKib: 19_456, parallelism: 2, passes: 2 });

describe("recovery code generation", () => {
  it("generates one bounded unique batch with canonical Argon2id PHCs", async () => {
    let byte = 0x10;
    let uuid = 0;
    const derive = vi.fn((parameters: Argon2Parameters) => {
      expect(parameters).toMatchObject({
        memory: 19_456,
        parallelism: 2,
        passes: 2,
        tagLength: 32,
      });
      expect(Buffer.from(parameters.secret as Uint8Array)).toEqual(Buffer.alloc(32, 0x77));
      expect(Buffer.from(parameters.associatedData as Uint8Array).toString("ascii")).toBe(
        "viberacing-recovery-code-v1",
      );
      return Promise.resolve(Buffer.alloc(32, (byte += 1)));
    });
    const generate = createRecoveryCodeGenerator(configuration, Buffer.alloc(32, 0x77), {
      argon2: derive,
      randomBytes: (size) => Buffer.alloc(size, (byte += 1)),
      randomUuid: () => `00000000-0000-4000-8000-${String((uuid += 1)).padStart(12, "0")}`,
    });

    const records = await generate();

    expect(records).toHaveLength(10);
    expect(new Set(records.map(({ codeId }) => codeId)).size).toBe(10);
    expect(new Set(records.map(({ plaintext }) => plaintext)).size).toBe(10);
    expect(new Set(records.map(({ verifierPhc }) => verifierPhc)).size).toBe(10);
    expect(records[0]?.codeId).toBe("00000000-0000-4000-8000-000000000001");
    expect(records[0]?.plaintext).toMatch(
      /^vrr1_00000000-0000-4000-8000-000000000001_[A-Za-z0-9_-]{43}$/,
    );
    expect(records[0]?.verifierPhc).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=2\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
    );
    expect(derive).toHaveBeenCalledTimes(10);
    expect(Object.isFrozen(records)).toBe(true);
    expect(records.every((record) => Object.isFrozen(record))).toBe(true);
  });

  it("uses the pinned Node Argon2id implementation on the production path", async () => {
    let uuid = 0;
    let randomCall = 0;
    const generate = createRecoveryCodeGenerator(configuration, Buffer.alloc(32, 0x44), {
      randomBytes: (size) => Buffer.alloc(size, (randomCall += 1)),
      randomUuid: () => `10000000-0000-4000-8000-${String((uuid += 1)).padStart(12, "0")}`,
    });

    const records = await generate();

    expect(records).toHaveLength(10);
    const first = records[0];
    expect(first).toBeDefined();
    const [, algorithm, version, parameters, salt, expectedTag] =
      first?.verifierPhc.split("$") ?? [];
    expect(algorithm).toBe("argon2id");
    expect(version).toBe("v=19");
    expect(parameters).toBe("m=19456,t=2,p=2");
    const secret = Buffer.from(first?.plaintext.split("_").at(-1) ?? "", "base64url");
    const pepper = Buffer.alloc(32, 0x44);
    const nonce = Buffer.from(salt ?? "", "base64");
    const associatedData = Buffer.from("viberacing-recovery-code-v1", "ascii");
    try {
      const derived = await new Promise<Buffer>((resolve, reject) => {
        argon2(
          "argon2id",
          {
            associatedData,
            memory: 19_456,
            message: secret,
            nonce,
            parallelism: 2,
            passes: 2,
            secret: pepper,
            tagLength: 32,
          },
          (error, value) => {
            if (error === null) {
              resolve(value);
            } else {
              reject(error);
            }
          },
        );
      });
      try {
        expect(derived.toString("base64").replace(/=+$/u, "")).toBe(expectedTag);
      } finally {
        derived.fill(0);
      }
    } finally {
      secret.fill(0);
      pepper.fill(0);
      nonce.fill(0);
    }
  });

  it("rejects invalid resource bounds, pepper, randomness, and derived output", async () => {
    expect(validRecoveryArgon2Configuration(19_456, 2, 2)).toBe(true);
    expect(validRecoveryArgon2Configuration(19_455, 2, 2)).toBe(false);
    expect(validRecoveryArgon2Configuration(65_536, 6, 2)).toBe(false);
    expect(validRecoveryArgon2Configuration(65_536, 2, 1)).toBe(false);
    expect(validRecoveryArgon2Configuration(19_460, 2, 4)).toBe(false);
    expect(() => createRecoveryCodeGenerator(configuration, Buffer.alloc(31))).toThrow(
      "Recovery codes are unavailable.",
    );

    const invalidRandomness = createRecoveryCodeGenerator(configuration, Buffer.alloc(32), {
      argon2: () => Promise.resolve(Buffer.alloc(32)),
      randomBytes: (size) => Buffer.alloc(size - 1),
      randomUuid: () => "not-a-uuid",
    });
    await expect(invalidRandomness()).rejects.toThrow("Recovery codes are unavailable.");

    const invalidDerived = createRecoveryCodeGenerator(configuration, Buffer.alloc(32), {
      argon2: () => Promise.resolve(Buffer.alloc(31)),
      randomBytes: (size) => Buffer.alloc(size, 1),
      randomUuid: () => "00000000-0000-4000-8000-000000000001",
    });
    await expect(invalidDerived()).rejects.toThrow("Recovery codes are unavailable.");
  });
});

describe("recovery code verification", () => {
  it("parses one exact code and clears its decoded secret", () => {
    const secret = Buffer.alloc(32, 0x51);
    const plaintext = `vrr1_00000000-0000-4000-8000-000000000901_${secret.toString("base64url")}`;
    const parsed = readRecoveryCode(plaintext);

    expect(parsed).toMatchObject({ codeId: "00000000-0000-4000-8000-000000000901" });
    expect(parsed?.secret).toEqual(secret);
    clearRecoveryCode(parsed);
    expect(parsed?.secret).toEqual(Buffer.alloc(32));
    expect(readRecoveryCode(` ${plaintext}`)).toBeUndefined();
    expect(readRecoveryCode(plaintext.replace("vrr1", "vrr2"))).toBeUndefined();
    expect(readRecoveryCode(plaintext.slice(0, -1))).toBeUndefined();
  });

  it("accepts only the matching canonical bounded PHC", async () => {
    const secret = Buffer.alloc(32, 0x52);
    const salt = Buffer.alloc(16, 0x53);
    const expectedTag = Buffer.alloc(32, 0x54);
    const observedMessages: Buffer[] = [];
    const derive = vi.fn((parameters: Argon2Parameters) => {
      const message = Buffer.from(parameters.message as Uint8Array);
      observedMessages.push(message);
      expect(Buffer.from(parameters.nonce as Uint8Array)).toEqual(salt);
      expect(Buffer.from(parameters.secret as Uint8Array)).toEqual(Buffer.alloc(32, 0x55));
      return Promise.resolve(
        message.equals(secret) ? Buffer.from(expectedTag) : Buffer.alloc(32, 0x59),
      );
    });
    const verify = createRecoveryCodeVerifier(configuration, Buffer.alloc(32, 0x55), {
      argon2: derive,
    });
    const phc =
      `$argon2id$v=19$m=19456,t=2,p=2$${salt.toString("base64").replace(/=+$/u, "")}` +
      `$${expectedTag.toString("base64").replace(/=+$/u, "")}`;

    await expect(verify(secret, phc)).resolves.toBe(true);
    await expect(verify(Buffer.alloc(32, 0x56), phc)).resolves.toBe(false);
    expect(derive).toHaveBeenCalledTimes(2);
    expect(observedMessages[0]).toEqual(secret);
  });

  it("performs one bounded dummy derivation for unknown or malformed material", async () => {
    const derive = vi.fn((parameters: Argon2Parameters) => {
      expect(parameters).toMatchObject({ memory: 19_456, parallelism: 2, passes: 2 });
      expect(Buffer.from(parameters.nonce as Uint8Array)).toEqual(
        Buffer.from("viberacing-dummy", "ascii"),
      );
      return Promise.resolve(Buffer.alloc(32, 0x61));
    });
    const verify = createRecoveryCodeVerifier(configuration, Buffer.alloc(32, 0x62), {
      argon2: derive,
    });

    await expect(verify(Buffer.alloc(32, 0x63), undefined)).resolves.toBe(false);
    await expect(verify(undefined, "$argon2id$invalid")).resolves.toBe(false);
    expect(derive).toHaveBeenCalledTimes(2);
  });
});
