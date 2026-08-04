-- Unify the account used by manual transactions and imported statements.
alter table public.transactions
  add column if not exists account_id text
  check (account_id is null or char_length(trim(account_id)) between 1 and 80);

update public.transactions as transaction
set account_id = statement_import.bank_id
from public.statement_imports as statement_import
where transaction.statement_import_id = statement_import.id
  and transaction.account_id is null
  and statement_import.bank_id is not null;

create index if not exists transactions_household_account_occurred_idx
  on public.transactions (household_id, account_id, occurred_on desc);

create or replace function public.copy_statement_bank_to_transaction_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is null and new.statement_import_id is not null then
    select statement_import.bank_id
      into new.account_id
    from public.statement_imports as statement_import
    where statement_import.id = new.statement_import_id
      and statement_import.household_id = new.household_id;
  end if;

  return new;
end;
$$;

revoke all on function public.copy_statement_bank_to_transaction_account() from public;

drop trigger if exists transactions_copy_statement_bank on public.transactions;
create trigger transactions_copy_statement_bank
  before insert or update of statement_import_id, account_id
  on public.transactions
  for each row
  execute function public.copy_statement_bank_to_transaction_account();

notify pgrst, 'reload schema';
