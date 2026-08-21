-- Open Finance expand phase: multi-provider integrity and atomic import RPC.
--
-- This migration intentionally follows the adopted banking baseline. It must
-- not be applied to the current remote database until the baseline has been
-- reviewed and registered through the separate adoption procedure.
--
-- This is the compatibility phase of the rollout. It only adds constraints,
-- indexes and the service-only RPC. In particular, it preserves every legacy
-- foreign key, unique constraint, table grant and RLS policy used by the
-- existing Pluggy Edge Function. Apply the contract/hardening migration only
-- after Pluggy has moved all transaction imports to the RPC.

begin;

-- Run every data compatibility check before adding constraints.
-- Existing ambiguity is a manual reconciliation task: this migration never
-- rewrites providers, guesses account ownership, or deduplicates rows.
do $preflight$
declare
  conflicting_rows bigint;
  sample_value text;
begin
  if to_regclass('public.bank_connections') is null
    or to_regclass('public.bank_connection_consents') is null
    or to_regclass('public.bank_sync_runs') is null
    or to_regclass('public.imported_bank_transactions') is null
  then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_BASELINE_MISSING',
      detail = 'Adopt or apply the reviewed Open Finance banking baseline before this migration.';
  end if;

  select connection.provider
    into sample_value
  from public.bank_connections as connection
  where connection.provider not in ('pluggy', 'polp')
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_INVALID_CONNECTION_PROVIDER',
      detail = format('Unsupported bank_connections.provider: %L.', sample_value);
  end if;

  select consent.provider
    into sample_value
  from public.bank_connection_consents as consent
  where consent.provider not in ('pluggy', 'polp')
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_INVALID_CONSENT_PROVIDER',
      detail = format('Unsupported bank_connection_consents.provider: %L.', sample_value);
  end if;

  select sync_run.provider
    into sample_value
  from public.bank_sync_runs as sync_run
  where sync_run.provider not in ('pluggy', 'polp')
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_INVALID_SYNC_PROVIDER',
      detail = format('Unsupported bank_sync_runs.provider: %L.', sample_value);
  end if;

  select imported.provider
    into sample_value
  from public.imported_bank_transactions as imported
  where imported.provider not in ('pluggy', 'polp')
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_INVALID_TRANSACTION_PROVIDER',
      detail = format('Unsupported imported_bank_transactions.provider: %L.', sample_value);
  end if;

  select connection.id::text
    into sample_value
  from public.bank_connections as connection
  where nullif(btrim(connection.external_account_id), '') is null
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_BLANK_CONNECTION_ACCOUNT_ID',
      detail = format('bank_connections row %s has an empty external_account_id.', sample_value);
  end if;

  select imported.id::text
    into sample_value
  from public.imported_bank_transactions as imported
  where nullif(btrim(imported.external_account_id), '') is null
    or nullif(btrim(imported.external_transaction_id), '') is null
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_INCOMPLETE_TRANSACTION_IDENTITY',
      detail = format(
        'imported_bank_transactions row %s has a null or empty external account/transaction ID.',
        sample_value
      );
  end if;

  select imported.id::text
    into sample_value
  from public.imported_bank_transactions as imported
  where imported.amount_cents <= 0
    or not isfinite(imported.occurred_on)
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_INVALID_TRANSACTION_VALUE',
      detail = format(
        'imported_bank_transactions row %s has a non-positive amount or non-finite date.',
        sample_value
      );
  end if;

  select consent.id::text
    into sample_value
  from public.bank_connection_consents as consent
  left join public.bank_connections as connection
    on connection.id = consent.connection_id
   and connection.household_id = consent.household_id
   and connection.provider = consent.provider
  where connection.id is null
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_CONSENT_CONTEXT_MISMATCH',
      detail = format(
        'bank_connection_consents row %s does not match its connection household/provider.',
        sample_value
      );
  end if;

  select sync_run.id::text
    into sample_value
  from public.bank_sync_runs as sync_run
  left join public.bank_connections as connection
    on connection.id = sync_run.connection_id
   and connection.household_id = sync_run.household_id
   and connection.provider = sync_run.provider
  where connection.id is null
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_SYNC_CONTEXT_MISMATCH',
      detail = format(
        'bank_sync_runs row %s does not match its connection household/provider.',
        sample_value
      );
  end if;

  select imported.id::text
    into sample_value
  from public.imported_bank_transactions as imported
  left join public.bank_connections as connection
    on connection.id = imported.connection_id
   and connection.household_id = imported.household_id
   and connection.provider = imported.provider
   and connection.external_account_id = imported.external_account_id
  where connection.id is null
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_TRANSACTION_CONNECTION_MISMATCH',
      detail = format(
        'imported_bank_transactions row %s does not match its connection household/provider/account.',
        sample_value
      );
  end if;

  select imported.id::text
    into sample_value
  from public.imported_bank_transactions as imported
  left join public.bank_sync_runs as sync_run
    on sync_run.id = imported.sync_run_id
   and sync_run.connection_id = imported.connection_id
   and sync_run.household_id = imported.household_id
   and sync_run.provider = imported.provider
  where imported.sync_run_id is not null
    and sync_run.id is null
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_TRANSACTION_SYNC_MISMATCH',
      detail = format(
        'imported_bank_transactions row %s does not match its sync run context.',
        sample_value
      );
  end if;

  select imported.id::text
    into sample_value
  from public.imported_bank_transactions as imported
  join public.transactions as ledger
    on ledger.id = imported.transaction_id
  where imported.transaction_id is not null
    and ledger.household_id <> imported.household_id
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_TRANSACTION_LEDGER_CONTEXT_MISMATCH',
      detail = format(
        'imported_bank_transactions row %s links to a transactions row from another household.',
        sample_value
      );
  end if;

  select count(*), min(conflict.identity)
    into conflicting_rows, sample_value
  from (
    select format(
      'transaction_id=%s count=%s',
      imported.transaction_id,
      count(*)
    ) as identity
    from public.imported_bank_transactions as imported
    where imported.transaction_id is not null
    group by imported.transaction_id
    having count(*) > 1
  ) as conflict;

  if conflicting_rows > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_DUPLICATE_LEDGER_LINK',
      detail = format(
        '%s transactions rows are linked by more than one imported identity. Example: %s. Reconcile them manually; no rows were changed.',
        conflicting_rows,
        sample_value
      );
  end if;

  select count(*), min(conflict.identity)
    into conflicting_rows, sample_value
  from (
    select format(
      'provider=%L connection_id=%s external_account_id=%L external_transaction_id=%L count=%s',
      imported.provider,
      imported.connection_id,
      imported.external_account_id,
      imported.external_transaction_id,
      count(*)
    ) as identity
    from public.imported_bank_transactions as imported
    group by
      imported.provider,
      imported.connection_id,
      imported.external_account_id,
      imported.external_transaction_id
    having count(*) > 1
  ) as conflict;

  if conflicting_rows > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_PREFLIGHT_DUPLICATE_EXTERNAL_IDENTITY',
      detail = format(
        '%s stable external identities are ambiguous. Example: %s. Reconcile them manually; no rows were changed.',
        conflicting_rows,
        sample_value
      );
  end if;
