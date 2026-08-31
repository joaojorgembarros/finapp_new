import type { Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

export const GOOGLE_OAUTH_CALLBACK_PATH = "/auth/callback";

export class GoogleAuthCancelledError extends Error {
  readonly name = "GoogleAuthCancelledError";

  constructor() {
    super("Google sign-in was cancelled.");
  }
}

export class GoogleAuthPendingConfigurationError extends Error {
  readonly name = "GoogleAuthPendingConfigurationError";

  constructor() {
    super("Google sign-in is pending configuration.");
  }
}

export type GoogleOAuthCallback =
  | { kind: "unrelated" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string }
  | { kind: "code"; code: string };

export type GoogleOAuthDedupeState = {
  lastCode?: string | null;
  lastAt?: number | null;
  inFlightCode?: string | null;
};

export type GoogleAuthClient = {
  signInWithOAuth: (params: {
    provider: "google";
    options: {
      redirectTo: string;
      skipBrowserRedirect: true;
    };
  }) => Promise<{
    data: { url: string | null };
    error: { message?: string; code?: string } | null;
  }>;
  exchangeCodeForSession: (code: string) => Promise<{
    data: { session: Session | null };
    error: { message?: string; code?: string } | null;
  }>;
  getSession: () => Promise<{
    data: { session: Session | null };
  }>;
};

export type GoogleAuthBrowserResult =
  | { type: "cancel" | "dismiss" | "opened" | "locked" }
  | { type: "success"; url: string };

export type GoogleAuthDependencies = {
  platform: typeof Platform.OS;
  createRedirectUrl: () => string;
  fetchGoogleProviderEnabled: () => Promise<boolean | null>;
  auth: GoogleAuthClient;
  maybeCompleteAuthSession: () => void;
  warmUpAsync: () => Promise<unknown>;
  coolDownAsync: () => Promise<unknown>;
  openAuthSessionAsync: (
    url: string,
    redirectUrl: string,
  ) => Promise<GoogleAuthBrowserResult>;
};

export const googleOAuthDedupe: GoogleOAuthDedupeState = {};

export function googleOAuthRedirectUrl(
  createURL: typeof Linking.createURL = Linking.createURL,
) {
  return createURL(GOOGLE_OAUTH_CALLBACK_PATH);
}

export function isGoogleAuthCancelled(error: unknown) {
  return error instanceof GoogleAuthCancelledError
    || (typeof error === "object" && error !== null && "name" in error && error.name === "GoogleAuthCancelledError");
}

export function isGoogleAuthPendingConfiguration(error: unknown) {
  if (error instanceof GoogleAuthPendingConfigurationError) return true;
  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  return code === "validation_failed" && /provider/.test(message)
    || /unsupported provider/.test(message)
    || /provider is not enabled/.test(message)
    || /provider not enabled/.test(message);
}

export function getGoogleAuthErrorMessage(
  error: unknown,
  isDev = typeof __DEV__ !== "undefined" && __DEV__,
) {
  if (isGoogleAuthCancelled(error)) return null;
  if (isGoogleAuthPendingConfiguration(error)) {
    return isDev
      ? "O login com Google ainda está em configuração neste ambiente. Use e-mail e senha por enquanto."
      : "O login com Google ainda não está disponível. Use e-mail e senha por enquanto.";
  }

  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  if (code.includes("rate_limit") || message.includes("rate limit") || message.includes("too many")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return "Não foi possível conectar agora. Confira sua internet e tente novamente.";
  }

  return "Não foi possível entrar com Google agora. Tente novamente em instantes.";
}

export function parseGoogleOAuthCallbackUrl(raw: string | null | undefined): GoogleOAuthCallback {
  if (!raw || !isGoogleOAuthCallbackUrl(raw)) return { kind: "unrelated" };

  const params = readUrlParams(raw);
  const error = params.get("error") ?? params.get("error_code");
  const description = params.get("error_description") ?? params.get("error_message") ?? error ?? "";
  if (error) {
    if (/access_denied|cancelled|canceled|user_cancelled/i.test(`${error} ${description}`)) {
      return { kind: "cancelled" };
    }
    return { kind: "error", message: description || error };
  }

  const code = params.get("code");
  if (code) return { kind: "code", code };
  return { kind: "error", message: "missing_code" };
}

export async function completeGoogleOAuthCallback(
  rawUrl: string | null | undefined,
  auth: Pick<GoogleAuthClient, "exchangeCodeForSession">,
  dedupe: GoogleOAuthDedupeState = googleOAuthDedupe,
  opts?: { now?: () => number },
) {
  const parsed = parseGoogleOAuthCallbackUrl(rawUrl);
  if (parsed.kind === "unrelated") return { processed: false as const };
  if (parsed.kind === "cancelled") {
    throw new GoogleAuthCancelledError();
  }
  if (parsed.kind === "error") {
    throw Object.assign(new Error(parsed.message), { code: parsed.message });
  }

  const now = opts?.now?.() ?? Date.now();
  if (dedupe.inFlightCode === parsed.code) return { processed: false as const, reason: "inflight" as const };
  if (dedupe.lastCode === parsed.code && dedupe.lastAt && now - dedupe.lastAt < 10_000) {
    return { processed: false as const, reason: "duplicate" as const };
  }

  dedupe.inFlightCode = parsed.code;
  try {
    const { data, error } = await auth.exchangeCodeForSession(parsed.code);
    if (error) throw error;
    if (!data.session?.user?.id) throw new Error("missing_session");
    dedupe.lastCode = parsed.code;
    dedupe.lastAt = now;
    return { processed: true as const, session: data.session };
  } finally {
    dedupe.inFlightCode = null;
  }
}

export async function signInWithGoogle(
  dependencies?: Partial<GoogleAuthDependencies>,
  dedupe: GoogleOAuthDedupeState = googleOAuthDedupe,
) {
  const deps = await resolveDependencies(dependencies);
  deps.maybeCompleteAuthSession();

  const enabled = await deps.fetchGoogleProviderEnabled();
  if (enabled === false) throw new GoogleAuthPendingConfigurationError();

  if (deps.platform === "android") await deps.warmUpAsync();

  try {
    const redirectTo = deps.createRedirectUrl();
    const { data, error } = await deps.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    if (!data.url) throw new Error("missing_oauth_url");

    const result = await deps.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== "success") throw new GoogleAuthCancelledError();

    const completed = await completeGoogleOAuthCallback(result.url, deps.auth, dedupe);
    if (completed.processed && "session" in completed && completed.session) {
      return completed.session;
    }

    const existing = await deps.auth.getSession();
    if (existing.data.session?.user?.id) return existing.data.session;
    throw new Error("missing_session");
  } finally {
    if (deps.platform === "android") {
      try {
        await deps.coolDownAsync();
      } catch {
        // Browser warmup is best-effort on Android.
      }
    }
  }
}

