-- Pair two existing income/expense rows as an internal transfer between own accounts.
-- Keep type = income | expense. Do not invent a third transaction. Old rows stay null.

alter table public.transactions
  add column if not exists transfer_group_id uuid;

create index if not exists transactions_household_transfer_group_idx
  on public.transactions (household_id, transfer_group_id)
  where transfer_group_id is not null;

create or replace function public.assert_internal_transfer_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pair_count integer := 0;
  income_count integer := 0;
  expense_count integer := 0;
  amount_values integer := 0;
  household_values integer := 0;
  ignored_count integer := 0;
  missing_account_count integer := 0;
  distinct_accounts integer := 0;
begin
  if p_group_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_group_id::text, 0));

  select
    count(*),
    count(*) filter (where type = 'income'),
    count(*) filter (where type = 'expense'),
    count(distinct amount_cents),
    count(distinct household_id),
    count(*) filter (where ignored_at is not null),
    count(*) filter (where account_id is null or btrim(account_id) = ''),
    count(distinct account_id)
  into
    pair_count,
    income_count,
    expense_count,
    amount_values,
    household_values,
    ignored_count,
    missing_account_count,
    distinct_accounts
  from public.transactions
  where transfer_group_id = p_group_id;

  if pair_count = 0 then
    return;
  end if;

  if pair_count <> 2 then
    raise exception using errcode = '23514',
      message = 'Uma transferência interna precisa ter exatamente duas movimentações.';
  end if;
  if household_values <> 1 then
    raise exception using errcode = '23514',
      message = 'As duas pontas da transferência precisam pertencer à mesma casa.';
  end if;
  if ignored_count <> 0 then
    raise exception using errcode = '23514',
      message = 'Não é possível vincular uma movimentação ignorada como transferência interna.';
  end if;
  if income_count <> 1 or expense_count <> 1 then
    raise exception using errcode = '23514',
      message = 'A transferência interna precisa ter uma entrada e uma saída.';
  end if;
  if amount_values <> 1 then
    raise exception using errcode = '23514',
      message = 'As duas pontas da transferência precisam ter o mesmo valor.';
  end if;
  if missing_account_count <> 0 or distinct_accounts <> 2 then
    raise exception using errcode = '23514',
      message = 'As duas pontas da transferência precisam ser de contas diferentes.';
  end if;
end;
$$;

revoke all on function public.assert_internal_transfer_group(uuid) from public;

