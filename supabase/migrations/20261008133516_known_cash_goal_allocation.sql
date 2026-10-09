-- Known-cash allocation foundation.
-- A contribution is an earmark, not a bank transaction.
-- source_kind makes that meaning explicit:
--   cycle_surplus  — only allocate_cycle_surplus
--   manual_unverified — "já guardei" or any legacy row without a closure
--   known_cash — only allocate_known_cash_to_goal
-- Ambiguous manual rows block a new known-cash distribution.
-- The allocatable amount is recomputed on the server from statement snapshots.
-- It is not the observed historical result and it ignores planned income.
--
-- Trusted writes are not a client flag. allocate_known_cash_to_goal and
-- allocate_cycle_surplus are security definer, so current_user inside them
-- is the function owner. The trigger allows known_cash and cycle_surplus
-- only for that owner. authenticated and anon cannot insert, relabel,
-- mutate, or delete those rows.
-- A future undo must be an explicit audited reversal, not a physical delete
-- of the trusted earmark. This migration does not add that operation.

alter table public.goal_contribution_entries
  add column if not exists source_kind text;

update public.goal_contribution_entries
set source_kind = case
  when cycle_closure_id is not null then 'cycle_surplus'
  else 'manual_unverified'
end
where source_kind is null;

alter table public.goal_contribution_entries
  alter column source_kind set default 'manual_unverified';

update public.goal_contribution_entries
set source_kind = 'manual_unverified'
where source_kind is null;

alter table public.goal_contribution_entries
  alter column source_kind set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goal_contribution_entries_source_kind_check'
      and conrelid = 'public.goal_contribution_entries'::regclass
  ) then
    alter table public.goal_contribution_entries
      add constraint goal_contribution_entries_source_kind_check
      check (source_kind in ('cycle_surplus', 'manual_unverified', 'known_cash'));
  end if;
end;
$$;

create index if not exists goal_contribution_entries_household_source_kind_idx
  on public.goal_contribution_entries (household_id, source_kind);

create or replace function public.assign_goal_contribution_source_kind()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.source_kind in ('known_cash', 'cycle_surplus')
       and current_user in ('authenticated', 'anon') then
      raise exception using errcode = '42501', message = 'known_cash:trusted_earmark_delete_forbidden';
    end if;
    return old;
  end if;

  -- A closure is the proof allocate_cycle_surplus writes. The column default
  -- would otherwise leave that new row as manual_unverified.
  if new.cycle_closure_id is not null and new.source_kind is distinct from 'known_cash' then
    new.source_kind := 'cycle_surplus';
  elsif new.source_kind is null then
    new.source_kind := 'manual_unverified';
  end if;

  if new.source_kind not in ('cycle_surplus', 'manual_unverified', 'known_cash') then
    raise exception using errcode = '23514', message = 'known_cash:invalid_source_kind';
  end if;

  if new.source_kind = 'cycle_surplus' and new.cycle_closure_id is null then
    raise exception using errcode = '23514', message = 'known_cash:cycle_surplus_requires_closure';
  end if;

  if current_user in ('authenticated', 'anon')
     and new.source_kind in ('known_cash', 'cycle_surplus')
     and (tg_op = 'INSERT' or old.source_kind is distinct from new.source_kind) then
    raise exception using
      errcode = '42501',
      message = case
        when new.source_kind = 'known_cash' then 'known_cash:direct_insert_forbidden'
        else 'known_cash:direct_cycle_surplus_forbidden'
      end;
  end if;

  if tg_op = 'UPDATE'
     and current_user in ('authenticated', 'anon')
     and old.source_kind in ('known_cash', 'cycle_surplus')
     and (
       old.source_kind is distinct from new.source_kind
       or old.amount_cents is distinct from new.amount_cents
       or old.goal_id is distinct from new.goal_id
       or old.household_id is distinct from new.household_id
       or old.contributed_on is distinct from new.contributed_on
       or old.cycle_key is distinct from new.cycle_key
       or old.cycle_closure_id is distinct from new.cycle_closure_id
     ) then
    raise exception using errcode = '42501', message = 'known_cash:trusted_earmark_locked';
  end if;

  return new;
end;
$$;

revoke all on function public.assign_goal_contribution_source_kind() from public, anon, authenticated;

