import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationDir = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const migration = readFileSync(join(migrationDir, "20261005165211_financial_pattern_decisions.sql"), "utf8");
const previous = readFileSync(join(migrationDir, "20261003140000_statement_conflict_by_account.sql"), "utf8");
const suggestions = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "financialPatternSuggestions.ts"), "utf8");
const planning = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "financialPlanning.ts"), "utf8");
const detector = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "financialPatternDetection.ts"), "utf8");

describe("financial pattern decision schema", () => {
  it("is a later migration and does not rewrite older files", () => {
    expect(previous).toMatch(/import_statement_v8/);
    expect(migration).toMatch(/create table if not exists public\.financial_pattern_decisions/);
    expect(migration).toMatch(/unique \(household_id, pattern_key\)/);
    expect(migration).toMatch(/decision in \('confirmed', 'rejected'\)/);
    expect(migration).not.toMatch(/'inferred'/);
    expect(migration).toMatch(/linked_commitment_id uuid references public\.financial_commitments\(id\) on delete cascade/);
    expect(migration).toMatch(/decision = 'confirmed' and linked_commitment_id is not null/);
  });

  it("isolates rows by household membership and keeps writes on the RPCs", () => {
    expect(migration).toMatch(/alter table public\.financial_pattern_decisions enable row level security/);
    expect(migration).toMatch(/revoke all on table public\.financial_pattern_decisions from public, anon, authenticated;/);
    expect(migration).toMatch(/grant select on table public\.financial_pattern_decisions to authenticated;/);
    expect(migration).not.toMatch(/grant select, insert, update, delete on table public\.financial_pattern_decisions to authenticated;/);
    expect(migration).toMatch(/financial_pattern_decisions_select_member[\s\S]*using \(public\.is_member\(household_id\)\)/);
    expect(migration).toMatch(/drop policy if exists financial_pattern_decisions_insert_member/);
    expect(migration).toMatch(/drop policy if exists financial_pattern_decisions_update_member/);
    expect(migration).toMatch(/drop policy if exists financial_pattern_decisions_delete_member/);
    expect(migration).toMatch(/enforce_financial_pattern_decision_invariants/);
    expect(migration).toMatch(/commitment_household is distinct from new.household_id/);
    expect(migration).not.toMatch(/grant select[\s\S]*financial_pattern_decisions[\s\S]*to anon/);
  });
});

describe("financial pattern RPCs", () => {
  const functions = migration.split(/create or replace function public\./).slice(1);

  it("confirms by creating or linking a commitment in one transaction", () => {
    const confirm = functions.find((body) => body.startsWith("confirm_financial_pattern")) ?? "";
    expect(confirm).toContain("security definer");
    expect(confirm).toContain("set search_path = public");
    const authCheck = confirm.indexOf("if uid is null then");
    const memberCheck = confirm.indexOf("if not public.is_member(p_household_id) then");
    const lock = confirm.indexOf("pg_advisory_xact_lock");
    const existingCommitment = confirm.indexOf("if p_existing_commitment_id is not null then");
    const writeCommitment = confirm.indexOf("insert into public.financial_commitments");
    const writeDecision = confirm.indexOf("insert into public.financial_pattern_decisions");
    expect(authCheck).toBeGreaterThan(-1);
    expect(memberCheck).toBeGreaterThan(authCheck);
    expect(lock).toBeGreaterThan(memberCheck);
    expect(existingCommitment).toBeGreaterThan(memberCheck);
    expect(writeCommitment).toBeGreaterThan(existingCommitment);
    expect(writeDecision).toBeGreaterThan(writeCommitment);
    expect(confirm).toMatch(/and household_id = p_household_id/);
    expect(confirm).toMatch(/and active = true/);
    expect(confirm).toMatch(/on conflict \(household_id, pattern_key\) do update set/);
    expect(confirm).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_household_id::text \|\| ':pattern:' \|\| trim\(p_pattern_key\), 0\)\)/);
    expect(confirm).toMatch(/O compromisso não pertence a esta casa\./);
    expect(confirm).not.toMatch(/if p_confidence/);
  });

  it("rejects without creating a commitment", () => {
    const reject = functions.find((body) => body.startsWith("reject_financial_pattern")) ?? "";
    expect(reject).toContain("if uid is null then");
    expect(reject).toContain("if not public.is_member(p_household_id) then");
    expect(reject).toMatch(/'rejected'/);
    expect(reject).not.toMatch(/insert into public\.financial_commitments/);
    expect(reject).toMatch(/Este padrão já faz parte do planejamento\./);
    expect(reject).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_household_id::text \|\| ':pattern:' \|\| trim\(p_pattern_key\), 0\)\)/);
  });

  it("grants execute only to authenticated", () => {
    expect(migration).toMatch(/revoke all on function public\.confirm_financial_pattern\([\s\S]*?\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function public\.confirm_financial_pattern\([\s\S]*?\) to authenticated;/);
    expect(migration).toMatch(/revoke all on function public\.reject_financial_pattern\([\s\S]*?\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function public\.reject_financial_pattern\([\s\S]*?\) to authenticated;/);
    expect(migration).not.toMatch(/grant execute on function public\.(confirm_financial_pattern|reject_financial_pattern)[\s\S]*to anon/);
  });
});

describe("phase 2 keeps planning math and the detector untouched", () => {
  it("does not rewrite financialPlanning.ts or the phase 1 detector", () => {
    expect(planning).toMatch(/export function calculateFinancialSummary/);
    expect(planning).toMatch(/formula: "conservative-v1"/);
    expect(detector).toMatch(/export function detectFinancialPatterns/);
    expect(suggestions).toMatch(/detectFinancialPatterns\(input\.transactions, \{ referenceDate \}\)/);
    expect(suggestions).toMatch(/merchant:\$\{PATTERN_DECISION_KEY_VERSION\}/);
    expect(suggestions).toMatch(/PATTERN_DETECTION\.windowMonths/);
    expect(suggestions).toMatch(/\.gte\("occurred_on", windowStart\)/);
    expect(suggestions).toMatch(/\.lte\("occurred_on", referenceDate\)/);
    expect(suggestions).not.toMatch(/calculateFinancialSummary/);
    expect(suggestions).not.toMatch(/allocate_cycle_surplus/);
  });

  it("uses the screen's local calendar date and does not block planning when suggestions fail", () => {
    const screen = readFileSync(join(migrationDir, "../../app/(app)/financial-plan.tsx"), "utf8");
    const inbox = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../ui/FinancialPatternInbox.tsx"), "utf8");
    expect(screen.match(/const referenceDate = ymd\(new Date\(\)\);/g)).toHaveLength(2);
    expect(screen).toMatch(/loadPlanningObservations\(\{ householdId, userId: userId \?\? "", referenceDate \}\)\.catch\(\(\) => EMPTY_PLANNING_OBSERVATIONS\)/);
    expect(screen).not.toMatch(/upsertProfile|from\("profiles"\)/);
    expect(screen).not.toMatch(/Usar no planejamento/);
    expect(inbox).toMatch(/if \(!suggestions.length && !reviewing\) return null;/);
  });
});
