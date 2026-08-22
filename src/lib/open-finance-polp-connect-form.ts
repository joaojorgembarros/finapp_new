import type { OpenFinancePolpInstitutionListItem } from "./open-finance-contract";
import {
  OpenFinancePolpStartError,
  normalizePolpCpf,
  requirePolpInstitutionId,
} from "./open-finance-polp-start";

export type OpenFinanceConnectHouseholdGate = "loading" | "missing" | "ready";

export type OpenFinanceConnectInstitutionOption = {
  id: string;
  label: string;
  logoUrl: string | null;
};

export type OpenFinanceConnectSubmitResult =
  | {
      ok: true;
      institutionId: string;
    }
  | {
      ok: false;
      institutionError: string | null;
      cpfError: string | null;
    };

const CPF_FIELD_ERROR = "Informe um CPF com 11 dígitos.";
const INSTITUTION_FIELD_ERROR = "Selecione um banco.";

export function formatPolpCpfMask(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  const part1 = digits.slice(0, 3);
  const part2 = digits.slice(3, 6);
  const part3 = digits.slice(6, 9);
  const part4 = digits.slice(9, 11);
  if (digits.length <= 3) return part1;
  if (digits.length <= 6) return `${part1}.${part2}`;
  if (digits.length <= 9) return `${part1}.${part2}.${part3}`;
  return `${part1}.${part2}.${part3}-${part4}`;
}

export function isPolpCpfReady(value: string) {
  try {
    normalizePolpCpf(value);
    return true;
  } catch {
    return false;
  }
}

export function polpCpfFieldError(value: string, visible: boolean) {
  if (!visible) return null;
  try {
    normalizePolpCpf(value);
    return null;
  } catch (error) {
    if (error instanceof OpenFinancePolpStartError) return error.message;
    return CPF_FIELD_ERROR;
  }
}

export function resolveConnectHouseholdGate(
  householdLoading: boolean,
  householdId: string | null | undefined,
): OpenFinanceConnectHouseholdGate {
  if (householdLoading) return "loading";
  if (typeof householdId !== "string" || !householdId.trim()) return "missing";
  return "ready";
}

export function connectHouseholdMessage(gate: OpenFinanceConnectHouseholdGate) {
  if (gate === "loading") return "Estamos preparando sua conta para continuar.";
  if (gate === "missing") return "Não foi possível identificar sua conta. Volte e tente novamente.";
  return null;
}

export function isSafeInstitutionLogoUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return value;
  } catch {
    return null;
  }
}

export function toConnectInstitutionOption(
  item: OpenFinancePolpInstitutionListItem,
): OpenFinanceConnectInstitutionOption {
  const label = (item.displayName || item.name).trim() || "Instituição";
  return {
    id: item.id,
    label,
    logoUrl: isSafeInstitutionLogoUrl(item.logoUrl),
  };
}

export function filterConnectInstitutions(
  options: OpenFinanceConnectInstitutionOption[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  if (!normalized) return options;
  return options.filter((option) => option.label.toLocaleLowerCase("pt-BR").includes(normalized));
}

export function shouldLoadInstitutionsWhenOpeningPicker(input: {
  alreadyRequested: boolean;
  institutionsLoading: boolean;
}) {
  return !input.alreadyRequested && !input.institutionsLoading;
}

export function planInstitutionPickerOpen(input: {
  alreadyRequested: boolean;
  institutionsLoading: boolean;
}) {
  const shouldLoad = shouldLoadInstitutionsWhenOpeningPicker(input);
  return {
    pickerOpen: true as const,
    alreadyRequested: input.alreadyRequested || shouldLoad,
    shouldLoad,
  };
}

export function canSubmitOpenFinanceConnectForm(input: {
  householdLoading: boolean;
  householdId: string | null | undefined;
  institutionId: string | null | undefined;
  cpfInput: string;
}) {
  if (resolveConnectHouseholdGate(input.householdLoading, input.householdId) !== "ready") {
    return false;
  }
  if (!input.institutionId?.trim()) return false;
  return isPolpCpfReady(input.cpfInput);
}

export function submitOpenFinanceConnectForm(input: {
  householdLoading: boolean;
  householdId: string | null | undefined;
  institutionId: string | null | undefined;
  cpfInput: string;
}): OpenFinanceConnectSubmitResult {
  if (resolveConnectHouseholdGate(input.householdLoading, input.householdId) !== "ready") {
    return {
      ok: false,
      institutionError: null,
      cpfError: null,
    };
  }

  let institutionId: string | null = null;
  let institutionError: string | null = null;
  let cpfError: string | null = null;

  try {
    institutionId = requirePolpInstitutionId(input.institutionId ?? "");
  } catch {
    institutionError = INSTITUTION_FIELD_ERROR;
  }

  try {
    normalizePolpCpf(input.cpfInput);
  } catch (error) {
    cpfError = error instanceof OpenFinancePolpStartError ? error.message : CPF_FIELD_ERROR;
  }

  if (institutionError || cpfError || !institutionId) {
    return { ok: false, institutionError, cpfError };
  }

  return { ok: true, institutionId };
}
