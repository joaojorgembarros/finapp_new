-- Allow auth user deletion to clean legacy financial rows.
-- Older projects had these foreign keys without ON DELETE CASCADE.

do $$
begin
  alter table public.cycle_closures
    drop constraint if exists cycle_closures_updated_by_fkey;
  alter table public.cycle_closures
    add constraint cycle_closures_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete cascade;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cycle_closures' and column_name = 'created_by'
  ) then
    alter table public.cycle_closures
      drop constraint if exists cycle_closures_created_by_fkey;
    alter table public.cycle_closures
      add constraint cycle_closures_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete cascade;
  end if;

  alter table public.goal_contributions
    drop constraint if exists goal_contributions_updated_by_fkey;
  alter table public.goal_contributions
    add constraint goal_contributions_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete cascade;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'goal_contributions' and column_name = 'created_by'
  ) then
    alter table public.goal_contributions
      drop constraint if exists goal_contributions_created_by_fkey;
    alter table public.goal_contributions
      add constraint goal_contributions_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete cascade;
  end if;

  alter table public.pay_schedules
    drop constraint if exists pay_schedules_updated_by_fkey;
  alter table public.pay_schedules
    add constraint pay_schedules_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete cascade;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pay_schedules' and column_name = 'created_by'
  ) then
    alter table public.pay_schedules
      drop constraint if exists pay_schedules_created_by_fkey;
    alter table public.pay_schedules
      add constraint pay_schedules_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete cascade;
  end if;
end
$$;
