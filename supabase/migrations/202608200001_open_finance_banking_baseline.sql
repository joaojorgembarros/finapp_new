-- Open Finance banking schema baseline.
--
-- This file is the faithful, reproducible definition of the four banking
-- tables that already exist in the currently linked remote database. It also
-- includes the exact trigger helper on which those tables depend; that helper
-- existed remotely but was missing from the repository's migration history.
--
-- Adoption rules:
--   * New database: run this migration normally after the existing migrations.
--   * Current remote database: DO NOT execute this DDL. First compare its
--     catalog with this baseline, then use a separately reviewed migration
--     adoption/repair procedure to register the baseline without recreating
--     objects that already exist.
--
-- Plain CREATE statements are intentional: applying this baseline to a
-- divergent or already-populated schema must fail instead of hiding drift.

create function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

alter function public.set_updated_at() owner to postgres;

revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_updated_at() to public, anon, authenticated, service_role;

create table public.bank_connections (
  id uuid not null default gen_random_uuid(),
  household_id uuid not null,
  created_by uuid not null,
  provider text not null,
  institution_id text,
  institution_name text not null,
  external_connection_id text,
  external_account_id text not null,
  account_name text not null,
  account_mask text,
  status text not null default 'connected'::text,
  consent_expires_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  raw_payload jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bank_connections_pkey primary key (id),
  constraint bank_connections_household_id_fkey
    foreign key (household_id) references public.households(id) on delete cascade,
  constraint bank_connections_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete cascade,
  constraint bank_connections_household_id_provider_external_account_id_key
    unique (household_id, provider, external_account_id),
  constraint bank_connections_status_check
    check (status = any (array['connected'::text, 'error'::text, 'disconnected'::text]))
);

alter table public.bank_connections owner to postgres;

create index bank_connections_household_idx
  on public.bank_connections using btree (household_id, created_at desc);

create index bank_connections_status_idx
  on public.bank_connections using btree (status);

create table public.bank_connection_consents (
  id uuid not null default gen_random_uuid(),
  connection_id uuid not null,
  household_id uuid not null,
  created_by uuid not null,
  provider text not null,
  external_consent_id text,
  status text not null default 'active'::text,
  granted_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone,
  raw_payload jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bank_connection_consents_pkey primary key (id),
  constraint bank_connection_consents_connection_id_fkey
    foreign key (connection_id) references public.bank_connections(id) on delete cascade,
  constraint bank_connection_consents_household_id_fkey
    foreign key (household_id) references public.households(id) on delete cascade,
  constraint bank_connection_consents_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete cascade,
  constraint bank_connection_consents_connection_id_key unique (connection_id),
  constraint bank_connection_consents_status_check
    check (
      status = any (
        array['active'::text, 'expiring'::text, 'expired'::text, 'revoked'::text]
      )
    )
);

alter table public.bank_connection_consents owner to postgres;

create index bank_connection_consents_household_idx
  on public.bank_connection_consents using btree (household_id, created_at desc);

create table public.bank_sync_runs (
  id uuid not null default gen_random_uuid(),
  connection_id uuid not null,
  household_id uuid not null,
  created_by uuid not null,
  provider text not null,
  month_key text not null,
  status text not null default 'syncing'::text,
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  found_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_message text,
  raw_payload jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bank_sync_runs_pkey primary key (id),
  constraint bank_sync_runs_connection_id_fkey
    foreign key (connection_id) references public.bank_connections(id) on delete cascade,
  constraint bank_sync_runs_household_id_fkey
    foreign key (household_id) references public.households(id) on delete cascade,
  constraint bank_sync_runs_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete cascade,
  constraint bank_sync_runs_month_key_check
    check (month_key ~ '^\d{4}-\d{2}$'::text),
  constraint bank_sync_runs_status_check
    check (status = any (array['syncing'::text, 'success'::text, 'error'::text]))
);

alter table public.bank_sync_runs owner to postgres;

