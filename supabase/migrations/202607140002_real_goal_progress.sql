-- Real goal progress for Journey. Deadlines remain optional until the user sets one.
alter table public.goals alter column desired_date drop not null;

create table if not exists public.goal_contribution_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  contributed_on date not null default current_date,
  note text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists goal_contribution_entries_goal_date_idx
  on public.goal_contribution_entries (goal_id, contributed_on desc, created_at desc);
create index if not exists goal_contribution_entries_household_date_idx
  on public.goal_contribution_entries (household_id, contributed_on desc);

alter table public.goal_contribution_entries enable row level security;

drop policy if exists goal_contribution_entries_select_member on public.goal_contribution_entries;
create policy goal_contribution_entries_select_member on public.goal_contribution_entries
  for select using (public.is_member(household_id));

drop policy if exists goal_contribution_entries_insert_member on public.goal_contribution_entries;
create policy goal_contribution_entries_insert_member on public.goal_contribution_entries
  for insert with check (public.is_member(household_id) and created_by = auth.uid());

drop policy if exists goal_contribution_entries_update_member on public.goal_contribution_entries;
create policy goal_contribution_entries_update_member on public.goal_contribution_entries
  for update using (public.is_member(household_id))
  with check (public.is_member(household_id) and created_by = auth.uid());

drop policy if exists goal_contribution_entries_delete_member on public.goal_contribution_entries;
create policy goal_contribution_entries_delete_member on public.goal_contribution_entries
  for delete using (public.is_member(household_id));

notify pgrst, 'reload schema';
