import { OpenFinanceClientError } from "./open-finance-client";
import type {
  OpenFinanceDisconnectConnectionRequest,
  OpenFinanceDisconnectConnectionResponse,
} from "./open-finance-contract";
import type { OpenFinancePolpCompletedResource } from "./open-finance-polp-completion";

export type OpenFinancePolpDisconnectPhase =
  | "idle"
  | "disconnecting"
  | "disconnected"
  | "error";

export type OpenFinancePolpDisconnectSnapshot = {
  phase: OpenFinancePolpDisconnectPhase;
  errorMessage: string | null;
  canStart: boolean;
};

export type OpenFinancePolpDisconnectInput = {
  householdId: string | null | undefined;
  connectionId: string | null | undefined;
};

export type OpenFinancePolpDisconnectDependencies = {
  disconnectConnection: (
    request: OpenFinanceDisconnectConnectionRequest,
  ) => Promise<OpenFinanceDisconnectConnectionResponse>;
};

export const POLP_DISCONNECT_CONFIRMATION = {
  title: "Desconectar instituição?",
  message:
    "Isso interrompe futuras sincronizações com este banco. As movimentações já importadas permanecem no app.",
  cancel: "Cancelar",
  confirm: "Desconectar",
} as const;

const GENERIC_DISCONNECT_ERROR = "Não foi possível desconectar a instituição. Tente novamente.";

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readPolpDisconnectConnectionId(
  resources: OpenFinancePolpCompletedResource[],
) {
  for (const resource of resources) {
    const connectionId = readNonEmptyString(resource.key);
    if (connectionId) return connectionId;
  }
  return null;
}

export function canStartPolpDisconnect(input: {
  householdId: string | null | undefined;
  connectionId: string | null | undefined;
  phase: OpenFinancePolpDisconnectPhase;
  blocked?: boolean;
}) {
  if (input.blocked) return false;
  if (input.phase === "disconnecting" || input.phase === "disconnected") return false;
  return Boolean(readNonEmptyString(input.householdId) && readNonEmptyString(input.connectionId));
}

function disconnectError(error: unknown) {
  if (error instanceof OpenFinanceClientError) {
    return error.message || GENERIC_DISCONNECT_ERROR;
  }
  return GENERIC_DISCONNECT_ERROR;
}

export function createOpenFinancePolpDisconnectController(
  deps: OpenFinancePolpDisconnectDependencies,
) {
  let phase: OpenFinancePolpDisconnectPhase = "idle";
  let errorMessage: string | null = null;
  let inFlight = false;
  let generation = 0;
  const listeners = new Set<(snapshot: OpenFinancePolpDisconnectSnapshot) => void>();

  function snapshot(): OpenFinancePolpDisconnectSnapshot {
    return {
      phase,
      errorMessage,
      canStart: !inFlight && phase !== "disconnecting" && phase !== "disconnected",
    };
  }

  function emit() {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function reset() {
    generation += 1;
    inFlight = false;
    phase = "idle";
    errorMessage = null;
    emit();
  }

  async function start(input: OpenFinancePolpDisconnectInput) {
    if (inFlight || phase === "disconnecting" || phase === "disconnected") return false;
    const householdId = readNonEmptyString(input.householdId);
    const connectionId = readNonEmptyString(input.connectionId);
    if (!householdId || !connectionId) return false;

    inFlight = true;
    phase = "disconnecting";
    errorMessage = null;
    const token = ++generation;
    emit();

    try {
      await deps.disconnectConnection({
        provider: "polp",
        householdId,
        connectionId,
      });
      if (token !== generation) return false;
      phase = "disconnected";
      return true;
    } catch (error) {
      if (token !== generation) return false;
      phase = "error";
      errorMessage = disconnectError(error);
      return false;
    } finally {
      inFlight = false;
      if (token === generation) emit();
    }
  }

  return {
    get snapshot() {
      return snapshot();
    },
    subscribe(listener: (value: OpenFinancePolpDisconnectSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    reset,
    dispose() {
      generation += 1;
      inFlight = false;
      listeners.clear();
    },
  };
}
