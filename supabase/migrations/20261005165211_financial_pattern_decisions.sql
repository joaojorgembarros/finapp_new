-- Persist only user decisions about inferred recurring patterns.
-- Inferred candidates stay in memory from the detector; confirmed rows
-- become official via financial_commitments. Deleting a linked commitment
-- cascades the decision so the pattern can be reviewed again.

create table if not exists public.financial_pattern_decisions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pattern_key text not null check (char_length(trim(pattern_key)) between 1 and 240),
  normalized_merchant text,
  direction text not null check (direction in ('income', 'expense')),
  behavior_type text not null check (behavior_type in (
    'fixed_recurring_expense',
    'variable_recurring_expense',
    'fixed_recurring_income',
    'variable_recurring_income',
    'habitual_category_spend',
    'eventual',
    'unknown'
  )),
  cadence text not null check (cadence in ('monthly', 'weekly', 'unknown')),
  decision text not null check (decision in ('confirmed', 'rejected')),
  linked_commitment_id uuid references public.financial_commitments(id) on delete cascade,
  estimated_amount_cents bigint check (estimated_amount_cents is null or estimated_amount_cents > 0),
  estimated_day integer check (estimated_day is null or estimated_day between 1 and 28),
  confidence integer check (confidence is null or confidence between 0 and 100),
  first_seen date,
  last_seen date,
  occurrence_count integer check (occurrence_count is null or occurrence_count >= 0),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, pattern_key),
  check (
    (decision = 'rejected' and linked_commitment_id is null)
    or (decision = 'confirmed' and linked_commitment_id is not null)
  )
);

create index if not exists financial_pattern_decisions_household_decision_idx
  on public.financial_pattern_decisions (household_id, decision);

create index if not exists financial_pattern_decisions_linked_commitment_idx
  on public.financial_pattern_decisions (linked_commitment_id);

alter table public.financial_pattern_decisions enable row level security;

-- Members may read their household decisions. Confirm/reject mutate only via RPC,
-- so PostgREST cannot insert a confirmed row that points at another house.
revoke all on table public.financial_pattern_decisions from public, anon, authenticated;
grant select on table public.financial_pattern_decisions to authenticated;

drop policy if exists financial_pattern_decisions_select_member on public.financial_pattern_decisions;
create policy financial_pattern_decisions_select_member on public.financial_pattern_decisions
  for select using (public.is_member(household_id));

drop policy if exists financial_pattern_decisions_insert_member on public.financial_pattern_decisions;
drop policy if exists financial_pattern_decisions_update_member on public.financial_pattern_decisions;
drop policy if exists financial_pattern_decisions_delete_member on public.financial_pattern_decisions;

create or replace function public.enforce_financial_pattern_decision_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  commitment_household uuid;
begin
  if new.decision = 'rejected' and new.linked_commitment_id is not null then
    raise exception using errcode = '23514', message = 'Uma rejeição não pode ficar ligada a um compromisso.';
  end if;
  if new.decision = 'confirmed' then
    if new.linked_commitment_id is null then
      raise exception using errcode = '23514', message = 'Uma confirmação precisa de um compromisso da mesma casa.';
    end if;
    select household_id
    into commitment_household
    from public.financial_commitments
    where id = new.linked_commitment_id;
    if commitment_household is null or commitment_household is distinct from new.household_id then
      raise exception using errcode = '23514', message = 'O compromisso não pertence a esta casa.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_financial_pattern_decision_invariants() from public, anon, authenticated;

drop trigger if exists financial_pattern_decisions_invariants on public.financial_pattern_decisions;
create trigger financial_pattern_decisions_invariants
  before insert or update on public.financial_pattern_decisions
  for each row execute function public.enforce_financial_pattern_decision_invariants();

