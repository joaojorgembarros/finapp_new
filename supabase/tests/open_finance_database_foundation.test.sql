-- Open Finance database foundation tests (local PostgreSQL 17 only).
--
-- Safe execution, from the repository root:
--   supabase start
--   supabase db reset --local
--   supabase test db supabase/tests/open_finance_database_foundation.test.sql --local
--
-- Never run this file with --linked. `supabase test db` wraps the file in a
-- transaction; the explicit transaction below also documents that every
-- fixture and test-only trigger must be rolled back.
--
-- This suite exercises idempotency in one session and the database objects
-- that make the RPC concurrency-safe. It intentionally does not claim to be
-- a real concurrent-session test. That requires two independent PostgreSQL
-- sessions and is a separate runtime gate before deployment.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(104);

-- ---------------------------------------------------------------------------
-- Baseline catalog: a fresh `supabase db reset --local` must create all four
-- tables with the remotely audited column order and their update triggers.
-- ---------------------------------------------------------------------------

select has_table('public', 'bank_connections', 'bank_connections exists');
select has_table(
  'public',
  'bank_connection_consents',
  'bank_connection_consents exists'
);
select has_table('public', 'bank_sync_runs', 'bank_sync_runs exists');
select has_table(
  'public',
  'imported_bank_transactions',
  'imported_bank_transactions exists'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
  ),
  62::bigint,
  'the banking baseline exposes all 62 audited columns'
);

select columns_are(
  'public',
  'bank_connections',
  array[
    'id',
    'household_id',
    'created_by',
    'provider',
    'institution_id',
    'institution_name',
    'external_connection_id',
    'external_account_id',
    'account_name',
    'account_mask',
    'status',
    'consent_expires_at',
    'last_synced_at',
    'raw_payload',
    'created_at',
    'updated_at'
  ]::name[],
  'bank_connections has the audited columns in order'
);

select columns_are(
  'public',
  'bank_connection_consents',
  array[
    'id',
    'connection_id',
    'household_id',
    'created_by',
    'provider',
    'external_consent_id',
    'status',
    'granted_at',
    'expires_at',
    'raw_payload',
    'created_at',
    'updated_at'
  ]::name[],
  'bank_connection_consents has the audited columns in order'
);

select columns_are(
  'public',
  'bank_sync_runs',
  array[
    'id',
    'connection_id',
    'household_id',
    'created_by',
    'provider',
    'month_key',
    'status',
    'started_at',
    'finished_at',
    'found_count',
    'inserted_count',
    'duplicate_count',
    'error_message',
    'raw_payload',
    'created_at',
    'updated_at'
  ]::name[],
  'bank_sync_runs has the audited columns in order'
);

select columns_are(
  'public',
  'imported_bank_transactions',
  array[
    'id',
    'sync_run_id',
    'connection_id',
    'household_id',
    'created_by',
    'provider',
    'external_transaction_id',
    'external_account_id',
    'posted_at',
    'occurred_on',
    'description',
    'amount_cents',
    'direction',
    'transaction_fingerprint',
    'transaction_id',
    'raw_payload',
    'created_at',
    'updated_at'
  ]::name[],
  'imported_bank_transactions has the audited columns in order'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = any (
      array[
        'public.bank_connections'::regclass,
        'public.bank_connection_consents'::regclass,
        'public.bank_sync_runs'::regclass,
        'public.imported_bank_transactions'::regclass
      ]
    )
      and contype = 'p'
  ),
  4::bigint,
  'all banking tables have primary keys'
);

select ok(
  (
    select bool_and(relrowsecurity and not relforcerowsecurity)
    from pg_class
    where oid = any (
      array[
        'public.bank_connections'::regclass,
        'public.bank_connection_consents'::regclass,
        'public.bank_sync_runs'::regclass,
        'public.imported_bank_transactions'::regclass
      ]
    )
  ),
  'RLS is enabled and not forced on all four banking tables'
);

