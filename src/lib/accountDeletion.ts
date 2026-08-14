import { supabase } from "./supabase";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  createAccountDeletionRunner,
  isExpiredAccountDeletionSessionError,
  type AccountDeletionSession,
  type AccountDeletionSessionValidation,
  type AccountDeletionUserState,
} from "./accountDeletionCore";

export * from "./accountDeletionCore";

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "").toLowerCase();
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.toLowerCase();
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String((error as { message?: unknown }).message ?? "").toLowerCase();
}

function isMissingUserError(error: unknown) {
  const code = errorCode(error);
  const message = errorMessage(error);
  return code === "user_not_found"
    || message.includes("user from sub claim in jwt does not exist")
    || message.includes("user not found");
}

async function getSupabaseSession(): Promise<AccountDeletionSession | null> {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session?.access_token || !session.user?.id) return null;
  return { userId: session.user.id, accessToken: session.access_token };
}

async function validateSupabaseSession(
  session: AccountDeletionSession,
): Promise<AccountDeletionSessionValidation> {
  try {
    const { data, error } = await supabase.auth.getUser(session.accessToken);
    if (!error && data.user?.id === session.userId) return "valid";
    if (isMissingUserError(error) || isExpiredAccountDeletionSessionError(error)) {
      return "expired";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function getSupabaseUserStateAfterFailure(
  session: AccountDeletionSession,
): Promise<AccountDeletionUserState> {
  try {
    const { data, error } = await supabase.auth.getUser(session.accessToken);
    if (!error && data.user?.id === session.userId) return "exists";
    if (isMissingUserError(error)) return "missing";
    if (isExpiredAccountDeletionSessionError(error)) return "expired";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function createSupabaseAccountDeletionRunner(
  expectedUserId: string,
  finalizeDeletedAccountLocally: (
    userId: string,
  ) => Promise<"cleared" | "different-user" | "failed">,
) {
  return createAccountDeletionRunner({
    expectedUserId,
    getSession: getSupabaseSession,
    validateSession: validateSupabaseSession,
    invokeDeleteAccount: async (accessToken) => {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirmation: ACCOUNT_DELETION_CONFIRMATION },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { data, error };
    },
    getUserStateAfterFailure: getSupabaseUserStateAfterFailure,
    finalizeDeletedAccountLocally,
  });
}
