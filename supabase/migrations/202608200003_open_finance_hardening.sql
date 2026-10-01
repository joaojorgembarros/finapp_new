-- Open Finance contract phase: remove legacy write paths and constraints.
--
-- ROLLOUT GATE: apply this migration only after the Pluggy Edge Function uses
-- public.import_open_finance_transaction for every transaction import. The
-- preceding 0002 migration is intentionally compatible with the legacy direct
-- write path and must be allowed to run on its own during that cutover window.

begin;

do $preflight$
begin
  if to_regprocedure(
    'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_HARDENING_RPC_MISSING',
      detail = 'Apply the Open Finance expand/RPC migration before hardening.';
  end if;
end
$preflight$;

-- The composite foreign keys added in 0002 now replace the baseline keys. The
-- stable external identity replaces date/value and fingerprint as identity.
alter table public.bank_connection_consents
  drop constraint bank_connection_consents_connection_id_fkey;

alter table public.bank_sync_runs
  drop constraint bank_sync_runs_connection_id_fkey;

alter table public.imported_bank_transactions
  alter column external_account_id set not null,
  drop constraint imported_bank_transactions_connection_id_fkey,
  drop constraint imported_bank_transactions_sync_run_id_fkey,
  drop constraint imported_bank_transactions_transaction_id_fkey,
  drop constraint imported_bank_transactions_connection_id_external_transacti_key,
  drop constraint imported_bank_transactions_connection_id_transaction_finger_key;

-- Remove administrative and write privileges from client-facing roles.
-- Authenticated users retain member-scoped reads through RLS. service_role
-- retains only the ordinary row operations needed by trusted Edge Functions
-- and by the SECURITY INVOKER import RPC.
revoke all privileges
on table
  public.bank_connections,
  public.bank_connection_consents,
  public.bank_sync_runs,
  public.imported_bank_transactions
from public, anon, authenticated, service_role;

grant select
on table
  public.bank_connections,
  public.bank_connection_consents,
  public.bank_sync_runs,
  public.imported_bank_transactions
to authenticated;

grant select, insert, update, delete
on table
  public.bank_connections,
  public.bank_connection_consents,
  public.bank_sync_runs,
  public.imported_bank_transactions
to service_role;

drop policy bank_connections_member_rw on public.bank_connections;
create policy bank_connections_member_select
  on public.bank_connections
  for select
  to authenticated
  using (public.is_member(household_id));

drop policy bank_connection_consents_member_rw
  on public.bank_connection_consents;
create policy bank_connection_consents_member_select
  on public.bank_connection_consents
  for select
  to authenticated
  using (public.is_member(household_id));

drop policy bank_sync_runs_member_rw on public.bank_sync_runs;
create policy bank_sync_runs_member_select
  on public.bank_sync_runs
  for select
  to authenticated
  using (public.is_member(household_id));

drop policy imported_bank_transactions_member_rw
  on public.imported_bank_transactions;
create policy imported_bank_transactions_member_select
  on public.imported_bank_transactions
  for select
  to authenticated
  using (public.is_member(household_id));

notify pgrst, 'reload schema';

commit;