select results_eq(
  $sql$
    select
      policyname::text collate "C",
      permissive::text collate "C",
      roles collate "C",
      cmd::text collate "C"
    from pg_policies
    where schemaname = 'public' and tablename = 'bank_connections'
  $sql$,
  $expected$
    values (
      'bank_connections_member_select'::text collate "C",
      'PERMISSIVE'::text collate "C",
      array['authenticated']::name[] collate "C",
      'SELECT'::text collate "C"
    )
  $expected$,
  'bank_connections has only its authenticated member SELECT policy'
);
select results_eq(
  $sql$
    select
      policyname::text collate "C",
      permissive::text collate "C",
      roles collate "C",
      cmd::text collate "C"
    from pg_policies
    where schemaname = 'public' and tablename = 'bank_connection_consents'
  $sql$,
  $expected$
    values (
      'bank_connection_consents_member_select'::text collate "C",
      'PERMISSIVE'::text collate "C",
      array['authenticated']::name[] collate "C",
      'SELECT'::text collate "C"
    )
  $expected$,
  'bank_connection_consents has only its member SELECT policy'
);
select results_eq(
  $sql$
    select
      policyname::text collate "C",
      permissive::text collate "C",
      roles collate "C",
      cmd::text collate "C"
    from pg_policies
    where schemaname = 'public' and tablename = 'bank_sync_runs'
  $sql$,
  $expected$
    values (
      'bank_sync_runs_member_select'::text collate "C",
      'PERMISSIVE'::text collate "C",
      array['authenticated']::name[] collate "C",
      'SELECT'::text collate "C"
    )
  $expected$,
  'bank_sync_runs has only its member SELECT policy'
);
select results_eq(
  $sql$
    select
      policyname::text collate "C",
      permissive::text collate "C",
      roles collate "C",
      cmd::text collate "C"
    from pg_policies
    where schemaname = 'public' and tablename = 'imported_bank_transactions'
  $sql$,
  $expected$
    values (
      'imported_bank_transactions_member_select'::text collate "C",
      'PERMISSIVE'::text collate "C",
      array['authenticated']::name[] collate "C",
      'SELECT'::text collate "C"
    )
  $expected$,
  'imported_bank_transactions has only its member SELECT policy'
);

select trigger_is(
  'public',
  'bank_connections',
  'set_bank_connections_updated_at',
  'public',
  'set_updated_at',
  'bank_connections updated_at trigger uses set_updated_at'
);
select trigger_is(
  'public',
  'bank_connection_consents',
  'set_bank_connection_consents_updated_at',
  'public',
  'set_updated_at',
  'bank_connection_consents updated_at trigger uses set_updated_at'
);
select trigger_is(
  'public',
  'bank_sync_runs',
  'set_bank_sync_runs_updated_at',
  'public',
  'set_updated_at',
  'bank_sync_runs updated_at trigger uses set_updated_at'
);
select trigger_is(
  'public',
  'imported_bank_transactions',
  'set_imported_bank_transactions_updated_at',
  'public',
  'set_updated_at',
  'imported_bank_transactions updated_at trigger uses set_updated_at'
);

select has_index(
  'public',
  'bank_connections',
  'bank_connections_household_idx',
  'baseline household connection index exists'
);
select has_index(
  'public',
  'bank_connections',
  'bank_connections_status_idx',
  'baseline connection status index exists'
);
select has_index(
  'public',
  'bank_connection_consents',
  'bank_connection_consents_household_idx',
  'baseline consent household index exists'
);
select has_index(
  'public',
  'bank_sync_runs',
  'bank_sync_runs_connection_idx',
  'baseline sync connection index exists'
);
select has_index(
  'public',
  'bank_sync_runs',
  'bank_sync_runs_household_month_idx',
  'baseline sync household/month index exists'
);
select has_index(
  'public',
  'imported_bank_transactions',
  'imported_bank_transactions_connection_idx',
  'baseline imported transaction connection index exists'
);
select has_index(
  'public',
  'imported_bank_transactions',
  'imported_bank_transactions_household_idx',
  'baseline imported transaction household index exists'
);
select has_index(
  'public',
  'imported_bank_transactions',
  'imported_bank_transactions_sync_run_idx',
  'baseline imported transaction sync index exists'
);

select has_index(
  'public',
  'bank_connections',
  'bank_connections_provider_external_connection_idx',
  'external connection lookup starts with provider'
);
select has_index(
  'public',
  'bank_connections',
  'bank_connections_provider_external_account_idx',
  'external account lookup starts with provider'
);
select has_index(
  'public',
  'bank_connection_consents',
  'bank_consents_provider_external_consent_idx',
  'external consent lookup starts with provider'
);
select has_index(
  'public',
  'bank_sync_runs',
  'bank_sync_runs_provider_connection_started_idx',
  'sync lookup starts with provider and connection'
);
select has_index(
  'public',
  'imported_bank_transactions',
  'imported_bank_tx_content_fingerprint_idx',
  'content fingerprint has a non-unique lookup index'
);

select index_is_unique(
  'public',
  'imported_bank_transactions',
  'imported_bank_tx_external_identity_key',
  'stable external identity is enforced by a unique index'
);

select ok(
  not (
    select index_record.indisunique
    from pg_index as index_record
    where index_record.indexrelid =
      'public.imported_bank_tx_content_fingerprint_idx'::regclass
  ),
  'the mutable content fingerprint is deliberately not unique'
);

select is(
  (
    select pg_get_constraintdef(constraint_record.oid)
    from pg_constraint as constraint_record
    where constraint_record.conrelid =
      'public.imported_bank_transactions'::regclass
      and constraint_record.conname =
        'imported_bank_tx_external_identity_key'
  ),
  'UNIQUE (provider, connection_id, external_account_id, external_transaction_id)',
  'external identity is provider + internal connection + account + transaction'
);

