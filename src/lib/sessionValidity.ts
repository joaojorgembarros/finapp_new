import type { Session } from "@supabase/supabase-js";

export type AuthSessionClient = {
  getSession: () => Promise<{
    data: { session: Session | null };
    error: { message?: string; code?: string } | null;
  }>;
  getUser: () => Promise<{
    data: { user: { id?: string } | null };
    error: { message?: string; code?: string } | null;
  }>;
  signOut: (options?: { scope?: "global" | "local" | "others" }) => Promise<{
    error: { message?: string; code?: string } | null;
  }>;
};

export type RestoreSessionResult =
  | { status: "anonymous" }
  | { status: "authenticated"; session: Session }
  | { status: "cleared_invalid"; reason: "missing_user" | "invalid_refresh" };

export function isMissingAuthUserError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  return code === "user_not_found"
    || /user from sub claim in jwt does not exist/.test(message)
    || /user not found/.test(message)
    || /auth session missing/.test(message);
}

export function isInvalidRefreshTokenError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  return code === "refresh_token_not_found"
    || /invalid refresh token/.test(message)
    || /refresh token not found/.test(message);
}

export function isDefinitivelyInvalidAuthError(error: unknown) {
  return isMissingAuthUserError(error) || isInvalidRefreshTokenError(error);
}

export async function discardInvalidAuthSession(auth: Pick<AuthSessionClient, "signOut">) {
  const { error } = await auth.signOut({ scope: "local" });
  if (error && !isDefinitivelyInvalidAuthError(error)) throw error;
}

export async function restoreValidatedSession(auth: AuthSessionClient): Promise<RestoreSessionResult> {
  const { data, error } = await auth.getSession();
  if (error) {
    if (isDefinitivelyInvalidAuthError(error)) {
      await discardInvalidAuthSession(auth);
      return {
        status: "cleared_invalid",
        reason: isInvalidRefreshTokenError(error) ? "invalid_refresh" : "missing_user",
      };
    }
    throw error;
  }
  if (!data.session?.user?.id) return { status: "anonymous" };

  const { data: userData, error: userError } = await auth.getUser();
  if (!userError && userData.user?.id) {
    return { status: "authenticated", session: data.session };
  }
  if (userError && !isDefinitivelyInvalidAuthError(userError)) {
    return { status: "authenticated", session: data.session };
  }

  await discardInvalidAuthSession(auth);
  return { status: "cleared_invalid", reason: "missing_user" };
}

export function shouldApplyAuthStateSession(event: string) {
  return event !== "INITIAL_SESSION";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return String(error ?? "");
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) return String(error.code).toLowerCase();
  return "";
}
