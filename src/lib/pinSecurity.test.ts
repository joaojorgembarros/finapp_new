import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIN_SCRYPT_PARAMS,
  constantTimeEqual,
  createPinVerifier,
  isPinVerifierRecord,
  isValidPin,
  verifyPin,
  type PinSecurityDependencies,
} from "./pinSecurity";

vi.mock("expo-crypto", () => ({
  getRandomBytesAsync: vi.fn(),
}));

const saltOne = Uint8Array.from({ length: 16 }, (_, index) => index + 1);

const lightweightDerive: PinSecurityDependencies["deriveKey"] = async (
  pinBytes,
  salt,
  params,
) => Uint8Array.from(
  { length: params.dkLen },
  (_, index) => pinBytes[index % pinBytes.length] ^ salt[index % salt.length] ^ index,
);

describe("PIN format", () => {
  it("accepts exactly six ASCII digits", () => {
    expect(isValidPin("012345")).toBe(true);
    expect(isValidPin("987654")).toBe(true);
  });

  it.each([
    "12345",
    "1234567",
    "12 456",
    "12345a",
    "１２３４５６",
    "١٢٣٤٥٦",
    "12345\n",
    "123456\n",
    "",
  ])("rejects invalid PIN %j", (pin) => {
    expect(isValidPin(pin)).toBe(false);
  });
});

describe("PIN verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a versioned record without storing the PIN", async () => {
    const record = await createPinVerifier("482731", {
      getRandomBytes: async () => saltOne.slice(),
      deriveKey: lightweightDerive,
    });

    expect(record).toMatchObject({
      version: 1,
      algorithm: "scrypt",
      params: PIN_SCRYPT_PARAMS,
    });
    expect(record.saltHex).toHaveLength(32);
    expect(record.verifierHex).toHaveLength(64);
    expect(JSON.stringify(record)).not.toContain("482731");
    expect(isPinVerifierRecord(record)).toBe(true);
  });

  it("uses a different salt and verifier for the same PIN", async () => {
    const first = await createPinVerifier("482731", {
      getRandomBytes: async () => Uint8Array.from({ length: 16 }, () => 1),
      deriveKey: lightweightDerive,
    });
    const second = await createPinVerifier("482731", {
      getRandomBytes: async () => Uint8Array.from({ length: 16 }, () => 2),
      deriveKey: lightweightDerive,
    });

    expect(first.saltHex).not.toBe(second.saltHex);
    expect(first.verifierHex).not.toBe(second.verifierHex);
  });

  it("verifies the correct PIN and rejects a different PIN", async () => {
    const record = await createPinVerifier("482731", {
      getRandomBytes: async () => saltOne.slice(),
      deriveKey: lightweightDerive,
    });

    expect(await verifyPin("482731", record, { deriveKey: lightweightDerive })).toBe(true);
    expect(await verifyPin("482730", record, { deriveKey: lightweightDerive })).toBe(false);
  });

  it("round-trips through the real scrypt implementation", async () => {
    const record = await createPinVerifier("905214", {
      getRandomBytes: async () => saltOne.slice(),
    });

    expect(await verifyPin("905214", record)).toBe(true);
    expect(await verifyPin("905215", record)).toBe(false);
  }, 15_000);

  it("rejects malformed records without deriving a key", async () => {
    const deriveKey = vi.fn(lightweightDerive);
    const malformedRecords = [
      null,
      {},
      { version: 2 },
      {
        version: 1,
        algorithm: "scrypt",
        saltHex: "00",
        verifierHex: "00".repeat(32),
        params: PIN_SCRYPT_PARAMS,
      },
      {
        version: 1,
        algorithm: "scrypt",
        saltHex: "00".repeat(16),
        verifierHex: "00".repeat(32),
        params: { ...PIN_SCRYPT_PARAMS, N: 2 ** 20 },
      },
    ];

    for (const record of malformedRecords) {
      expect(await verifyPin("482731", record, { deriveKey })).toBe(false);
    }
    expect(deriveKey).not.toHaveBeenCalled();
  });

  it("rejects invalid PINs before requesting randomness", async () => {
    const getRandomBytes = vi.fn(async () => saltOne.slice());
    await expect(createPinVerifier("12345", { getRandomBytes })).rejects.toThrow("6 dígitos");
    expect(getRandomBytes).not.toHaveBeenCalled();
  });

  it("fails safely when randomness or derivation has an unexpected size", async () => {
    await expect(createPinVerifier("123456", {
      getRandomBytes: async () => new Uint8Array(8),
      deriveKey: lightweightDerive,
    })).rejects.toThrow("salt seguro");

    await expect(createPinVerifier("123456", {
      getRandomBytes: async () => saltOne.slice(),
      deriveKey: async () => new Uint8Array(8),
    })).rejects.toThrow("verificador");
  });

  it("clears temporary PIN and salt buffers after derivation", async () => {
    let capturedPin: Uint8Array | null = null;
    let capturedSalt: Uint8Array | null = null;
    await createPinVerifier("482731", {
      getRandomBytes: async () => saltOne.slice(),
      deriveKey: async (pinBytes, salt, params) => {
        capturedPin = pinBytes;
        capturedSalt = salt;
        return new Uint8Array(params.dkLen);
      },
    });

    expect(Array.from(capturedPin ?? [])).toEqual(new Array(6).fill(0));
    expect(Array.from(capturedSalt ?? [])).toEqual(new Array(16).fill(0));
  });
});

describe("constantTimeEqual", () => {
  it("compares equal and different byte arrays", () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(9, 2, 3), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2, 9), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
  });
});
