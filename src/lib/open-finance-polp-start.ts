import type {
  OpenFinanceListInstitutionsResponse,
  OpenFinancePolpCreateConnectionRequest,
  OpenFinancePolpInstitutionListItem,
  OpenFinancePolpProduct,
  OpenFinancePolpStartConnectionResponse,
  OpenFinanceStartConnectionResponse,
} from "./open-finance-contract";

export type OpenFinancePolpStartErrorCode =
  | "MISSING_HOUSEHOLD"
  | "INVALID_INSTITUTION"
  | "INVALID_CPF"
  | "INVALID_CNPJ"
  | "START_IN_PROGRESS"
  | "START_FAILED"
  | "INSTITUTIONS_FAILED";

export class OpenFinancePolpStartError extends Error {
  readonly code: OpenFinancePolpStartErrorCode;

  constructor(code: OpenFinancePolpStartErrorCode, message: string) {
    super(message);
    this.name = "OpenFinancePolpStartError";
    this.code = code;
  }
}

export type OpenFinancePolpStartInput = {
  householdId: string | null | undefined;
  institutionId: string;
  cpf: string;
  cnpj?: string | null;
  products?: OpenFinancePolpProduct[];
};

export type OpenFinancePolpStartDependencies = {
  listInstitutions: (input: { provider: "polp" }) => Promise<OpenFinanceListInstitutionsResponse>;
  startConnection: (
    request: OpenFinancePolpCreateConnectionRequest,
  ) => Promise<OpenFinanceStartConnectionResponse>;
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizePolpCpf(value: string) {
  const digits = digitsOnly(value);
  if (!digits || digits.length !== 11) {
    throw new OpenFinancePolpStartError("INVALID_CPF", "Informe um CPF com 11 dígitos.");
  }
  return digits;
}

export function normalizeOptionalPolpCnpj(value?: string | null) {
  if (value == null || value.trim() === "") return undefined;
  const digits = digitsOnly(value);
  if (digits.length !== 14) {
    throw new OpenFinancePolpStartError("INVALID_CNPJ", "Informe um CNPJ com 14 dígitos.");
  }
  return digits;
}

export function requirePolpInstitutionId(value: string) {
  const institutionId = value.trim();
  if (!institutionId) {
    throw new OpenFinancePolpStartError("INVALID_INSTITUTION", "Selecione uma instituição.");
  }
  return institutionId;
}

export function requireAuthenticatedHouseholdId(value: string | null | undefined) {
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenFinancePolpStartError(
      "MISSING_HOUSEHOLD",
      "Não foi possível identificar o household autenticado.",
    );
  }
  return value.trim();
}

export function toSafeOpenFinancePolpStartMessage(error: unknown) {
  if (error instanceof OpenFinancePolpStartError) return error.message;
  return "Não foi possível concluir a operação Open Finance.";
}

export function createOpenFinancePolpStartGate() {
  let starting = false;

  return {
    get starting() {
      return starting;
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (starting) {
        throw new OpenFinancePolpStartError(
          "START_IN_PROGRESS",
          "A conexão já está sendo iniciada.",
        );
      }
      starting = true;
      try {
        return await operation();
      } finally {
        starting = false;
      }
    },
  };
}

export async function loadOpenFinancePolpInstitutions(
  deps: Pick<OpenFinancePolpStartDependencies, "listInstitutions">,
): Promise<OpenFinancePolpInstitutionListItem[]> {
  try {
    const response = await deps.listInstitutions({ provider: "polp" });
    return response.institutions ?? [];
  } catch (error) {
    throw new OpenFinancePolpStartError(
      "INSTITUTIONS_FAILED",
      toSafeOpenFinancePolpStartMessage(error),
    );
  }
}

export async function startOpenFinancePolpConnection(
  input: OpenFinancePolpStartInput,
  deps: Pick<OpenFinancePolpStartDependencies, "startConnection">,
  gate = createOpenFinancePolpStartGate(),
): Promise<OpenFinancePolpStartConnectionResponse> {
  const householdId = requireAuthenticatedHouseholdId(input.householdId);
  const institutionId = requirePolpInstitutionId(input.institutionId);
  const cpf = normalizePolpCpf(input.cpf);
  const cnpj = normalizeOptionalPolpCnpj(input.cnpj);
  const products = input.products && input.products.length > 0 ? input.products : undefined;

  return gate.run(async () => {
    try {
      const response = await deps.startConnection({
        provider: "polp",
        householdId,
        institutionId,
        cpf,
        ...(cnpj ? { cnpj } : {}),
        ...(products ? { products } : {}),
      });
      if (response.provider !== "polp") {
        throw new OpenFinancePolpStartError(
          "START_FAILED",
          "A Edge Open Finance retornou um provider incompatível.",
        );
      }
      return response;
    } catch (error) {
      if (error instanceof OpenFinancePolpStartError) throw error;
      throw new OpenFinancePolpStartError(
        "START_FAILED",
        toSafeOpenFinancePolpStartMessage(error),
      );
    }
  });
}

export function createOpenFinancePolpStartController(deps: OpenFinancePolpStartDependencies) {
  const gate = createOpenFinancePolpStartGate();

  return {
    get starting() {
      return gate.starting;
    },
    loadInstitutions() {
      return loadOpenFinancePolpInstitutions(deps);
    },
    startConnection(input: OpenFinancePolpStartInput) {
      return startOpenFinancePolpConnection(input, deps, gate);
    },
  };
}
