import * as Crypto from "expo-crypto";
import { scryptAsync } from "@noble/hashes/scrypt";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export const PIN_LENGTH = 6;
export const PIN_VERIFIER_VERSION = 1 as const;

export const PIN_SCRYPT_PARAMS = Object.freeze({
  N: 2 ** 15,
  r: 8,
  p: 1,
  dkLen: 32,
});

const PIN_SALT_BYTES = 16;
const PIN_SCRYPT_MAX_MEMORY_BYTES = 64 * 1024 * 1024;

export type PinScryptParams = typeof PIN_SCRYPT_PARAMS;

export type PinVerifierRecord = {
  version: typeof PIN_VERIFIER_VERSION;
  algorithm: "scrypt";
  saltHex: string;
  verifierHex: string;
  params: PinScryptParams;
};

type DerivePinKey = (
  pinBytes: Uint8Array,
  salt: Uint8Array,
  params: PinScryptParams,
) => Promise<Uint8Array>;

export type PinSecurityDependencies = {
  getRandomBytes: (byteCount: number) => Promise<Uint8Array>;
  deriveKey: DerivePinKey;
};

const derivePinKey: DerivePinKey = (pinBytes, salt, params) =>
  scryptAsync(pinBytes, salt, {
    ...params,
    asyncTick: 8,
    maxmem: PIN_SCRYPT_MAX_MEMORY_BYTES,
  });

const defaultDependencies: PinSecurityDependencies = {
  getRandomBytes: Crypto.getRandomBytesAsync,
  deriveKey: derivePinKey,
};

function dependenciesWithDefaults(
  dependencies?: Partial<PinSecurityDependencies>,
): PinSecurityDependencies {
  return {
    getRandomBytes: dependencies?.getRandomBytes ?? defaultDependencies.getRandomBytes,
    deriveKey: dependencies?.deriveKey ?? defaultDependencies.deriveKey,
  };
}

function isExactHex(value: unknown, byteLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length === byteLength * 2 &&
    /^[0-9a-f]+$/.test(value)
  );
}

function hasExpectedScryptParams(value: unknown): value is PinScryptParams {
  if (!value || typeof value !== "object") return false;
  const params = value as Record<string, unknown>;
  return (
    params.N === PIN_SCRYPT_PARAMS.N &&
    params.r === PIN_SCRYPT_PARAMS.r &&
    params.p === PIN_SCRYPT_PARAMS.p &&
    params.dkLen === PIN_SCRYPT_PARAMS.dkLen
  );
}

export function isValidPin(pin: string): boolean {
  return pin.length === PIN_LENGTH && /^[0-9]+$/.test(pin);
}

export function isPinVerifierRecord(value: unknown): value is PinVerifierRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === PIN_VERIFIER_VERSION &&
    record.algorithm === "scrypt" &&
    isExactHex(record.saltHex, PIN_SALT_BYTES) &&
    isExactHex(record.verifierHex, PIN_SCRYPT_PARAMS.dkLen) &&
    hasExpectedScryptParams(record.params)
  );
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function createPinVerifier(
  pin: string,
  dependencies?: Partial<PinSecurityDependencies>,
): Promise<PinVerifierRecord> {
  if (!isValidPin(pin)) {
    throw new Error("O PIN deve conter exatamente 6 dígitos.");
  }

  const { getRandomBytes, deriveKey } = dependenciesWithDefaults(dependencies);
  const salt = await getRandomBytes(PIN_SALT_BYTES);
  if (!(salt instanceof Uint8Array) || salt.length !== PIN_SALT_BYTES) {
    throw new Error("Não foi possível gerar um salt seguro para o PIN.");
  }

  const pinBytes = utf8ToBytes(pin);
  let verifier: Uint8Array | null = null;
  try {
    verifier = await deriveKey(pinBytes, salt, PIN_SCRYPT_PARAMS);
    if (!(verifier instanceof Uint8Array) || verifier.length !== PIN_SCRYPT_PARAMS.dkLen) {
      throw new Error("Não foi possível criar o verificador do PIN.");
    }

    return {
      version: PIN_VERIFIER_VERSION,
      algorithm: "scrypt",
      saltHex: bytesToHex(salt),
      verifierHex: bytesToHex(verifier),
      params: { ...PIN_SCRYPT_PARAMS },
    };
  } finally {
    pinBytes.fill(0);
    salt.fill(0);
    verifier?.fill(0);
  }
}

export async function verifyPin(
  pin: string,
  record: unknown,
  dependencies?: Partial<PinSecurityDependencies>,
): Promise<boolean> {
  if (!isValidPin(pin) || !isPinVerifierRecord(record)) return false;

  const { deriveKey } = dependenciesWithDefaults(dependencies);
  const pinBytes = utf8ToBytes(pin);
  const salt = hexToBytes(record.saltHex);
  const expectedVerifier = hexToBytes(record.verifierHex);
  let candidate: Uint8Array | null = null;

  try {
    candidate = await deriveKey(pinBytes, salt, record.params);
    if (!(candidate instanceof Uint8Array)) return false;
    return constantTimeEqual(candidate, expectedVerifier);
  } finally {
    pinBytes.fill(0);
    salt.fill(0);
    expectedVerifier.fill(0);
    candidate?.fill(0);
  }
}
