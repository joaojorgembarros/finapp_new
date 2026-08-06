-- Safe editing for manual transactions and reversible visibility for statement rows.
alter table public.transactions
  add column if not exists original_note text,
  add column if not exists ignored_at timestamptz,
  add column if not exists ignored_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.transactions
set original_note = note
where statement_import_id is not null
  and original_note is null;

create index if not exists transactions_household_visible_occurred_idx
  on public.transactions (household_id, occurred_on desc)
  where ignored_at is null;

create or replace function public.maintain_transaction_edit_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();

  if new.statement_import_id is not null then
    if tg_op = 'INSERT' then
      new.original_note := coalesce(new.original_note, new.note);
    else
      new.original_note := coalesce(old.original_note, old.note, new.original_note, new.note);
    end if;
  else
    new.original_note := null;
    new.ignored_at := null;
    new.ignored_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_maintain_edit_metadata on public.transactions;
create trigger transactions_maintain_edit_metadata
  before insert or update on public.transactions
  for each row execute function public.maintain_transaction_edit_metadata();

-- Semantic deduplication must compare the immutable statement description,
-- not a user-edited display description. Ignored rows intentionally remain
-- part of conflict detection so reimporting does not resurrect them.
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
      lower(regexp_replace(
        coalesce(
          case when tx.statement_import_id is not null then tx.original_note else tx.note end,
          ''
        ),
        '\s+',
        ' ',
        'g'
      )) as normalized_note,
      count(*) as quantity
    from public.transactions as tx
    where tx.household_id = p_household_id
    group by
      tx.type,
      tx.amount_cents,
      tx.occurred_on,
      lower(regexp_replace(
        coalesce(
          case when tx.statement_import_id is not null then tx.original_note else tx.note end,
          ''
        ),
        '\s+',
        ' ',
        'g'
      ))
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

revoke all on function public.find_statement_import_conflicts(uuid, jsonb) from public;
grant execute on function public.find_statement_import_conflicts(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
