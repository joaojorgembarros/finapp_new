import type { Session } from "@supabase/supabase-js";

export const PASSWORD_RECOVERY_PATH = "reset-password";
export const PASSWORD_RECOVERY_HREF = "/reset-password" as const;

export class PasswordRecoveryLinkError extends Error {
  readonly name = "PasswordRecoveryLinkError";
  readonly reason: PasswordRecoveryLinkReason;

  constructor(reason: PasswordRecoveryLinkReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type PasswordRecoveryLinkReason = "expired" | "invalid" | "session";

export type PasswordRecoveryCallback =
  | { kind: "unrelated" }
  | { kind: "error"; reason: PasswordRecoveryLinkReason; message: string }
  | { kind: "code"; code: string }
  | { kind: "tokens"; accessToken: string; refreshToken: string };

export type PasswordRecoveryDedupeState = {
  lastCode?: string | null;
  lastAt?: number | null;
  inFlightCode?: string | null;
};

export type PasswordRecoveryAuthClient = {
  exchangeCodeForSession: (code: string) => Promise<{
    data: { session: Session | null };
    error: { message?: string; code?: string } | null;
  }>;
  setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<{
    data: { session: Session | null };
    error: { message?: string; code?: string } | null;
  }>;
  updateUser: (attributes: { password: string }) => Promise<{
    error: { message?: string; code?: string } | null;
  }>;
};

export const passwordRecoveryDedupe: PasswordRecoveryDedupeState = {};

export function isPasswordRecoveryUrl(raw: string) {
  return /reset-password/i.test(raw) && !/auth\/callback/i.test(raw);
}

export function shouldOpenPasswordRecoveryScreen(state: {
  pending: boolean;
  active: boolean;
  error: string | null;
}) {
  return state.pending || state.active || Boolean(state.error);
}

export function passwordRecoveryUrlFromRouterParams(
  params: Record<string, string | string[] | undefined>,
) {
  const query = new URLSearchParams();
  for (const key of ["code", "type", "error", "error_code", "error_description", "error_message"]) {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (text) query.set(key, text);
  }
  if ([...query.keys()].length === 0) return null;
  return `${PASSWORD_RECOVERY_PATH}?${query.toString()}`;
}

export function parsePasswordRecoveryUrl(raw: string | null | undefined): PasswordRecoveryCallback {
  if (!raw || !isPasswordRecoveryUrl(raw)) return { kind: "unrelated" };

  const params = readUrlParams(raw);
  const error = params.get("error") ?? params.get("error_code") ?? "";
  const errorCodeParam = params.get("error_code") ?? "";
  const description = params.get("error_description") ?? params.get("error_message") ?? error;
  if (error) {
    const reason = isExpiredRecoveryError(`${error} ${errorCodeParam}`, description) ? "expired" : "invalid";
    return { kind: "error", reason, message: description || error };
  }

  const code = params.get("code");
  if (code) return { kind: "code", code };

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "tokens", accessToken, refreshToken };

  return { kind: "error", reason: "invalid", message: "missing_code" };
}

export function getPasswordRecoveryLinkErrorMessage(error: unknown) {
  if (error instanceof PasswordRecoveryLinkError) {
    return messageForReason(error.reason);
  }

  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  if (code === "expired" || isExpiredRecoveryError(code, message)) {
    return messageForReason("expired");
  }
  if (code === "invalid" || code === "missing_code" || /access_denied|invalid|otp/.test(message)) {
    return messageForReason("invalid");
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return "Não foi possível conectar agora. Confira sua internet e tente novamente.";
  }
  return messageForReason("session");
}

export function requireRecoverySession(session: Session | null | undefined) {
  if (!session?.user?.id) {
    throw new PasswordRecoveryLinkError("session", "missing_session");
  }
  return session;
}

export async function completePasswordRecoveryCallback(
  rawUrl: string | null | undefined,
  auth: Pick<PasswordRecoveryAuthClient, "exchangeCodeForSession" | "setSession">,
  dedupe: PasswordRecoveryDedupeState = passwordRecoveryDedupe,
  opts?: { now?: () => number },
) {
  const parsed = parsePasswordRecoveryUrl(rawUrl);
  if (parsed.kind === "unrelated") return { processed: false as const };
  if (parsed.kind === "error") {
    throw new PasswordRecoveryLinkError(parsed.reason, parsed.message);
  }

  if (parsed.kind === "code") {
    const now = opts?.now?.() ?? Date.now();
    if (dedupe.inFlightCode === parsed.code) return { processed: false as const, reason: "inflight" as const };
    if (dedupe.lastCode === parsed.code && dedupe.lastAt && now - dedupe.lastAt < 10_000) {
      return { processed: false as const, reason: "duplicate" as const };
    }

    dedupe.inFlightCode = parsed.code;
    try {
      const { data, error } = await auth.exchangeCodeForSession(parsed.code);
      if (error) throw error;
      if (!data.session?.user?.id) throw new PasswordRecoveryLinkError("session", "missing_session");
      dedupe.lastCode = parsed.code;
      dedupe.lastAt = now;
      return { processed: true as const, session: data.session };
    } finally {
      dedupe.inFlightCode = null;
    }
  }

  const { data, error } = await auth.setSession({
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
  });
  if (error) throw error;
  if (!data.session?.user?.id) throw new PasswordRecoveryLinkError("session", "missing_session");
  return { processed: true as const, session: data.session };
}

export async function updatePasswordDuringRecovery(
  session: Session | null | undefined,
  auth: Pick<PasswordRecoveryAuthClient, "updateUser">,
  password: string,
) {
  requireRecoverySession(session);
  const { error } = await auth.updateUser({ password });
  if (error) throw error;
}

function messageForReason(reason: PasswordRecoveryLinkReason) {
  if (reason === "expired") {
    return "Este link expirou. Solicite um novo e-mail para redefinir sua senha.";
  }
  if (reason === "invalid") {
    return "Este link não é mais válido. Solicite um novo e-mail para redefinir sua senha.";
  }
  return "Não foi possível validar o link de recuperação. Tente novamente.";
}

function isExpiredRecoveryError(error: string, description: string) {
  return /otp_expired|expired|flow_state_expired/i.test(`${error} ${description}`);
}

function readUrlParams(raw: string) {
  const params = new URLSearchParams();
  try {
    const url = new URL(raw);
    mergeParams(params, url.search);
    mergeParams(params, url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    return params;
  } catch {
    const afterScheme = raw.includes("://") ? raw.split("://")[1] ?? "" : raw;
    const hashIndex = afterScheme.indexOf("#");
    const queryIndex = afterScheme.indexOf("?");
    if (hashIndex >= 0 && (queryIndex < 0 || hashIndex < queryIndex)) {
      mergeParams(params, afterScheme.slice(hashIndex + 1));
      return params;
    }
    const query = queryIndex >= 0 ? afterScheme.slice(queryIndex + 1) : "";
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
  if (error instanceof PasswordRecoveryLinkError) return error.reason;
  return "";
}
