import {
  buildOpenFinanceTransactionFingerprint,
  isOpenFinanceDate,
  type OpenFinanceConnectionStatus,
  type OpenFinanceConsentStatus,
  type OpenFinancePolpInstitution,
  type OpenFinanceTransactionDirection,
} from "../../../src/lib/open-finance-contract";

export const POLP_PROVIDER = "polp" as const;

export type JsonObject = Record<string, unknown>;

export type NormalizedPolpConsent = {
  externalConsentId: string;
  institutionId: string;
  providerStatus: "AWAITING_AUTHORIZATION" | "AUTHORISED" | "REJECTED" | "EXPIRED";
  executionStatus: "AWAITING_RESOURCES" | "SUCCESS" | "PARTIAL_SUCCESS" | null;
  resourcesReady: boolean;
  flags: string[];
  hasProviderError: boolean;
  status: OpenFinanceConsentStatus;
  connectionStatus: OpenFinanceConnectionStatus;
  grantedAt: string;
  expiresAt: null;
  authorizationUrl: string | null;
  authorizationExpiresAt: string | null;
  products: string[];
  rawPayload: JsonObject;
};

export type NormalizedPolpResource = {
  resourceType: "account" | "credit_card";
  externalAccountId: string;
  externalConsentId: string;
  accountName: string;
  accountMask: string;
  type: string;
  subtype: string | null;
  currency: string | null;
  rawPayload: JsonObject;
};

export type NormalizedPolpBill = {
  id: string;
  creditCardId: string;
  dueDate: string;
  closingDate: string;
  minimumAmountCents: number | null;
  totalAmountCents: number | null;
  currency: string | null;
};

export type NormalizedPolpTransaction = {
  externalTransactionId: string;
  externalAccountId: string;
  description: string;
  amountCents: number;
  direction: OpenFinanceTransactionDirection;
  occurredOn: string;
  postedAt: string;
  fingerprint: string;
  rawPayload: JsonObject;
};

const SENSITIVE_KEYS = new Set([
  "access_token",
  "account_number",
  "authorization",
  "authorization_url",
  "check_digit",
  "client_secret",
  "cliente_user_id",
  "cnpj",
  "cpf",
  "documents",
  "identification_number",
  "number",
  "partie_branch_code",
  "partie_check_digit",
  "partie_cnpj_cpf",
  "partie_number",
  "password",
  "secret",
  "signature",
  "tax_id",
  "token",
  "url_to_authenticate",
]);

const KNOWN_CONSENT_PRODUCTS = new Set([
  "ACCOUNT",
  "CREDIT_CARD_ACCOUNT",
  "CREDIT_OPERATIONS",
  "INVESTMENTS",
  "EXCHANGE",
  "LOAN",
  "FINANCING",
  "UNARRANGED_ACCOUNT_OVERDRAFT",
  "INVOICE_FINANCING",
  "BANK_FIXED_INCOME",
  "CREDIT_FIXED_INCOME",
  "VARIABLE_INCOME",
  "TREASURE_TITLE",
  "FUND",
]);

const CONSENT_RAW_FIELDS = new Set([
  "id",
  "institution_id",
  "status",
  "status_label",
  "execution_status",
  "execution_status_label",
  "flags",
  "products",
  "products_label",
  "created_at",
  "updated_at",
]);
const ACCOUNT_RAW_FIELDS = new Set([
  "id",
  "consent_id",
  "type",
  "compe_code",
  "subtype",
  "currency",
  "balance",
  "overdraft_limit",
  "created_at",
  "updated_at",
]);
const CREDIT_CARD_RAW_FIELDS = new Set([
  "id",
  "consent_id",
  "name",
  "credit_card_network",
  "product_type",
  "product_additional_info",
  "network_additional_info",
  "limits",
  "simulated_bill_total_amount",
  "created_at",
  "updated_at",
]);
const TRANSACTION_RAW_FIELDS = new Set([
  "id",
  "account_id",
  "credit_card_id",
  "transaction_name",
  "transaction_date_time",
  "type",
  "completed_authorised_payment_type",
  "credit_debit_type",
  "transaction_type",
  "type_additional_info",
  "transaction_amount",
  "brazilian_amount",
  "amount",
  "bill_post_date",
  "bill_forecast_date",
  "bill_id",
  "charge_identificator",
  "charge_number",
  "category_ref",
  "created_at",
  "updated_at",
]);

