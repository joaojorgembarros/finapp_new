import type {
  OpenFinanceGetConsentResponse,
  OpenFinancePolpConsentStatus,
  OpenFinancePolpStartConnectionResponse,
} from "./open-finance-contract";

export const POLP_AUTHORIZATION_POLL_DELAYS_MS = [0, 2000, 3000, 5000, 8000] as const;

export type OpenFinancePolpAuthorizationPhase =
  | "idle"
  | "starting"
  | "awaiting_authorization"
  | "checking"
  | "ready_to_complete"
  | "rejected"
  | "expired"
  | "provider_error"
  | "timed_out"
  | "error";

export type OpenFinancePolpAuthorizationSnapshot = {
  phase: OpenFinancePolpAuthorizationPhase;
  hasConsent: boolean;
  title: string | null;
  message: string | null;
  canStart: boolean;
  canOpenAuthorization: boolean;
  canCheckAgain: boolean;
  canReset: boolean;
  formLocked: boolean;
};

export type OpenFinancePolpAuthorizationStartInput = {
  householdId: string;
  institutionId: string;
  cpf: string;
};

export type OpenFinancePolpAuthorizationDependencies = {
  startConnection: (input: {
    institutionId: string;
    cpf: string;
  }) => Promise<OpenFinancePolpStartConnectionResponse>;
  getConsent: (input: {
    provider: "polp";
    householdId: string;
    consentId: string;
  }) => Promise<OpenFinanceGetConsentResponse>;
  openUrl: (url: string) => Promise<void>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

type StoredAuthorization = {
  householdId: string;
  consentId: string;
  authorizationUrl: string;
  expiresAt: string | null;
  connectionId: string | null;
};

type ConsentOutcome =
  | "ready"
  | "pending"
  | "rejected"
  | "expired"
  | "provider_error";

const MESSAGES: Record<Exclude<OpenFinancePolpAuthorizationPhase, "idle">, { title: string; message: string }> = {
  starting: {
    title: "Iniciando conexão",
    message: "Estamos preparando a autorização com a sua instituição.",
  },
  awaiting_authorization: {
    title: "Autorize no banco",
    message: "Abra o banco para autorizar o acesso. Depois volte ao app para continuarmos.",
  },
  checking: {
    title: "Verificando autorização",
    message: "Estamos conferindo se a instituição já autorizou o acesso.",
  },
  ready_to_complete: {
    title: "Autorização concluída",
    message: "Sua instituição autorizou o acesso. Estamos prontos para concluir a conexão.",
  },
  rejected: {
    title: "Autorização recusada",
    message: "A instituição não autorizou este acesso. Você pode iniciar uma nova conexão quando quiser.",
  },
  expired: {
    title: "Pedido expirado",
    message: "O pedido de autorização expirou. Inicie uma nova conexão para continuar.",
  },
  provider_error: {
    title: "Não foi possível autorizar",
    message: "A instituição não concluiu a autorização. Tente uma nova conexão.",
  },
  timed_out: {
    title: "Ainda sem confirmação",
    message: "Ainda não recebemos a confirmação do banco. Você pode verificar novamente ou abrir o banco.",
  },
  error: {
    title: "Não foi possível continuar",
    message: "Não foi possível concluir esta etapa. Tente novamente.",
  },
};

function isAbortError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "name" in error
    && (error as { name?: string }).name === "AbortError",
  );
}

