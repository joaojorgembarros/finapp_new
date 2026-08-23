import type {
  OpenFinancePolpCompletedResource,
  OpenFinancePolpCompletionPhase,
} from "./open-finance-polp-completion";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSyncableResourceType(value: unknown): "account" | "credit_card" | null {
  return value === "account" || value === "credit_card" ? value : null;
}

export function readHydratedPolpConnectionResource(
  value: unknown,
): OpenFinancePolpCompletedResource | null {
  if (!isRecord(value)) return null;
  if (value.provider !== "polp") return null;
  if (value.status !== "connected") return null;
  const id = readNonEmptyString(value.id);
  if (!id) return null;
  const rawPayload = isRecord(value.rawPayload) ? value.rawPayload : null;
  const resourceType = readSyncableResourceType(value.resourceType)
    ?? readSyncableResourceType(rawPayload?.resourceType);
  if (!resourceType) return null;

  const institution = isRecord(value.institution) ? value.institution : null;
  const institutionName = readNonEmptyString(institution?.displayName)
    ?? readNonEmptyString(institution?.name);
  const title = resourceType === "credit_card" ? "Cartão de crédito" : "Conta bancária";
  const name = readNonEmptyString(value.accountName) ?? institutionName ?? title;

  return {
    key: id,
    type: resourceType,
    title,
    name,
    mask: readNonEmptyString(value.accountMask),
  };
}

export function readHydratedPolpSyncResources(connections: unknown) {
  if (!Array.isArray(connections)) return [];
  const byId = new Map<string, OpenFinancePolpCompletedResource>();
  for (const connection of connections) {
    const resource = readHydratedPolpConnectionResource(connection);
    if (resource && !byId.has(resource.key)) byId.set(resource.key, resource);
  }
  return [...byId.values()];
}

export async function fetchHydratedPolpSyncResources(
  listConnections: (input: {
    provider: "polp";
    householdId: string;
  }) => Promise<{ connections: unknown }>,
  householdId: string,
) {
  const response = await listConnections({
    provider: "polp",
    householdId,
  });
  return readHydratedPolpSyncResources(response.connections);
}

export function resolveExistingPolpConnectView(input: {
  completionPhase: OpenFinancePolpCompletionPhase;
  completionResources: OpenFinancePolpCompletedResource[];
  hydratedResources: OpenFinancePolpCompletedResource[];
  hydrationLoading?: boolean;
}) {
  const live = input.completionPhase === "completed" ? input.completionResources : [];
  const resources = live.length ? live : input.hydratedResources;
  const showExistingConnection = resources.length > 0;
  return {
    resources,
    showExistingConnection,
    syncCompletionPhase: (showExistingConnection ? "completed" : input.completionPhase) as OpenFinancePolpCompletionPhase,
    showStartForm: !showExistingConnection && !input.hydrationLoading,
    showHydrationLoading: !showExistingConnection && Boolean(input.hydrationLoading),
  };
}
