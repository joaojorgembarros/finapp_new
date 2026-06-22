-- FinApp (novo banco) — Schema + RLS
-- Cole no SQL Editor do Supabase

create extension if not exists pgcrypto;

-- helper: checa se usuário é membro do household
create or replace function public.is_member(hid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

-- HOUSEHOLDS
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'individual', -- individual | couple
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.households enable row level security;

drop policy if exists "households_select_member" on public.households;
create policy "households_select_member"
on public.households for select
using (public.is_member(id));

drop policy if exists "households_insert_owner" on public.households;
create policy "households_insert_owner"
on public.households for insert
with check (created_by = auth.uid());

drop policy if exists "households_update_owner" on public.households;
create policy "households_update_owner"
on public.households for update
using (created_by = auth.uid())
with check (created_by = auth.uid());

-- MEMBERSHIPS
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member', -- owner | member
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

alter table public.memberships enable row level security;

drop policy if exists "memberships_select_self" on public.memberships;
create policy "memberships_select_self"
on public.memberships for select
using (user_id = auth.uid());

drop policy if exists "memberships_insert_self" on public.memberships;
create policy "memberships_insert_self"
on public.memberships for insert
with check (user_id = auth.uid());

-- PROFILES (por usuário)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  income_cents bigint not null default 0,
  employment_type text not null default 'CLT',
  onboarding_done boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
on public.profiles for select
using (user_id = auth.uid());

drop policy if exists "profiles_upsert_self" on public.profiles;
create policy "profiles_upsert_self"
on public.profiles for insert
with check (user_id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- AVATARS (foto de perfil)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_self" on storage.objects;
create policy "avatars_insert_self"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "avatars_update_self" on storage.objects;
create policy "avatars_update_self"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- CATEGORIES
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  flow text not null, -- income | expense
  kind text not null, -- fixed | variable
  name text not null,
  icon text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

drop policy if exists "categories_member_rw" on public.categories;
create policy "categories_member_rw"
on public.categories for all
using (public.is_member(household_id))
with check (public.is_member(household_id));

-- TRANSACTIONS
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null, -- income | expense
  amount_cents bigint not null,
  category_id uuid references public.categories(id) on delete set null,
  note text,
  occurred_on date not null default current_date,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

drop policy if exists "transactions_member_rw" on public.transactions;
create policy "transactions_member_rw"
on public.transactions for all
using (public.is_member(household_id))
with check (public.is_member(household_id) and created_by = auth.uid());

-- BUDGETS
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month_key text not null, -- YYYY-MM
  planned_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, category_id, month_key)
);

alter table public.budgets add column if not exists month_key text not null default to_char(current_date, 'YYYY-MM');
alter table public.budgets add column if not exists planned_cents bigint not null default 0;
alter table public.budgets add column if not exists created_at timestamptz not null default now();
alter table public.budgets add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'budgets_household_id_category_id_month_key_key'
      and conrelid = 'public.budgets'::regclass
  ) then
    alter table public.budgets add constraint budgets_household_id_category_id_month_key_key
      unique (household_id, category_id, month_key);
  end if;
end $$;

alter table public.budgets enable row level security;

drop policy if exists "budgets_member_rw" on public.budgets;
create policy "budgets_member_rw"
on public.budgets for all
using (public.is_member(household_id))
with check (public.is_member(household_id));

notify pgrst, 'reload schema';

-- GOALS
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  target_cents bigint not null,
  desired_date date not null,
  priority int not null default 1,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.goals enable row level security;

drop policy if exists "goals_member_rw" on public.goals;
create policy "goals_member_rw"
on public.goals for all
using (public.is_member(household_id))
with check (public.is_member(household_id) and created_by = auth.uid());