drop trigger if exists goal_contribution_entries_assign_source_kind on public.goal_contribution_entries;
create trigger goal_contribution_entries_assign_source_kind
  before insert or update or delete on public.goal_contribution_entries
  for each row execute function public.assign_goal_contribution_source_kind();

create table if not exists public.known_cash_allocation_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  request_id uuid not null,
  goal_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  -- Restrict, not cascade: deleting the earmark must not erase the idempotency
  -- ledger. Household removal deletes these rows first, then the contributions.
  contribution_id uuid not null references public.goal_contribution_entries(id) on delete restrict,
  result jsonb not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (household_id, request_id)
);

create index if not exists known_cash_allocation_requests_contribution_idx
  on public.known_cash_allocation_requests (contribution_id);

alter table public.known_cash_allocation_requests enable row level security;

revoke all on table public.known_cash_allocation_requests from public, anon, authenticated;
grant select on table public.known_cash_allocation_requests to authenticated;

drop policy if exists known_cash_allocation_requests_select_member on public.known_cash_allocation_requests;
create policy known_cash_allocation_requests_select_member
  on public.known_cash_allocation_requests
  for select using (public.is_member(household_id));

-- Account deletion removes the household. Clear the ledger first so the
-- contribution foreign key can restrict an ordinary delete without blocking
-- that household wipe. This is not an undo of one earmark.
create or replace function public.remove_known_cash_allocation_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.known_cash_allocation_requests
  where household_id = old.id;
  return old;
end;
$$;

revoke all on function public.remove_known_cash_allocation_requests() from public, anon, authenticated;

drop trigger if exists households_remove_known_cash_allocation_requests on public.households;
create trigger households_remove_known_cash_allocation_requests
  before delete on public.households
  for each row execute function public.remove_known_cash_allocation_requests();

-- User deletion cascades to contributions and to this ledger. Clear the ledger
-- in a before trigger so the restrict foreign key does not depend on cascade order.
create or replace function public.remove_known_cash_requests_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.known_cash_allocation_requests
  where created_by = old.id
     or household_id in (
       select household.id
       from public.households household
       where household.created_by = old.id
     );
  return old;
end;
$$;

revoke all on function public.remove_known_cash_requests_for_user() from public, anon, authenticated;

drop trigger if exists remove_known_cash_requests_for_user on auth.users;
create trigger remove_known_cash_requests_for_user
  before delete on auth.users
  for each row execute function public.remove_known_cash_requests_for_user();

create or replace function public.known_cash_reference_date()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (timezone('America/Sao_Paulo', now()))::date;
$$;

revoke all on function public.known_cash_reference_date() from public, anon, authenticated;

-- Pending bills for one planning cycle. Same payment link as allocate_cycle_surplus:
-- a paid amount counts only when it is tied to a visible expense inside the cycle.
-- Money already paid is not subtracted again.
create or replace function public.cycle_pending_commitment_cents(
  p_household_id uuid,
  p_cycle_key text,
  p_cycle_start date,
  p_cycle_end date
) returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(greatest(commitment.amount_cents - coalesce(paid.paid_cents, 0), 0)), 0)
  from public.financial_commitments commitment
  cross join lateral (
    select case
      when make_date(
        extract(year from p_cycle_start)::integer,
        extract(month from p_cycle_start)::integer,
        commitment.due_day
      ) >= p_cycle_start
      then make_date(
        extract(year from p_cycle_start)::integer,
        extract(month from p_cycle_start)::integer,
        commitment.due_day
      )
      else (
        make_date(
          extract(year from p_cycle_start)::integer,
          extract(month from p_cycle_start)::integer,
          commitment.due_day
        ) + interval '1 month'
      )::date
    end as due_on
  ) due
  left join lateral (
    select coalesce(sum(payment.paid_cents), 0) as paid_cents
    from public.financial_commitment_payments payment
    join public.transactions payment_transaction
      on payment_transaction.id = payment.transaction_id
     and payment_transaction.household_id = commitment.household_id
     and payment_transaction.type = 'expense'
     and payment_transaction.ignored_at is null
     and payment_transaction.occurred_on >= p_cycle_start
     and payment_transaction.occurred_on < p_cycle_end
    where payment.commitment_id = commitment.id
      and payment.household_id = commitment.household_id
      and payment.cycle_key = p_cycle_key
  ) paid on true
  where commitment.household_id = p_household_id
    and (
      commitment.active
      or (commitment.archived_at is not null and due.due_on < commitment.archived_at::date)
    )
    and due.due_on >= commitment.starts_on
    and due.due_on < p_cycle_end
    and (commitment.ends_on is null or due.due_on <= commitment.ends_on)
    and (
      commitment.kind <> 'installment'
      or (
        ((extract(year from due.due_on)::integer - extract(year from commitment.starts_on)::integer) * 12
          + extract(month from due.due_on)::integer - extract(month from commitment.starts_on)::integer + 1)
        <= commitment.installments_total
      )
    );