select is(
  (
    select count(*)
    from pg_constraint as constraint_record
    where constraint_record.conname in (
      'bank_connections_context_key',
      'bank_connections_account_context_key',
      'bank_consents_connection_context_fkey',
      'bank_sync_runs_context_key',
      'bank_sync_runs_connection_context_fkey',
      'transactions_open_finance_context_key',
      'imported_bank_tx_connection_context_fkey',
      'imported_bank_tx_sync_context_fkey',
      'imported_bank_tx_transaction_context_fkey',
      'imported_bank_tx_transaction_id_key'
    )
  ),
  10::bigint,
  'all provider/household/ledger composite integrity constraints exist'
);

select is(
  (
    select count(*)
    from pg_constraint as constraint_record
    where constraint_record.conrelid =
      'public.imported_bank_transactions'::regclass
      and constraint_record.conname in (
        'imported_bank_transactions_connection_id_external_transacti_key',
        'imported_bank_transactions_connection_id_transaction_finger_key'
      )
  ),
  0::bigint,
  'date/value and content fingerprint are no longer immutable identities'
);

select col_not_null(
  'public',
  'imported_bank_transactions',
  'external_account_id',
  'external account is mandatory for stable imported identity'
);

-- ---------------------------------------------------------------------------
-- Hardened grants and service-only RPC exposure.
-- ---------------------------------------------------------------------------

select results_eq(
  $query$
    select
      grant_row.table_name::text collate "C",
      array_agg(
        grant_row.privilege_type::text collate "C"
        order by grant_row.privilege_type::text collate "C"
      ) collate "C"
    from information_schema.role_table_grants as grant_row
    where grant_row.grantee = 'authenticated'
      and grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
    group by grant_row.table_name
    order by grant_row.table_name
  $query$,
  $expected$
    values
      (
        'bank_connection_consents'::text collate "C",
        array['SELECT']::text[] collate "C"
      ),
      (
        'bank_connections'::text collate "C",
        array['SELECT']::text[] collate "C"
      ),
      (
        'bank_sync_runs'::text collate "C",
        array['SELECT']::text[] collate "C"
      ),
      (
        'imported_bank_transactions'::text collate "C",
        array['SELECT']::text[] collate "C"
      )
  $expected$,
  'authenticated is read-only; all banking writes must use trusted server paths'
);

select is(
  (
    select count(*)
    from information_schema.role_table_grants as grant_row
    where grant_row.grantee = 'anon'
      and grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
  ),
  0::bigint,
  'anon has no direct banking table privileges'
);

select is(
  (
    select count(*)
    from pg_class as relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as privilege
    where relation.oid = any (
      array[
        'public.bank_connections'::regclass,
        'public.bank_connection_consents'::regclass,
        'public.bank_sync_runs'::regclass,
        'public.imported_bank_transactions'::regclass
      ]
    )
      and privilege.grantee = 0
  ),
  0::bigint,
  'PUBLIC has no banking table privileges'
);

select results_eq(
  $query$
    select
      grant_row.table_name::text collate "C",
      array_agg(
        grant_row.privilege_type::text collate "C"
        order by grant_row.privilege_type::text collate "C"
      ) collate "C"
    from information_schema.role_table_grants as grant_row
    where grant_row.grantee = 'service_role'
      and grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
    group by grant_row.table_name
    order by grant_row.table_name
  $query$,
  $expected$
    values
      (
        'bank_connection_consents'::text collate "C",
        array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] collate "C"
      ),
      (
        'bank_connections'::text collate "C",
        array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] collate "C"
      ),
      (
        'bank_sync_runs'::text collate "C",
        array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] collate "C"
      ),
      (
        'imported_bank_transactions'::text collate "C",
        array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] collate "C"
      )
  $expected$,
  'service_role has only the row privileges required by trusted server paths'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']::text[]) as client(role_name)
    cross join unnest(
      array[
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
        'MAINTAIN'
      ]::text[]
    ) as forbidden(privilege_name)
    cross join unnest(
      array[
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      ]::text[]
    ) as banking(table_name)
    where has_table_privilege(
      client.role_name,
      format('public.%I', banking.table_name),
      forbidden.privilege_name
    )
  ),
  'client roles have no banking write or administrative privileges'
);

select ok(
  not exists (
    select 1
    from unnest(
      array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[]
    ) as forbidden(privilege_name)
    cross join unnest(
      array[
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      ]::text[]
    ) as banking(table_name)
    where has_table_privilege(
      'service_role',
      format('public.%I', banking.table_name),
      forbidden.privilege_name
    )
  ),
  'service_role has no banking table administration privileges'
);

select ok(
  has_table_privilege('service_role', 'public.memberships', 'SELECT')
    and has_table_privilege('service_role', 'public.memberships', 'UPDATE')
    and has_table_privilege('service_role', 'public.transactions', 'SELECT')
    and has_table_privilege('service_role', 'public.transactions', 'INSERT')
    and not has_table_privilege('service_role', 'public.memberships', 'INSERT')
    and not has_table_privilege('anon', 'public.memberships', 'SELECT')
    and not has_table_privilege('authenticated', 'public.memberships', 'SELECT')
    and not has_table_privilege('anon', 'public.transactions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.transactions', 'INSERT'),
  'service_role alone has the minimal RPC dependency grants'
);

