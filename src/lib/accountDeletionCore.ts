export const ACCOUNT_DELETION_CONFIRMATION = "EXCLUIR";

export type AccountDeletionErrorCode =
  | "session-expired"
  | "shared-household"
  | "invalid-confirmation"
  | "account-changed"
  | "failed";

export class AccountDeletionError extends Error {
  readonly code: AccountDeletionErrorCode;

  constructor(code: AccountDeletionErrorCode) {
    super(code);
    this.name = "AccountDeletionError";
    this.code = code;
  }
}

export type AccountDeletionSession = {
  userId: string;
  accessToken: string;
};

export type AccountDeletionSessionValidation = "valid" | "expired" | "unknown";
export type AccountDeletionUserState = "exists" | "missing" | "expired" | "unknown";
export type AccountDeletionLocalCleanupResult = "cleared" | "different-user" | "failed";

export type AccountDeletionInvokeResult = {
  data: unknown;
  error: unknown;
};

export type AccountDeletionDependencies = {
  expectedUserId: string;
  getSession: () => Promise<AccountDeletionSession | null>;
  validateSession: (
    session: AccountDeletionSession,
  ) => Promise<AccountDeletionSessionValidation>;
  invokeDeleteAccount: (accessToken: string) => Promise<AccountDeletionInvokeResult>;
  getUserStateAfterFailure: (
    session: AccountDeletionSession,
  ) => Promise<AccountDeletionUserState>;
  finalizeDeletedAccountLocally: (
    userId: string,
  ) => Promise<AccountDeletionLocalCleanupResult>;
};

export type AccountDeletionResult = {
  deleted: true;
  userId: string;
  localCleanup: AccountDeletionLocalCleanupResult;
};

export function isAccountDeletionConfirmation(value: string) {
  return value === ACCOUNT_DELETION_CONFIRMATION;
}

export function shouldRequireAccountDeletionLocalIdentity(options: {
  platform: string;
  appLockSupported: boolean;
  appLockEnabled: boolean;
  hasPin: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
}) {
  return options.platform !== "web"
    && options.appLockSupported
    && options.appLockEnabled
    && (
      options.hasPin
      || (options.biometricEnabled && options.biometricAvailable)
    );
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const directStatus = "status" in error
    ? Number((error as { status?: unknown }).status)
    : Number.NaN;
  if (Number.isFinite(directStatus)) return directStatus;
  const context = "context" in error
    ? (error as { context?: unknown }).context
    : null;
  if (!context || typeof context !== "object" || !("status" in context)) return null;
  const status = Number((context as { status?: unknown }).status);
  return Number.isFinite(status) ? status : null;
}

export function isExpiredAccountDeletionSessionError(error: unknown) {
  const status = errorStatus(error);
  if (status === 401 || status === 403) return true;
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code ?? "").toLowerCase();
  return [
    "bad_jwt",
    "invalid_jwt",
    "session_not_found",
    "refresh_token_not_found",
  ].includes(code);
}

function isSuccessfulResponse(data: unknown) {
  return Boolean(
    data
      && typeof data === "object"
      && (data as { ok?: unknown }).ok === true
      && (data as { deleted?: unknown }).deleted === true,
  );
}

export function createAccountDeletionRunner(deps: AccountDeletionDependencies) {
  let inFlight: Promise<AccountDeletionResult> | null = null;

  const execute = async (): Promise<AccountDeletionResult> => {
    const session = await deps.getSession();
    if (!session) throw new AccountDeletionError("session-expired");
    if (session.userId !== deps.expectedUserId) {
      throw new AccountDeletionError("account-changed");
    }

    const validation = await deps.validateSession(session);
    if (validation === "expired") throw new AccountDeletionError("session-expired");
    if (validation !== "valid") throw new AccountDeletionError("failed");
    if (session.userId !== deps.expectedUserId) {
      throw new AccountDeletionError("account-changed");
    }

    let invocation: AccountDeletionInvokeResult;
    try {
      invocation = await deps.invokeDeleteAccount(session.accessToken);
    } catch (error) {
      invocation = { data: null, error };
    }

    let deleted = !invocation.error && isSuccessfulResponse(invocation.data);
    if (!deleted && invocation.error) {
      const status = errorStatus(invocation.error);
      if (status === 401) throw new AccountDeletionError("session-expired");
      if (status === 409) throw new AccountDeletionError("shared-household");
      if (status === 400) throw new AccountDeletionError("invalid-confirmation");

      // The server may have removed Auth successfully while the final response
      // was lost. Only an explicit user-not-found result is treated as success.
      const userState = await deps.getUserStateAfterFailure(session);
      if (userState === "expired") throw new AccountDeletionError("session-expired");
      deleted = userState === "missing";
    }

    if (!deleted) throw new AccountDeletionError("failed");

    let localCleanup: AccountDeletionLocalCleanupResult = "failed";
    try {
      localCleanup = await deps.finalizeDeletedAccountLocally(session.userId);
    } catch {
      // The remote deletion is definitive. Local cleanup starts by removing the
      // in-memory session and is best-effort after that point.
    }
    return { deleted: true, userId: session.userId, localCleanup };
  };

  return () => {
    if (inFlight) return inFlight;
    inFlight = execute().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

export function getAccountDeletionMessage(error: unknown) {
  if (error instanceof AccountDeletionError) {
    if (error.code === "session-expired") {
      return "Sua sessão expirou. Entre novamente para continuar.";
    }
    if (error.code === "shared-household") {
      return "Esta conta participa de uma casa compartilhada. Não foi possível excluir sem proteger os dados das outras pessoas.";
    }
    if (error.code === "account-changed") {
      return "A conta ativa mudou. Abra novamente a exclusão no perfil da conta correta.";
    }
  }
  return "Não foi possível excluir sua conta. Tente novamente.";
}
