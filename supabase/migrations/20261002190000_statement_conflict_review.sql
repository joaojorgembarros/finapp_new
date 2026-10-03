-- Detailed manual-vs-CSV conflict preview and an import path that can
-- keep a conflicting source line when the user says it is a different movement.
-- find_statement_import_conflicts stays integer[] for the existing import chain.

create or replace function public.find_statement_import_conflict_pairs(
  p_household_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pairs jsonb;
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
      coalesce(item.note, '') as note,
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
      tx.id,
      tx.type,
      tx.amount_cents,
      tx.occurred_on,
      tx.category_id,
      tx.account_id,
      tx.statement_import_id,
      tx.ignored_at,
      tx.created_at,
      case
        when tx.statement_import_id is not null then tx.original_note
        else tx.note
      end as compared_note,
      lower(regexp_replace(
        coalesce(
          case when tx.statement_import_id is not null then tx.original_note else tx.note end,
          ''
        ),
        '\s+',
        ' ',
        'g'
      )) as normalized_note
    from public.transactions as tx
    where tx.household_id = p_household_id
  ),
  conflicting as (
    select incoming.*
    from incoming
    left join (
      select type, amount_cents, occurred_on, normalized_note, count(*) as quantity
      from existing
      group by type, amount_cents, occurred_on, normalized_note
    ) as grouped
      on grouped.type = incoming.type
     and grouped.amount_cents = incoming.amount_cents
     and grouped.occurred_on = incoming.occurred_on
     and grouped.normalized_note = incoming.normalized_note
    where incoming.occurrence <= coalesce(grouped.quantity, 0)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'raw_line', conflicting.raw_line,
      'type', conflicting.type,
      'amount_cents', conflicting.amount_cents,
      'occurred_on', conflicting.occurred_on,
      'note', conflicting.note,
      'matches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'transaction_id', existing.id,
          'note', existing.compared_note,
          'category_id', existing.category_id,
          'account_id', existing.account_id,
          'statement_import_id', existing.statement_import_id,
          'ignored_at', existing.ignored_at
        ) order by existing.created_at, existing.id)
        from existing
        where existing.type = conflicting.type
          and existing.amount_cents = conflicting.amount_cents
          and existing.occurred_on = conflicting.occurred_on
          and existing.normalized_note = conflicting.normalized_note
      ), '[]'::jsonb)
    )
    order by conflicting.raw_line
  ), '[]'::jsonb)
  into pairs
  from conflicting;

  return pairs;
end;
$$;

revoke all on function public.find_statement_import_conflict_pairs(uuid, jsonb) from public, anon;
grant execute on function public.find_statement_import_conflict_pairs(uuid, jsonb) to authenticated;