select has_function(
  'public',
  'import_open_finance_transaction',
  array[
    'text',
    'uuid',
    'uuid',
    'uuid',
    'text',
    'text',
    'date',
    'text',
    'bigint',
    'text',
    'uuid',
    'timestamp with time zone',
    'jsonb'
  ]::name[],
  'atomic Open Finance import RPC exists with the expected signature'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
    where procedure.oid = 'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE privilege on the import RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute the import RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot execute the import RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'service_role can execute the import RPC'
);

select is(
  (
    select procedure.prosecdef
    from pg_proc as procedure
    where procedure.oid = 'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)'::regprocedure
  ),
  false,
  'the import RPC is SECURITY INVOKER'
);

select is(
  (
    select procedure.proconfig
    from pg_proc as procedure
    where procedure.oid = 'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)'::regprocedure
  ),
  array['search_path=""']::text[],
  'the import RPC has an empty fixed search_path'
);

select imatches(
  pg_get_functiondef(
    'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)'::regprocedure
  ),
  'pg_advisory_xact_lock',
  'the RPC definition includes a transaction-scoped identity lock'
);
select imatches(
  pg_get_functiondef(
    'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)'::regprocedure
  ),
  'on conflict on constraint imported_bank_tx_external_identity_key do nothing',
  'the RPC definition uses the stable unique constraint as its race guard'
);

-- ---------------------------------------------------------------------------
-- Test data. UUIDs and addresses are deterministic, non-production fixtures.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'of-db-member@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'of-db-other@example.invalid');

insert into public.households (id, name, type, created_by)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'Open Finance database test household',
    'individual',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Other database test household',
    'individual',
    '10000000-0000-4000-8000-000000000002'
  );

insert into public.memberships (household_id, user_id, role)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'owner'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'owner'
  );

insert into public.bank_connections (
  id,
  household_id,
  created_by,
  provider,
  institution_name,
  external_connection_id,
  external_account_id,
  account_name
)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'pluggy',
  'Test institution',
  'same-external-connection',
  'same-external-account',
  'Pluggy test account'
);

select lives_ok(
  $sql$
    insert into public.bank_connections (
      id,
      household_id,
      created_by,
      provider,
      institution_name,
      external_connection_id,
      external_account_id,
      account_name
    ) values (
      '30000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'polp',
      'Test institution',
      'same-external-connection',
      'same-external-account',
      'Polp test account'
    )
  $sql$,
  'Pluggy and Polp can use the same external connection/account IDs'
);

insert into public.bank_connections (
  id,
  household_id,
  created_by,
  provider,
  institution_name,
  external_connection_id,
  external_account_id,
  account_name
)
values (
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'pluggy',
  'Other test institution',
  'other-household-connection',
  'other-household-account',
  'Other household account'
);

insert into public.transactions (
  id,
  household_id,
  type,
  amount_cents,
  note,
  occurred_on,
  created_by
)
values (
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'expense',
  100,
  'Ledger context fixture',
  date '2026-08-10',
  '10000000-0000-4000-8000-000000000002'
);