create or replace function public.validate_internal_transfer_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.assert_internal_transfer_group(old.transfer_group_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.transfer_group_id is distinct from new.transfer_group_id then
    perform public.assert_internal_transfer_group(old.transfer_group_id);
  end if;

  perform public.assert_internal_transfer_group(new.transfer_group_id);
  return new;
end;
$$;

revoke all on function public.validate_internal_transfer_group() from public;

drop trigger if exists transactions_internal_transfer_validate on public.transactions;
create constraint trigger transactions_internal_transfer_validate
  after insert or update or delete on public.transactions
  deferrable initially deferred
  for each row
  execute function public.validate_internal_transfer_group();

create or replace function public.create_internal_transfer(
  p_household_id uuid,
  p_from_account_id text,
  p_to_account_id text,
  p_amount_cents bigint,
  p_occurred_on date,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  group_id uuid := gen_random_uuid();
  from_account text := nullif(btrim(p_from_account_id), '');
  to_account text := nullif(btrim(p_to_account_id), '');
  note text := nullif(btrim(coalesce(p_note, '')), '');
  expense_id uuid;
  income_id uuid;
begin
  if uid is null or not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a estas movimentações.';
  end if;
  if from_account is null then
    raise exception using errcode = '22023', message = 'Selecione a conta de origem.';
  end if;
  if to_account is null then
    raise exception using errcode = '22023', message = 'Selecione a conta de destino.';
  end if;
  if from_account = to_account then
    raise exception using errcode = '22023', message = 'As duas pontas da transferência precisam ser de contas diferentes.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'Informe um valor maior que zero.';
  end if;
  if p_occurred_on is null then
    raise exception using errcode = '22023', message = 'Informe a data da transferência.';
  end if;

  insert into public.transactions (
    household_id, created_by, type, amount_cents, account_id, note, occurred_on, transfer_group_id
  ) values (
    p_household_id, uid, 'expense', p_amount_cents, from_account, note, p_occurred_on, group_id
  ) returning id into expense_id;

  insert into public.transactions (
    household_id, created_by, type, amount_cents, account_id, note, occurred_on, transfer_group_id
  ) values (
    p_household_id, uid, 'income', p_amount_cents, to_account, note, p_occurred_on, group_id
  ) returning id into income_id;

  return jsonb_build_object(
    'transfer_group_id', group_id,
    'expense_id', expense_id,
    'income_id', income_id
  );
end;
$$;

revoke all on function public.create_internal_transfer(uuid, text, text, bigint, date, text) from public;
grant execute on function public.create_internal_transfer(uuid, text, text, bigint, date, text) to authenticated;

create or replace function public.link_internal_transfer(
  p_household_id uuid,
  p_transaction_id uuid,
  p_counterpart_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  group_id uuid := gen_random_uuid();
  left_household uuid;
  right_household uuid;
  left_type text;
  right_type text;
  left_amount bigint;
  right_amount bigint;
  left_account text;
  right_account text;
  left_ignored timestamptz;
  right_ignored timestamptz;
  left_group uuid;
  right_group uuid;
begin
  if uid is null or not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a estas movimentações.';
  end if;
  if p_transaction_id is null or p_counterpart_id is null or p_transaction_id = p_counterpart_id then
    raise exception using errcode = '22023', message = 'Selecione duas movimentações diferentes para vincular.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(p_transaction_id::text, p_counterpart_id::text) || chr(31) || greatest(p_transaction_id::text, p_counterpart_id::text), 0)
  );

  select household_id, type, amount_cents, account_id, ignored_at, transfer_group_id
    into left_household, left_type, left_amount, left_account, left_ignored, left_group
  from public.transactions
  where id = p_transaction_id
  for update;

  select household_id, type, amount_cents, account_id, ignored_at, transfer_group_id
    into right_household, right_type, right_amount, right_account, right_ignored, right_group
  from public.transactions
  where id = p_counterpart_id
  for update;

  if left_household is null or right_household is null then
    raise exception using errcode = '23503', message = 'A movimentação selecionada não foi encontrada.';
  end if;
  if left_household <> p_household_id or right_household <> p_household_id then
    raise exception using errcode = '23514', message = 'As duas pontas da transferência precisam pertencer à mesma casa.';
  end if;
  if left_ignored is not null or right_ignored is not null then
    raise exception using errcode = '23514', message = 'Não é possível vincular uma movimentação ignorada como transferência interna.';
  end if;
  if left_group is not null or right_group is not null then
    raise exception using errcode = '23514', message = 'Uma das movimentações já está vinculada a outra transferência interna.';
  end if;
  if exists (
    select 1
    from public.financial_commitment_payments payment
    where payment.household_id = p_household_id
      and payment.transaction_id in (p_transaction_id, p_counterpart_id)
  ) then
    raise exception using errcode = '23514',
      message = 'Uma movimentação vinculada a um compromisso não pode ser transferência interna.';
  end if;
  if left_amount is distinct from right_amount or left_amount is null or left_amount <= 0 then
    raise exception using errcode = '23514', message = 'As duas pontas da transferência precisam ter o mesmo valor.';
  end if;
  if not ((left_type = 'expense' and right_type = 'income') or (left_type = 'income' and right_type = 'expense')) then
    raise exception using errcode = '23514', message = 'A transferência interna precisa ter uma entrada e uma saída.';
  end if;
  if left_account is null or btrim(left_account) = '' or right_account is null or btrim(right_account) = '' then
    raise exception using errcode = '23514', message = 'Informe a conta de origem e a conta de destino.';
  end if;
  if left_account = right_account then
    raise exception using errcode = '23514', message = 'As duas pontas da transferência precisam ser de contas diferentes.';
  end if;

  update public.transactions
  set transfer_group_id = group_id
  where household_id = p_household_id
    and id in (p_transaction_id, p_counterpart_id);

  return jsonb_build_object(
    'transfer_group_id', group_id,
    'transaction_id', p_transaction_id,
    'counterpart_id', p_counterpart_id
  );
end;
$$;

revoke all on function public.link_internal_transfer(uuid, uuid, uuid) from public;
grant execute on function public.link_internal_transfer(uuid, uuid, uuid) to authenticated;

create or replace function public.unlink_internal_transfer(
  p_household_id uuid,
  p_transaction_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  group_id uuid;
begin
  if uid is null or not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a estas movimentações.';
  end if;

  select transfer_group_id
    into group_id
  from public.transactions
  where id = p_transaction_id
    and household_id = p_household_id
  for update;

  if group_id is null then
    raise exception using errcode = '22023', message = 'Esta movimentação não é uma transferência interna.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(group_id::text, 0));

  update public.transactions
  set transfer_group_id = null
  where household_id = p_household_id
    and transfer_group_id = group_id;

  return jsonb_build_object('transfer_group_id', group_id, 'unlinked', true);
end;
$$;

revoke all on function public.unlink_internal_transfer(uuid, uuid) from public;
grant execute on function public.unlink_internal_transfer(uuid, uuid) to authenticated;

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
  transaction_transfer_group_id uuid;
  payment_cycle_start date;
  payment_cycle_end date;
  already_paid_cents bigint := 0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.commitment_id::text || chr(31) || new.cycle_key, 0)
  );

  select household_id, amount_cents
  into commitment_household_id, commitment_amount_cents
  from public.financial_commitments
  where id = new.commitment_id
  for update;

  if commitment_household_id is null or commitment_household_id <> new.household_id then
    raise exception using errcode = '23514', message = 'O compromisso não pertence a esta casa.';
  end if;

  select household_id, amount_cents, type, occurred_on, ignored_at, transfer_group_id
  into transaction_household_id, transaction_amount_cents, transaction_type,
       transaction_date, transaction_ignored_at, transaction_transfer_group_id
  from public.transactions
  where id = new.transaction_id;

  if transaction_household_id is null or transaction_household_id <> new.household_id then
    raise exception using errcode = '23514', message = 'A movimentação não pertence a esta casa.';
  end if;
  if transaction_type <> 'expense' or transaction_ignored_at is not null then
    raise exception using errcode = '23514', message = 'Somente uma despesa visível pode contabilizar um compromisso.';
  end if;
  if transaction_transfer_group_id is not null then
    raise exception using errcode = '23514',
      message = 'Uma transferência entre contas próprias não pode contabilizar um compromisso.';
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
  if new.paid_cents > transaction_amount_cents then
    raise exception using errcode = '23514', message = 'O valor contabilizado ultrapassa a despesa.';
  end if;

  select coalesce(sum(paid_cents), 0)
  into already_paid_cents
  from public.financial_commitment_payments
  where commitment_id = new.commitment_id
    and cycle_key = new.cycle_key
    and id is distinct from new.id;

  if already_paid_cents + new.paid_cents > commitment_amount_cents then
    raise exception using errcode = '23514',
      message = 'O total pago neste ciclo ultrapassa o valor do compromisso.';
  end if;

  new.paid_on := transaction_date;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_financial_commitment_payment() from public;

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
