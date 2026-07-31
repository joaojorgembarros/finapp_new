-- Preview semantic conflicts and import only new statement rows atomically.
alter table public.statement_imports
  add column if not exists skipped_transaction_count integer not null default 0
  check (skipped_transaction_count >= 0);

create or replace function public.find_statement_import_conflicts(
  p_household_id uuid,
  p_rows jsonb
) returns integer[]
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  conflict_lines integer[];
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária para verificar o extrato.';
  end if;

  if not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não faz parte desta casa.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'As transações do extrato são inválidas.';
  end if;

  with incoming as (
    select
      item.raw_line,
      item.type,
      item.amount_cents,
      item.occurred_on,
      lower(regexp_replace(
        coalesce(left(nullif(trim(item.note), ''), 500), ''),
        '\s+',
        ' ',
        'g'
      )) as normalized_note,
      row_number() over (
        partition by
          item.type,
          item.amount_cents,
          item.occurred_on,
          lower(regexp_replace(
            coalesce(left(nullif(trim(item.note), ''), 500), ''),
            '\s+',
            ' ',
            'g'
          ))
        order by item.raw_line
      ) as occurrence
    from jsonb_to_recordset(p_rows) as item(
      type text,
      amount_cents bigint,
      note text,
      occurred_on date,
      raw_line integer
    )
  ),
  existing as (
    select
      tx.type,
      tx.amount_cents,
      tx.occurred_on,
      lower(regexp_replace(coalesce(tx.note, ''), '\s+', ' ', 'g')) as normalized_note,
      count(*) as quantity
    from public.transactions as tx
    where tx.household_id = p_household_id
    group by
      tx.type,
      tx.amount_cents,
      tx.occurred_on,
      lower(regexp_replace(coalesce(tx.note, ''), '\s+', ' ', 'g'))
  )
  select coalesce(
    array_agg(incoming.raw_line order by incoming.raw_line)
      filter (where incoming.occurrence <= coalesce(existing.quantity, 0)),
    '{}'::integer[]
  )
  into conflict_lines
  from incoming
  left join existing
    on existing.type = incoming.type
   and existing.amount_cents = incoming.amount_cents
   and existing.occurred_on = incoming.occurred_on
   and existing.normalized_note = incoming.normalized_note;

  return conflict_lines;
end;
$$;

create or replace function public.import_statement_v2(
  p_household_id uuid,
  p_file_hash text,
  p_file_name text,
  p_bank_id text,
  p_initial_balance_cents bigint,
  p_final_balance_cents bigint,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  import_id uuid;
  source_count integer;
  imported_count integer;
  skipped_count integer;
  income_total bigint;
  expense_total bigint;
  first_date date;
  last_date date;
  conflict_lines integer[];
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

  source_count := jsonb_array_length(p_rows);
  if source_count < 1 or source_count > 5000 then
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

  if (
    select count(distinct item.raw_line)
    from jsonb_to_recordset(p_rows) as item(raw_line integer)
  ) <> source_count then
    raise exception using errcode = '22023', message = 'O extrato contém linhas repetidas.';
  end if;

  -- Serialize imports in the same household so conflict detection and insertion
  -- remain one atomic decision even when requests arrive concurrently.
  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text, 0));

  if exists (
    select 1
    from public.statement_imports
    where household_id = p_household_id
      and file_hash = p_file_hash
  ) then
    raise exception using errcode = '23505', message = 'Este arquivo já foi importado.';
  end if;

  conflict_lines := public.find_statement_import_conflicts(p_household_id, p_rows);
  skipped_count := cardinality(conflict_lines);
  imported_count := source_count - skipped_count;

  if imported_count < 1 then
    raise exception using errcode = '23505', message = 'As movimentações deste arquivo já foram importadas.';
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
  )
  where not (item.raw_line = any(conflict_lines));

  insert into public.statement_imports (
    household_id,
    created_by,
    file_hash,
    file_name,
    bank_id,
    transaction_count,
    skipped_transaction_count,
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
    imported_count,
    skipped_count,
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
  )
  where not (item.raw_line = any(conflict_lines));

  return jsonb_build_object(
    'import_id', import_id,
    'source_count', source_count,
    'imported_count', imported_count,
    'skipped_count', skipped_count
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Este arquivo já foi importado.';
end;
$$;

revoke all on function public.find_statement_import_conflicts(uuid, jsonb) from public;
grant execute on function public.find_statement_import_conflicts(uuid, jsonb) to authenticated;

revoke all on function public.import_statement_v2(uuid, text, text, text, bigint, bigint, jsonb) from public;
grant execute on function public.import_statement_v2(uuid, text, text, text, bigint, bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';