select throws_ok(
  $sql$
    insert into public.imported_bank_transactions (
      connection_id,
      household_id,
      created_by,
      provider,
      external_transaction_id,
      external_account_id,
      occurred_on,
      description,
      amount_cents,
      direction,
      transaction_fingerprint,
      transaction_id
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'pluggy',
      'wrong-household-ledger-link',
      'same-external-account',
      date '2026-08-10',
      'Wrong household ledger link',
      100,
      'expense',
      'wrong-household-ledger-fingerprint',
      '60000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23503'
);

insert into public.imported_bank_transactions (
  connection_id,
  household_id,
  created_by,
  provider,
  external_transaction_id,
  external_account_id,
  occurred_on,
  description,
  amount_cents,
  direction,
  transaction_fingerprint,
  transaction_id
)
values (
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'pluggy',
  'ledger-set-null',
  'other-household-account',
  date '2026-08-10',
  'Ledger SET NULL fixture',
  100,
  'expense',
  'ledger-set-null-fingerprint',
  '60000000-0000-4000-8000-000000000001'
);

delete from public.transactions
where id = '60000000-0000-4000-8000-000000000001';

select is(
  (
    select transaction_id
    from public.imported_bank_transactions
    where external_transaction_id = 'ledger-set-null'
  ),
  null::uuid,
  'deleting a ledger row clears only the imported transaction link'
);

-- Provider CHECKs must exist on every shared banking table. Every statement
-- supplies otherwise-valid required data so SQLSTATE 23514 identifies the
-- provider CHECK rather than a missing-column error.
select throws_ok(
  $sql$
    insert into public.bank_connections (
      household_id,
      created_by,
      provider,
      institution_name,
      external_account_id,
      account_name
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'invalid-provider',
      'Invalid provider test',
      'invalid-provider-account',
      'Invalid provider account'
    )
  $sql$,
  '23514'
);

select throws_ok(
  $sql$
    insert into public.bank_connection_consents (
      connection_id,
      household_id,
      created_by,
      provider,
      external_consent_id
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'invalid-provider',
      'invalid-provider-consent'
    )
  $sql$,
  '23514'
);

select throws_ok(
  $sql$
    insert into public.bank_sync_runs (
      connection_id,
      household_id,
      created_by,
      provider,
      month_key
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'invalid-provider',
      '2026-08'
    )
  $sql$,
  '23514'
);

select throws_ok(
  $sql$
    insert into public.imported_bank_transactions (
      connection_id,
      household_id,
      created_by,
      provider,
      external_transaction_id,
      external_account_id,
      occurred_on,
      description,
      amount_cents,
      direction,
      transaction_fingerprint
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'invalid-provider',
      'invalid-provider-transaction',
      'same-external-account',
      date '2026-08-10',
      'Invalid provider transaction',
      100,
      'expense',
      'invalid-provider-fingerprint'
    )
  $sql$,
  '23514'
);

-- The composite foreign keys must reject valid providers attached to the
-- wrong connection context.
select throws_ok(
  $sql$
    insert into public.bank_connection_consents (
      connection_id,
      household_id,
      created_by,
      provider,
      external_consent_id
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'polp',
      'wrong-provider-consent'
    )
  $sql$,
  '23503'
);

select throws_ok(
  $sql$
    insert into public.bank_sync_runs (
      connection_id,
      household_id,
      created_by,
      provider,
      month_key
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'polp',
      '2026-08'
    )
  $sql$,
  '23503'
);

select throws_ok(
  $sql$
    insert into public.imported_bank_transactions (
      connection_id,
      household_id,
      created_by,
      provider,
      external_transaction_id,
      external_account_id,
      occurred_on,
      description,
      amount_cents,
      direction,
      transaction_fingerprint
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'polp',
      'wrong-provider-import',
      'same-external-account',
      date '2026-08-10',
      'Wrong provider import',
      100,
      'expense',
      'wrong-provider-import-fingerprint'
    )
  $sql$,
  '23503'
);

insert into public.bank_connection_consents (
  id,
  connection_id,
  household_id,
  created_by,
  provider,
  external_consent_id
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'pluggy',
    'pluggy-test-consent'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'polp',
    'polp-test-consent'
  );

insert into public.bank_sync_runs (
  id,
  connection_id,
  household_id,
  created_by,
  provider,
  month_key
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'pluggy',
    '2026-08'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'polp',
    '2026-08'
  );

select throws_ok(
  $sql$
    insert into public.imported_bank_transactions (
      sync_run_id,
      connection_id,
      household_id,
      created_by,
      provider,
      external_transaction_id,
      external_account_id,
      occurred_on,
      description,
      amount_cents,
      direction,
      transaction_fingerprint
    ) values (
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'polp',
      'wrong-sync-context-import',
      'same-external-account',
      date '2026-08-10',
      'Wrong sync context import',
      100,
      'expense',
      'wrong-sync-context-fingerprint'
    )
  $sql$,
  '23503'
);

-- Exercise the final ACLs as the real client roles. Catalog assertions above
-- are useful diagnostics, but these calls prove PostgreSQL itself rejects the
-- operation before any RPC or table body can run.
set local role anon;

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'anon-must-not-run',
      p_occurred_on => date '2026-08-10',
      p_description => 'Denied anonymous RPC',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '42501',
  'permission denied for function import_open_finance_transaction',
  'anon is rejected when it actually invokes the RPC'
);

select throws_ok(
  $sql$select count(*) from public.bank_connections$sql$,
  '42501',
  'permission denied for table bank_connections',
  'anon is rejected when it actually reads a banking table'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'authenticated-must-not-run',
      p_occurred_on => date '2026-08-10',
      p_description => 'Denied authenticated RPC',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '42501',
  'permission denied for function import_open_finance_transaction',
  'authenticated is rejected when it actually invokes the RPC'
);

select throws_ok(
  $sql$
    insert into public.bank_sync_runs (
      connection_id,
      household_id,
      created_by,
      provider,
      month_key
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'pluggy',
      '2026-09'
    )
  $sql$,
  '42501',
  'permission denied for table bank_sync_runs',
  'authenticated is rejected when it actually writes a banking table'
);

reset role;

-- ---------------------------------------------------------------------------
-- Atomic RPC identity and validation.
-- ---------------------------------------------------------------------------

create temporary table open_finance_rpc_results (
  invocation text primary key,
  imported_bank_transaction_id uuid not null,
  transaction_id uuid not null,
  inserted boolean not null,
  content_changed boolean not null
) on commit drop;

grant insert, select on table open_finance_rpc_results to service_role;
set local role service_role;