export async function sleepWithAbort(ms: number, signal: AbortSignal) {
  if (ms <= 0) return;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function requireHttpsAuthorizationUrl(value: string) {
  const authorizationUrl = value.trim();
  if (!authorizationUrl) {
    throw new TypeError("authorizationUrl is missing.");
  }
  let parsed: URL;
  try {
    parsed = new URL(authorizationUrl);
  } catch {
    throw new TypeError("authorizationUrl is invalid.");
  }
  if (parsed.protocol !== "https:") {
    throw new TypeError("authorizationUrl must be https.");
  }
  return authorizationUrl;
}

export function readPolpAuthorizationStart(response: OpenFinancePolpStartConnectionResponse) {
  if (response.provider !== "polp") {
    throw new TypeError("A conexão retornou um provedor incompatível.");
  }
  const consentId = response.consentId.trim();
  if (!consentId) {
    throw new TypeError("A conexão retornou um identificador inválido.");
  }
  return {
    consentId,
    authorizationUrl: requireHttpsAuthorizationUrl(response.authorizationUrl),
    expiresAt: response.expiresAt ?? null,
    connectionId: response.connectionId ?? null,
  };
}

export function interpretPolpConsentStatus(consent: OpenFinancePolpConsentStatus): ConsentOutcome {
  if (consent.hasProviderError) return "provider_error";
  if (consent.providerStatus === "REJECTED") return "rejected";
  if (consent.providerStatus === "EXPIRED") return "expired";
  if (consent.providerStatus === "AUTHORISED" && consent.resourcesReady) return "ready";
  return "pending";
}

export function shouldCheckConsentOnAppState(input: {
  previous: string;
  next: string;
  phase: OpenFinancePolpAuthorizationPhase;
  hasConsent: boolean;
  checking: boolean;
}) {
  if (!input.hasConsent || input.checking) return false;
  if (input.next !== "active" || input.previous === "active") return false;
  return input.phase === "awaiting_authorization";
}

function copy(phase: OpenFinancePolpAuthorizationPhase, hasConsent: boolean): OpenFinancePolpAuthorizationSnapshot {
  const copyForPhase = phase === "idle" ? null : MESSAGES[phase];
  const terminal = phase === "rejected"
    || phase === "expired"
    || phase === "provider_error"
    || phase === "ready_to_complete";
  const canStart = phase === "idle" || (phase === "error" && !hasConsent);
  return {
    phase,
    hasConsent,
    title: copyForPhase?.title ?? null,
    message: copyForPhase?.message ?? null,
    canStart,
    canOpenAuthorization: hasConsent && !terminal && phase !== "starting",
    canCheckAgain: hasConsent && (phase === "timed_out" || phase === "error" || phase === "awaiting_authorization"),
    canReset: phase === "rejected"
      || phase === "expired"
      || phase === "provider_error"
      || phase === "timed_out"
      || phase === "error"
      || phase === "ready_to_complete",
    formLocked: !canStart,
  };
}

export function createOpenFinancePolpAuthorizationController(
  deps: OpenFinancePolpAuthorizationDependencies,
) {
  const sleep = deps.sleep ?? sleepWithAbort;
  let phase: OpenFinancePolpAuthorizationPhase = "idle";
  let stored: StoredAuthorization | null = null;
  let pollInFlight = false;
  let generation = 0;
  let abort: AbortController | null = null;
  let lastAppState = "active";
  const listeners = new Set<(snapshot: OpenFinancePolpAuthorizationSnapshot) => void>();

  function snapshot(): OpenFinancePolpAuthorizationSnapshot {
    return copy(phase, Boolean(stored));
  }

  function emit() {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function beginGeneration() {
    generation += 1;
    abort?.abort();
    abort = new AbortController();
    return { generation, signal: abort.signal };
  }

  function isCurrent(token: number) {
    return token === generation;
  }

  async function openStoredUrl() {
    if (!stored) return;
    await deps.openUrl(stored.authorizationUrl);
  }

  async function runPoll(token: number, signal: AbortSignal) {
    if (!stored || pollInFlight) return;
    pollInFlight = true;
    phase = "checking";
    emit();
    try {
      for (const delay of POLP_AUTHORIZATION_POLL_DELAYS_MS) {
        if (!isCurrent(token) || signal.aborted || !stored) return;
        await sleep(delay, signal);
        if (!isCurrent(token) || signal.aborted || !stored) return;
        const response = await deps.getConsent({
          provider: "polp",
          householdId: stored.householdId,
          consentId: stored.consentId,
        });
        if (!isCurrent(token) || signal.aborted) return;
        if (!response.consent || response.consent.provider !== "polp") {
          phase = "error";
          return;
        }
        const outcome = interpretPolpConsentStatus(response.consent);
        if (outcome === "ready") {
          phase = "ready_to_complete";
          return;
        }
        if (outcome === "rejected") {
          phase = "rejected";
          return;
        }
        if (outcome === "expired") {
          phase = "expired";
          return;
        }
        if (outcome === "provider_error") {
          phase = "provider_error";
          return;
        }
      }
      if (isCurrent(token)) phase = "timed_out";
    } catch (error) {
      if (!isCurrent(token) || isAbortError(error)) return;
      phase = "error";
    } finally {
      if (isCurrent(token)) {
        pollInFlight = false;
        emit();
      }
    }
  }

  async function checkAgain() {
    if (!stored || pollInFlight) return;
    if (phase === "ready_to_complete" || phase === "rejected" || phase === "expired" || phase === "provider_error") {
      return;
    }
    const token = beginGeneration();
    await runPoll(token.generation, token.signal);
  }

  return {
    get snapshot() {
      return snapshot();
    },
    subscribe(listener: (value: OpenFinancePolpAuthorizationSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    async start(input: OpenFinancePolpAuthorizationStartInput) {
      if (!snapshot().canStart || pollInFlight) return;
      stored = null;
      phase = "starting";
      emit();
      const token = beginGeneration();
      try {
        const response = await deps.startConnection({
          institutionId: input.institutionId,
          cpf: input.cpf,
        });
        if (!isCurrent(token.generation)) return;
        const started = readPolpAuthorizationStart(response);
        stored = {
          householdId: input.householdId,
          ...started,
        };
        phase = "awaiting_authorization";
        emit();
        try {
          await openStoredUrl();
        } catch {
          if (isCurrent(token.generation)) emit();
        }
      } catch (error) {
        if (!isCurrent(token.generation) || isAbortError(error)) return;
        stored = null;
        phase = "error";
        emit();
      }
    },
    async openAuthorization() {
      if (!snapshot().canOpenAuthorization || !stored) return;
      try {
        await openStoredUrl();
      } catch {
        emit();
      }
    },
    async checkAgain() {
      await checkAgain();
    },
    handleAppState(next: string) {
      const previous = lastAppState;
      lastAppState = next;
      if (!shouldCheckConsentOnAppState({
        previous,
        next,
        phase,
        hasConsent: Boolean(stored),
        checking: pollInFlight,
      })) return;
      return checkAgain();
    },
    reset() {
      beginGeneration();
      pollInFlight = false;
      stored = null;
      phase = "idle";
      emit();
    },
    dispose() {
      beginGeneration();
      pollInFlight = false;
      listeners.clear();
    },
  };
}
