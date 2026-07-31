-- Persist rows rejected by CSV validation without storing invalid transactions.
alter table public.statement_imports
  add column if not exists rejected_transaction_count integer not null default 0
  check (rejected_transaction_count >= 0);

create or replace function public.import_statement_v3(
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
begin
  if p_rejected_count is null or p_rejected_count < 0 then
    raise exception using errcode = '22023', message = 'Quantidade de linhas rejeitadas inválida.';
  end if;

  outcome := public.import_statement_v2(
    p_household_id,
    p_file_hash,
    p_file_name,
    p_bank_id,
    p_initial_balance_cents,
    p_final_balance_cents,
    p_rows
  );

  import_id := (outcome->>'import_id')::uuid;

  update public.statement_imports
  set rejected_transaction_count = p_rejected_count
  where id = import_id
    and household_id = p_household_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Não foi possível registrar as linhas rejeitadas.';
  end if;

  return outcome || jsonb_build_object('rejected_count', p_rejected_count);
end;
$$;

revoke all on function public.import_statement_v3(uuid, text, text, text, bigint, bigint, integer, jsonb) from public;
grant execute on function public.import_statement_v3(uuid, text, text, text, bigint, bigint, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