insert into open_finance_rpc_results
select
  'pluggy-first',
  result.imported_bank_transaction_id,
  result.transaction_id,
  result.inserted,
  result.content_changed
from public.import_open_finance_transaction(
  p_provider => 'pluggy',
  p_connection_id => '30000000-0000-4000-8000-000000000001',
  p_household_id => '20000000-0000-4000-8000-000000000001',
  p_created_by => '10000000-0000-4000-8000-000000000001',
  p_external_account_id => 'same-external-account',
  p_external_transaction_id => 'same-external-transaction',
  p_occurred_on => date '2026-08-10',
  p_description => 'Coffee shop',
  p_amount_cents => 1250,
  p_direction => 'expense',
  p_sync_run_id => '50000000-0000-4000-8000-000000000001',
  p_posted_at => timestamptz '2026-08-10 12:00:00+00',
  p_raw_payload => '{"revision":1}'::jsonb
) as result;

reset role;

insert into open_finance_rpc_results
select
  'pluggy-identical',
  result.imported_bank_transaction_id,
  result.transaction_id,
  result.inserted,
  result.content_changed
from public.import_open_finance_transaction(
  p_provider => 'pluggy',
  p_connection_id => '30000000-0000-4000-8000-000000000001',
  p_household_id => '20000000-0000-4000-8000-000000000001',
  p_created_by => '10000000-0000-4000-8000-000000000001',
  p_external_account_id => 'same-external-account',
  p_external_transaction_id => 'same-external-transaction',
  p_occurred_on => date '2026-08-10',
  p_description => 'Coffee shop',
  p_amount_cents => 1250,
  p_direction => 'expense',
  p_sync_run_id => '50000000-0000-4000-8000-000000000001',
  p_posted_at => timestamptz '2026-08-10 12:00:00+00',
  p_raw_payload => '{"revision":1}'::jsonb
) as result;

insert into open_finance_rpc_results
select
  'pluggy-corrected',
  result.imported_bank_transaction_id,
  result.transaction_id,
  result.inserted,
  result.content_changed
from public.import_open_finance_transaction(
  p_provider => 'pluggy',
  p_connection_id => '30000000-0000-4000-8000-000000000001',
  p_household_id => '20000000-0000-4000-8000-000000000001',
  p_created_by => '10000000-0000-4000-8000-000000000001',
  p_external_account_id => 'same-external-account',
  p_external_transaction_id => 'same-external-transaction',
  p_occurred_on => date '2026-08-11',
  p_description => 'Coffee shop corrected',
  p_amount_cents => 1350,
  p_direction => 'expense',
  p_sync_run_id => '50000000-0000-4000-8000-000000000001',
  p_posted_at => timestamptz '2026-08-11 12:00:00+00',
  p_raw_payload => '{"revision":2}'::jsonb
) as result;

insert into open_finance_rpc_results
select
  'polp-same-external-id',
  result.imported_bank_transaction_id,
  result.transaction_id,
  result.inserted,
  result.content_changed
from public.import_open_finance_transaction(
  p_provider => 'polp',
  p_connection_id => '30000000-0000-4000-8000-000000000002',
  p_household_id => '20000000-0000-4000-8000-000000000001',
  p_created_by => '10000000-0000-4000-8000-000000000001',
  p_external_account_id => 'same-external-account',
  p_external_transaction_id => 'same-external-transaction',
  p_occurred_on => date '2026-08-10',
  p_description => 'Coffee shop',
  p_amount_cents => 1250,
  p_direction => 'expense',
  p_sync_run_id => '50000000-0000-4000-8000-000000000002',
  p_posted_at => timestamptz '2026-08-10 12:00:00+00',
  p_raw_payload => '{"revision":1}'::jsonb
) as result;

select is(
  (select inserted from open_finance_rpc_results where invocation = 'pluggy-first'),
  true,
  'the first external transaction import is new'
);
select matches(
  (
    select imported.transaction_fingerprint
    from public.imported_bank_transactions as imported
    where imported.id = (
      select result.imported_bank_transaction_id
      from open_finance_rpc_results as result
      where result.invocation = 'pluggy-first'
    )
  ),
  '^sha256:[0-9a-f]{64}$',
  'content fingerprint has a fixed-size SHA-256 representation'
);
select is(
  (select inserted from open_finance_rpc_results where invocation = 'pluggy-identical'),
  false,
  'an identical retry is not inserted again'
);
select is(
  (select content_changed from open_finance_rpc_results where invocation = 'pluggy-identical'),
  false,
  'an identical retry has unchanged content'
);
select is(
  (select inserted from open_finance_rpc_results where invocation = 'pluggy-corrected'),
  false,
  'corrected date/value do not create a second external identity'
);
select is(
  (select content_changed from open_finance_rpc_results where invocation = 'pluggy-corrected'),
  true,
  'corrected date/value are reported as changed content'
);
select is(
  (
    select count(distinct imported_bank_transaction_id)
    from open_finance_rpc_results
    where invocation like 'pluggy-%'
  ),
  1::bigint,
  'all Pluggy retries resolve to one imported row'
);
select is(
  (
    select count(distinct transaction_id)
    from open_finance_rpc_results
    where invocation like 'pluggy-%'
  ),
  1::bigint,
  'all Pluggy retries resolve to one transactions row'
);
select is(
  (select inserted from open_finance_rpc_results where invocation = 'polp-same-external-id'),
  true,
  'the same external transaction ID under Polp is an independent identity'
);
select is(
  (
    select count(*)
    from public.imported_bank_transactions
    where external_transaction_id = 'same-external-transaction'
  ),
  2::bigint,
  'provider/connection/account identity stores one Pluggy and one Polp import'
);
select is(
  (
    select count(distinct transaction_id)
    from public.imported_bank_transactions
    where external_transaction_id = 'same-external-transaction'
  ),
  2::bigint,
  'cross-provider imports create distinct transactions rows'
);

