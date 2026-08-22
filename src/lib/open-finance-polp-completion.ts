import { OpenFinanceClientError } from "./open-finance-client";
import type {
  OpenFinanceCompleteConnectionResponse,
  OpenFinancePolpCompleteConnectionRequest,
  OpenFinanceResourceType,
} from "./open-finance-contract";
import type { OpenFinancePolpAuthorizationPhase } from "./open-finance-polp-authorization";

export type OpenFinancePolpCompletionPhase =
  | "idle"
  | "completing"
  | "completed"
  | "error";

export type OpenFinancePolpCompletedResource = {
  key: string;
  type: Extract<OpenFinanceResourceType, "account" | "credit_card">;
  title: string;
  name: string;
  mask: string | null;
};

export type OpenFinancePolpCompletionSnapshot = {
  phase: OpenFinancePolpCompletionPhase;
  resources: OpenFinancePolpCompletedResource[];
  errorMessage: string | null;
  errorCode: string | null;
  errorStatus: number | null;
  retryable: boolean;
};

export type OpenFinancePolpCompletionInput = {
  authorizationPhase: OpenFinancePolpAuthorizationPhase;
  householdId: string | null | undefined;
  consentId: string | null | undefined;
};

export type OpenFinancePolpCompletionIdentity = {
  householdId: string;
  consentId: string;
};

export type OpenFinancePolpCompletionDependencies = {
  completeConnection: (
    request: OpenFinancePolpCompleteConnectionRequest,
  ) => Promise<OpenFinanceCompleteConnectionResponse>;
  getActiveContext: () => OpenFinancePolpCompletionIdentity | null;
};

type CompletionContext = OpenFinancePolpCompletionIdentity;

const RESOURCES_PENDING_CODE = "CONSENT_RESOURCES_PENDING";
const GENERIC_COMPLETION_ERROR = "Não foi possível concluir a conexão. Tente novamente.";
const RESOURCES_PENDING_MESSAGE =
  "A instituição ainda está preparando seus recursos. Aguarde um pouco e tente concluir novamente.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readCompletionIdentity(
  input: OpenFinancePolpCompletionInput,
): OpenFinancePolpCompletionIdentity | null {
  if (input.authorizationPhase !== "ready_to_complete") return null;
  const householdId = readNonEmptyString(input.householdId);
  const consentId = readNonEmptyString(input.consentId);
  if (!householdId || !consentId) return null;
  return { householdId, consentId };
}

export function sameCompletionIdentity(
  a: OpenFinancePolpCompletionIdentity | null | undefined,
  b: OpenFinancePolpCompletionIdentity | null | undefined,
) {
  return Boolean(a && b && a.householdId === b.householdId && a.consentId === b.consentId);
}

function toCompletedResource(
  value: unknown,
  consentId: string,
): OpenFinancePolpCompletedResource | null {
  if (!isRecord(value)) return null;
  if (value.provider !== "polp") return null;
  const id = readNonEmptyString(value.id);
  if (!id || value.externalConnectionId !== consentId) return null;
  if (value.resourceType !== "account" && value.resourceType !== "credit_card") return null;

  const institution = isRecord(value.institution) ? value.institution : null;
  const institutionName = readNonEmptyString(institution?.displayName)
    ?? readNonEmptyString(institution?.name);
  const title = value.resourceType === "credit_card" ? "Cartão de crédito" : "Conta bancária";
  const name = readNonEmptyString(value.accountName) ?? institutionName ?? title;

  return {
    key: id,
    type: value.resourceType,
    title,
    name,
    mask: readNonEmptyString(value.accountMask),
  };
}

export function readPolpCompletedResources(
  response: OpenFinanceCompleteConnectionResponse,
  consentId: string,
) {
  if (!("consent" in response) || response.consentId !== consentId) {
    throw new TypeError("A conclusão retornou um consentimento incompatível.");
  }
  if (
    !response.consent
    || response.consent.provider !== "polp"
    || response.consent.consentId !== consentId
  ) {
    throw new TypeError("A conclusão retornou um consentimento Polp inválido.");
  }
  if (!Array.isArray(response.connections)) {
    throw new TypeError("A conclusão retornou conexões inválidas.");
  }

  const byId = new Map<string, OpenFinancePolpCompletedResource>();
  for (const connection of response.connections) {
    const resource = toCompletedResource(connection, consentId);
    if (resource && !byId.has(resource.key)) byId.set(resource.key, resource);
  }
  return [...byId.values()];
}

