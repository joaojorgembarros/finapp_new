export const SUPABASE_API_KEYS_ERROR = "supabase_api_keys_unavailable";

const PUBLISHABLE_KEYS_ENV = "SUPABASE_PUBLISHABLE_KEYS";
const SECRET_KEYS_ENV = "SUPABASE_SECRET_KEYS";
const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";
const SECRET_KEY_PREFIX = "sb_secret_";

export type SupabaseEnvironment = {
  get: (name: string) => string | undefined;
};

export type SupabaseApiKeyNames = {
  publishable: string;
  secret: string;
};

export type ResolvedSupabaseApiKeys = {
  publishableKey: string;
  secretKey: string;
};

type SupabaseApiKeyKind = "publishable" | "secret";

function fail(): never {
  throw new Error(SUPABASE_API_KEYS_ERROR);
}

function readEnvironmentValue(
  environment: SupabaseEnvironment,
  name: string,
): string {
  let value: string | undefined;

  try {
    value = environment.get(name);
  } catch {
    return fail();
  }

  if (typeof value !== "string" || !value.trim()) return fail();
  return value;
}

function parseKeyMap(value: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return fail();
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return fail();
  }

  return parsed as Record<string, unknown>;
}

function resolveNamedKey(
  keyMap: Record<string, unknown>,
  keyName: string,
  expectedPrefix: string,
): string {
  if (!keyName || keyName.trim() !== keyName) return fail();

  const key = Object.hasOwn(keyMap, keyName) ? keyMap[keyName] : undefined;

  if (
    typeof key !== "string"
    || key.trim() !== key
    || !key.startsWith(expectedPrefix)
    || key.length === expectedPrefix.length
  ) {
    return fail();
  }

  return key;
}

function resolveSupabaseApiKey(
  environment: SupabaseEnvironment,
  kind: SupabaseApiKeyKind,
  keyName: string,
): string {
  const isPublishable = kind === "publishable";
  const environmentName = isPublishable ? PUBLISHABLE_KEYS_ENV : SECRET_KEYS_ENV;
  const expectedPrefix = isPublishable ? PUBLISHABLE_KEY_PREFIX : SECRET_KEY_PREFIX;

  return resolveNamedKey(
    parseKeyMap(readEnvironmentValue(environment, environmentName)),
    keyName,
    expectedPrefix,
  );
}

export function resolveSupabasePublishableKey(
  environment: SupabaseEnvironment,
  keyName: string,
): string {
  return resolveSupabaseApiKey(environment, "publishable", keyName);
}

export function resolveSupabaseSecretKey(
  environment: SupabaseEnvironment,
  keyName: string,
): string {
  return resolveSupabaseApiKey(environment, "secret", keyName);
}

export function resolveSupabaseApiKeys(
  environment: SupabaseEnvironment,
  keyNames: SupabaseApiKeyNames,
): ResolvedSupabaseApiKeys {
  return {
    publishableKey: resolveSupabasePublishableKey(environment, keyNames.publishable),
    secretKey: resolveSupabaseSecretKey(environment, keyNames.secret),
  };
}
