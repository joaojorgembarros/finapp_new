-- FinApp MVP schema: ordered, idempotent and safe for new/existing projects.
create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  type text not null default 'individual' check (type in ('individual', 'couple', 'shared')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create or replace function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
    where m.household_id = hid and m.user_id = auth.uid());
$$;
revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  income_cents bigint not null default 0 check (income_cents >= 0),
  income_fixed_cents bigint not null default 0 check (income_fixed_cents >= 0),
  income_variable_avg_cents bigint not null default 0 check (income_variable_avg_cents >= 0),
  employment_type text not null default 'CLT',
  onboarding_done boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists income_fixed_cents bigint not null default 0;
alter table public.profiles add column if not exists income_variable_avg_cents bigint not null default 0;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  flow text not null check (flow in ('income', 'expense')), kind text not null check (kind in ('fixed', 'variable')),
  name text not null check (char_length(trim(name)) between 1 and 80), icon text, sort integer not null default 0,
  created_at timestamptz not null default now(), unique (household_id, flow, kind, name)
);
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('income', 'expense')), amount_cents bigint not null check (amount_cents > 0),
  category_id uuid references public.categories(id) on delete set null, note text, occurred_on date not null default current_date,
  created_by uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now()
);
create index if not exists transactions_household_occurred_idx on public.transactions (household_id, occurred_on desc);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month_key text not null check (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  planned_cents bigint not null default 0 check (planned_cents >= 0), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (household_id, category_id, month_key)
);
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120), target_cents bigint not null check (target_cents > 0),
  desired_date date not null, priority integer not null default 1 check (priority > 0),
  created_by uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now()
);
create table if not exists public.pay_schedules (
  household_id uuid primary key references public.households(id) on delete cascade,
  mode text not null default 'month' check (mode in ('month', 'twice_month')), settings jsonb not null default '{}'::jsonb,
  updated_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade, cycle_key text not null,
  cycle_start date not null, cycle_end date not null, amount_cents bigint not null default 0 check (amount_cents >= 0),
  updated_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (household_id, goal_id, cycle_key), check (cycle_end > cycle_start)
);
create table if not exists public.cycle_closures (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  cycle_key text not null, mode text not null check (mode in ('month', 'twice_month')),
  cycle_start date not null, cycle_end date not null, net_cents bigint not null default 0,
  allocated_cents bigint not null default 0 check (allocated_cents >= 0),
  updated_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (household_id, cycle_key), check (cycle_end > cycle_start)
);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade, type text not null check (type in ('cash', 'bank', 'card')),
  name text not null check (char_length(trim(name)) between 1 and 80),
  credit_limit_cents bigint check (credit_limit_cents is null or credit_limit_cents >= 0),
  closing_day integer check (closing_day is null or closing_day between 1 and 28),
  due_day integer check (due_day is null or due_day between 1 and 28),
  limit_behavior text not null default 'full' check (limit_behavior in ('full', 'installment')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.card_charges (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.payment_methods(id) on delete cascade, purchased_on date not null,
  description text, total_cents bigint not null check (total_cents > 0),
  installments_total integer not null default 1 check (installments_total between 1 and 60),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.card_installments (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.payment_methods(id) on delete cascade,
  charge_id uuid not null references public.card_charges(id) on delete cascade,
  n integer not null check (n between 1 and 60), due_on date not null,
  amount_cents bigint not null check (amount_cents > 0), paid_at timestamptz,
  created_at timestamptz not null default now(), unique (charge_id, n)
);
create index if not exists card_installments_household_due_idx on public.card_installments (household_id, due_on);

alter table public.households enable row level security;
alter table public.memberships enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.pay_schedules enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.cycle_closures enable row level security;
alter table public.payment_methods enable row level security;
alter table public.card_charges enable row level security;
alter table public.card_installments enable row level security;

drop policy if exists households_select_member on public.households;
create policy households_select_member on public.households for select using (public.is_member(id));
drop policy if exists households_update_owner on public.households;
create policy households_update_owner on public.households for update using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists households_insert_owner on public.households;

drop policy if exists memberships_select_self on public.memberships;
create policy memberships_select_self on public.memberships for select using (user_id = auth.uid());
drop policy if exists memberships_insert_self on public.memberships;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select using (user_id = auth.uid());
drop policy if exists profiles_upsert_self on public.profiles;
create policy profiles_upsert_self on public.profiles for insert with check (user_id = auth.uid());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists categories_member_rw on public.categories;
create policy categories_member_rw on public.categories for all using (public.is_member(household_id)) with check (public.is_member(household_id));
drop policy if exists budgets_member_rw on public.budgets;
create policy budgets_member_rw on public.budgets for all using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists transactions_member_rw on public.transactions;
drop policy if exists transactions_select_member on public.transactions;
create policy transactions_select_member on public.transactions for select using (public.is_member(household_id));
drop policy if exists transactions_insert_member on public.transactions;
create policy transactions_insert_member on public.transactions for insert with check (public.is_member(household_id) and created_by = auth.uid());
drop policy if exists transactions_update_member on public.transactions;
create policy transactions_update_member on public.transactions for update using (public.is_member(household_id)) with check (public.is_member(household_id));
drop policy if exists transactions_delete_member on public.transactions;
create policy transactions_delete_member on public.transactions for delete using (public.is_member(household_id));

drop policy if exists goals_member_rw on public.goals;
create policy goals_member_rw on public.goals for all using (public.is_member(household_id)) with check (public.is_member(household_id) and created_by = auth.uid());
drop policy if exists pay_schedules_member_rw on public.pay_schedules;
create policy pay_schedules_member_rw on public.pay_schedules for all using (public.is_member(household_id)) with check (public.is_member(household_id) and updated_by = auth.uid());
drop policy if exists goal_contributions_member_rw on public.goal_contributions;
create policy goal_contributions_member_rw on public.goal_contributions for all using (public.is_member(household_id)) with check (public.is_member(household_id) and updated_by = auth.uid());
drop policy if exists cycle_closures_member_rw on public.cycle_closures;
create policy cycle_closures_member_rw on public.cycle_closures for all using (public.is_member(household_id)) with check (public.is_member(household_id) and updated_by = auth.uid());
drop policy if exists payment_methods_member_rw on public.payment_methods;
create policy payment_methods_member_rw on public.payment_methods for all using (public.is_member(household_id)) with check (public.is_member(household_id) and created_by = auth.uid());
drop policy if exists card_charges_member_rw on public.card_charges;
create policy card_charges_member_rw on public.card_charges for all using (public.is_member(household_id)) with check (public.is_member(household_id) and created_by = auth.uid());
drop policy if exists card_installments_member_rw on public.card_installments;
create policy card_installments_member_rw on public.card_installments for all using (public.is_member(household_id)) with check (public.is_member(household_id) and created_by = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists avatars_select_public on storage.objects;
create policy avatars_select_public on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_insert_self on storage.objects;
create policy avatars_insert_self on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists avatars_update_self on storage.objects;
create policy avatars_update_self on storage.objects for update using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists avatars_delete_self on storage.objects;
create policy avatars_delete_self on storage.objects for delete using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create or replace function public.create_household(household_name text, household_type text default 'individual') returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); hid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if char_length(trim(household_name)) not between 1 and 80 then raise exception 'Invalid household name'; end if;
  if household_type not in ('individual', 'couple', 'shared') then raise exception 'Invalid household type'; end if;
  insert into public.households (name, type, created_by) values (trim(household_name), household_type, uid) returning id into hid;
  insert into public.memberships (household_id, user_id, role) values (hid, uid, 'owner');
  return hid;
end; $$;
revoke all on function public.create_household(text, text) from public;
grant execute on function public.create_household(text, text) to authenticated;

create or replace function public.delete_own_account() returns void
language plpgsql security definer set search_path = public, auth, storage as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  delete from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = uid::text;
  delete from auth.users where id = uid;
end; $$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

notify pgrst, 'reload schema';