function completionError(error: unknown) {
  if (error instanceof OpenFinanceClientError) {
    if (error.code === RESOURCES_PENDING_CODE) {
      return {
        code: error.code,
        status: error.status,
        message: RESOURCES_PENDING_MESSAGE,
      };
    }
    return {
      code: error.code,
      status: error.status,
      message: error.message || GENERIC_COMPLETION_ERROR,
    };
  }
  return {
    code: null,
    status: null,
    message: GENERIC_COMPLETION_ERROR,
  };
}

export function createOpenFinancePolpCompletionController(
  deps: OpenFinancePolpCompletionDependencies,
) {
  let phase: OpenFinancePolpCompletionPhase = "idle";
  let resources: OpenFinancePolpCompletedResource[] = [];
  let errorMessage: string | null = null;
  let errorCode: string | null = null;
  let errorStatus: number | null = null;
  let context: CompletionContext | null = null;
  let completing = false;
  let inFlight = false;
  let generation = 0;
  const listeners = new Set<(snapshot: OpenFinancePolpCompletionSnapshot) => void>();

  function snapshot(): OpenFinancePolpCompletionSnapshot {
    return {
      phase,
      resources,
      errorMessage,
      errorCode,
      errorStatus,
      retryable: phase === "error"
        && Boolean(context)
        && sameCompletionIdentity(context, deps.getActiveContext()),
    };
  }

  function emit() {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function clearToIdle() {
    generation += 1;
    completing = false;
    context = null;
    phase = "idle";
    resources = [];
    errorMessage = null;
    errorCode = null;
    errorStatus = null;
  }

  function reset() {
    clearToIdle();
    emit();
  }

  function belongsToActiveIdentity(runContext: CompletionContext | null) {
    return sameCompletionIdentity(runContext, deps.getActiveContext());
  }

  function isCurrent(token: number, runContext: CompletionContext) {
    if (token !== generation) return false;
    if (belongsToActiveIdentity(runContext)) return true;
    reset();
    return false;
  }

  function syncActiveIdentity() {
    if (!context && phase === "idle") return;
    if (belongsToActiveIdentity(context)) return;
    reset();
  }

  async function run(activeContext: CompletionContext) {
    if (inFlight) return;
    inFlight = true;
    completing = true;
    phase = "completing";
    resources = [];
    errorMessage = null;
    errorCode = null;
    errorStatus = null;
    const token = ++generation;
    emit();

    try {
      const response = await deps.completeConnection({
        provider: "polp",
        householdId: activeContext.householdId,
        consentId: activeContext.consentId,
      });
      if (!isCurrent(token, activeContext)) return;
      resources = readPolpCompletedResources(response, activeContext.consentId);
      phase = "completed";
    } catch (error) {
      if (!isCurrent(token, activeContext)) return;
      const safeError = completionError(error);
      errorMessage = safeError.message;
      errorCode = safeError.code;
      errorStatus = safeError.status;
      phase = "error";
    } finally {
      inFlight = false;
      if (token === generation) {
        completing = false;
        emit();
      }
    }
  }

  return {
    get snapshot() {
      return snapshot();
    },
    subscribe(listener: (value: OpenFinancePolpCompletionSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    async complete(input: OpenFinancePolpCompletionInput) {
      if (phase !== "idle" || completing || inFlight) return;
      const nextContext = readCompletionIdentity(input);
      if (!nextContext || !belongsToActiveIdentity(nextContext)) return;
      context = nextContext;
      await run(nextContext);
    },
    async retry() {
      if (phase !== "error" || !context || completing || inFlight) return;
      if (!belongsToActiveIdentity(context)) {
        reset();
        return;
      }
      await run(context);
    },
    syncActiveIdentity,
    reset,
    dispose() {
      generation += 1;
      completing = false;
      listeners.clear();
    },
  };
}