select is(
  (
    select count(*)
    from public.transactions as ledger
    where ledger.id in (
      select distinct result.transaction_id
      from open_finance_rpc_results as result
    )
      and not exists (
        select 1
        from public.imported_bank_transactions as imported
        where imported.transaction_id = ledger.id
      )
  ),
  0::bigint,
  'successful RPC imports leave no unassociated transactions rows'
);

select throws_ok(
  $sql$
    insert into public.imported_bank_transactions (
      connection_id,
      household_id,
      created_by,
      provider,
      external_transaction_id,
      external_account_id,
      occurred_on,
      description,
      amount_cents,
      direction,
      transaction_fingerprint,
      transaction_id
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'pluggy',
      'second-identity-same-ledger',
      'same-external-account',
      date '2026-08-10',
      'Second identity for same ledger',
      1250,
      'expense',
      'second-identity-same-ledger-fingerprint',
      (
        select transaction_id
        from open_finance_rpc_results
        where invocation = 'pluggy-first'
      )
    )
  $sql$,
  '23505'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'invalid-provider',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-invalid-provider',
      p_occurred_on => date '2026-08-10',
      p_description => 'Invalid provider',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '22023',
  'OPEN_FINANCE_INVALID_PROVIDER',
  'the RPC rejects an invalid provider'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000002',
      p_created_by => '10000000-0000-4000-8000-000000000002',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-wrong-household',
      p_occurred_on => date '2026-08-10',
      p_description => 'Wrong household',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '23503',
  'OPEN_FINANCE_CONNECTION_CONTEXT_MISMATCH',
  'the RPC rejects a connection from another household'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'polp',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-wrong-provider',
      p_occurred_on => date '2026-08-10',
      p_description => 'Wrong provider',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '23503',
  'OPEN_FINANCE_CONNECTION_CONTEXT_MISMATCH',
  'the RPC rejects a connection from another provider'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'another-external-account',
      p_external_transaction_id => 'rpc-wrong-account',
      p_occurred_on => date '2026-08-10',
      p_description => 'Wrong account',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '23514',
  'OPEN_FINANCE_CONNECTION_ACCOUNT_MISMATCH',
  'the RPC rejects an account outside the connection context'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000002',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-wrong-creator',
      p_occurred_on => date '2026-08-10',
      p_description => 'Wrong creator',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '42501',
  'OPEN_FINANCE_USER_NOT_HOUSEHOLD_MEMBER',
  'the RPC rejects a creator who is not a household member'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-wrong-sync',
      p_occurred_on => date '2026-08-10',
      p_description => 'Wrong sync',
      p_amount_cents => 100,
      p_direction => 'expense',
      p_sync_run_id => '50000000-0000-4000-8000-000000000002'
    )
  $sql$,
  '23503',
  'OPEN_FINANCE_SYNC_CONTEXT_MISMATCH',
  'the RPC rejects a sync run from another connection/provider'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-invalid-date',
      p_occurred_on => '2026-02-30',
      p_description => 'Invalid date',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '22008'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-non-finite-date',
      p_occurred_on => date 'infinity',
      p_description => 'Non-finite date',
      p_amount_cents => 100,
      p_direction => 'expense'
    )
  $sql$,
  '22023',
  'OPEN_FINANCE_INVALID_OCCURRED_ON',
  'the RPC rejects a non-finite PostgreSQL date'
);

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-invalid-amount',
      p_occurred_on => date '2026-08-10',
      p_description => 'Invalid amount',
      p_amount_cents => 0,
      p_direction => 'expense'
    )
  $sql$,
  '22023',
  'OPEN_FINANCE_INVALID_AMOUNT',
  'the RPC rejects a non-positive amount'
);

-- Force an error after the RPC has reserved the imported identity and inserted
-- its transactions row. PostgreSQL must roll both writes back atomically.
create function public.__test_fail_open_finance_import_association()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'OPEN_FINANCE_TEST_ASSOCIATION_FAILURE';
end;
$function$;