end
$preflight$;

alter table public.bank_connections
  add constraint bank_connections_provider_check
    check (provider in ('pluggy', 'polp')),
  add constraint bank_connections_external_account_id_check
    check (nullif(btrim(external_account_id), '') is not null),
  add constraint bank_connections_context_key
    unique (id, household_id, provider),
  add constraint bank_connections_account_context_key
    unique (id, household_id, provider, external_account_id);

alter table public.bank_connection_consents
  add constraint bank_connection_consents_provider_check
    check (provider in ('pluggy', 'polp')),
  add constraint bank_consents_connection_context_fkey
    foreign key (connection_id, household_id, provider)
    references public.bank_connections (id, household_id, provider)
    on delete cascade;

alter table public.bank_sync_runs
  add constraint bank_sync_runs_provider_check
    check (provider in ('pluggy', 'polp')),
  add constraint bank_sync_runs_context_key
    unique (id, connection_id, household_id, provider),
  add constraint bank_sync_runs_connection_context_fkey
    foreign key (connection_id, household_id, provider)
    references public.bank_connections (id, household_id, provider)
    on delete cascade;

alter table public.transactions
  add constraint transactions_open_finance_context_key
    unique (id, household_id);

alter table public.imported_bank_transactions
  add constraint imported_bank_transactions_provider_check
    check (provider in ('pluggy', 'polp')),
  add constraint imported_bank_tx_external_ids_check
    check (
      external_account_id is not null
      and nullif(btrim(external_account_id), '') is not null
      and external_transaction_id is not null
      and nullif(btrim(external_transaction_id), '') is not null
    ),
  add constraint imported_bank_tx_amount_positive_check
    check (amount_cents > 0),
  add constraint imported_bank_tx_occurred_on_finite_check
    check (isfinite(occurred_on)),
  add constraint imported_bank_tx_connection_context_fkey
    foreign key (connection_id, household_id, provider, external_account_id)
    references public.bank_connections (
      id,
      household_id,
      provider,
      external_account_id
    )
    on delete cascade,
  add constraint imported_bank_tx_sync_context_fkey
    foreign key (sync_run_id, connection_id, household_id, provider)
    references public.bank_sync_runs (
      id,
      connection_id,
      household_id,
      provider
    )
    on delete set null (sync_run_id),
  add constraint imported_bank_tx_transaction_context_fkey
    foreign key (transaction_id, household_id)
    references public.transactions (id, household_id)
    on delete set null (transaction_id),
  add constraint imported_bank_tx_transaction_id_key
    unique (transaction_id),
  add constraint imported_bank_tx_external_identity_key
    unique (
      provider,
      connection_id,
      external_account_id,
      external_transaction_id
    );