export function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required.`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeKey(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function sanitizeProviderPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => sanitizeProviderPayload(item, depth + 1));
  }

  const object = asObject(value);
  if (!object) return null;

  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => !SENSITIVE_KEYS.has(sanitizeKey(key)))
      .map(([key, item]) => [key, sanitizeProviderPayload(item, depth + 1)]),
  );
}

function sanitizedObject(value: unknown): JsonObject {
  return asObject(sanitizeProviderPayload(value)) ?? {};
}

function whitelistedProviderPayload(value: unknown, allowedFields: Set<string>): JsonObject {
  const object = asObject(value);
  if (!object) return {};
  return sanitizedObject(Object.fromEntries(
    Object.entries(object).filter(([key]) => allowedFields.has(key)),
  ));
}

function normalizeAuthorizationUrl(value: unknown): string | null {
  const raw = optionalString(value);
  if (!raw) return null;
  if (raw.length > 4_096) throw new TypeError("Polp authorization URL is too long.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Polp authorization URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new TypeError("Polp authorization URL must be an HTTPS URL without credentials.");
  }
  return url.toString();
}

function normalizeTimestamp(value: unknown): string | null {
  const raw = optionalString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function civilDateFromTimestamp(value: unknown): string | null {
  const raw = optionalString(value);
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(raw);
  const civilDate = match?.[1] ?? null;

  if (!civilDate || !isOpenFinanceDate(civilDate)) return null;
  if (raw !== civilDate && !normalizeTimestamp(raw)) return null;
  return civilDate;
}

function digitsMask(...values: unknown[]) {
  const digits = values
    .map((value) => optionalString(value) ?? "")
    .join("")
    .replace(/\D/g, "");
  const lastFour = digits.slice(-4);
  return lastFour ? `**** ${lastFour}` : "****";
}

function normalizeDescription(value: unknown): string | null {
  const raw = optionalString(value);
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function parseCurrencyAmount(value: unknown, requirePositive = true): number | null {
  const amount = asObject(value);
  if (!amount) return null;

  const currency = optionalString(amount.currency)?.toUpperCase();
  const raw = amount.amount;
  if (currency !== "BRL" || typeof raw !== "string") return null;

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!match) return null;

  const whole = BigInt(match[2]);
  const fractionDigits = match[3] ?? "";
  if (fractionDigits.length > 2 && /[^0]/.test(fractionDigits.slice(2))) return null;
  const fraction = BigInt(fractionDigits.slice(0, 2).padEnd(2, "0"));
  const signed = (whole * 100n + fraction) * (match[1] === "-" ? -1n : 1n);
  const absolute = signed < 0n ? -signed : signed;

  if ((requirePositive && absolute === 0n) || absolute > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  return Number(requirePositive ? absolute : signed);
}

function normalizeDirection(value: unknown): OpenFinanceTransactionDirection | null {
  const indicator = optionalString(value)?.toUpperCase();
  if (indicator === "CREDITO" || indicator === "CREDIT") return "income";
  if (indicator === "DEBITO" || indicator === "DEBIT") return "expense";
  return null;
}

export function normalizePolpInstitution(value: unknown): OpenFinancePolpInstitution {
  const institution = asObject(value);
  if (!institution) throw new TypeError("Invalid Polp institution payload.");

  const id = requiredString(institution.id, "institution.id");
  const name = requiredString(institution.name, "institution.name");

  return {
    id,
    name,
    displayName: name,
    provider: POLP_PROVIDER,
    connectorId: null,
  };
}

export function normalizePolpConsent(value: unknown): NormalizedPolpConsent {
  const consent = asObject(value);
  if (!consent) throw new TypeError("Invalid Polp consent payload.");

  const externalConsentId = requiredString(consent.id, "consent.id");
  const institutionId = requiredString(consent.institution_id, "consent.institution_id");
  const providerStatus = requiredString(consent.status, "consent.status");
  const executionStatusValue = optionalString(consent.execution_status);
  if (
    executionStatusValue !== null
    && executionStatusValue !== "AWAITING_RESOURCES"
    && executionStatusValue !== "SUCCESS"
    && executionStatusValue !== "PARTIAL_SUCCESS"
  ) {
    throw new TypeError(`Unsupported Polp consent execution status: ${executionStatusValue}.`);
  }
  const executionStatus = executionStatusValue as NormalizedPolpConsent["executionStatus"];
  const resourcesReady = providerStatus === "AUTHORISED"
    && (executionStatus === "SUCCESS" || executionStatus === "PARTIAL_SUCCESS");

  let status: OpenFinanceConsentStatus;
  let connectionStatus: OpenFinanceConnectionStatus;
  switch (providerStatus) {
    case "AUTHORISED":
      status = "active";
      connectionStatus = resourcesReady ? "connected" : "error";
      break;
    case "AWAITING_AUTHORIZATION":
      status = "expiring";
      connectionStatus = "error";
      break;
    case "EXPIRED":
      status = "expired";
      connectionStatus = "disconnected";
      break;
    case "REJECTED":
      status = "revoked";
      connectionStatus = "disconnected";
      break;
    default:
      throw new TypeError(`Unsupported Polp consent status: ${providerStatus}.`);
  }

  const grantedAt = normalizeTimestamp(consent.updated_at ?? consent.created_at);
  if (!grantedAt) throw new TypeError("consent.created_at/updated_at is invalid.");

  const products = asArray(consent.products)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => KNOWN_CONSENT_PRODUCTS.has(item));
  const flags = asArray(consent.flags)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 128)
    .slice(0, 32);

  return {
    externalConsentId,
    institutionId,
    providerStatus: providerStatus as NormalizedPolpConsent["providerStatus"],
    executionStatus,
    resourcesReady,
    flags,
    hasProviderError: asObject(consent.error) !== null,
    status,
    connectionStatus,
    grantedAt,
    expiresAt: null,
    authorizationUrl: normalizeAuthorizationUrl(consent.url_to_authenticate),
    authorizationExpiresAt: normalizeTimestamp(consent.url_to_authenticate_expires_at),
    products,
    rawPayload: whitelistedProviderPayload(consent, CONSENT_RAW_FIELDS),
  };
}

export function normalizePolpAccount(
  value: unknown,
  expectedConsentId?: string,
): NormalizedPolpResource {
  const account = asObject(value);
  if (!account) throw new TypeError("Invalid Polp account payload.");

  const externalAccountId = requiredString(account.id, "account.id");
  const externalConsentId = requiredString(account.consent_id, "account.consent_id");
  if (expectedConsentId && externalConsentId !== expectedConsentId) {
    throw new TypeError("Account belongs to a different consent.");
  }
  const type = requiredString(account.type, "account.type");
  const subtype = optionalString(account.subtype);
  const currency = optionalString(account.currency)?.toUpperCase() ?? null;
  const accountName = subtype?.replaceAll("_", " ") ?? type.replaceAll("_", " ");

  return {
    resourceType: "account",
    externalAccountId,
    externalConsentId,
    accountName,
    accountMask: digitsMask(account.number, account.check_digit),
    type,
    subtype,
    currency,
    rawPayload: whitelistedProviderPayload(account, ACCOUNT_RAW_FIELDS),
  };
}

export function normalizePolpCreditCard(
  value: unknown,
  expectedConsentId?: string,
): NormalizedPolpResource {
  const card = asObject(value);
  if (!card) throw new TypeError("Invalid Polp credit card payload.");

  const externalAccountId = requiredString(card.id, "credit_card.id");
  const externalConsentId = requiredString(card.consent_id, "credit_card.consent_id");
  if (expectedConsentId && externalConsentId !== expectedConsentId) {
    throw new TypeError("Credit card belongs to a different consent.");
  }
  const accountName = requiredString(card.name, "credit_card.name");
  const paymentMethod = asObject(asArray(card.payment_methods)[0]);

  return {
    resourceType: "credit_card",
    externalAccountId,
    externalConsentId,
    accountName,
    accountMask: digitsMask(
      paymentMethod?.identification_number,
      paymentMethod?.number,
      card.identification_number,
    ),
    type: "CREDIT_CARD_ACCOUNT",
    subtype: optionalString(card.product_type),
    currency: null,
    rawPayload: whitelistedProviderPayload(card, CREDIT_CARD_RAW_FIELDS),
  };
}

export function normalizePolpBill(value: unknown, expectedCreditCardId?: string): NormalizedPolpBill {
  const bill = asObject(value);
  if (!bill) throw new TypeError("Invalid Polp bill payload.");

  const minimum = asObject(bill.bill_minimum_amount);
  const total = asObject(bill.bill_total_amount);
  const dueDate = civilDateFromTimestamp(bill.due_date);
  const closingDate = civilDateFromTimestamp(bill.bill_closing_date);
  const creditCardId = requiredString(bill.credit_card_id, "bill.credit_card_id");

  if (!dueDate || !closingDate) throw new TypeError("Invalid Polp bill date.");
  if (expectedCreditCardId && creditCardId !== expectedCreditCardId) {
    throw new TypeError("Bill belongs to a different credit card.");
  }

  return {
    id: requiredString(bill.id, "bill.id"),
    creditCardId,
    dueDate,
    closingDate,
    minimumAmountCents: parseCurrencyAmount(minimum, false),
    totalAmountCents: parseCurrencyAmount(total, false),
    currency: optionalString(total?.currency ?? minimum?.currency)?.toUpperCase() ?? null,
  };
}

export function normalizePolpTransaction(input: {
  value: unknown;
  resourceType: "account" | "credit_card";
  internalConnectionId: string;
  externalConnectionId: string | null;
  expectedExternalAccountId: string;
  expectedBillId?: string;
}): NormalizedPolpTransaction {
  const transaction = asObject(input.value);
  if (!transaction) throw new TypeError("Invalid Polp transaction payload.");

  const externalTransactionId = requiredString(transaction.id, "transaction.id");
  const externalAccountId = requiredString(
    input.resourceType === "account" ? transaction.account_id : transaction.credit_card_id,
    input.resourceType === "account" ? "transaction.account_id" : "transaction.credit_card_id",
  );

  if (externalAccountId !== input.expectedExternalAccountId) {
    throw new TypeError("Transaction belongs to a different external account.");
  }
  if (
    input.expectedBillId
    && requiredString(transaction.bill_id, "transaction.bill_id") !== input.expectedBillId
  ) {
    throw new TypeError("Transaction belongs to a different bill.");
  }

  const description = normalizeDescription(transaction.transaction_name);
  const occurredOn = civilDateFromTimestamp(transaction.transaction_date_time);
  const postedAt = normalizeTimestamp(transaction.transaction_date_time);
  const direction = normalizeDirection(transaction.credit_debit_type);
  const amountCents = parseCurrencyAmount(
    input.resourceType === "account"
      ? transaction.transaction_amount
      : transaction.brazilian_amount,
  );

  if (!description) throw new TypeError("Transaction description is required.");
  if (!occurredOn || !postedAt) throw new TypeError("Transaction date is invalid.");
  if (!direction) throw new TypeError("Transaction direction is invalid.");
  if (!amountCents) throw new TypeError("Transaction amount is invalid or not BRL.");

  return {
    externalTransactionId,
    externalAccountId,
    description,
    amountCents,
    direction,
    occurredOn,
    postedAt,
    fingerprint: buildOpenFinanceTransactionFingerprint({
      provider: POLP_PROVIDER,
      internalConnectionId: input.internalConnectionId,
      externalConnectionId: input.externalConnectionId,
      externalAccountId,
      externalTransactionId,
      occurredOn,
      amountCents,
    }),
    rawPayload: whitelistedProviderPayload(transaction, TRANSACTION_RAW_FIELDS),
  };
}
