-- Persistent statement import history, exact-file deduplication and atomic imports.
create table if not exists public.statement_imports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  file_name text not null check (char_length(trim(file_name)) between 1 and 255),
  bank_id text check (bank_id is null or char_length(bank_id) between 1 and 80),
  transaction_count integer not null check (transaction_count > 0),
  income_cents bigint not null default 0 check (income_cents >= 0),
  expense_cents bigint not null default 0 check (expense_cents >= 0),
  initial_balance_cents bigint,
  final_balance_cents bigint,
  period_start date not null,
  period_end date not null,
  created_at timestamptz not null default now(),
  unique (household_id, file_hash),
  check (period_end >= period_start)
);

create index if not exists statement_imports_household_created_idx
  on public.statement_imports (household_id, created_at desc);

alter table public.transactions
  add column if not exists statement_import_id uuid references public.statement_imports(id) on delete cascade;
alter table public.transactions
  add column if not exists source_line integer check (source_line is null or source_line > 0);

create unique index if not exists transactions_statement_source_line_idx
  on public.transactions (statement_import_id, source_line)
  where statement_import_id is not null and source_line is not null;

alter table public.statement_imports enable row level security;

drop policy if exists statement_imports_select_member on public.statement_imports;
create policy statement_imports_select_member on public.statement_imports
  for select using (public.is_member(household_id));

drop policy if exists statement_imports_delete_member on public.statement_imports;
create policy statement_imports_delete_member on public.statement_imports
  for delete using (public.is_member(household_id));

create or replace function public.import_statement(
  p_household_id uuid,
  p_file_hash text,
  p_file_name text,
  p_bank_id text,
  p_initial_balance_cents bigint,
  p_final_balance_cents bigint,
  p_rows jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  import_id uuid;
  row_count integer;
  income_total bigint;
  expense_total bigint;
  first_date date;
  last_date date;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária para importar o extrato.';
  end if;

  if not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não faz parte desta casa.';
  end if;

  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Identificação do arquivo inválida.';
  end if;

  if p_file_name is null or char_length(trim(p_file_name)) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'Nome do arquivo inválido.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'As transações do extrato são inválidas.';
  end if;

  row_count := jsonb_array_length(p_rows);
  if row_count < 1 or row_count > 5000 then
    raise exception using errcode = '22023', message = 'O extrato deve conter entre 1 e 5.000 transações.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as item(
      type text,
      amount_cents bigint,
      note text,
      occurred_on date,
      raw_line integer
    )
    where item.type not in ('income', 'expense')
       or item.amount_cents is null
       or item.amount_cents <= 0
       or item.occurred_on is null
       or item.raw_line is null
       or item.raw_line <= 0
  ) then
    raise exception using errcode = '22023', message = 'O extrato contém uma transação inválida.';
  end if;

  select
    coalesce(sum(item.amount_cents) filter (where item.type = 'income'), 0),
    coalesce(sum(item.amount_cents) filter (where item.type = 'expense'), 0),
    min(item.occurred_on),
    max(item.occurred_on)
  into income_total, expense_total, first_date, last_date
  from jsonb_to_recordset(p_rows) as item(
    type text,
    amount_cents bigint,
    note text,
    occurred_on date,
    raw_line integer
  );

  -- Imports made before this migration have no file hash. For multi-row
  -- statements, compare the complete transaction multiset as a safe fallback.
  if row_count > 1 and not exists (
    with incoming as (
      select
        item.type,
        item.amount_cents,
        coalesce(left(nullif(trim(item.note), ''), 500), '') as note,
        item.occurred_on,
        count(*) as quantity
      from jsonb_to_recordset(p_rows) as item(
        type text,
        amount_cents bigint,
        note text,
        occurred_on date,
        raw_line integer
      )
      group by item.type, item.amount_cents, coalesce(left(nullif(trim(item.note), ''), 500), ''), item.occurred_on
    ),
    existing as (
      select
        tx.type,
        tx.amount_cents,
        coalesce(tx.note, '') as note,
        tx.occurred_on,
        count(*) as quantity
      from public.transactions as tx
      where tx.household_id = p_household_id
        and tx.occurred_on between first_date and last_date
      group by tx.type, tx.amount_cents, coalesce(tx.note, ''), tx.occurred_on
    )
    select 1
    from incoming
    left join existing
      on existing.type = incoming.type
     and existing.amount_cents = incoming.amount_cents
     and existing.note = incoming.note
     and existing.occurred_on = incoming.occurred_on
    where coalesce(existing.quantity, 0) < incoming.quantity
  ) then
    raise exception using errcode = '23505', message = 'As movimentações deste arquivo já foram importadas.';
  end if;

  insert into public.statement_imports (
    household_id,
    created_by,
    file_hash,
    file_name,
    bank_id,
    transaction_count,
    income_cents,
    expense_cents,
    initial_balance_cents,
    final_balance_cents,
    period_start,
    period_end
  ) values (
    p_household_id,
    uid,
    p_file_hash,
    trim(p_file_name),
    nullif(trim(p_bank_id), ''),
    row_count,
    income_total,
    expense_total,
    p_initial_balance_cents,
    p_final_balance_cents,
    first_date,
    last_date
  )
  returning id into import_id;

  insert into public.transactions (
    household_id,
    type,
    amount_cents,
    category_id,
    note,
    occurred_on,
    created_by,
    statement_import_id,
    source_line
  )
  select
    p_household_id,
    item.type,
    item.amount_cents,
    null,
    left(nullif(trim(item.note), ''), 500),
    item.occurred_on,
    uid,
    import_id,
    item.raw_line
  from jsonb_to_recordset(p_rows) as item(
    type text,
    amount_cents bigint,
    note text,
    occurred_on date,
    raw_line integer
  );

  return import_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Este arquivo já foi importado.';
end;
$$;

revoke all on function public.import_statement(uuid, text, text, text, bigint, bigint, jsonb) from public;
grant execute on function public.import_statement(uuid, text, text, text, bigint, bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';