create index bank_connections_provider_external_connection_idx
  on public.bank_connections (provider, external_connection_id, household_id)
  where external_connection_id is not null;

create index bank_connections_provider_external_account_idx
  on public.bank_connections (provider, external_account_id, household_id);

create index bank_consents_provider_external_consent_idx
  on public.bank_connection_consents (provider, external_consent_id, household_id)
  where external_consent_id is not null;

create index bank_sync_runs_provider_connection_started_idx
  on public.bank_sync_runs (provider, connection_id, started_at desc);

create index imported_bank_tx_content_fingerprint_idx
  on public.imported_bank_transactions (
    provider,
    connection_id,
    transaction_fingerprint
  );

-- The historical application migrations predate explicit grants on these two
-- RPC dependencies. Add only the privileges required by the legacy Pluggy
-- writer and by this SECURITY INVOKER function: membership lookup/key lock
-- plus ledger insert-and-return. PostgreSQL requires UPDATE privilege for
-- SELECT ... FOR KEY SHARE. No client-facing role receives privileges here.
grant select, update on table public.memberships to service_role;
grant select, insert on table public.transactions to service_role;

-- Reserve the provider-scoped external identity before creating a local
-- transaction. The stable unique constraint is the final concurrency guard;
-- the advisory transaction lock avoids unnecessary speculative inserts and
-- also serializes the duplicate-read path. A raised error rolls back the
-- reservation, local transaction and association as one RPC statement.
-- A repeated identity never overwrites ledger data: content_changed tells the
-- caller that an explicit reconciliation workflow is required.
-- Identity boundary: the service-only Edge caller must validate the Bearer JWT
-- with Supabase Auth and pass the resulting user.id as p_created_by. It must
-- never copy created_by (or an equivalent user ID) from the mobile request body.
create function public.import_open_finance_transaction(
  p_provider text,
  p_connection_id uuid,
  p_household_id uuid,
  p_created_by uuid,
  p_external_account_id text,
  p_external_transaction_id text,
  p_occurred_on date,
  p_description text,
  p_amount_cents bigint,
  p_direction text,
  p_sync_run_id uuid default null,
  p_posted_at timestamp with time zone default null,
  p_raw_payload jsonb default null
)
returns table (
  imported_bank_transaction_id uuid,
  transaction_id uuid,
  inserted boolean,
  content_changed boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  connection_external_account_id text;
  content_fingerprint text;
  existing_amount_cents bigint;
  existing_description text;
  existing_direction text;
  existing_occurred_on date;
  imported_id uuid;
  local_transaction_id uuid;
  normalized_description text;
begin
  if p_provider is null or p_provider not in ('pluggy', 'polp') then
    raise exception using
      errcode = '22023',
      message = 'OPEN_FINANCE_INVALID_PROVIDER';
  end if;

  if p_connection_id is null
    or p_household_id is null
    or p_created_by is null
  then
    raise exception using
      errcode = '22023',
      message = 'OPEN_FINANCE_INVALID_INTERNAL_CONTEXT';
  end if;

  if nullif(pg_catalog.btrim(p_external_account_id), '') is null
    or nullif(pg_catalog.btrim(p_external_transaction_id), '') is null
  then
    raise exception using
      errcode = '22023',
      message = 'OPEN_FINANCE_INVALID_EXTERNAL_IDENTITY';
  end if;

  if p_occurred_on is null or not pg_catalog.isfinite(p_occurred_on) then
    raise exception using
      errcode = '22023',
      message = 'OPEN_FINANCE_INVALID_OCCURRED_ON';
  end if;

  if p_posted_at is not null and not pg_catalog.isfinite(p_posted_at) then
    raise exception using
      errcode = '22023',
      message = 'OPEN_FINANCE_INVALID_POSTED_AT';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using
      errcode = '22023',
      message = 'OPEN_FINANCE_INVALID_AMOUNT';
  end if;

  if p_direction is null or p_direction not in ('income', 'expense') then
    raise exception using
      errcode = '22023',
      message = 'OPEN_FINANCE_INVALID_DIRECTION';
  end if;

  if nullif(pg_catalog.btrim(p_description), '') is null then
    raise exception using
      errcode = '22023',
      message = 'OPEN_FINANCE_INVALID_DESCRIPTION';
  end if;

  select connection.external_account_id
    into connection_external_account_id
  from public.bank_connections as connection
  where connection.id = p_connection_id
    and connection.household_id = p_household_id
    and connection.provider = p_provider
  for key share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'OPEN_FINANCE_CONNECTION_CONTEXT_MISMATCH';
  end if;

  if connection_external_account_id is distinct from p_external_account_id then
    raise exception using
      errcode = '23514',
      message = 'OPEN_FINANCE_CONNECTION_ACCOUNT_MISMATCH';
  end if;

  perform 1
  from public.memberships as membership
  where membership.household_id = p_household_id
    and membership.user_id = p_created_by
  for key share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'OPEN_FINANCE_USER_NOT_HOUSEHOLD_MEMBER';
  end if;

  if p_sync_run_id is not null then
    perform 1
    from public.bank_sync_runs as sync_run
    where sync_run.id = p_sync_run_id
      and sync_run.connection_id = p_connection_id
      and sync_run.household_id = p_household_id
      and sync_run.provider = p_provider
    for key share;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'OPEN_FINANCE_SYNC_CONTEXT_MISMATCH';
    end if;
  end if;

  normalized_description := pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(p_description),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );

  -- The legacy baseline still has UNIQUE (connection_id,
  -- transaction_fingerprint) during this expand phase. Scope the fingerprint
  -- by stable external identity as well as content so two distinct external
  -- transactions with identical content remain valid until 0003 removes that
  -- legacy uniqueness rule. content_changed is calculated from stored fields
  -- below and therefore does not depend on this digest.
  content_fingerprint := 'sha256:' || pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        'open-finance-transaction-fingerprint:v2|'
          || pg_catalog.jsonb_build_array(
            p_provider,
            p_connection_id::text,
            p_external_account_id,
            p_external_transaction_id,
            p_occurred_on::text,
            p_amount_cents,
            p_direction,
            normalized_description
          )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'open-finance-external-identity:v1|'
        || pg_catalog.jsonb_build_array(
          p_provider,
          p_connection_id::text,
          p_external_account_id,
          p_external_transaction_id
        )::text,
      0
    )
  );

  insert into public.imported_bank_transactions as imported (
    sync_run_id,
    connection_id,
    household_id,
    created_by,
    provider,
    external_transaction_id,
    external_account_id,
    posted_at,
    occurred_on,
    description,
    amount_cents,
    direction,
    transaction_fingerprint,
    transaction_id,
    raw_payload
  ) values (
    p_sync_run_id,
    p_connection_id,
    p_household_id,
    p_created_by,
    p_provider,
    p_external_transaction_id,
    p_external_account_id,
    p_posted_at,
    p_occurred_on,
    pg_catalog.btrim(p_description),
    p_amount_cents,
    p_direction,
    content_fingerprint,
    null,
    p_raw_payload
  )
  on conflict on constraint imported_bank_tx_external_identity_key do nothing
  returning imported.id into imported_id;

  if imported_id is null then
    select
      imported.id,
      imported.transaction_id,
      imported.occurred_on,
      imported.amount_cents,
      imported.direction,
      imported.description
    into
      imported_id,
      local_transaction_id,
      existing_occurred_on,
      existing_amount_cents,
      existing_direction,
      existing_description
    from public.imported_bank_transactions as imported
    where imported.provider = p_provider
      and imported.connection_id = p_connection_id
      and imported.external_account_id = p_external_account_id
      and imported.external_transaction_id = p_external_transaction_id
    for update;

    if not found then
      raise exception using
        errcode = '40001',
        message = 'OPEN_FINANCE_IDENTITY_CHANGED_DURING_IMPORT',
        hint = 'Retry the complete RPC call.';
    end if;

    if local_transaction_id is null then
      raise exception using
        errcode = '55000',
        message = 'OPEN_FINANCE_EXISTING_IDENTITY_REQUIRES_RECONCILIATION',
        detail = format(
          'Imported bank transaction %s exists without a linked transactions row.',
          imported_id
        ),
        hint = 'Reconcile the existing identity explicitly; the RPC will not recreate a deleted ledger row.';
    end if;

    return query
    select
      imported_id,
      local_transaction_id,
      false,
      existing_occurred_on is distinct from p_occurred_on
        or existing_amount_cents is distinct from p_amount_cents
        or existing_direction is distinct from p_direction
        or pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.btrim(existing_description),
            '[[:space:]]+',
            ' ',
            'g'
          )
        ) is distinct from normalized_description;
    return;
  end if;

  insert into public.transactions (
    household_id,
    type,
    amount_cents,
    category_id,
    note,
    occurred_on,
    created_by
  ) values (
    p_household_id,
    p_direction,
    p_amount_cents,
    null,
    pg_catalog.btrim(p_description),
    p_occurred_on,
    p_created_by
  )
  returning id into local_transaction_id;

  update public.imported_bank_transactions as imported
  set transaction_id = local_transaction_id
  where imported.id = imported_id
    and imported.transaction_id is null;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'OPEN_FINANCE_TRANSACTION_ASSOCIATION_FAILED';
  end if;

  return query
  select imported_id, local_transaction_id, true, false;
end;
$function$;

alter function public.import_open_finance_transaction(
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  text,
  bigint,
  text,
  uuid,
  timestamp with time zone,
  jsonb
) owner to postgres;

revoke all on function public.import_open_finance_transaction(
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  text,
  bigint,
  text,
  uuid,
  timestamp with time zone,
  jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.import_open_finance_transaction(
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  text,
  bigint,
  text,
  uuid,
  timestamp with time zone,
  jsonb
) to service_role;

notify pgrst, 'reload schema';

commit;
