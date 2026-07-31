-- Learn household-specific statement categorization rules and support
-- recategorizing transactions from an existing statement import.
create table if not exists public.statement_category_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  flow text not null check (flow in ('income', 'expense')),
  match_key text not null check (char_length(trim(match_key)) between 2 and 160),
  category_id uuid not null references public.categories(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, flow, match_key)
);

alter table public.statement_category_rules enable row level security;

drop policy if exists statement_category_rules_select_member on public.statement_category_rules;
create policy statement_category_rules_select_member
  on public.statement_category_rules
  for select
  using (public.is_member(household_id));

create or replace function public.import_statement_v5(
  p_household_id uuid,
  p_file_hash text,
  p_file_name text,
  p_bank_id text,
  p_initial_balance_cents bigint,
  p_final_balance_cents bigint,
  p_rejected_count integer,
  p_rows jsonb,
  p_category_rules jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  outcome jsonb;
  learned_count integer := 0;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária para importar o extrato.';
  end if;

  if p_category_rules is null or jsonb_typeof(p_category_rules) <> 'array' then
    raise exception using errcode = '22023', message = 'As regras de categoria são inválidas.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_category_rules) as item(
      flow text,
      match_key text,
      category_id uuid
    )
    left join public.categories as category
      on category.id = item.category_id
     and category.household_id = p_household_id
    where item.flow not in ('income', 'expense')
       or item.match_key is null
       or char_length(trim(item.match_key)) not between 2 and 160
       or category.id is null
       or category.flow <> item.flow
  ) then
    raise exception using errcode = '22023', message = 'Uma regra de categoria é inválida.';
  end if;

  outcome := public.import_statement_v4(
    p_household_id,
    p_file_hash,
    p_file_name,
    p_bank_id,
    p_initial_balance_cents,
    p_final_balance_cents,
    p_rejected_count,
    p_rows
  );

  insert into public.statement_category_rules (
    household_id,
    flow,
    match_key,
    category_id,
    created_by
  )
  select distinct on (item.flow, lower(trim(item.match_key)))
    p_household_id,
    item.flow,
    lower(trim(item.match_key)),
    item.category_id,
    uid
  from jsonb_to_recordset(p_category_rules) as item(
    flow text,
    match_key text,
    category_id uuid
  )
  order by item.flow, lower(trim(item.match_key))
  on conflict (household_id, flow, match_key)
  do update set
    category_id = excluded.category_id,
    created_by = excluded.created_by,
    updated_at = now();

  get diagnostics learned_count = row_count;
  return outcome || jsonb_build_object('learned_rules_count', learned_count);
end;
$$;

create or replace function public.categorize_statement_import(
  p_household_id uuid,
  p_import_id uuid,
  p_assignments jsonb,
  p_category_rules jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  assignment_count integer;
  updated_count integer := 0;
  learned_count integer := 0;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária para categorizar o extrato.';
  end if;

  if not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não faz parte desta casa.';
  end if;

  if not exists (
    select 1
    from public.statement_imports
    where id = p_import_id
      and household_id = p_household_id
  ) then
    raise exception using errcode = 'P0002', message = 'Importação não encontrada.';
  end if;

  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'As categorias revisadas são inválidas.';
  end if;

  if p_category_rules is null or jsonb_typeof(p_category_rules) <> 'array' then
    raise exception using errcode = '22023', message = 'As regras de categoria são inválidas.';
  end if;

  assignment_count := jsonb_array_length(p_assignments);
  if (
    select count(distinct item.transaction_id)
    from jsonb_to_recordset(p_assignments) as item(transaction_id uuid)
  ) <> assignment_count then
    raise exception using errcode = '22023', message = 'Uma movimentação foi informada mais de uma vez.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_assignments) as item(
      transaction_id uuid,
      category_id uuid
    )
    left join public.transactions as transaction
      on transaction.id = item.transaction_id
     and transaction.household_id = p_household_id
     and transaction.statement_import_id = p_import_id
    left join public.categories as category
      on category.id = item.category_id
     and category.household_id = p_household_id
    where transaction.id is null
       or (
         item.category_id is not null
         and (category.id is null or category.flow <> transaction.type)
       )
  ) then
    raise exception using errcode = '22023', message = 'Uma categoria revisada é inválida.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_category_rules) as item(
      flow text,
      match_key text,
      category_id uuid
    )
    left join public.categories as category
      on category.id = item.category_id
     and category.household_id = p_household_id
    where item.flow not in ('income', 'expense')
       or item.match_key is null
       or char_length(trim(item.match_key)) not between 2 and 160
       or category.id is null
       or category.flow <> item.flow
  ) then
    raise exception using errcode = '22023', message = 'Uma regra de categoria é inválida.';
  end if;

  with assignments as (
    select item.transaction_id, item.category_id
    from jsonb_to_recordset(p_assignments) as item(
      transaction_id uuid,
      category_id uuid
    )
  )
  update public.transactions as transaction
  set category_id = assignments.category_id
  from assignments
  where transaction.id = assignments.transaction_id
    and transaction.household_id = p_household_id
    and transaction.statement_import_id = p_import_id;

  get diagnostics updated_count = row_count;

  insert into public.statement_category_rules (
    household_id,
    flow,
    match_key,
    category_id,
    created_by
  )
  select distinct on (item.flow, lower(trim(item.match_key)))
    p_household_id,
    item.flow,
    lower(trim(item.match_key)),
    item.category_id,
    uid
  from jsonb_to_recordset(p_category_rules) as item(
    flow text,
    match_key text,
    category_id uuid
  )
  order by item.flow, lower(trim(item.match_key))
  on conflict (household_id, flow, match_key)
  do update set
    category_id = excluded.category_id,
    created_by = excluded.created_by,
    updated_at = now();

  get diagnostics learned_count = row_count;

  return jsonb_build_object(
    'updated_count', updated_count,
    'learned_rules_count', learned_count
  );
end;
$$;

revoke all on function public.import_statement_v5(uuid, text, text, text, bigint, bigint, integer, jsonb, jsonb) from public;
grant execute on function public.import_statement_v5(uuid, text, text, text, bigint, bigint, integer, jsonb, jsonb) to authenticated;

revoke all on function public.categorize_statement_import(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.categorize_statement_import(uuid, uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
