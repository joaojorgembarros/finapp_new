-- Financial planning: configurable cycles, commitments, trustworthy statement
-- balances and cycle-linked goal allocations.

alter table public.statement_imports
  add column if not exists balance_confidence text not null default 'unavailable';

-- Older imports did not persist how their final balance was obtained. They stay
-- unavailable for balance calculations instead of being promoted by guesswork.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'statement_imports_balance_confidence_check'
      and conrelid = 'public.statement_imports'::regclass
  ) then
    alter table public.statement_imports
      add constraint statement_imports_balance_confidence_check
      check (balance_confidence in ('confirmed', 'derived', 'unavailable'));
  end if;
end;
$$;

create table if not exists public.financial_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  cycle_mode text not null default 'calendar'
    check (cycle_mode in ('calendar', 'payday')),
  payday_day integer check (payday_day is null or payday_day between 1 and 28),
  reserve_cents bigint not null default 0 check (reserve_cents >= 0),
  updated_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cycle_mode = 'calendar' or payday_day is not null)
);

create table if not exists public.financial_commitments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('fixed_bill', 'debt', 'installment')),
  name text not null check (char_length(trim(name)) between 1 and 100),
  amount_cents bigint not null check (amount_cents > 0),
  due_day integer not null check (due_day between 1 and 28),
  starts_on date not null,
  ends_on date,
  installments_total integer
    check (installments_total is null or installments_total between 1 and 600),
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (
    (kind = 'installment' and installments_total is not null)
    or (kind <> 'installment' and installments_total is null)
  )
);

create index if not exists financial_commitments_household_active_idx
  on public.financial_commitments (household_id, active, starts_on, due_day);

alter table public.financial_commitments
  add column if not exists archived_at timestamptz;

create table if not exists public.financial_commitment_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  commitment_id uuid not null references public.financial_commitments(id) on delete cascade,
  cycle_key text not null check (char_length(trim(cycle_key)) between 7 and 40),
  paid_cents bigint not null check (paid_cents > 0),
  paid_on date not null default current_date,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commitment_id, cycle_key)
);

create index if not exists financial_commitment_payments_household_cycle_idx
  on public.financial_commitment_payments (household_id, cycle_key);

create unique index if not exists financial_commitment_payments_transaction_idx
  on public.financial_commitment_payments (household_id, transaction_id);

alter table public.financial_commitment_payments
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.validate_financial_commitment_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  commitment_household_id uuid;
  commitment_amount_cents bigint;
  transaction_household_id uuid;
  transaction_amount_cents bigint;
  transaction_type text;
  transaction_date date;
  transaction_ignored_at timestamptz;
  payment_cycle_start date;
  payment_cycle_end date;
begin
  select household_id, amount_cents
  into commitment_household_id, commitment_amount_cents
  from public.financial_commitments
  where id = new.commitment_id;

  if commitment_household_id is null or commitment_household_id <> new.household_id then
    raise exception using errcode = '23514', message = 'O compromisso não pertence a esta casa.';
  end if;

  select household_id, amount_cents, type, occurred_on, ignored_at
  into transaction_household_id, transaction_amount_cents, transaction_type,
       transaction_date, transaction_ignored_at
  from public.transactions
  where id = new.transaction_id;

  if transaction_household_id is null or transaction_household_id <> new.household_id then
    raise exception using errcode = '23514', message = 'A movimentação não pertence a esta casa.';
  end if;
  if transaction_type <> 'expense' or transaction_ignored_at is not null then
    raise exception using errcode = '23514', message = 'Somente uma despesa visível pode contabilizar um compromisso.';
  end if;

  if new.cycle_key ~ '^calendar:[0-9]{4}-[0-9]{2}$' then
    payment_cycle_start := to_date(substring(new.cycle_key from 10), 'YYYY-MM');
  elsif new.cycle_key ~ '^payday:[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    payment_cycle_start := to_date(substring(new.cycle_key from 8), 'YYYY-MM-DD');
  else
    raise exception using errcode = '22023', message = 'A identificação do ciclo do pagamento é inválida.';
  end if;
  payment_cycle_end := (payment_cycle_start + interval '1 month')::date;

  if transaction_date < payment_cycle_start or transaction_date >= payment_cycle_end then
    raise exception using errcode = '23514', message = 'A despesa não pertence ao ciclo selecionado.';
  end if;
  if new.paid_cents > least(commitment_amount_cents, transaction_amount_cents) then
    raise exception using errcode = '23514', message = 'O valor contabilizado ultrapassa a despesa ou o compromisso.';
  end if;

  new.paid_on := transaction_date;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_financial_commitment_payment() from public;

