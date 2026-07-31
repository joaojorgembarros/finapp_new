-- Persist user-reviewed categories as part of the atomic statement import.
create or replace function public.import_statement_v4(
  p_household_id uuid,
  p_file_hash text,
  p_file_name text,
  p_bank_id text,
  p_initial_balance_cents bigint,
  p_final_balance_cents bigint,
  p_rejected_count integer,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  outcome jsonb;
  import_id uuid;
  categorized_count integer;
begin
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

  outcome := public.import_statement_v3(
    p_household_id,
    p_file_hash,
    p_file_name,
    p_bank_id,
    p_initial_balance_cents,
    p_final_balance_cents,
    p_rejected_count,
    p_rows
  );

  import_id := (outcome->>'import_id')::uuid;

  with categorized as (
    select item.raw_line, item.category_id
    from jsonb_to_recordset(p_rows) as item(raw_line integer, category_id uuid)
    where item.category_id is not null
  )
  update public.transactions as transaction
  set category_id = categorized.category_id
  from categorized
  where transaction.statement_import_id = import_id
    and transaction.source_line = categorized.raw_line;

  get diagnostics categorized_count = row_count;

  return outcome || jsonb_build_object('categorized_count', categorized_count);
end;
$$;

revoke all on function public.import_statement_v4(uuid, text, text, text, bigint, bigint, integer, jsonb) from public;
grant execute on function public.import_statement_v4(uuid, text, text, text, bigint, bigint, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
