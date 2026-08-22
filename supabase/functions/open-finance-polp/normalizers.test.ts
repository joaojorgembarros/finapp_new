import { describe, expect, it } from "vitest";

import {
  normalizePolpAccount,
  normalizePolpBill,
  normalizePolpConsent,
  normalizePolpCreditCard,
  normalizePolpInstitution,
  normalizePolpTransaction,
  sanitizeProviderPayload,
} from "./normalizers";
import {
  ACCOUNT_ID,
  accountFixture,
  accountTransactionFixture,
  authorisedConsentFixture,
  awaitingConsentFixture,
  BILL_ID,
  billFixture,
  CARD_ID,
  cardTransactionFixture,
  CONSENT_ID,
  CONNECTION_ID,
  creditCardFixture,
  INSTITUTION_ID,
  institutionFixture,
} from "./test-fixtures";

const OBSERVED_ACCOUNT_TRANSACTION_TYPES = [
  "BOLETO",
  "CARTAO",
  "DEPOSITO",
  "OPERACAO_CREDITO",
  "OUTROS",
  "PIX",
  "PORTABILIDADE_SALARIO",
  "RESGATE_APLIC_FINANCEIRA",
  "TRANSFERENCIA_MESMA_INSTITUICAO",
] as const;

describe("Polp v2 normalizers", () => {
  it("normalizes institutions to the shared provider-aware contract", () => {
    expect(normalizePolpInstitution(institutionFixture)).toEqual({
      id: INSTITUTION_ID,
      name: "Banco Exemplo Open Finance",
      displayName: "Banco Exemplo Open Finance",
      provider: "polp",
      connectorId: null,
    });
  });

  it("recognizes exact AUTHORISED and preserves the indefinite consent model", () => {
    const awaiting = normalizePolpConsent(awaitingConsentFixture);
    expect(awaiting).toEqual(expect.objectContaining({
      externalConsentId: CONSENT_ID,
      providerStatus: "AWAITING_AUTHORIZATION",
      status: "expiring",
      connectionStatus: "error",
      executionStatus: null,
      resourcesReady: false,
      authorizationUrl: expect.stringContaining("https://auth.example.invalid/"),
      authorizationExpiresAt: "2026-08-21T15:30:00.000Z",
      expiresAt: null,
    }));

    const authorised = normalizePolpConsent(authorisedConsentFixture);
    expect(authorised).toEqual(expect.objectContaining({
      providerStatus: "AUTHORISED",
      status: "active",
      connectionStatus: "connected",
      executionStatus: "SUCCESS",
      resourcesReady: true,
      grantedAt: "2026-08-21T15:05:00.000Z",
      authorizationUrl: null,
      expiresAt: null,
    }));
    expect(authorised.rawPayload).not.toHaveProperty("cliente_user_id");
    expect(awaiting.rawPayload).not.toHaveProperty("url_to_authenticate");
  });

  it("rejects obsolete or misspelled consent states", () => {
    expect(() => normalizePolpConsent({
      ...authorisedConsentFixture,
      status: "AUTHORiSED",
    })).toThrow(/Unsupported Polp consent status/);
  });

  it("accepts only HTTPS authorization URLs without embedded credentials", () => {
    expect(() => normalizePolpConsent({
      ...awaitingConsentFixture,
      url_to_authenticate: "http://auth.example.invalid/consent",
    })).toThrow(/HTTPS URL/);
    expect(() => normalizePolpConsent({
      ...awaitingConsentFixture,
      url_to_authenticate: "https://user:password@auth.example.invalid/consent",
    })).toThrow(/HTTPS URL/);
  });

  it("does not mark AUTHORISED as resource-ready before execution completes", () => {
    const pending = normalizePolpConsent({
      ...authorisedConsentFixture,
      execution_status: "AWAITING_RESOURCES",
      flags: ["ERROR_PROCESSING_CATEGORIES"],
    });
    expect(pending).toEqual(expect.objectContaining({
      providerStatus: "AUTHORISED",
      executionStatus: "AWAITING_RESOURCES",
      resourcesReady: false,
      status: "active",
      connectionStatus: "error",
      flags: ["ERROR_PROCESSING_CATEGORIES"],
    }));

    const partial = normalizePolpConsent({
      ...authorisedConsentFixture,
      execution_status: "PARTIAL_SUCCESS",
    });
    expect(partial).toEqual(expect.objectContaining({
      executionStatus: "PARTIAL_SUCCESS",
      resourcesReady: true,
      connectionStatus: "connected",
    }));
  });

  it("normalizes accounts and cards while retaining only masked identifiers", () => {
    const account = normalizePolpAccount(accountFixture);
    expect(account).toEqual(expect.objectContaining({
      resourceType: "account",
      externalAccountId: ACCOUNT_ID,
      externalConsentId: CONSENT_ID,
      accountName: "INDIVIDUAL",
      accountMask: "**** 4567",
      type: "CONTA_PAGAMENTO_PRE_PAGA",
      subtype: "INDIVIDUAL",
      currency: "BRL",
    }));
    expect(account.rawPayload).not.toHaveProperty("number");
    expect(account.rawPayload).not.toHaveProperty("check_digit");

    const card = normalizePolpCreditCard(creditCardFixture);
    expect(card).toEqual(expect.objectContaining({
      resourceType: "credit_card",
      externalAccountId: CARD_ID,
      externalConsentId: CONSENT_ID,
      accountName: "Cartão Gold Sintético",
      accountMask: "**** 4242",
      type: "CREDIT_CARD_ACCOUNT",
      subtype: "GOLD",
      currency: null,
    }));
    expect(card.rawPayload).toEqual(expect.objectContaining({
      credit_card_network: "MASTERCARD",
      product_type: "GOLD",
      limits: expect.any(Array),
    }));
    expect(JSON.stringify(card.rawPayload)).not.toContain("411111");
  });

  it("rejects provider resources that cross the expected consent/card boundary", () => {
    expect(() => normalizePolpAccount(accountFixture, "different-consent")).toThrow(
      /different consent/,
    );
    expect(() => normalizePolpCreditCard(creditCardFixture, "different-consent")).toThrow(
      /different consent/,
    );
    expect(() => normalizePolpBill(billFixture, "different-card")).toThrow(
      /different credit card/,
    );
  });

  it("normalizes account transaction identity, civil date, cents and direction", () => {
    const transaction = normalizePolpTransaction({
      value: accountTransactionFixture,
      resourceType: "account",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: ACCOUNT_ID,
    });

    expect(transaction).toEqual(expect.objectContaining({
      externalAccountId: ACCOUNT_ID,
      description: "PIX SUPERMERCADO EXEMPLO",
      amountCents: 12345,
      direction: "expense",
      occurredOn: "2026-08-15",
      postedAt: "2026-08-15T13:45:30.000Z",
      fingerprint: expect.stringContaining("open-finance-transaction-fingerprint:v1|"),
    }));
    expect(transaction.rawPayload).not.toHaveProperty("partie_cnpj_cpf");
    expect(transaction.rawPayload).toEqual(expect.objectContaining({
      type: "PIX",
      type_additional_info: "TRANSFERENCIA_SINTETICA",
      category_ref: "PAGAMENTOS",
    }));
  });

  it.each(OBSERVED_ACCOUNT_TRANSACTION_TYPES)(
    "accepts observed account transaction type %s without dropping its classification",
    (type) => {
      const transaction = normalizePolpTransaction({
        value: { ...accountTransactionFixture, type },
        resourceType: "account",
        internalConnectionId: CONNECTION_ID,
        externalConnectionId: CONSENT_ID,
        expectedExternalAccountId: ACCOUNT_ID,
      });

      expect(transaction.rawPayload.type).toBe(type);
    },
  );

  it.each([
    ["0.01", 1],
    ["1.20", 120],
    ["123456.78", 12_345_678],
  ])("converts decimal string amount %s to integer cents", (amount, expectedCents) => {
    const transaction = normalizePolpTransaction({
      value: {
        ...accountTransactionFixture,
        transaction_amount: { amount, currency: "BRL" },
      },
      resourceType: "account",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: ACCOUNT_ID,
    });

    expect(transaction.amountCents).toBe(expectedCents);
  });

  it.each([
    ["CREDITO", "income"],
    ["DEBITO", "expense"],
  ] as const)("maps observed direction %s to %s", (creditDebitType, expectedDirection) => {
    const transaction = normalizePolpTransaction({
      value: { ...accountTransactionFixture, credit_debit_type: creditDebitType },
      resourceType: "account",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: ACCOUNT_ID,
    });

    expect(transaction.direction).toBe(expectedDirection);
  });

  it("normalizes credit-card Brazilian amount without floating point drift", () => {
    const transaction = normalizePolpTransaction({
      value: cardTransactionFixture,
      resourceType: "credit_card",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: CARD_ID,
    });

    expect(transaction).toEqual(expect.objectContaining({
      externalAccountId: CARD_ID,
      amountCents: 8990,
      direction: "expense",
      occurredOn: "2026-08-16",
      postedAt: "2026-08-16T18:20:00.000Z",
    }));
    expect(JSON.stringify(transaction.rawPayload)).not.toContain("411111");
  });

  it.each(["OPERACOES_CREDITO_CONTRATADAS_CARTAO", "PAGAMENTO"])(
    "accepts observed credit-card transaction type %s with nullable forecast/counterparty",
    (transactionType) => {
      const transaction = normalizePolpTransaction({
        value: {
          ...cardTransactionFixture,
          transaction_type: transactionType,
          bill_forecast_date: null,
          counterparty: null,
        },
        resourceType: "credit_card",
        internalConnectionId: CONNECTION_ID,
        externalConnectionId: CONSENT_ID,
        expectedExternalAccountId: CARD_ID,
      });

      expect(transaction).toEqual(expect.objectContaining({
        amountCents: 8990,
        direction: "expense",
      }));
      expect(transaction.rawPayload.transaction_type).toBe(transactionType);
      expect(transaction.rawPayload.bill_forecast_date).toBeNull();
    },
  );

  it("accepts absent optional counterparty and category_ref fields", () => {
    const { counterparty: _counterparty, category_ref: _categoryRef, ...value } =
      accountTransactionFixture;
    expect(() => normalizePolpTransaction({
      value,
      resourceType: "account",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: ACCOUNT_ID,
    })).not.toThrow();
  });

  it("accepts bill transactions using the observed credit-card transaction contract", () => {
    const transaction = normalizePolpTransaction({
      value: {
        ...cardTransactionFixture,
        transaction_type: "OPERACOES_CREDITO_CONTRATADAS_CARTAO",
        credit_debit_type: "DEBITO",
        bill_id: BILL_ID,
        bill_forecast_date: null,
        counterparty: null,
      },
      resourceType: "credit_card",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: CARD_ID,
      expectedBillId: BILL_ID,
    });

    expect(transaction).toEqual(expect.objectContaining({
      externalAccountId: CARD_ID,
      amountCents: 8990,
      direction: "expense",
    }));
  });

  it.each([
    ["missing external id", { ...accountTransactionFixture, id: "" }],
    ["different account", { ...accountTransactionFixture, account_id: CARD_ID }],
    ["invalid civil date", { ...accountTransactionFixture, transaction_date_time: "2026-02-30T10:00:00Z" }],
    ["invalid amount precision", {
      ...accountTransactionFixture,
      transaction_amount: { amount: "10.001", currency: "BRL" },
    }],
    ["unsupported currency", {
      ...accountTransactionFixture,
      transaction_amount: { amount: "10.00", currency: "USD" },
    }],
    ["invalid direction", { ...accountTransactionFixture, credit_debit_type: "UNKNOWN" }],
    ["blank description", { ...accountTransactionFixture, transaction_name: "  " }],
  ])("rejects %s", (_name, value) => {
    expect(() => normalizePolpTransaction({
      value,
      resourceType: "account",
      internalConnectionId: CONNECTION_ID,
      externalConnectionId: CONSENT_ID,
      expectedExternalAccountId: ACCOUNT_ID,
    })).toThrow();
  });

  it("uses bill_closing_date without requiring legacy closing_date, status or finance_charges", () => {
    expect(billFixture).not.toHaveProperty("status");
    expect(billFixture).not.toHaveProperty("finance_charges");
    expect(normalizePolpBill({
      ...billFixture,
      closing_date: "2026-01-01",
    })).toEqual({
      id: BILL_ID,
      creditCardId: CARD_ID,
      dueDate: "2026-08-27",
      closingDate: "2026-08-20",
      minimumAmountCents: 5899,
      totalAmountCents: 58990,
      currency: "BRL",
    });
  });

  it("deeply removes credentials, documents and authentication URLs", () => {
    const sanitized = sanitizeProviderPayload({
      x: {
        cpf: "12345678901",
        cnpj: "12345678000199",
        clientSecret: "provider-secret",
        urlToAuthenticate: "https://auth.example.invalid/token",
        safe: "kept",
      },
    });
    expect(sanitized).toEqual({ x: { safe: "kept" } });
  });

  it("persists only explicit top-level raw fields from each provider schema", () => {
    const consent = normalizePolpConsent({
      ...authorisedConsentFixture,
      future_document_number: "should-never-be-persisted",
      refresh_token: "should-never-be-persisted",
    });
    expect(consent.rawPayload).not.toHaveProperty("future_document_number");
    expect(consent.rawPayload).not.toHaveProperty("refresh_token");
  });
});