$$;

revoke all on function public.cycle_pending_commitment_cents(uuid, text, date, date) from public, anon, authenticated;

create or replace function public.allocatable_cash_position(
  p_household_id uuid,
  p_reference_date date
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  month_start date := date_trunc('month', p_reference_date)::date;
  cycle_mode text := 'calendar';
  payday_day integer := 5;
  cycle_key text;
  cycle_start date;
  cycle_end date;
  reserve_cents bigint := 0;
  account_count integer := 0;
  known_cash bigint;
  as_of date;
  distinct_dates integer := 0;
  accounts jsonb := '[]'::jsonb;
  same_bank jsonb := '[]'::jsonb;
  missing_banks jsonb := '[]'::jsonb;
  earmarked bigint := 0;
  ambiguous_count integer := 0;
  pending_cents bigint := 0;
  available bigint;
  reasons jsonb := '[]'::jsonb;
begin
  select
    coalesce(settings.cycle_mode, 'calendar'),
    coalesce(settings.payday_day, 5),
    greatest(coalesce(settings.reserve_cents, 0), 0)
  into cycle_mode, payday_day, reserve_cents
  from public.financial_settings settings
  where settings.household_id = p_household_id;

  cycle_mode := coalesce(cycle_mode, 'calendar');
  payday_day := least(28, greatest(1, coalesce(payday_day, 5)));
  reserve_cents := coalesce(reserve_cents, 0);

  if cycle_mode = 'payday' then
    if extract(day from p_reference_date)::integer >= payday_day then
      cycle_start := make_date(
        extract(year from p_reference_date)::integer,
        extract(month from p_reference_date)::integer,
        payday_day
      );
    else
      cycle_start := make_date(
        extract(year from (p_reference_date - interval '1 month'))::integer,
        extract(month from (p_reference_date - interval '1 month'))::integer,
        payday_day
      );
    end if;
    cycle_end := (cycle_start + interval '1 month')::date;
    cycle_key := 'payday:' || to_char(cycle_start, 'YYYY-MM-DD');
  else
    cycle_start := month_start;
    cycle_end := (cycle_start + interval '1 month')::date;
    cycle_key := 'calendar:' || to_char(cycle_start, 'YYYY-MM');
  end if;

  with latest as (
    select distinct on (btrim(import.bank_id))
      btrim(import.bank_id) as bank_id,
      import.id,
      import.final_balance_cents,
      import.period_end,
      import.balance_confidence
    from public.statement_imports import
    where import.household_id = p_household_id
      and import.bank_id is not null
      and btrim(import.bank_id) <> ''
      and import.final_balance_cents is not null
      and import.balance_confidence in ('confirmed', 'derived')
      and import.period_end is not null
    order by btrim(import.bank_id), import.period_end desc, import.created_at desc, import.id desc
  )
  select
    count(*)::integer,
    case when count(*) = 0 then null else sum(latest.final_balance_cents) end,
    max(latest.period_end),
    count(distinct latest.period_end)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'bankId', latest.bank_id,
      'importId', latest.id,
      'knownCashCents', latest.final_balance_cents,
      'asOfDate', latest.period_end,
      'confidence', latest.balance_confidence
    ) order by latest.bank_id), '[]'::jsonb),
    coalesce((
      select jsonb_agg(shared.bank_id order by shared.bank_id)
      from latest shared
      where shared.bank_id in ('nubank', 'outro-banco')
    ), '[]'::jsonb)
  into account_count, known_cash, as_of, distinct_dates, accounts, same_bank
  from latest;

  -- Observed accounts are distinct trimmed bank_id values on any import for
  -- this household, including rows with a null or unusable balance.
  -- A bank is missing when that id is not in the trusted snapshot above.
  -- There is no account_id. An abandoned bank with only an unusable import
  -- stays missing until that evidence is gone. This version does not expire it.
  select coalesce(jsonb_agg(missing.bank_id order by missing.bank_id), '[]'::jsonb)
  into missing_banks
  from (
    select distinct btrim(import.bank_id) as bank_id
    from public.statement_imports import
    where import.household_id = p_household_id
      and import.bank_id is not null
      and btrim(import.bank_id) <> ''
    except
    select account."bankId"
    from jsonb_to_recordset(accounts) as account("bankId" text)
  ) missing;

  select coalesce(sum(entry.amount_cents), 0)
  into earmarked
  from public.goal_contribution_entries entry
  where entry.household_id = p_household_id
    and entry.source_kind in ('known_cash', 'cycle_surplus');

  select count(*)::integer
  into ambiguous_count
  from public.goal_contribution_entries entry
  where entry.household_id = p_household_id
    and entry.source_kind = 'manual_unverified';

  pending_cents := public.cycle_pending_commitment_cents(
    p_household_id, cycle_key, cycle_start, cycle_end
  );

  if account_count = 0 then
    reasons := reasons || jsonb_build_array('no_snapshot');
  end if;
  -- Stale when the newest selected period_end is before the civil month start.
  -- For reference 2026-10-08, 2026-09-30 is stale and 2026-10-01 is not.
  if account_count > 0 and as_of < month_start then
    reasons := reasons || jsonb_build_array('stale_snapshot');
  end if;
  -- Different close dates are not one consolidated instant. Block them.
  if distinct_dates > 1 then
    reasons := reasons || jsonb_build_array('dates_differ');
  end if;
  if jsonb_array_length(same_bank) > 0 then
    -- nubank and outro-banco can hide a second account. Stay fail-closed.
    reasons := reasons || jsonb_build_array('same_bank_risk');
  end if;
  if jsonb_array_length(missing_banks) > 0 then
    reasons := reasons || jsonb_build_array('missing_account_snapshot');
  end if;
  if ambiguous_count > 0 then
    reasons := reasons || jsonb_build_array('ambiguous_goal_contributions');
  end if;

  if jsonb_array_length(reasons) = 0 then
    available := greatest(0, known_cash - earmarked - pending_cents - reserve_cents);
  else
    available := null;
  end if;

  return jsonb_build_object(
    'knownCashCents', known_cash,
    'earmarkedCents', earmarked,
    'pendingDueCents', pending_cents,
    'reservePolicyCents', reserve_cents,
    'availableToOrganizeCents', available,
    'cashAsOfDate', as_of,
    'referenceDate', p_reference_date,
    'cycleKey', cycle_key,
    'cycleStart', cycle_start,
    'cycleEnd', cycle_end,
    'accounts', accounts,
    'dataQuality', jsonb_build_object(
      'hasSnapshot', account_count > 0,
      'isStale', account_count > 0 and as_of < month_start,
      'datesDiffer', distinct_dates > 1,
      'sameBankRisk', jsonb_array_length(same_bank) > 0,
      'sameBankIds', same_bank,
      'missingBankIds', missing_banks,
      'hasAmbiguousGoalContributions', ambiguous_count > 0,
      'ambiguousContributionCount', ambiguous_count
    ),
    'blockReasons', reasons,
    'canAllocate', jsonb_array_length(reasons) = 0
  );
