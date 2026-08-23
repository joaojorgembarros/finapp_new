import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { OpenFinancePolpInstitutionListItem } from "./open-finance-contract";
import {
  canSubmitOpenFinanceConnectForm,
  connectHouseholdMessage,
  filterConnectInstitutions,
  formatPolpCpfMask,
  isPolpCpfReady,
  isSafeInstitutionLogoUrl,
  planInstitutionPickerOpen,
  polpCpfFieldError,
  resolveConnectHouseholdGate,
  shouldLoadInstitutionsWhenOpeningPicker,
  submitOpenFinanceConnectForm,
  toConnectInstitutionOption,
} from "./open-finance-polp-connect-form";

const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";

const INSTITUTION: OpenFinancePolpInstitutionListItem = {
  id: "institution-1",
  name: "Banco Exemplo",
  displayName: "Banco Exemplo PF",
  provider: "polp",
  connectorId: null,
  description: "raw description",
  logoUrl: "https://cdn.example.test/logo.png",
  status: "OPERATIONAL",
  type: "PERSONAL",
  credentials: ["cpf"],
};

const F3A_FILES = [
  resolve(process.cwd(), "src/lib/open-finance-polp-connect-form.ts"),
  resolve(process.cwd(), "app/(app)/open-finance-connect.tsx"),
];

const EXISTING_UI_FILES = [
  resolve(process.cwd(), "app/(app)/import-extract.tsx"),
  resolve(process.cwd(), "app/(app)/journey.tsx"),
  resolve(process.cwd(), "app/(app)/new-transaction.tsx"),
  resolve(process.cwd(), "app/(app)/link-commitment.tsx"),
];

