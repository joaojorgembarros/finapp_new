import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { OpenFinancePolpCompletedResource } from "./open-finance-polp-completion";
import {
  fetchHydratedPolpSyncResources,
  readHydratedPolpSyncResources,
  resolveExistingPolpConnectView,
} from "./open-finance-polp-hydrate";
import { readEligiblePolpSyncConnections, readPolpSyncContext } from "./open-finance-polp-sync";

const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";
const ACCOUNT_ID = "account-1";
const CARD_ID = "card-1";
const MONTH_KEY = "2026-08";

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    provider: "polp",
    status: "connected",
    resourceType: "account",
    accountName: "Conta corrente",
    accountMask: "**** 1234",
    institution: { displayName: "Banco Exemplo PF", name: "Banco Exemplo" },
    ...overrides,
  };
}

function completedResource(
  key: string,
  type: "account" | "credit_card",
): OpenFinancePolpCompletedResource {
  return {
    key,
    type,
    title: type === "credit_card" ? "Cartão de crédito" : "Conta bancária",
    name: type === "credit_card" ? "Cartão Gold" : "Conta corrente",
    mask: null,
  };
}

describe("existing Polp connection hydration", () => {
  it("maps connected account and credit_card without requiring consentId", () => {
    const resources = readHydratedPolpSyncResources([
      connection(),
      connection({
        id: CARD_ID,
        resourceType: "credit_card",
        accountName: "Cartão Gold",
        accountMask: "**** 4242",
      }),
    ]);

    expect(resources).toEqual([
      {
        key: ACCOUNT_ID,
        type: "account",
        title: "Conta bancária",
        name: "Conta corrente",
        mask: "**** 1234",
      },
      {
        key: CARD_ID,
        type: "credit_card",
        title: "Cartão de crédito",
        name: "Cartão Gold",
        mask: "**** 4242",
      },
    ]);
  });

  it("lifts resourceType from rawPayload when the public field is missing", () => {
    const resources = readHydratedPolpSyncResources([
      connection({
        resourceType: undefined,
        rawPayload: { resourceType: "account" },
      }),
    ]);
    expect(resources).toHaveLength(1);
    expect(resources[0]?.type).toBe("account");
  });

  it("dedupes by connection id and ignores ineligible rows", () => {
    const resources = readHydratedPolpSyncResources([
      connection(),
      connection({ accountName: "Conta duplicada" }),
      connection({ id: "pluggy-1", provider: "pluggy" }),
      connection({ id: "disconnected-1", status: "disconnected" }),
      connection({ id: "error-1", status: "error" }),
      connection({ id: "consent-placeholder", resourceType: "consent" }),
      connection({
        id: CARD_ID,
        resourceType: "credit_card",
        accountName: null,
      }),
    ]);

    expect(resources.map((item) => item.key)).toEqual([ACCOUNT_ID, CARD_ID]);
    expect(resources[1]).toMatchObject({
      type: "credit_card",
      title: "Cartão de crédito",
      name: "Banco Exemplo PF",
    });
  });

  it("recovers remounted route state from listConnections without start or complete", async () => {
    const listConnections = vi.fn(async (request: { provider: "polp"; householdId: string }) => {
      expect(request).toEqual({ provider: "polp", householdId: HOUSEHOLD_ID });
      return {
        connections: [
          connection(),
          connection({
            id: CARD_ID,
            resourceType: "credit_card",
            accountName: "Cartão Gold",
          }),
        ],
      };
    });
    const startConnection = vi.fn();
    const completeConnection = vi.fn();
    const syncMonth = vi.fn();

    const hydrated = await fetchHydratedPolpSyncResources(listConnections, HOUSEHOLD_ID);
    const view = resolveExistingPolpConnectView({
      completionPhase: "idle",
      completionResources: [],
      hydratedResources: hydrated,
      hydrationLoading: false,
    });
    const syncContext = readPolpSyncContext({
      completionPhase: view.syncCompletionPhase,
      householdId: HOUSEHOLD_ID,
      monthKey: MONTH_KEY,
      connections: view.resources,
    });

    expect(view.showExistingConnection).toBe(true);
    expect(view.showStartForm).toBe(false);
    expect(view.syncCompletionPhase).toBe("completed");
    expect(readEligiblePolpSyncConnections(view.resources).map((item) => item.type))
      .toEqual(["account", "credit_card"]);
    expect(syncContext?.connections).toHaveLength(2);
    expect(listConnections).toHaveBeenCalledTimes(1);
    expect(startConnection).not.toHaveBeenCalled();
    expect(completeConnection).not.toHaveBeenCalled();
    expect(syncMonth).not.toHaveBeenCalled();
  });

  it("hides the start form while hydration is in flight", () => {
    const view = resolveExistingPolpConnectView({
      completionPhase: "idle",
      completionResources: [],
      hydratedResources: [],
      hydrationLoading: true,
    });
    expect(view.showStartForm).toBe(false);
    expect(view.showHydrationLoading).toBe(true);
    expect(view.showExistingConnection).toBe(false);
  });

  it("prefers live completion resources over hydrated ones", () => {
    const view = resolveExistingPolpConnectView({
      completionPhase: "completed",
      completionResources: [completedResource("live-account", "account")],
      hydratedResources: [completedResource(ACCOUNT_ID, "account"), completedResource(CARD_ID, "credit_card")],
      hydrationLoading: false,
    });
    expect(view.resources.map((item) => item.key)).toEqual(["live-account"]);
    expect(view.showExistingConnection).toBe(true);
  });

  it("keeps the start form when no connected Polp resources exist", () => {
    const view = resolveExistingPolpConnectView({
      completionPhase: "idle",
      completionResources: [],
      hydratedResources: [],
      hydrationLoading: false,
    });
    expect(view.showStartForm).toBe(true);
    expect(view.syncCompletionPhase).toBe("idle");
  });

  it("hides the existing connection after a successful local disconnect", () => {
    const view = resolveExistingPolpConnectView({
      completionPhase: "completed",
      completionResources: [completedResource(ACCOUNT_ID, "account")],
      hydratedResources: [completedResource(ACCOUNT_ID, "account")],
      hydrationLoading: false,
      connectionCleared: true,
    });
    expect(view.showExistingConnection).toBe(false);
    expect(view.showStartForm).toBe(true);
    expect(view.resources).toEqual([]);
    expect(view.syncCompletionPhase).toBe("idle");
  });
});

