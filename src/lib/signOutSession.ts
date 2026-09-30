import {
  discardInvalidAuthSession,
  isDefinitivelyInvalidAuthError,
  type AuthSessionClient,
} from "./sessionValidity";

export type SignOutResult = {
  remoteSignOutCompleted: boolean;
  localSessionCleared: boolean;
  activeAccountChanged: boolean;
  errorMessage: string | null;
};

export type SignOutFeedback = {
  title: string;
  message: string;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return String(error ?? "");
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) return String(error.code).toLowerCase();
  return "";
}

export function isSignOutNetworkError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  return code.includes("network")
    || message.includes("network")
    || message.includes("fetch")
    || message.includes("connection")
    || message.includes("failed to fetch");
}

export function getSignOutErrorMessage(error: unknown) {
  if (isSignOutNetworkError(error)) {
    return "Sem conexão. Verifique sua internet e tente novamente.";
  }
  return "Não foi possível sair agora. Tente novamente.";
}

export function getRemoteSignOutWarningMessage(error: unknown) {
  if (isSignOutNetworkError(error)) {
    return "Não foi possível confirmar a saída dos outros dispositivos. Tente novamente quando estiver conectado.";
  }
  return "A sessão neste aparelho foi encerrada, mas não foi possível confirmar a saída dos outros dispositivos.";
}

export function getSignOutFeedback(result: SignOutResult): SignOutFeedback | null {
  if (!result.errorMessage) return null;
  if (result.localSessionCleared) {
    return {
      title: "Sessão encerrada neste aparelho",
      message: result.errorMessage,
    };
  }
  return {
    title: "Não foi possível sair",
    message: result.errorMessage,
  };
}

export function shouldLeaveAuthenticatedApp(result: SignOutResult) {
  return result.localSessionCleared || result.remoteSignOutCompleted;
}

async function signOutSafely(
  auth: Pick<AuthSessionClient, "signOut">,
  options?: { scope?: "global" | "local" | "others" },
) {
  try {
    return await auth.signOut(options);
  } catch (error) {
    return { error: error as { message?: string; code?: string } };
  }
}

export async function performSignOut(
  auth: Pick<AuthSessionClient, "signOut">,
): Promise<SignOutResult> {
  const { error } = await signOutSafely(auth);

  if (!error) {
    return {
      remoteSignOutCompleted: true,
      localSessionCleared: true,
      activeAccountChanged: false,
      errorMessage: null,
    };
  }

  if (isDefinitivelyInvalidAuthError(error)) {
    try {
      await discardInvalidAuthSession(auth);
    } catch {
      // Local storage may already be empty for an invalid session.
    }
    return {
      remoteSignOutCompleted: false,
      localSessionCleared: true,
      activeAccountChanged: false,
      errorMessage: null,
    };
  }

  const { error: localError } = await signOutSafely(auth, { scope: "local" });
  if (localError && !isDefinitivelyInvalidAuthError(localError)) {
    return {
      remoteSignOutCompleted: false,
      localSessionCleared: false,
      activeAccountChanged: false,
      errorMessage: getSignOutErrorMessage(error),
    };
  }

  return {
    remoteSignOutCompleted: false,
    localSessionCleared: true,
    activeAccountChanged: false,
    errorMessage: getRemoteSignOutWarningMessage(error),
  };
}

export function createSignOutGate(perform: () => Promise<SignOutResult>) {
  let inFlight: Promise<SignOutResult> | null = null;

  return function signOut() {
    if (inFlight) return inFlight;
    const pending = perform().finally(() => {
      if (inFlight === pending) inFlight = null;
    });
    inFlight = pending;
    return pending;
  };
}
