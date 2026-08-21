import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { JsonObject } from "./normalizers";

export const HOUSEHOLD_ID = "a10e8400-e29b-41d4-a716-446655440010";
export const USER_ID = "a20e8400-e29b-41d4-a716-446655440020";
export const CONNECTION_ID = "a30e8400-e29b-41d4-a716-446655440030";
export const SYNC_RUN_ID = "a40e8400-e29b-41d4-a716-446655440040";
export const INTERNAL_CONSENT_ID = "a50e8400-e29b-41d4-a716-446655440050";

function readFixture(name: string): unknown {
  const path = resolve(
    process.cwd(),
    "supabase",
    "functions",
    "open-finance-polp",
    "fixtures",
    name,
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

function fixtureArray(name: string) {
  const value = readFixture(name);
  if (!Array.isArray(value)) throw new TypeError(`${name} must contain an array.`);
  return value as JsonObject[];
}

export const institutionFixture = fixtureArray("institutions.json")[0];
export const [awaitingConsentFixture, authorisedConsentFixture] = fixtureArray("consents.json");
export const accountFixture = fixtureArray("accounts.json")[0];
export const creditCardFixture = fixtureArray("credit-cards.json")[0];
export const [accountTransactionFixture, cardTransactionFixture] = fixtureArray("transactions.json");
export const billFixture = fixtureArray("bills.json")[0];
export const webhookFixture = readFixture("webhook-sample.json") as JsonObject;

export const INSTITUTION_ID = String(institutionFixture.id);
export const CONSENT_ID = String(authorisedConsentFixture.id);
export const ACCOUNT_ID = String(accountFixture.id);
export const CARD_ID = String(creditCardFixture.id);
export const BILL_ID = String(billFixture.id);