describe("R10I production boundaries", () => {
  it("hydrates from listConnections only and does not auto-start later steps", () => {
    const hydrateSource = readFileSync(resolve(__dirname, "open-finance-polp-hydrate.ts"), "utf8");
    const hookSource = readFileSync(
      resolve(__dirname, "../hooks/useOpenFinancePolpHydration.ts"),
      "utf8",
    );
    const routeSource = readFileSync(
      resolve(__dirname, "../../app/(app)/open-finance-connect.tsx"),
      "utf8",
    );

    expect(hydrateSource).toContain("listConnections");
    expect(hydrateSource).not.toMatch(/startConnection|completeConnection|syncMonth|consentId/);
    expect(hookSource).toContain("client.listConnections");
    expect(hookSource).not.toMatch(/startConnection|completeConnection|syncMonth|sync\.start/);
    expect(hookSource).not.toMatch(/console\.(log|error|info|debug)/);
    expect(routeSource).toContain("useOpenFinancePolpHydration");
    expect(routeSource).toContain("resolveExistingPolpConnectView");
    expect(routeSource).toContain("existingView.showStartForm");
    expect(routeSource).toContain("existingView.showExistingConnection");
    expect(routeSource).not.toMatch(/\buseEffect\b/);
    expect(routeSource).toContain("await authorization.start({");
    expect(routeSource).toContain("onPress={() => void (completion.phase === \"error\" ? completion.retry() : completion.complete())}");
    expect(routeSource).toContain("onPress={() => void sync.start()}");
    expect(routeSource.match(/sync\.start\(/g)?.length).toBe(2);
  });
});