function isGoogleOAuthCallbackUrl(raw: string) {
  return /auth\/callback/i.test(raw);
}

function readUrlParams(raw: string) {
  const params = new URLSearchParams();
  try {
    const url = new URL(raw);
    mergeParams(params, url.search);
    mergeParams(params, url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    return params;
  } catch {
    const [, afterScheme = ""] = raw.split("://");
    const query = afterScheme.split("?")[1] ?? "";
    const [queryPart, hashPart = ""] = query.split("#");
    mergeParams(params, queryPart);
    mergeParams(params, hashPart);
    return params;
  }
}

function mergeParams(target: URLSearchParams, raw: string) {
  if (!raw) return;
  const parsed = new URLSearchParams(raw);
  for (const [key, value] of parsed.entries()) {
    if (!target.has(key)) target.set(key, value);
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "";
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) return String(error.code).toLowerCase();
  return "";
}

async function resolveDependencies(
  dependencies?: Partial<GoogleAuthDependencies>,
): Promise<GoogleAuthDependencies> {
  return {
    platform: Platform.OS,
    createRedirectUrl: googleOAuthRedirectUrl,
    fetchGoogleProviderEnabled,
    auth: dependencies?.auth ?? await loadDefaultAuthClient(),
    maybeCompleteAuthSession: () => {
      WebBrowser.maybeCompleteAuthSession();
    },
    warmUpAsync: () => WebBrowser.warmUpAsync(),
    coolDownAsync: () => WebBrowser.coolDownAsync(),
    openAuthSessionAsync: (url, redirectUrl) =>
      WebBrowser.openAuthSessionAsync(url, redirectUrl) as Promise<GoogleAuthBrowserResult>,
    ...dependencies,
  };
}

async function loadDefaultAuthClient(): Promise<GoogleAuthClient> {
  const { supabase } = await import("./supabase");
  return supabase.auth as GoogleAuthClient;
}

async function fetchGoogleProviderEnabled(): Promise<boolean | null> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const apiKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !apiKey) return null;

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { external?: { google?: unknown } };
    return typeof payload.external?.google === "boolean" ? payload.external.google : null;
  } catch {
    return null;
  }
}