describe("Open Finance connect route boundary", () => {
  it("registers a dedicated screen without wiring existing navigation", () => {
    const route = readFileSync(F3A_FILES[1], "utf8");
    expect(route).toContain("export default function OpenFinanceConnectScreen");
    expect(route).toContain("useOpenFinancePolpStart");
    expect(route).toContain("useOpenFinancePolpHydration");
    expect(route).toContain("reloadInstitutions");
    expect(route).toContain("startConnection");
    expect(route).not.toMatch(/\buseEffect\b/);
    expect(route).toContain("Tentar novamente");
    for (const file of EXISTING_UI_FILES) {
      expect(readFileSync(file, "utf8")).not.toContain("open-finance-connect");
    }
  });

  it("does not open URLs, persist documents, or call later Open Finance steps", () => {
    const forbidden = [
      "completeOpenFinanceConnection",
      "syncOpenFinanceMonth",
      "complete-connection",
      "sync-month",
      "AsyncStorage",
      "SecureStore",
      "console.log",
      "console.error",
      "POLP_API_SECRET",
      "POLP_API_CLIENT",
      "from \"./banks\"",
      "from \"../lib/banks\"",
    ];
    const formSource = readFileSync(F3A_FILES[0], "utf8");
    expect(["startConnection(", ...forbidden].filter((name) => formSource.includes(name))).toEqual([]);
    expect(formSource).not.toMatch(/fetch\s*\(/);
    const routeSource = readFileSync(F3A_FILES[1], "utf8");
    expect(forbidden.filter((name) => routeSource.includes(name))).toEqual([]);
    expect(routeSource).not.toMatch(/fetch\s*\(/);
  });
});

describe("Open Finance connect institutions", () => {
  it("does not fetch institutions until the picker opens", () => {
    expect(shouldLoadInstitutionsWhenOpeningPicker({
      alreadyRequested: false,
      institutionsLoading: true,
    })).toBe(false);
  });

  it("loads institutions when the picker opens for the first time", () => {
    const first = planInstitutionPickerOpen({
      alreadyRequested: false,
      institutionsLoading: false,
    });
    expect(first).toEqual({
      pickerOpen: true,
      alreadyRequested: true,
      shouldLoad: true,
    });

    const second = planInstitutionPickerOpen({
      alreadyRequested: first.alreadyRequested,
      institutionsLoading: false,
    });
    expect(second.shouldLoad).toBe(false);
    expect(second.alreadyRequested).toBe(true);
  });

  it("maps institutions to visible labels and logos without raw credentials", () => {
    const option = toConnectInstitutionOption(INSTITUTION);
    expect(option).toEqual({
      id: "institution-1",
      label: "Banco Exemplo PF",
      logoUrl: "https://cdn.example.test/logo.png",
    });
    expect(option).not.toHaveProperty("credentials");
    expect(option).not.toHaveProperty("status");
    expect(option).not.toHaveProperty("type");
    expect(isSafeInstitutionLogoUrl("javascript:alert(1)")).toBeNull();
    expect(isSafeInstitutionLogoUrl("http://cdn.example.test/logo.png")).toBeNull();
  });

  it("filters the institution list by visible name", () => {
    const nubs = toConnectInstitutionOption({
      ...INSTITUTION,
      id: "institution-2",
      name: "Nubank",
      displayName: "Nubank",
    });
    const options = [toConnectInstitutionOption(INSTITUTION), nubs];
    expect(filterConnectInstitutions(options, "nuba").map((item) => item.label)).toEqual(["Nubank"]);
    expect(filterConnectInstitutions(options, "  ")).toEqual(options);
  });
});

describe("Open Finance connect CPF and continue", () => {
  it("masks CPF for display and reuses F2 validation", () => {
    expect(formatPolpCpfMask("12345678901")).toBe("123.456.789-01");
    expect(formatPolpCpfMask("123.456")).toBe("123.456");
    expect(isPolpCpfReady("123.456.789-01")).toBe(true);
    expect(isPolpCpfReady("123")).toBe(false);
    expect(polpCpfFieldError("123", false)).toBeNull();
    expect(polpCpfFieldError("123", true)).toBe("Informe um CPF com 11 dígitos.");
    expect(polpCpfFieldError("123", true)).not.toContain("123");
  });

  it("keeps Continue unavailable until household, bank and CPF are ready", () => {
    const valid = {
      householdLoading: false,
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpfInput: "123.456.789-01",
    };
    expect(canSubmitOpenFinanceConnectForm(valid)).toBe(true);
    expect(canSubmitOpenFinanceConnectForm({ ...valid, householdLoading: true })).toBe(false);
    expect(canSubmitOpenFinanceConnectForm({ ...valid, householdId: null })).toBe(false);
    expect(canSubmitOpenFinanceConnectForm({ ...valid, institutionId: "" })).toBe(false);
    expect(canSubmitOpenFinanceConnectForm({ ...valid, cpfInput: "123" })).toBe(false);
  });

  it("validates locally without starting a connection", () => {
    const startConnection = vi.fn();
    const invalid = submitOpenFinanceConnectForm({
      householdLoading: false,
      householdId: HOUSEHOLD_ID,
      institutionId: "",
      cpfInput: "123",
    });
    expect(invalid).toEqual({
      ok: false,
      institutionError: "Selecione um banco.",
      cpfError: "Informe um CPF com 11 dígitos.",
    });
    expect(String(invalid)).not.toContain("123");

    const valid = submitOpenFinanceConnectForm({
      householdLoading: false,
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpfInput: "123.456.789-01",
    });
    expect(valid).toEqual({ ok: true, institutionId: "institution-1" });
    expect(startConnection).not.toHaveBeenCalled();
  });

  it("blocks continue while household is loading or missing without exposing ids", () => {
    expect(resolveConnectHouseholdGate(true, null)).toBe("loading");
    expect(resolveConnectHouseholdGate(false, null)).toBe("missing");
    expect(resolveConnectHouseholdGate(false, HOUSEHOLD_ID)).toBe("ready");
    expect(connectHouseholdMessage("missing")).not.toContain(HOUSEHOLD_ID);
    expect(submitOpenFinanceConnectForm({
      householdLoading: true,
      householdId: HOUSEHOLD_ID,
      institutionId: "institution-1",
      cpfInput: "123.456.789-01",
    }).ok).toBe(false);
  });
});
