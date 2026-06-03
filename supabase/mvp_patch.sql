-- FinApp MVP patch
-- Rode no Supabase SQL Editor depois do schema.sql atual.
-- Este arquivo e idempotente: cria/ajusta estruturas sem apagar dados.

create extension if not exists pgcrypto;

-- PROFILES: o app atual separa renda fixa e media de renda variavel.
alter table public.profiles
  add column if not exists income_fixed_cents bigint not null default 0,
  add column if not exists income_variable_avg_cents bigint not null default 0;

update public.profiles
set income_fixed_cents = coalesce(nullif(income_fixed_cents, 0), income_cents, 0)
where coalesce(income_fixed_cents, 0) = 0
  and coalesce(income_cents, 0) > 0;

-- PAY SCHEDULES: regra de fechamento de ciclos.
create table if not exists public.pay_schedules (
  household_id uuid primary key references public.households(id) on delete cascade,
  mode text not null default 'month', -- month | twice_month
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pay_schedules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'households'
      and policyname = 'households_select_owner_before_membership'
  ) then
    create policy "households_select_owner_before_membership"
    on public.households for select
    using (created_by = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pay_schedules'
      and policyname = 'pay_schedules_member_rw'
  ) then
    create policy "pay_schedules_member_rw"
    on public.pay_schedules for all
    using (public.is_member(household_id))
    with check (public.is_member(household_id));
  end if;
end $$;

-- CATEGORIES: lista inicial para households existentes que ainda nao tem categorias.
insert into public.categories (household_id, flow, kind, name, icon, sort)
select h.id, v.flow, v.kind, v.name, v.icon, v.sort
from public.households h
cross join (
  values
    ('income', 'fixed', 'Salario', 'cash-outline', 10),
    ('income', 'variable', 'Renda extra', 'rocket-outline', 20),
    ('income', 'variable', 'Pix recebido', 'swap-horizontal-outline', 30),
    ('income', 'variable', 'Bonus', 'gift-outline', 40),
    ('expense', 'fixed', 'Aluguel / Financiamento', 'home-outline', 110),
    ('expense', 'fixed', 'Internet / Celular', 'wifi-outline', 120),
    ('expense', 'fixed', 'Energia / Agua', 'flash-outline', 130),
    ('expense', 'fixed', 'Assinaturas', 'tv-outline', 140),
    ('expense', 'variable', 'Alimentacao', 'restaurant-outline', 210),
    ('expense', 'variable', 'Transporte', 'car-outline', 220),
    ('expense', 'variable', 'Saude', 'medkit-outline', 230),
    ('expense', 'variable', 'Lazer', 'game-controller-outline', 240),
    ('expense', 'variable', 'Compras', 'cart-outline', 250),
    ('expense', 'variable', 'Educacao', 'school-outline', 260),
    ('expense', 'variable', 'Cuidados pessoais', 'sparkles-outline', 270)
) as v(flow, kind, name, icon, sort)
where not exists (
  select 1 from public.categories c where c.household_id = h.id
);

-- PAYMENT METHODS / CARDS
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  type text not null default 'card', -- cash | bank | card
  name text not null,
  credit_limit_cents bigint,
  closing_day int,
  due_day int,
  limit_behavior text not null default 'full', -- full | installment
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_methods
  add column if not exists credit_limit_cents bigint,
  add column if not exists closing_day int,
  add column if not exists due_day int,
  add column if not exists limit_behavior text not null default 'full',
  add column if not exists updated_at timestamptz not null default now();

alter table public.payment_methods enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'payment_methods'
      and policyname = 'payment_methods_member_rw'
  ) then
    create policy "payment_methods_member_rw"
    on public.payment_methods for all
    using (public.is_member(household_id))
    with check (public.is_member(household_id) and created_by = auth.uid());
  end if;
end $$;

-- CARD CHARGES / INSTALLMENTS
create table if not exists public.card_charges (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.payment_methods(id) on delete cascade,
  purchased_on date not null,
  description text,
  total_cents bigint not null,
  installments_total int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.card_charges enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'card_charges'
      and policyname = 'card_charges_member_rw'
  ) then
    create policy "card_charges_member_rw"
    on public.card_charges for all
    using (public.is_member(household_id))
    with check (public.is_member(household_id) and created_by = auth.uid());
  end if;
end $$;

create table if not exists public.card_installments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.payment_methods(id) on delete cascade,
  charge_id uuid not null references public.card_charges(id) on delete cascade,
  n int not null,
  due_on date not null,
  amount_cents bigint not null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.card_installments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'card_installments'
      and policyname = 'card_installments_member_rw'
  ) then
    create policy "card_installments_member_rw"
    on public.card_installments for all
    using (public.is_member(household_id))
    with check (public.is_member(household_id) and created_by = auth.uid());
  end if;
end $$;

-- GOAL CONTRIBUTIONS / CYCLE CLOSURES
create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  cycle_key text not null,
  cycle_start date not null,
  cycle_end date not null,
  amount_cents bigint not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, goal_id, cycle_key)
);

alter table public.goal_contributions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'goal_contributions'
      and policyname = 'goal_contributions_member_rw'
  ) then
    create policy "goal_contributions_member_rw"
    on public.goal_contributions for all
    using (public.is_member(household_id))
    with check (public.is_member(household_id));
  end if;
end $$;

create table if not exists public.cycle_closures (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  cycle_key text not null,
  mode text not null,
  cycle_start date not null,
  cycle_end date not null,
  net_cents bigint not null default 0,
  allocated_cents bigint not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, cycle_key)
);

alter table public.cycle_closures enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'cycle_closures'
      and policyname = 'cycle_closures_member_rw'
  ) then
    create policy "cycle_closures_member_rw"
    on public.cycle_closures for all
    using (public.is_member(household_id))
    with check (public.is_member(household_id));
  end if;
end $$;

-- Indices para as telas principais.
create index if not exists idx_transactions_household_occurred
  on public.transactions (household_id, occurred_on desc);

create index if not exists idx_categories_household_flow_kind
  on public.categories (household_id, flow, kind);

create index if not exists idx_payment_methods_household_type
  on public.payment_methods (household_id, type);

create index if not exists idx_card_installments_household_card_due
  on public.card_installments (household_id, card_id, due_on);

create index if not exists idx_goal_contributions_household_goal
  on public.goal_contributions (household_id, goal_id);

notify pgrst, 'reload schema';
