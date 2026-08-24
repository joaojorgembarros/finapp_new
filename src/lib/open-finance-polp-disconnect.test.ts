import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { OpenFinanceClientError } from "./open-finance-client";
import type { OpenFinancePolpCompletedResource } from "./open-finance-polp-completion";
import {
  POLP_DISCONNECT_CONFIRMATION,
  canStartPolpDisconnect,
  createOpenFinancePolpDisconnectController,
  readPolpDisconnectConnectionId,
} from "./open-finance-polp-disconnect";

const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";
const CONNECTION_ID = "a30e8400-e29b-41d4-a716-446655440030";

function resource(key: string): OpenFinancePolpCompletedResource {
  return {
    key,
    type: "account",
    title: "Conta bancária",
    name: "Conta corrente",
    mask: "**** 1234",
  };
}

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe("Polp disconnect target and confirmation", () => {
  it("uses the first connected resource id and does not invent history deletion", () => {
    expect(readPolpDisconnectConnectionId([
      resource(CONNECTION_ID),
      resource("second-connection"),
    ])).toBe(CONNECTION_ID);
    expect(readPolpDisconnectConnectionId([])).toBeNull();
    expect(POLP_DISCONNECT_CONFIRMATION.message).toContain("interrompe futuras sincronizações");
    expect(POLP_DISCONNECT_CONFIRMATION.message).toContain("permanecem no app");
    expect(POLP_DISCONNECT_CONFIRMATION.message).not.toMatch(/excluir|apagar|deletar/i);
  });

  it("blocks start while disconnecting, disconnected, or missing ids", () => {
    const ready = {
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
      phase: "idle" as const,
    };
    expect(canStartPolpDisconnect(ready)).toBe(true);
    expect(canStartPolpDisconnect({ ...ready, phase: "error" })).toBe(true);
    expect(canStartPolpDisconnect({ ...ready, phase: "disconnecting" })).toBe(false);
    expect(canStartPolpDisconnect({ ...ready, phase: "disconnected" })).toBe(false);
    expect(canStartPolpDisconnect({ ...ready, blocked: true })).toBe(false);
    expect(canStartPolpDisconnect({ ...ready, householdId: null })).toBe(false);
    expect(canStartPolpDisconnect({ ...ready, connectionId: null })).toBe(false);
  });
});

describe("Polp disconnect controller", () => {
  it("reuses disconnectConnection once and ignores a second in-flight start", async () => {
    const pending = createDeferred<{ success: true; consentId: string; disconnectedItemId: string | null }>();
    const disconnectConnection = vi.fn(() => pending.promise);
    const controller = createOpenFinancePolpDisconnectController({ disconnectConnection });

    const first = controller.start({
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
    });
    const second = await controller.start({
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
    });

    expect(controller.snapshot.phase).toBe("disconnecting");
    expect(controller.snapshot.canStart).toBe(false);
    expect(second).toBe(false);
    expect(disconnectConnection).toHaveBeenCalledTimes(1);
    expect(disconnectConnection).toHaveBeenCalledWith({
      provider: "polp",
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
    });

    pending.resolve({
      success: true,
      consentId: "consent-1",
      disconnectedItemId: "consent-1",
    });
    await expect(first).resolves.toBe(true);
    expect(controller.snapshot.phase).toBe("disconnected");
    expect(controller.snapshot.canStart).toBe(false);
    expect(await controller.start({
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
    })).toBe(false);
    expect(disconnectConnection).toHaveBeenCalledTimes(1);
  });

  it("keeps the local connection on error and allows retry", async () => {
    const disconnectConnection = vi.fn()
      .mockRejectedValueOnce(new OpenFinanceClientError("Falha segura.", "PROVIDER_ERROR", 502))
      .mockResolvedValueOnce({
        success: true,
        consentId: "consent-1",
        disconnectedItemId: "consent-1",
      });
    const controller = createOpenFinancePolpDisconnectController({ disconnectConnection });

    await expect(controller.start({
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
    })).resolves.toBe(false);

    expect(controller.snapshot.phase).toBe("error");
    expect(controller.snapshot.errorMessage).toBe("Falha segura.");
    expect(controller.snapshot.canStart).toBe(true);

    await expect(controller.start({
      householdId: HOUSEHOLD_ID,
      connectionId: CONNECTION_ID,
    })).resolves.toBe(true);
    expect(controller.snapshot.phase).toBe("disconnected");
    expect(disconnectConnection).toHaveBeenCalledTimes(2);
  });

  it("does not start without household or connection ids", async () => {
    const disconnectConnection = vi.fn();
    const controller = createOpenFinancePolpDisconnectController({ disconnectConnection });
    await expect(controller.start({ householdId: null, connectionId: CONNECTION_ID })).resolves.toBe(false);
    await expect(controller.start({ householdId: HOUSEHOLD_ID, connectionId: null })).resolves.toBe(false);
    expect(disconnectConnection).not.toHaveBeenCalled();
    expect(controller.snapshot.phase).toBe("idle");
  });
});

describe("Polp disconnect production boundaries", () => {
  it("reuses the existing client disconnect and keeps the route confirmation local", () => {
    const libSource = readFileSync(resolve(__dirname, "open-finance-polp-disconnect.ts"), "utf8");
    const hookSource = readFileSync(
      resolve(__dirname, "../hooks/useOpenFinancePolpDisconnect.ts"),
      "utf8",
    );
    const routeSource = readFileSync(
      resolve(__dirname, "../../app/(app)/open-finance-connect.tsx"),
      "utf8",
    );
    const importSource = readFileSync(
      resolve(__dirname, "../../app/(app)/import-extract.tsx"),
      "utf8",
    );

    expect(hookSource).toContain("client.disconnectConnection");
    expect(libSource).toContain("disconnectConnection");
    expect(libSource).not.toMatch(/revokeConsent|deleteTransaction|imported_bank_transactions/);
    expect(libSource).not.toMatch(/AsyncStorage|SecureStore|fetch\s*\(|console\./);
    expect(routeSource).toContain("useOpenFinancePolpDisconnect");
    expect(routeSource).toContain("Alert.alert");
    expect(routeSource).toContain("POLP_DISCONNECT_CONFIRMATION");
    expect(routeSource).toContain("Desconectar instituição");
    expect(routeSource).not.toMatch(/\buseEffect\b/);
    expect(importSource).toContain("open-finance-connect");
    expect(importSource).toContain("CSV");
    expect(importSource).toContain("Excel (.xlsx)");
    expect(importSource).toContain("PDF");
    expect(importSource).toContain("import-csv");
  });

  it("does not wire Open Finance from unrelated existing flows", () => {
    for (const relativePath of [
      "../../app/(app)/journey.tsx",
      "../../app/(app)/new-transaction.tsx",
      "../../app/(app)/link-commitment.tsx",
    ]) {
      const source = readFileSync(resolve(__dirname, relativePath), "utf8");
      expect(source).not.toContain("open-finance-connect");
    }
  });
});