drop trigger if exists financial_commitment_payments_validate on public.financial_commitment_payments;
create trigger financial_commitment_payments_validate
  before insert or update on public.financial_commitment_payments
  for each row execute function public.validate_financial_commitment_payment();

alter table public.goal_contribution_entries
  add column if not exists cycle_key text;
alter table public.goal_contribution_entries
  add column if not exists cycle_closure_id uuid
    references public.cycle_closures(id) on delete set null;

create index if not exists goal_contribution_entries_household_cycle_idx
  on public.goal_contribution_entries (household_id, cycle_key)
  where cycle_key is not null;

create or replace function public.validate_goal_contribution_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  goal_household_id uuid;
  goal_target_cents bigint;
  existing_cents bigint := 0;
  closure_household_id uuid;
  closure_cycle_key text;
begin
  perform pg_advisory_xact_lock(hashtextextended('goal:' || new.goal_id::text, 0));

  select household_id, target_cents
  into goal_household_id, goal_target_cents
  from public.goals
  where id = new.goal_id
  for update;

  if goal_household_id is null or goal_household_id <> new.household_id then
    raise exception using errcode = '23514', message = 'O sonho não pertence a esta casa.';
  end if;

  if new.cycle_closure_id is not null then
    select household_id, cycle_key
    into closure_household_id, closure_cycle_key
    from public.cycle_closures
    where id = new.cycle_closure_id;

    if closure_household_id is null
      or closure_household_id <> new.household_id
      or closure_cycle_key is distinct from new.cycle_key then
      raise exception using errcode = '23514', message = 'O fechamento não pertence ao ciclo desta contribuição.';
    end if;
  end if;

  select coalesce(sum(entry.amount_cents), 0)
  into existing_cents
  from public.goal_contribution_entries entry
  where entry.goal_id = new.goal_id
    and entry.household_id = new.household_id
    and entry.id <> new.id;

  if existing_cents + new.amount_cents > goal_target_cents then
    raise exception using errcode = '23514', message = 'O valor ultrapassa o que falta para concluir este sonho.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_goal_contribution_entry() from public;

drop trigger if exists goal_contribution_entries_validate on public.goal_contribution_entries;
create trigger goal_contribution_entries_validate
  before insert or update of household_id, goal_id, amount_cents, cycle_key, cycle_closure_id
  on public.goal_contribution_entries
  for each row execute function public.validate_goal_contribution_entry();

alter table public.financial_settings enable row level security;
alter table public.financial_commitments enable row level security;
alter table public.financial_commitment_payments enable row level security;

drop policy if exists financial_settings_select_member on public.financial_settings;
create policy financial_settings_select_member on public.financial_settings
  for select using (public.is_member(household_id));
drop policy if exists financial_settings_insert_member on public.financial_settings;
create policy financial_settings_insert_member on public.financial_settings
  for insert with check (public.is_member(household_id) and updated_by = auth.uid());
drop policy if exists financial_settings_update_member on public.financial_settings;
create policy financial_settings_update_member on public.financial_settings
  for update using (public.is_member(household_id))
  with check (public.is_member(household_id) and updated_by = auth.uid());

drop policy if exists financial_commitments_select_member on public.financial_commitments;
create policy financial_commitments_select_member on public.financial_commitments
  for select using (public.is_member(household_id));
drop policy if exists financial_commitments_insert_member on public.financial_commitments;
create policy financial_commitments_insert_member on public.financial_commitments
  for insert with check (public.is_member(household_id) and created_by = auth.uid());
drop policy if exists financial_commitments_update_member on public.financial_commitments;
create policy financial_commitments_update_member on public.financial_commitments
  for update using (public.is_member(household_id))
  with check (public.is_member(household_id));
drop policy if exists financial_commitments_delete_member on public.financial_commitments;
create policy financial_commitments_delete_member on public.financial_commitments
  for delete using (public.is_member(household_id));

drop policy if exists financial_commitment_payments_select_member on public.financial_commitment_payments;
create policy financial_commitment_payments_select_member on public.financial_commitment_payments
  for select using (public.is_member(household_id));
drop policy if exists financial_commitment_payments_insert_member on public.financial_commitment_payments;
create policy financial_commitment_payments_insert_member on public.financial_commitment_payments
  for insert with check (public.is_member(household_id) and created_by = auth.uid());
