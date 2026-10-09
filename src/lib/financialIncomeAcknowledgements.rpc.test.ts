import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(join(root, "supabase/migrations/20261005223000_financial_income_acknowledgements.sql"), "utf8");
const decisions = readFileSync(join(root, "supabase/migrations/20261005165211_financial_pattern_decisions.sql"), "utf8");
const screen = readFileSync(join(root, "src/features/planning/FinancialPlanScreen.tsx"), "utf8");
const section = readFileSync(join(root, "src/ui/ObservedIncomeSection.tsx"), "utf8");

describe("financial income acknowledgement schema", () => {
  it("adds a recognition table without rewriting expense decisions", () => {
    expect(migration).toMatch(/create table if not exists public\.financial_income_acknowledgements/);
    expect(migration).toMatch(/unique \(household_id, user_id, pattern_key\)/);
    expect(migration).toMatch(/target_field in \('income_fixed_cents', 'income_variable_avg_cents'\)/);
    expect(migration).toMatch(/decision in \('incorporated', 'declined'\)/);
    expect(migration).toMatch(/decision = 'declined'[\s\S]*profile_cents_after is null/);
    expect(decisions).toMatch(/decision = 'confirmed' and linked_commitment_id is not null/);
    expect(migration).not.toMatch(/financial_pattern_decisions/);
    expect(migration).not.toMatch(/financial_commitments/);
  });

  it("lets a person read only their own rows and blocks direct writes", () => {
    expect(migration).toMatch(/revoke all on table public\.financial_income_acknowledgements from public, anon, authenticated;/);
    expect(migration).toMatch(/grant select on table public\.financial_income_acknowledgements to authenticated;/);
    expect(migration).not.toMatch(/grant (insert|update|delete|select, insert)/);
    expect(migration).toMatch(/user_id = auth\.uid\(\) and public\.is_member\(household_id\)/);
    expect(migration).toMatch(/drop policy if exists financial_income_acknowledgements_insert_own/);
    expect(migration).toMatch(/drop policy if exists financial_income_acknowledgements_update_own/);
    expect(migration).toMatch(/drop policy if exists financial_income_acknowledgements_delete_own/);
    expect(migration).toMatch(/revoke all on function public\.acknowledge_income_pattern\([\s\S]*?\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function public\.acknowledge_income_pattern\([\s\S]*?\) to authenticated;/);
  });
});

describe("acknowledge_income_pattern", () => {
  const body = migration.slice(migration.indexOf("function public.acknowledge_income_pattern"));

  it("locks the person and pattern, then compares the profile under row lock", () => {
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = public/);
    expect(body).toMatch(/pg_advisory_xact_lock/);
    expect(body).toMatch(/:income:/);
    expect(body).toMatch(/from public\.profiles[\s\S]*where user_id = uid[\s\S]*for update/);
    expect(body).toMatch(/current_cents is distinct from p_expected_current_cents/);
    expect(body).toMatch(/Renda alterada em outro lugar/);
  });

  it("writes an absolute total and preserves the other income field", () => {
    expect(body).toMatch(/p_desired_total_cents \+ income_variable_avg_cents/);
    expect(body).toMatch(/income_fixed_cents \+ p_desired_total_cents/);
    expect(body).toMatch(/profile_cents_after = p_desired_total_cents/);
    expect(body).toMatch(/current_cents = p_desired_total_cents then/);
  });

  it("rejects a decline that would change the profile and allows the same row to become incorporated", () => {
    const declineReturn = body.indexOf("p_decision = 'declined'");
    const profileUpdate = body.indexOf("update public.profiles");
    expect(declineReturn).toBeGreaterThan(-1);
    expect(profileUpdate).toBeGreaterThan(declineReturn);
    expect(body).toMatch(/if p_decision = 'incorporated' then/);
    expect(body).toMatch(/on conflict \(household_id, user_id, pattern_key\) do update/);
  });

  it("checks membership, field, behavior, sign and ceiling before writing", () => {
    expect(body).toMatch(/auth\.uid\(\)/);
    expect(body).toMatch(/is_member\(p_household_id\)/);
    expect(body).toMatch(/p_suggested_cents < 0 or p_suggested_cents > max_cents/);
    expect(body).toMatch(/p_desired_total_cents < 0 or p_desired_total_cents > max_cents/);
    expect(body).toMatch(/tipo de renda não corresponde ao campo/);
    expect(body).toMatch(/max_cents constant bigint := 1000000000/);
    expect(body).not.toMatch(/p_user_id/);
  });
});

describe("income planning screen", () => {
  it("keeps profile columns out of the screen and hides the action from other inflows", () => {
    expect(screen).toMatch(/acknowledgeIncomePattern/);
    expect(screen).toMatch(/expectedCurrentCents: incomePlan\.currentCents/);
    expect(screen).not.toMatch(/upsertProfile|from\("profiles"\)|expectedMonthlyIncomeCents/);
    expect(section).toMatch(/Usar no planejamento/);
    expect(section).not.toMatch(/Outras entradas observadas[\s\S]*Usar no planejamento/);
  });
});