end;
$$;

revoke all on function public.allocatable_cash_position(uuid, date) from public, anon, authenticated;

create or replace function public.get_allocatable_cash_position(
  p_household_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'known_cash:unauthorized';
  end if;
  return public.allocatable_cash_position(p_household_id, public.known_cash_reference_date());
end;
$$;

revoke all on function public.get_allocatable_cash_position(uuid) from public, anon;
grant execute on function public.get_allocatable_cash_position(uuid) to authenticated;

create or replace function public.allocate_known_cash_to_goal(
  p_household_id uuid,
  p_goal_id uuid,
  p_amount_cents bigint,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  reference_date date;
  existing_goal uuid;
  existing_amount bigint;
  existing_result jsonb;
  position jsonb;
  reasons jsonb;
  goal_remaining bigint := 0;
  available_before bigint;
  contribution_id uuid;
  result jsonb;
begin
  if uid is null or not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'known_cash:unauthorized';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'known_cash:invalid_request';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'known_cash:invalid_amount';
  end if;

  -- Fixed order: household, then goal. The position is read only after both.
  perform pg_advisory_xact_lock(hashtextextended('known-cash:' || p_household_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('goal:' || p_goal_id::text, 0));

  select request.goal_id, request.amount_cents, request.result
  into existing_goal, existing_amount, existing_result
  from public.known_cash_allocation_requests request
  where request.household_id = p_household_id
    and request.request_id = p_request_id
  for update;

  if existing_goal is not null then
    if existing_goal <> p_goal_id or existing_amount <> p_amount_cents then
      raise exception using errcode = '23505', message = 'known_cash:request_conflict';
    end if;
    return existing_result || jsonb_build_object('idempotentReplay', true);
  end if;

  if not exists (
    select 1 from public.goals goal
    where goal.id = p_goal_id
      and goal.household_id = p_household_id
  ) then
    raise exception using errcode = '23503', message = 'known_cash:goal_not_found';
  end if;

  reference_date := public.known_cash_reference_date();
  position := public.allocatable_cash_position(p_household_id, reference_date);
  reasons := position->'blockReasons';
  if jsonb_array_length(reasons) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'known_cash:' || (reasons->>0),
      detail = reasons::text;
  end if;

  perform 1
  from public.goals goal
  where goal.id = p_goal_id
    and goal.household_id = p_household_id
  for update;

  select greatest(goal.target_cents - coalesce(sum(entry.amount_cents), 0), 0)
  into goal_remaining
  from public.goals goal
  left join public.goal_contribution_entries entry
    on entry.goal_id = goal.id
   and entry.household_id = goal.household_id
  where goal.id = p_goal_id
    and goal.household_id = p_household_id
  group by goal.id, goal.target_cents;

  if coalesce(goal_remaining, 0) <= 0 then
    raise exception using errcode = '23514', message = 'known_cash:goal_completed';
  end if;
  if p_amount_cents > goal_remaining then
    raise exception using errcode = '23514', message = 'known_cash:amount_exceeds_goal_remaining';
  end if;

  available_before := (position->>'availableToOrganizeCents')::bigint;
  if p_amount_cents > coalesce(available_before, 0) then
    raise exception using errcode = '23514', message = 'known_cash:insufficient_available_cash';
  end if;

  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, note,
    created_by, source_kind
  ) values (
    p_household_id, p_goal_id, p_amount_cents, reference_date,
    null, uid, 'known_cash'
  )
  returning id into contribution_id;

  result := jsonb_build_object(
    'contributionId', contribution_id,
    'requestId', p_request_id,
    'amountCents', p_amount_cents,
    'goalId', p_goal_id,
    'knownCashCents', position->'knownCashCents',
    'earmarkedBeforeCents', position->'earmarkedCents',
    'pendingDueCents', position->'pendingDueCents',
    'reservePolicyCents', position->'reservePolicyCents',
    'availableBeforeCents', available_before,
    'availableAfterCents', greatest(available_before - p_amount_cents, 0),
    'cashAsOfDate', position->'cashAsOfDate',
    'sourceKind', 'known_cash',
    'idempotentReplay', false
  );

  insert into public.known_cash_allocation_requests (
    household_id, request_id, goal_id, amount_cents, contribution_id, result, created_by
  ) values (
    p_household_id, p_request_id, p_goal_id, p_amount_cents, contribution_id, result, uid
  );

  return result;
end;
$$;

revoke all on function public.allocate_known_cash_to_goal(uuid, uuid, bigint, uuid) from public, anon;
grant execute on function public.allocate_known_cash_to_goal(uuid, uuid, bigint, uuid) to authenticated;

-- Same household lock as allocate_known_cash_to_goal, taken first, then the
-- existing cycle lock, then the goal lock. The insert names source_kind.
-- The trigger classifies a closure the same way if a later edit omits it.
create or replace function public.allocate_cycle_surplus(
  p_household_id uuid,
  p_goal_id uuid,
  p_cycle_key text,
  p_cycle_start date,
  p_cycle_end date,
  p_amount_cents bigint,
  p_contributed_on date default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cycle_net bigint := 0;
  already_allocated bigint := 0;
  pending_commitments bigint := 0;
  reserve_cents bigint := 0;
  balance_cents bigint := 0;
  balance_count integer := 0;
  available_cents bigint := 0;
  goal_remaining_cents bigint := 0;
  configured_cycle_mode text := 'calendar';
  configured_payday_day integer := 5;
  closure_id uuid;
  contribution_id uuid;
  contribution_date date;
begin
  if uid is null or not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este planejamento.';
  end if;
  if p_cycle_start is null or p_cycle_end is null or p_cycle_end <= p_cycle_start then
    raise exception using errcode = '22023', message = 'O ciclo financeiro é inválido.';
  end if;
  if p_cycle_key is null or char_length(trim(p_cycle_key)) not between 7 and 40 then
    raise exception using errcode = '22023', message = 'A identificação do ciclo é inválida.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'Informe um valor positivo para o sonho.';
  end if;
  if not exists (
    select 1 from public.goals
    where id = p_goal_id and household_id = p_household_id
  ) then
    raise exception using errcode = '23503', message = 'O sonho selecionado não foi encontrado.';
  end if;

  select settings.cycle_mode, settings.payday_day, settings.reserve_cents
  into configured_cycle_mode, configured_payday_day, reserve_cents
  from public.financial_settings settings
  where settings.household_id = p_household_id;

  configured_cycle_mode := coalesce(configured_cycle_mode, 'calendar');
  configured_payday_day := coalesce(configured_payday_day, 5);
  reserve_cents := coalesce(reserve_cents, 0);

  if p_cycle_end <> (p_cycle_start + interval '1 month')::date then
    raise exception using errcode = '22023', message = 'O período do ciclo financeiro é inválido.';
  end if;
  if configured_cycle_mode = 'calendar' and (
    extract(day from p_cycle_start)::integer <> 1
    or p_cycle_key <> 'calendar:' || to_char(p_cycle_start, 'YYYY-MM')
  ) then
    raise exception using errcode = '22023', message = 'O ciclo não corresponde ao planejamento mensal.';
  end if;
  if configured_cycle_mode = 'payday' and (
    extract(day from p_cycle_start)::integer <> configured_payday_day
    or p_cycle_key <> 'payday:' || to_char(p_cycle_start, 'YYYY-MM-DD')
  ) then
    raise exception using errcode = '22023', message = 'O ciclo não corresponde ao dia de recebimento configurado.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('known-cash:' || p_household_id::text, 0));
  perform pg_advisory_xact_lock(hashtext(p_household_id::text || ':' || p_cycle_key));
  perform pg_advisory_xact_lock(hashtextextended('goal:' || p_goal_id::text, 0));

  perform 1
  from public.goals
  where id = p_goal_id and household_id = p_household_id
  for update;

  select greatest(goal.target_cents - coalesce(sum(entry.amount_cents), 0), 0)
  into goal_remaining_cents
  from public.goals goal
  left join public.goal_contribution_entries entry
    on entry.goal_id = goal.id
   and entry.household_id = goal.household_id
  where goal.id = p_goal_id
    and goal.household_id = p_household_id
  group by goal.id, goal.target_cents;

  if p_amount_cents > coalesce(goal_remaining_cents, 0) then
    raise exception using errcode = '23514', message = 'O valor ultrapassa o que falta para concluir este sonho.';
  end if;

  select coalesce(sum(case when type = 'income' then amount_cents else -amount_cents end), 0)
  into cycle_net
  from public.transactions
  where household_id = p_household_id
    and ignored_at is null
    and transfer_group_id is null
    and occurred_on >= p_cycle_start
    and occurred_on < p_cycle_end;

  select coalesce(sum(entry.amount_cents), 0)
  into already_allocated
  from public.goal_contribution_entries entry
  where entry.household_id = p_household_id
    and (
      entry.cycle_key = p_cycle_key
      or (
        entry.contributed_on >= p_cycle_start
        and entry.contributed_on < p_cycle_end
      )
    );

  select coalesce(sum(greatest(commitment.amount_cents - coalesce(paid.paid_cents, 0), 0)), 0)
  into pending_commitments
  from public.financial_commitments commitment
  cross join lateral (
    select case
      when make_date(
        extract(year from p_cycle_start)::integer,
        extract(month from p_cycle_start)::integer,
        commitment.due_day
      ) >= p_cycle_start
      then make_date(
        extract(year from p_cycle_start)::integer,
        extract(month from p_cycle_start)::integer,
        commitment.due_day
      )
      else (
        make_date(
          extract(year from p_cycle_start)::integer,
          extract(month from p_cycle_start)::integer,
          commitment.due_day
        ) + interval '1 month'
      )::date
    end as due_on
  ) due
  left join lateral (
    select coalesce(sum(payment.paid_cents), 0) as paid_cents
    from public.financial_commitment_payments payment
    join public.transactions payment_transaction
      on payment_transaction.id = payment.transaction_id
     and payment_transaction.household_id = commitment.household_id
     and payment_transaction.type = 'expense'
     and payment_transaction.ignored_at is null
     and payment_transaction.occurred_on >= p_cycle_start
     and payment_transaction.occurred_on < p_cycle_end
    where payment.commitment_id = commitment.id
      and payment.household_id = commitment.household_id
      and payment.cycle_key = p_cycle_key
  ) paid on true
  where commitment.household_id = p_household_id
    and (
      commitment.active
      or (commitment.archived_at is not null and due.due_on < commitment.archived_at::date)
    )
    and due.due_on >= commitment.starts_on
    and due.due_on < p_cycle_end
    and (commitment.ends_on is null or due.due_on <= commitment.ends_on)
    and (
      commitment.kind <> 'installment'
      or (
        ((extract(year from due.due_on)::integer - extract(year from commitment.starts_on)::integer) * 12
          + extract(month from due.due_on)::integer - extract(month from commitment.starts_on)::integer + 1)
        <= commitment.installments_total
      )
    );

  select count(*)::integer, coalesce(sum(snapshot.final_balance_cents), 0)
  into balance_count, balance_cents
  from (
    select distinct on (bank_id) bank_id, final_balance_cents
    from public.statement_imports
    where household_id = p_household_id
      and bank_id is not null
      and final_balance_cents is not null
      and balance_confidence in ('confirmed', 'derived')
      and period_end < p_cycle_end
    order by bank_id, period_end desc, created_at desc
  ) snapshot;

  available_cents := greatest(cycle_net, 0);
  if balance_count > 0 then
    available_cents := least(available_cents, greatest(balance_cents, 0));
  end if;
  available_cents := greatest(
    available_cents - pending_commitments - reserve_cents - already_allocated,
    0
  );

  if p_amount_cents > available_cents then
    raise exception using errcode = '23514', message = 'O valor ultrapassa a sobra segura disponível neste ciclo.';
  end if;

  insert into public.cycle_closures (
    household_id, cycle_key, mode, cycle_start, cycle_end,
    net_cents, allocated_cents, updated_by, updated_at
  ) values (
    p_household_id, p_cycle_key, 'month', p_cycle_start, p_cycle_end,
    cycle_net, already_allocated + p_amount_cents, uid, now()
  )
  on conflict (household_id, cycle_key) do update set
    cycle_start = excluded.cycle_start,
    cycle_end = excluded.cycle_end,
    net_cents = excluded.net_cents,
    allocated_cents = excluded.allocated_cents,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning id into closure_id;

  contribution_date := greatest(
    p_cycle_start,
    least(coalesce(p_contributed_on, current_date), p_cycle_end - 1)
  );

  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, note,
    created_by, cycle_key, cycle_closure_id, source_kind
  ) values (
    p_household_id, p_goal_id, p_amount_cents, contribution_date,
    nullif(trim(coalesce(p_note, '')), ''), uid, p_cycle_key, closure_id,
    'cycle_surplus'
  )
  returning id into contribution_id;

  return jsonb_build_object(
    'cycle_closure_id', closure_id,
    'contribution_id', contribution_id,
    'net_cents', cycle_net,
    'allocated_cents', already_allocated + p_amount_cents,
    'remaining_cents', greatest(available_cents - p_amount_cents, 0)
  );
end;
$$;

revoke all on function public.allocate_cycle_surplus(uuid, uuid, text, date, date, bigint, date, text) from public, anon;
grant execute on function public.allocate_cycle_surplus(uuid, uuid, text, date, date, bigint, date, text) to authenticated;

notify pgrst, 'reload schema';