create trigger __test_fail_open_finance_import_association
before update of transaction_id on public.imported_bank_transactions
for each row
when (
  old.transaction_id is null
  and new.transaction_id is not null
  and new.external_transaction_id = 'rpc-rollback'
)
execute function public.__test_fail_open_finance_import_association();

create temporary table open_finance_rollback_counts
on commit drop
as
select
  (select count(*) from public.imported_bank_transactions) as imported_count,
  (select count(*) from public.transactions) as transaction_count;

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'rpc-rollback',
      p_occurred_on => date '2026-08-10',
      p_description => 'Rollback test',
      p_amount_cents => 100,
      p_direction => 'expense',
      p_sync_run_id => '50000000-0000-4000-8000-000000000001'
    )
  $sql$,
  'P0001',
  'OPEN_FINANCE_TEST_ASSOCIATION_FAILURE',
  'an association failure aborts the RPC'
);

select is(
  (select count(*) from public.imported_bank_transactions),
  (select imported_count from open_finance_rollback_counts),
  'rollback removes the reserved imported identity'
);
select is(
  (select count(*) from public.transactions),
  (select transaction_count from open_finance_rollback_counts),
  'rollback removes the newly inserted transactions row'
);

drop trigger __test_fail_open_finance_import_association
on public.imported_bank_transactions;
drop function public.__test_fail_open_finance_import_association();

-- ---------------------------------------------------------------------------
-- Runtime RLS: a member can see their household while another authenticated
-- user cannot see any of its rows in any shared banking table.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select results_eq(
  $sql$
    select count(*)
    from public.bank_connections
    where household_id = '20000000-0000-4000-8000-000000000001'
  $sql$,
  array[2::bigint],
  'a member sees their Pluggy and Polp connections'
);
select results_eq(
  $sql$
    select count(*)
    from public.bank_connection_consents
    where household_id = '20000000-0000-4000-8000-000000000001'
  $sql$,
  array[2::bigint],
  'a member sees their connection consents'
);
select results_eq(
  $sql$
    select count(*)
    from public.bank_sync_runs
    where household_id = '20000000-0000-4000-8000-000000000001'
  $sql$,
  array[2::bigint],
  'a member sees their sync runs'
);
select results_eq(
  $sql$
    select count(*)
    from public.imported_bank_transactions
    where household_id = '20000000-0000-4000-8000-000000000001'
  $sql$,
  array[2::bigint],
  'a member sees their imported transactions'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);

select results_eq(
  $sql$
    select count(*)
    from public.bank_connections
    where household_id = '20000000-0000-4000-8000-000000000001'
  $sql$,
  array[0::bigint],
  'RLS hides another household connections'
);
select results_eq(
  $sql$
    select count(*)
    from public.bank_connection_consents
    where household_id = '20000000-0000-4000-8000-000000000001'
  $sql$,
  array[0::bigint],
  'RLS hides another household consents'
);
select results_eq(
  $sql$
    select count(*)
    from public.bank_sync_runs
    where household_id = '20000000-0000-4000-8000-000000000001'
  $sql$,
  array[0::bigint],
  'RLS hides another household sync runs'
);
select results_eq(
  $sql$
    select count(*)
    from public.imported_bank_transactions
    where household_id = '20000000-0000-4000-8000-000000000001'
  $sql$,
  array[0::bigint],
  'RLS hides another household imported transactions'
);

reset role;

-- A pre-existing identity whose ledger row was unlinked is ambiguous. The RPC
-- must fail closed instead of silently creating a second transactions row.
update public.imported_bank_transactions
set transaction_id = null
where provider = 'pluggy'
  and connection_id = '30000000-0000-4000-8000-000000000001'
  and external_account_id = 'same-external-account'
  and external_transaction_id = 'same-external-transaction';

select throws_ok(
  $sql$
    select *
    from public.import_open_finance_transaction(
      p_provider => 'pluggy',
      p_connection_id => '30000000-0000-4000-8000-000000000001',
      p_household_id => '20000000-0000-4000-8000-000000000001',
      p_created_by => '10000000-0000-4000-8000-000000000001',
      p_external_account_id => 'same-external-account',
      p_external_transaction_id => 'same-external-transaction',
      p_occurred_on => date '2026-08-10',
      p_description => 'Coffee shop',
      p_amount_cents => 1250,
      p_direction => 'expense'
    )
  $sql$,
  '55000',
  'OPEN_FINANCE_EXISTING_IDENTITY_REQUIRES_RECONCILIATION',
  'an unlinked existing identity fails closed instead of duplicating the ledger'
);

select is(
  (
    select count(*)
    from public.imported_bank_transactions
    where provider = 'pluggy'
      and connection_id = '30000000-0000-4000-8000-000000000001'
      and external_account_id = 'same-external-account'
      and external_transaction_id = 'same-external-transaction'
  ),
  1::bigint,
  'the ambiguous existing identity remains singular'
);

select * from finish();
rollback;
