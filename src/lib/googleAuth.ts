import type { Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

export const GOOGLE_OAUTH_CALLBACK_PATH = "auth/callback";

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

export class GoogleAuthAlreadyHandledError extends Error {
  readonly name = "GoogleAuthAlreadyHandledError";

  constructor() {
    super("Google sign-in result was already handled.");
  }
}

export class GoogleAuthFailedError extends Error {
  readonly name = "GoogleAuthFailedError";
}

export type GoogleOAuthCallback =
  | { kind: "unrelated" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string }
  | { kind: "code"; code: string };

export type GoogleOAuthClaimKind = "success" | "error" | "cancelled";

export type GoogleOAuthDedupeState = {
  lastCode?: string | null;
  inFlightCode?: string | null;
  attemptActive?: boolean;
  pendingErrorMessage?: string | null;
  claimedKeys?: Record<string, GoogleOAuthClaimKind>;
  inFlightReports?: Record<string, Promise<unknown>>;
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

export function getGoogleOAuthCallbackKey(rawUrl: string | null | undefined) {
  const parsed = parseGoogleOAuthCallbackUrl(rawUrl);
  if (parsed.kind === "unrelated") return null;
  if (parsed.kind === "code") return `code:${parsed.code}`;
  if (parsed.kind === "cancelled") return "cancelled";
  return `error:${parsed.message}`;
}

export function getGoogleAuthPendingError(dedupe: GoogleOAuthDedupeState = googleOAuthDedupe) {
  return dedupe.pendingErrorMessage ?? null;
}

export function beginGoogleAuthAttempt(dedupe: GoogleOAuthDedupeState = googleOAuthDedupe) {
  if (dedupe.attemptActive) return;
  dedupe.attemptActive = true;
  dedupe.pendingErrorMessage = null;
  const claimed = dedupe.claimedKeys;
  if (!claimed) return;
  for (const key of Object.keys(claimed)) {
    if (!key.startsWith("code:")) delete claimed[key];
  }
}

export function endGoogleAuthAttempt(dedupe: GoogleOAuthDedupeState = googleOAuthDedupe) {
  dedupe.attemptActive = false;
}

export function isGoogleAuthCancelled(error: unknown) {
  return error instanceof GoogleAuthCancelledError
    || (typeof error === "object" && error !== null && "name" in error && error.name === "GoogleAuthCancelledError");
}

export function isGoogleAuthAlreadyHandled(error: unknown) {
  return error instanceof GoogleAuthAlreadyHandledError
    || (typeof error === "object" && error !== null && "name" in error && error.name === "GoogleAuthAlreadyHandledError");
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
  if (isGoogleAuthCancelled(error) || isGoogleAuthAlreadyHandled(error)) return null;
  if (error instanceof GoogleAuthFailedError) return error.message;
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
    return "Sem conexão. Verifique sua internet e tente novamente.";
  }
  if (code === "missing_code" || message === "missing_code") {
    return "Não foi possível concluir o login com Google. Tente novamente.";
  }
  if (code === "missing_session" || message === "missing_session") {
    return "Não foi possível entrar com o Google. Tente novamente.";
  }

  return "Não foi possível entrar com o Google. Tente novamente.";
}

export function getGoogleAuthFailureAlert(errorMessage: string | null | undefined) {
  if (!errorMessage) return null;
  return {
    title: "Não foi possível entrar com o Google",
    message: errorMessage,
  };
}

export type GoogleOAuthCallbackReport =
  | { kind: "unrelated"; processed: false; errorMessage: null }
  | { kind: "ignored"; processed: false; errorMessage: null }
  | { kind: "cancelled"; processed: false; errorMessage: null }
  | { kind: "error"; processed: false; errorMessage: string }
  | { kind: "success"; processed: true; session: Session; errorMessage: null };

function rememberGoogleAuthClaim(
  dedupe: GoogleOAuthDedupeState,
  key: string,
  report: GoogleOAuthCallbackReport,
) {
  if (report.kind !== "success" && report.kind !== "error" && report.kind !== "cancelled") return;
  dedupe.claimedKeys ??= {};
  dedupe.claimedKeys[key] = report.kind;
  if (report.kind === "success") {
    dedupe.pendingErrorMessage = null;
    return;
  }
  if (report.kind === "cancelled") return;
  dedupe.pendingErrorMessage = report.errorMessage;
}

async function resolveGoogleOAuthCallback(
  rawUrl: string | null | undefined,
  auth: Pick<GoogleAuthClient, "exchangeCodeForSession">,
  dedupe: GoogleOAuthDedupeState,
): Promise<GoogleOAuthCallbackReport> {
  try {
    const result = await completeGoogleOAuthCallback(rawUrl, auth, dedupe);
    if (result.processed && "session" in result && result.session) {
      return {
        kind: "success",
        processed: true,
        session: result.session,
        errorMessage: null,
      };
    }
    return { kind: "ignored", processed: false, errorMessage: null };
  } catch (error) {
    if (isGoogleAuthCancelled(error)) {
      return { kind: "cancelled", processed: false, errorMessage: null };
    }
    return {
      kind: "error",
      processed: false,
      errorMessage: getGoogleAuthErrorMessage(error)
        ?? "Não foi possível entrar com o Google. Tente novamente.",
    };
  }
}

export async function reportGoogleOAuthCallback(
  rawUrl: string | null | undefined,
  auth: Pick<GoogleAuthClient, "exchangeCodeForSession">,
  dedupe: GoogleOAuthDedupeState = googleOAuthDedupe,
): Promise<GoogleOAuthCallbackReport> {
  const key = getGoogleOAuthCallbackKey(rawUrl);
  if (!key) {
    return { kind: "unrelated", processed: false, errorMessage: null };
  }

  dedupe.claimedKeys ??= {};
  dedupe.inFlightReports ??= {};
  if (dedupe.claimedKeys[key]) {
    return { kind: "ignored", processed: false, errorMessage: null };
  }

  const pending = dedupe.inFlightReports[key];
  if (pending) {
    await pending;
    return { kind: "ignored", processed: false, errorMessage: null };
  }

  const run = resolveGoogleOAuthCallback(rawUrl, auth, dedupe);
  dedupe.inFlightReports[key] = run;
  try {
    const report = await run;
    rememberGoogleAuthClaim(dedupe, key, report);
    return report;
  } finally {
    if (dedupe.inFlightReports[key] === run) delete dedupe.inFlightReports[key];
  }
}

export function getGoogleCallbackRedirect(input: {
  session: Session | null | undefined;
  loading: boolean;
  callbackReady: boolean;
  authenticatedHref: string;
}) {
  if (input.session) {
    return { pending: false as const, href: input.authenticatedHref };
  }
  if (input.loading || !input.callbackReady) {
    return { pending: true as const, href: null };
  }
  return { pending: false as const, href: "/(auth)/login" };
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
) {
  const parsed = parseGoogleOAuthCallbackUrl(rawUrl);
  if (parsed.kind === "unrelated") return { processed: false as const };
  if (parsed.kind === "cancelled") {
    throw new GoogleAuthCancelledError();
  }
  if (parsed.kind === "error") {
    throw Object.assign(new Error(parsed.message), { code: parsed.message });
  }

  if (dedupe.inFlightCode === parsed.code) return { processed: false as const, reason: "inflight" as const };
  if (dedupe.lastCode === parsed.code) {
    return { processed: false as const, reason: "duplicate" as const };
  }

  dedupe.inFlightCode = parsed.code;
  try {
    const { data, error } = await auth.exchangeCodeForSession(parsed.code);
    if (error || !data.session?.user?.id) {
      dedupe.lastCode = parsed.code;
      if (error) throw error;
      throw new Error("missing_session");
    }
    dedupe.lastCode = parsed.code;
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
  beginGoogleAuthAttempt(dedupe);

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

    const report = await reportGoogleOAuthCallback(result.url, deps.auth, dedupe);
    if (report.kind === "success") return report.session;
    if (report.kind === "cancelled") throw new GoogleAuthCancelledError();
    if (report.kind === "error") throw new GoogleAuthFailedError(report.errorMessage);

    const key = getGoogleOAuthCallbackKey(result.url);
    const claimed = key ? dedupe.claimedKeys?.[key] : undefined;
    if (claimed === "cancelled") throw new GoogleAuthCancelledError();
    if (claimed === "success" || (key?.startsWith("code:") && !claimed)) {
      const existing = await deps.auth.getSession();
      if (existing.data.session?.user?.id) return existing.data.session;
    }
    throw new GoogleAuthAlreadyHandledError();
  } finally {
    endGoogleAuthAttempt(dedupe);
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