drop policy if exists financial_commitment_payments_update_member on public.financial_commitment_payments;
create policy financial_commitment_payments_update_member on public.financial_commitment_payments
  for update using (public.is_member(household_id))
  with check (public.is_member(household_id));
drop policy if exists financial_commitment_payments_delete_member on public.financial_commitment_payments;
create policy financial_commitment_payments_delete_member on public.financial_commitment_payments
  for delete using (public.is_member(household_id));

create or replace function public.import_statement_v6(
  p_household_id uuid,
  p_file_hash text,
  p_file_name text,
  p_bank_id text,
  p_initial_balance_cents bigint,
  p_final_balance_cents bigint,
  p_balance_confidence text,
  p_rejected_count integer,
  p_rows jsonb,
  p_category_rules jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  outcome jsonb;
  import_id uuid;
  imported_period_start date;
  imported_period_end date;
begin
  if p_balance_confidence is null or p_balance_confidence not in ('confirmed', 'derived', 'unavailable') then
    raise exception using errcode = '22023', message = 'A origem do saldo do extrato é inválida.';
  end if;
  if p_balance_confidence = 'unavailable' and p_final_balance_cents is not null then
    raise exception using errcode = '22023', message = 'Um saldo não confirmado não pode ser salvo como saldo bancário.';
  end if;
  if p_balance_confidence = 'confirmed' and p_final_balance_cents is null then
    raise exception using errcode = '22023', message = 'O saldo final confirmado não foi informado.';
  end if;
  if p_balance_confidence = 'derived' and p_final_balance_cents is null then
    raise exception using errcode = '22023', message = 'O saldo final estimado não foi informado.';
  end if;

  outcome := public.import_statement_v5(
    p_household_id,
    p_file_hash,
    p_file_name,
    p_bank_id,
    p_initial_balance_cents,
    p_final_balance_cents,
    p_rejected_count,
    p_rows,
    p_category_rules
  );

  import_id := (outcome ->> 'import_id')::uuid;
  update public.statement_imports
  set balance_confidence = p_balance_confidence,
      final_balance_cents = case
        when p_balance_confidence in ('confirmed', 'derived')
          then p_final_balance_cents
        else null
      end,
      period_start = (
        select min(item.occurred_on)
        from jsonb_to_recordset(p_rows) as item(occurred_on date)
      ),
      period_end = (
        select max(item.occurred_on)
        from jsonb_to_recordset(p_rows) as item(occurred_on date)
      )
  where id = import_id and household_id = p_household_id;

  select min(occurred_on), max(occurred_on)
  into imported_period_start, imported_period_end
  from public.transactions
  where statement_import_id = import_id
    and household_id = p_household_id;

  return outcome || jsonb_build_object(
    'imported_period_start', imported_period_start,
    'imported_period_end', imported_period_end
  );
end;
$$;

revoke all on function public.import_statement_v6(uuid, text, text, text, bigint, bigint, text, integer, jsonb, jsonb) from public;
grant execute on function public.import_statement_v6(uuid, text, text, text, bigint, bigint, text, integer, jsonb, jsonb) to authenticated;

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

  select coalesce(sum(greatest(
    commitment.amount_cents
      - case when payment_transaction.id is not null then coalesce(payment.paid_cents, 0) else 0 end,
    0
  )), 0)
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
  left join public.financial_commitment_payments payment
    on payment.commitment_id = commitment.id
   and payment.household_id = commitment.household_id
   and payment.cycle_key = p_cycle_key
  left join public.transactions payment_transaction
    on payment_transaction.id = payment.transaction_id
   and payment_transaction.household_id = commitment.household_id
   and payment_transaction.type = 'expense'
   and payment_transaction.ignored_at is null
   and payment_transaction.occurred_on >= p_cycle_start
   and payment_transaction.occurred_on < p_cycle_end
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
    created_by, cycle_key, cycle_closure_id
  ) values (
    p_household_id, p_goal_id, p_amount_cents, contribution_date,
    nullif(trim(coalesce(p_note, '')), ''), uid, p_cycle_key, closure_id
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

revoke all on function public.allocate_cycle_surplus(uuid, uuid, text, date, date, bigint, date, text) from public;
grant execute on function public.allocate_cycle_surplus(uuid, uuid, text, date, date, bigint, date, text) to authenticated;

notify pgrst, 'reload schema';