create or replace function public.confirm_financial_pattern(
  p_household_id uuid,
  p_pattern_key text,
  p_name text,
  p_amount_cents bigint,
  p_due_day integer,
  p_existing_commitment_id uuid default null,
  p_normalized_merchant text default null,
  p_direction text default 'expense',
  p_behavior_type text default 'fixed_recurring_expense',
  p_cadence text default 'monthly',
  p_estimated_amount_cents bigint default null,
  p_estimated_day integer default null,
  p_confidence integer default null,
  p_first_seen date default null,
  p_last_seen date default null,
  p_occurrence_count integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing public.financial_pattern_decisions%rowtype;
  commitment public.financial_commitments%rowtype;
  commitment_id uuid;
  approved_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Você precisa estar autenticado.';
  end if;
  if not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este planejamento.';
  end if;

  if p_pattern_key is null or char_length(trim(p_pattern_key)) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'A identificação do padrão é inválida.';
  end if;
  if approved_name is null or char_length(approved_name) > 100 then
    raise exception using errcode = '22023', message = 'Informe o nome do compromisso.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'O valor do compromisso deve ser maior que zero.';
  end if;
  if p_due_day is null or p_due_day < 1 or p_due_day > 28 then
    raise exception using errcode = '22023', message = 'O vencimento deve estar entre os dias 1 e 28.';
  end if;
  if p_direction is null or p_direction <> 'expense' then
    raise exception using errcode = '22023', message = 'Somente despesas recorrentes podem entrar no planejamento nesta etapa.';
  end if;
  if p_behavior_type is null or p_behavior_type not in ('fixed_recurring_expense', 'variable_recurring_expense') then
    raise exception using errcode = '22023', message = 'Este padrão ainda não pode ser confirmado.';
  end if;
  if p_cadence is null or p_cadence not in ('monthly', 'weekly', 'unknown') then
    raise exception using errcode = '22023', message = 'A recorrência informada é inválida.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':pattern:' || trim(p_pattern_key), 0));

  select *
  into existing
  from public.financial_pattern_decisions
  where household_id = p_household_id
    and pattern_key = trim(p_pattern_key)
  for update;

  if existing.id is not null
    and existing.decision = 'confirmed'
    and existing.linked_commitment_id is not null then
    select *
    into commitment
    from public.financial_commitments
    where id = existing.linked_commitment_id
      and household_id = p_household_id
      and active = true;
    if commitment.id is not null then
      return to_jsonb(commitment);
    end if;
  end if;

  if p_existing_commitment_id is not null then
    select *
    into commitment
    from public.financial_commitments
    where id = p_existing_commitment_id
      and household_id = p_household_id
      and active = true
    for update;
    if commitment.id is null then
      raise exception using errcode = '42501', message = 'O compromisso não pertence a esta casa.';
    end if;
    commitment_id := commitment.id;
  else
    insert into public.financial_commitments (
      household_id, created_by, kind, name, amount_cents, due_day, starts_on, active
    ) values (
      p_household_id,
      uid,
      'fixed_bill',
      approved_name,
      p_amount_cents,
      p_due_day,
      coalesce(p_first_seen, current_date),
      true
    )
    returning * into commitment;
    commitment_id := commitment.id;
  end if;

  insert into public.financial_pattern_decisions (
    household_id,
    pattern_key,
    normalized_merchant,
    direction,
    behavior_type,
    cadence,
    decision,
    linked_commitment_id,
    estimated_amount_cents,
    estimated_day,
    confidence,
    first_seen,
    last_seen,
    occurrence_count,
    created_by,
    updated_at
  ) values (
    p_household_id,
    trim(p_pattern_key),
    nullif(trim(coalesce(p_normalized_merchant, '')), ''),
    p_direction,
    p_behavior_type,
    p_cadence,
    'confirmed',
    commitment_id,
    p_estimated_amount_cents,
    p_estimated_day,
    p_confidence,
    p_first_seen,
    p_last_seen,
    p_occurrence_count,
    uid,
    now()
  )
  on conflict (household_id, pattern_key) do update set
    normalized_merchant = excluded.normalized_merchant,
    direction = excluded.direction,
    behavior_type = excluded.behavior_type,
    cadence = excluded.cadence,
    decision = 'confirmed',
    linked_commitment_id = excluded.linked_commitment_id,
    estimated_amount_cents = excluded.estimated_amount_cents,
    estimated_day = excluded.estimated_day,
    confidence = excluded.confidence,
    first_seen = excluded.first_seen,
    last_seen = excluded.last_seen,
    occurrence_count = excluded.occurrence_count,
    updated_at = now();

  select *
  into commitment
  from public.financial_commitments
  where id = commitment_id
    and household_id = p_household_id;

  return to_jsonb(commitment);
end;
$$;

create or replace function public.reject_financial_pattern(
  p_household_id uuid,
  p_pattern_key text,
  p_normalized_merchant text default null,
  p_direction text default 'expense',
  p_behavior_type text default 'fixed_recurring_expense',
  p_cadence text default 'monthly',
  p_estimated_amount_cents bigint default null,
  p_estimated_day integer default null,
  p_confidence integer default null,
  p_first_seen date default null,
  p_last_seen date default null,
  p_occurrence_count integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing public.financial_pattern_decisions%rowtype;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Você precisa estar autenticado.';
  end if;
  if not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este planejamento.';
  end if;
  if p_pattern_key is null or char_length(trim(p_pattern_key)) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'A identificação do padrão é inválida.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':pattern:' || trim(p_pattern_key), 0));

  select *
  into existing
  from public.financial_pattern_decisions
  where household_id = p_household_id
    and pattern_key = trim(p_pattern_key)
  for update;

  if existing.id is not null and existing.decision = 'confirmed' then
    raise exception using errcode = '23514', message = 'Este padrão já faz parte do planejamento.';
  end if;

  if existing.id is not null and existing.decision = 'rejected' then
    return to_jsonb(existing);
  end if;

  insert into public.financial_pattern_decisions (
    household_id,
    pattern_key,
    normalized_merchant,
    direction,
    behavior_type,
    cadence,
    decision,
    linked_commitment_id,
    estimated_amount_cents,
    estimated_day,
    confidence,
    first_seen,
    last_seen,
    occurrence_count,
    created_by,
    updated_at
  ) values (
    p_household_id,
    trim(p_pattern_key),
    nullif(trim(coalesce(p_normalized_merchant, '')), ''),
    coalesce(nullif(trim(coalesce(p_direction, '')), ''), 'expense'),
    coalesce(nullif(trim(coalesce(p_behavior_type, '')), ''), 'unknown'),
    coalesce(nullif(trim(coalesce(p_cadence, '')), ''), 'unknown'),
    'rejected',
    null,
    p_estimated_amount_cents,
    p_estimated_day,
    p_confidence,
    p_first_seen,
    p_last_seen,
    p_occurrence_count,
    uid,
    now()
  )
  on conflict (household_id, pattern_key) do update set
    normalized_merchant = excluded.normalized_merchant,
    direction = excluded.direction,
    behavior_type = excluded.behavior_type,
    cadence = excluded.cadence,
    decision = 'rejected',
    linked_commitment_id = null,
    estimated_amount_cents = excluded.estimated_amount_cents,
    estimated_day = excluded.estimated_day,
    confidence = excluded.confidence,
    first_seen = excluded.first_seen,
    last_seen = excluded.last_seen,
    occurrence_count = excluded.occurrence_count,
    updated_at = now()
  returning * into existing;

  return to_jsonb(existing);
end;
$$;

revoke all on function public.confirm_financial_pattern(uuid, text, text, bigint, integer, uuid, text, text, text, text, bigint, integer, integer, date, date, integer) from public, anon;
grant execute on function public.confirm_financial_pattern(uuid, text, text, bigint, integer, uuid, text, text, text, text, bigint, integer, integer, date, date, integer) to authenticated;

revoke all on function public.reject_financial_pattern(uuid, text, text, text, text, text, bigint, integer, integer, date, date, integer) from public, anon;
grant execute on function public.reject_financial_pattern(uuid, text, text, text, text, text, bigint, integer, integer, date, date, integer) to authenticated;

notify pgrst, 'reload schema';