create or replace function public.import_statement_v7(
  p_household_id uuid,
  p_file_hash text,
  p_file_name text,
  p_bank_id text,
  p_initial_balance_cents bigint,
  p_final_balance_cents bigint,
  p_balance_confidence text,
  p_rejected_count integer,
  p_rows jsonb,
  p_category_rules jsonb,
  p_force_source_lines integer[]
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
  protected_lines integer[];
  effective_skip integer[];
  categorized_count integer := 0;
  learned_count integer := 0;
  imported_period_start date;
  imported_period_end date;
  force_lines integer[] := coalesce(p_force_source_lines, '{}'::integer[]);
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária para importar o extrato.';
  end if;

  if not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não faz parte desta casa.';
  end if;

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

  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Identificação do arquivo inválida.';
  end if;

  if p_file_name is null or char_length(trim(p_file_name)) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'Nome do arquivo inválido.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'As transações do extrato são inválidas.';
  end if;

  if p_category_rules is null or jsonb_typeof(p_category_rules) <> 'array' then
    raise exception using errcode = '22023', message = 'As regras de categoria são inválidas.';
  end if;

  if p_rejected_count is null or p_rejected_count < 0 then
    raise exception using errcode = '22023', message = 'Quantidade de linhas rejeitadas inválida.';
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
      raw_line integer,
      category_id uuid
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

  if exists (
    select 1
    from unnest(force_lines) as forced(raw_line)
    where forced.raw_line is null
       or not exists (
         select 1
         from jsonb_to_recordset(p_rows) as item(raw_line integer)
         where item.raw_line = forced.raw_line
       )
  ) then
    raise exception using errcode = '22023', message = 'Uma linha autorizada não pertence a este extrato.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as item(type text, category_id uuid)
    left join public.categories as category
      on category.id = item.category_id
     and category.household_id = p_household_id
    where item.category_id is not null
      and (category.id is null or category.flow <> item.type)
  ) then
    raise exception using errcode = '22023', message = 'O extrato contém uma categoria inválida.';
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
      )) as normalized_note
    from jsonb_to_recordset(p_rows) as item(
      type text,
      amount_cents bigint,
      note text,
      occurred_on date,
      raw_line integer
    )
    where item.raw_line = any(conflict_lines)
  )
  select coalesce(array_agg(distinct incoming.raw_line), '{}'::integer[])
  into protected_lines
  from incoming
  join public.transactions as tx
    on tx.household_id = p_household_id
   and tx.statement_import_id is not null
   and tx.type = incoming.type
   and tx.amount_cents = incoming.amount_cents
   and tx.occurred_on = incoming.occurred_on
   and lower(regexp_replace(
     coalesce(tx.original_note, ''),
     '\s+',
     ' ',
     'g'
   )) = incoming.normalized_note;

  select coalesce(array_agg(skipped.raw_line order by skipped.raw_line), '{}'::integer[])
  into effective_skip
  from unnest(conflict_lines) as skipped(raw_line)
  where not (
    skipped.raw_line = any(force_lines)
    and not (skipped.raw_line = any(protected_lines))
  );

  skipped_count := cardinality(effective_skip);
  imported_count := source_count - skipped_count;

  if imported_count < 1 then
    -- P0001 stays outside the unique_violation handler, which rewrites 23505
    -- as a repeated-file error. transaction_count > 0 is unchanged.
    raise exception using errcode = 'P0001', message = 'Nenhuma movimentação nova será importada.';
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
  where not (item.raw_line = any(effective_skip));

  insert into public.statement_imports (
    household_id,
    created_by,
    file_hash,
    file_name,
    bank_id,
    transaction_count,
    skipped_transaction_count,
    rejected_transaction_count,
    income_cents,
    expense_cents,
    initial_balance_cents,
    final_balance_cents,
    balance_confidence,
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
    p_rejected_count,
    income_total,
    expense_total,
    p_initial_balance_cents,
    case
      when p_balance_confidence in ('confirmed', 'derived') then p_final_balance_cents
      else null
    end,
    p_balance_confidence,
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
    original_note,
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
  where not (item.raw_line = any(effective_skip));

  with categorized as (
    select item.raw_line, item.category_id
    from jsonb_to_recordset(p_rows) as item(raw_line integer, category_id uuid)
    where item.category_id is not null
      and not (item.raw_line = any(effective_skip))
  )
  update public.transactions as transaction
  set category_id = categorized.category_id
  from categorized
  where transaction.statement_import_id = import_id
    and transaction.source_line = categorized.raw_line;

  get diagnostics categorized_count = row_count;

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

  update public.statement_imports
  set period_start = (
        select min(item.occurred_on)
        from jsonb_to_recordset(p_rows) as item(occurred_on date)
      ),
      period_end = (
        select max(item.occurred_on)
        from jsonb_to_recordset(p_rows) as item(occurred_on date)
      )
  where id = import_id
    and household_id = p_household_id;

  select min(occurred_on), max(occurred_on)
  into imported_period_start, imported_period_end
  from public.transactions
  where statement_import_id = import_id
    and household_id = p_household_id;

  return jsonb_build_object(
    'import_id', import_id,
    'source_count', source_count,
    'imported_count', imported_count,
    'skipped_count', skipped_count,
    'rejected_count', p_rejected_count,
    'categorized_count', categorized_count,
    'learned_rules_count', learned_count,
    'imported_period_start', imported_period_start,
    'imported_period_end', imported_period_end
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Este arquivo já foi importado.';
end;
$$;

revoke all on function public.import_statement_v7(uuid, text, text, text, bigint, bigint, text, integer, jsonb, jsonb, integer[]) from public, anon;
grant execute on function public.import_statement_v7(uuid, text, text, text, bigint, bigint, text, integer, jsonb, jsonb, integer[]) to authenticated;

notify pgrst, 'reload schema';
