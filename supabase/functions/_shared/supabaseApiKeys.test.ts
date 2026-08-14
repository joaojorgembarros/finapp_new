import { describe, expect, it, vi } from "vitest";
import {
  resolveSupabaseApiKeys,
  resolveSupabasePublishableKey,
  resolveSupabaseSecretKey,
  SUPABASE_API_KEYS_ERROR,
  type SupabaseEnvironment,
} from "./supabaseApiKeys";

const KEY_NAMES = {
  publishable: "delete-account",
  secret: "delete-account",
};
const PUBLISHABLE_KEY = "sb_publishable_delete_account_test";
const SECRET_KEY = "sb_secret_delete_account_test";

function createEnvironment(
  values: Record<string, string | undefined>,
): SupabaseEnvironment {
  return { get: vi.fn((name: string) => values[name]) };
}

function validEnvironment(
  overrides: Record<string, string | undefined> = {},
): SupabaseEnvironment {
  return createEnvironment({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
      default: "sb_publishable_default_test",
      "delete-account": PUBLISHABLE_KEY,
    }),
    SUPABASE_SECRET_KEYS: JSON.stringify({
      default: "sb_secret_default_test",
      "delete-account": SECRET_KEY,
    }),
    ...overrides,
  });
}

function getError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
  }

  throw new Error("expected resolver to throw");
}

describe("Supabase API key resolver", () => {
  it("resolves a named publishable key without requiring the secret map", () => {
    const environment = createEnvironment({
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
        default: "sb_publishable_default_test",
        "delete-account": PUBLISHABLE_KEY,
      }),
    });

    expect(resolveSupabasePublishableKey(environment, "delete-account"))
      .toBe(PUBLISHABLE_KEY);
  });

  it("resolves a named secret key without requiring the publishable map", () => {
    const environment = createEnvironment({
      SUPABASE_SECRET_KEYS: JSON.stringify({
        default: "sb_secret_default_test",
        "open-finance": "sb_secret_open_finance_test",
      }),
    });

    expect(resolveSupabaseSecretKey(environment, "open-finance"))
      .toBe("sb_secret_open_finance_test");
  });

  it("resolves only the explicitly named modern keys", () => {
    expect(resolveSupabaseApiKeys(validEnvironment(), KEY_NAMES)).toEqual({
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
    });
  });

  it.each([
    ["missing publishable map", { SUPABASE_PUBLISHABLE_KEYS: undefined }],
    ["missing secret map", { SUPABASE_SECRET_KEYS: undefined }],
    ["invalid publishable JSON", { SUPABASE_PUBLISHABLE_KEYS: "not-json" }],
    ["invalid secret JSON", { SUPABASE_SECRET_KEYS: "not-json" }],
    ["array publishable map", { SUPABASE_PUBLISHABLE_KEYS: "[]" }],
    ["null secret map", { SUPABASE_SECRET_KEYS: "null" }],
  ])("fails closed for a %s", (_description, overrides) => {
    expect(() => resolveSupabaseApiKeys(validEnvironment(overrides), KEY_NAMES))
      .toThrow(SUPABASE_API_KEYS_ERROR);
  });

  it.each([
    ["missing named publishable key", { default: "sb_publishable_default_test" }],
    ["non-string publishable key", { "delete-account": 7 }],
    ["blank publishable key", { "delete-account": " " }],
    ["legacy-shaped publishable key", { "delete-account": "legacy.jwt.value" }],
    ["secret key in publishable map", { "delete-account": SECRET_KEY }],
  ])("rejects a %s", (_description, publishableMap) => {
    const environment = validEnvironment({
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify(publishableMap),
    });

    expect(() => resolveSupabaseApiKeys(environment, KEY_NAMES))
      .toThrow(SUPABASE_API_KEYS_ERROR);
  });

  it.each([
    ["missing named secret key", { default: "sb_secret_default_test" }],
    ["non-string secret key", { "delete-account": 7 }],
    ["blank secret key", { "delete-account": " " }],
    ["legacy-shaped secret key", { "delete-account": "legacy.jwt.value" }],
    ["publishable key in secret map", { "delete-account": PUBLISHABLE_KEY }],
  ])("rejects a %s", (_description, secretMap) => {
    const environment = validEnvironment({
      SUPABASE_SECRET_KEYS: JSON.stringify(secretMap),
    });

    expect(() => resolveSupabaseApiKeys(environment, KEY_NAMES))
      .toThrow(SUPABASE_API_KEYS_ERROR);
  });

  it("replaces environment and parser failures with a value-free error", () => {
    const sensitiveMarker = "must-not-appear-in-errors";
    const parserError = getError(() => resolveSupabaseApiKeys(
      validEnvironment({
        SUPABASE_SECRET_KEYS: `{${sensitiveMarker}`,
      }),
      KEY_NAMES,
    ));
    const environmentError = getError(() => resolveSupabaseApiKeys({
      get: () => {
        throw new Error(sensitiveMarker);
      },
    }, KEY_NAMES));

    for (const error of [parserError, environmentError]) {
      expect(error.message).toBe(SUPABASE_API_KEYS_ERROR);
      expect(error.message).not.toContain(sensitiveMarker);
      expect(error.stack).not.toContain(sensitiveMarker);
    }
  });
});