create index bank_sync_runs_connection_idx
  on public.bank_sync_runs using btree (connection_id, started_at desc);

create index bank_sync_runs_household_month_idx
  on public.bank_sync_runs using btree (household_id, month_key, started_at desc);

create table public.imported_bank_transactions (
  id uuid not null default gen_random_uuid(),
  sync_run_id uuid,
  connection_id uuid not null,
  household_id uuid not null,
  created_by uuid not null,
  provider text not null,
  external_transaction_id text not null,
  external_account_id text,
  posted_at timestamp with time zone,
  occurred_on date not null,
  description text not null,
  amount_cents bigint not null,
  direction text not null,
  transaction_fingerprint text not null,
  transaction_id uuid,
  raw_payload jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint imported_bank_transactions_pkey primary key (id),
  constraint imported_bank_transactions_sync_run_id_fkey
    foreign key (sync_run_id) references public.bank_sync_runs(id) on delete set null,
  constraint imported_bank_transactions_connection_id_fkey
    foreign key (connection_id) references public.bank_connections(id) on delete cascade,
  constraint imported_bank_transactions_household_id_fkey
    foreign key (household_id) references public.households(id) on delete cascade,
  constraint imported_bank_transactions_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete cascade,
  constraint imported_bank_transactions_transaction_id_fkey
    foreign key (transaction_id) references public.transactions(id) on delete set null,
  constraint imported_bank_transactions_direction_check
    check (direction = any (array['income'::text, 'expense'::text])),
  constraint imported_bank_transactions_connection_id_external_transacti_key
    unique (connection_id, external_transaction_id, occurred_on, amount_cents),
  constraint imported_bank_transactions_connection_id_transaction_finger_key
    unique (connection_id, transaction_fingerprint)
);

alter table public.imported_bank_transactions owner to postgres;

create index imported_bank_transactions_connection_idx
  on public.imported_bank_transactions using btree (connection_id, occurred_on desc);

create index imported_bank_transactions_household_idx
  on public.imported_bank_transactions using btree (household_id, occurred_on desc);

create index imported_bank_transactions_sync_run_idx
  on public.imported_bank_transactions using btree (sync_run_id);

alter table public.bank_connections enable row level security;
alter table public.bank_connection_consents enable row level security;
alter table public.bank_sync_runs enable row level security;
alter table public.imported_bank_transactions enable row level security;

create policy bank_connections_member_rw
on public.bank_connections
as permissive
for all
to public
using (public.is_member(household_id))
with check (public.is_member(household_id) and created_by = auth.uid());

create policy bank_connection_consents_member_rw
on public.bank_connection_consents
as permissive
for all
to public
using (public.is_member(household_id))
with check (public.is_member(household_id) and created_by = auth.uid());

create policy bank_sync_runs_member_rw
on public.bank_sync_runs
as permissive
for all
to public
using (public.is_member(household_id))
with check (public.is_member(household_id) and created_by = auth.uid());

create policy imported_bank_transactions_member_rw
on public.imported_bank_transactions
as permissive
for all
to public
using (public.is_member(household_id))
with check (public.is_member(household_id) and created_by = auth.uid());

create trigger set_bank_connections_updated_at
before update on public.bank_connections
for each row execute function public.set_updated_at();

create trigger set_bank_connection_consents_updated_at
before update on public.bank_connection_consents
for each row execute function public.set_updated_at();

create trigger set_bank_sync_runs_updated_at
before update on public.bank_sync_runs
for each row execute function public.set_updated_at();

create trigger set_imported_bank_transactions_updated_at
before update on public.imported_bank_transactions
for each row execute function public.set_updated_at();

revoke all on table
  public.bank_connections,
  public.bank_connection_consents,
  public.bank_sync_runs,
  public.imported_bank_transactions
from public, anon, authenticated, service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update
on table
  public.bank_connections,
  public.bank_connection_consents,
  public.bank_sync_runs,
  public.imported_bank_transactions
to postgres, anon, authenticated, service_role;
