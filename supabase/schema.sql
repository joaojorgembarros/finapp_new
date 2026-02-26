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

create policy "households_select_member"
on public.households for select
using (public.is_member(id));

create policy "households_insert_owner"
on public.households for insert
with check (created_by = auth.uid());

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

create policy "memberships_select_self"
on public.memberships for select
using (user_id = auth.uid());

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

create policy "profiles_select_self"
on public.profiles for select
using (user_id = auth.uid());

create policy "profiles_upsert_self"
on public.profiles for insert
with check (user_id = auth.uid());

create policy "profiles_update_self"
on public.profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

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

create policy "transactions_member_rw"
on public.transactions for all
using (public.is_member(household_id))
with check (public.is_member(household_id) and created_by = auth.uid());

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

create policy "goals_member_rw"
on public.goals for all
using (public.is_member(household_id))
with check (public.is_member(household_id) and created_by = auth.uid());
