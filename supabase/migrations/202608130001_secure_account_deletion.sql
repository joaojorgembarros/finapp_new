-- Server-side account deletion safeguards.
-- The Edge Function performs the orchestration; these database objects provide
-- defense in depth and keep user-owned rows compatible with auth user deletion.

do $migration$
declare
  target record;
  existing_constraint record;
  target_relation regclass;
  target_attnum smallint;
  expected_constraint_name text;
begin
  for target in
    select *
    from (
      values
        ('household_invites', 'invited_by'),
        ('payment_methods', 'created_by'),
        ('card_charges', 'created_by'),
        ('card_installments', 'created_by')
    ) as targets(table_name, column_name)
  loop
    target_relation := to_regclass(format('public.%I', target.table_name));

    if target_relation is null then
      continue;
    end if;

    select attribute.attnum
      into target_attnum
    from pg_attribute as attribute
    where attribute.attrelid = target_relation
      and attribute.attname = target.column_name
      and not attribute.attisdropped;

    if target_attnum is null then
      continue;
    end if;

    expected_constraint_name := target.table_name || '_' || target.column_name || '_fkey';

    execute format(
      'alter table public.%I drop constraint if exists %I',
      target.table_name,
      expected_constraint_name
    );

    for existing_constraint in
      select constraint_record.conname
      from pg_constraint as constraint_record
      where constraint_record.conrelid = target_relation
        and constraint_record.confrelid = 'auth.users'::regclass
        and constraint_record.contype = 'f'
        and constraint_record.conkey = array[target_attnum]::smallint[]
    loop
      execute format(
        'alter table public.%I drop constraint %I',
        target.table_name,
        existing_constraint.conname
      );
    end loop;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
      target.table_name,
      expected_constraint_name,
      target.column_name
    );
  end loop;
end
$migration$;

-- Remove the legacy authenticated RPC so account deletion cannot bypass the
-- Edge Function's validation, storage cleanup and shared-household safeguards.
do $migration$
begin
  if to_regprocedure('public.delete_own_account()') is not null then
    revoke all on function public.delete_own_account() from public, anon, authenticated;
  end if;
end
$migration$;

drop function if exists public.delete_own_account();

-- Access JWTs are stateless and can remain cryptographically valid briefly
-- after Auth deletion. Require the backing auth.users row for user-owned avatar
-- writes so an old token cannot recreate files after the cleanup completed.
create or replace function public.is_current_auth_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = auth.uid()
  );
$$;

revoke all on function public.is_current_auth_user() from public, anon;
grant execute on function public.is_current_auth_user() to authenticated;

create or replace function public.can_manage_goal_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage, auth
as $$
  select public.can_access_goal_photo(object_name)
    and auth.uid()::text = (storage.foldername(object_name))[2]
    and public.is_current_auth_user();
$$;

revoke all on function public.can_manage_goal_photo(text) from public, anon;
grant execute on function public.can_manage_goal_photo(text) to authenticated;

drop policy if exists avatars_insert_self on storage.objects;
create policy avatars_insert_self
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
    and public.is_current_auth_user()
  );

drop policy if exists avatars_update_self on storage.objects;
create policy avatars_update_self
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
    and public.is_current_auth_user()
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
    and public.is_current_auth_user()
  );

drop policy if exists avatars_delete_self on storage.objects;
create policy avatars_delete_self
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
    and public.is_current_auth_user()
  );

create or replace function public.account_deletion_households(target_user_id uuid)
returns table (
  household_id uuid,
  household_type text,
  member_count bigint,
  has_other_members boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    household.id,
    household.type,
    (
      select count(*)
      from public.memberships as membership_count
      where membership_count.household_id = household.id
    ) as member_count,
    (
      household.created_by <> target_user_id
      or exists (
        select 1
        from public.memberships as other_membership
        where other_membership.household_id = household.id
          and other_membership.user_id <> target_user_id
      )
    ) as has_other_members
  from public.households as household
  where household.created_by = target_user_id
    or exists (
      select 1
      from public.memberships as own_membership
      where own_membership.household_id = household.id
        and own_membership.user_id = target_user_id
    )
  order by household.id;
$$;

revoke all on function public.account_deletion_households(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_households(uuid) to service_role;

create or replace function public.account_deletion_storage_objects(target_user_id uuid)
returns table (
  bucket_id text,
  object_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select storage_object.bucket_id, storage_object.name
  from storage.objects as storage_object
  where (
      storage_object.bucket_id = 'avatars'
      and (storage.foldername(storage_object.name))[1] = target_user_id::text
    )
    or (
      storage_object.bucket_id = 'goal-photos'
      and (storage.foldername(storage_object.name))[2] = target_user_id::text
    )
  order by storage_object.bucket_id, storage_object.name;
$$;

revoke all on function public.account_deletion_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_storage_objects(uuid) to service_role;

create or replace function public.account_deletion_external_connections(target_user_id uuid)
returns table (
  external_connection_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.bank_connections') is null
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'bank_connections'
        and column_name = 'created_by'
    )
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'bank_connections'
        and column_name = 'provider'
    )
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'bank_connections'
        and column_name = 'external_connection_id'
    )
  then
    return;
  end if;

  return query execute $query$
    select distinct connection.external_connection_id::text
    from public.bank_connections as connection
    where (
        connection.created_by = $1
        or exists (
          select 1
          from public.households as household
          where household.id = connection.household_id
            and household.created_by = $1
        )
        or exists (
          select 1
          from public.memberships as membership
          where membership.household_id = connection.household_id
            and membership.user_id = $1
        )
      )
      and lower(connection.provider) = 'pluggy'
      and nullif(btrim(connection.external_connection_id), '') is not null
    order by connection.external_connection_id::text
  $query$ using target_user_id;
end;
$$;

revoke all on function public.account_deletion_external_connections(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_external_connections(uuid) to service_role;

create or replace function public.account_deletion_has_unsafe_references(target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_reference record;
  unsafe_reference boolean;
begin
  -- A removed membership must not hide rows whose ON DELETE CASCADE would
  -- still destroy data belonging to a surviving household. Inspect every
  -- public FK from auth.users where the same table also carries household_id.
  for user_reference in
    select
      referencing_schema.nspname as schema_name,
      referencing_table.relname as table_name,
      user_column.attname as column_name
    from pg_constraint as user_foreign_key
    join pg_class as referencing_table
      on referencing_table.oid = user_foreign_key.conrelid
    join pg_namespace as referencing_schema
      on referencing_schema.oid = referencing_table.relnamespace
    join pg_attribute as user_column
      on user_column.attrelid = referencing_table.oid
      and user_column.attnum = user_foreign_key.conkey[1]
    join pg_attribute as household_column
      on household_column.attrelid = referencing_table.oid
      and household_column.attname = 'household_id'
      and not household_column.attisdropped
    where referencing_schema.nspname = 'public'
      and user_foreign_key.contype = 'f'
      and user_foreign_key.confrelid = 'auth.users'::regclass
      and cardinality(user_foreign_key.conkey) = 1
      and user_foreign_key.confdeltype = 'c'
  loop
    execute format(
      'select exists (
         select 1
         from %I.%I as row_reference
         join public.households as surviving_household
           on surviving_household.id = row_reference.household_id
         where row_reference.%I = $1
           and surviving_household.created_by <> $1
       )',
      user_reference.schema_name,
      user_reference.table_name,
      user_reference.column_name
    ) into unsafe_reference using target_user_id;

    if unsafe_reference then
      return true;
    end if;
  end loop;

  return exists (
    select 1
    from public.households as household
    where (
        household.created_by = target_user_id
        or exists (
          select 1
          from public.memberships as own_membership
          where own_membership.household_id = household.id
            and own_membership.user_id = target_user_id
        )
      )
      and (
        household.created_by <> target_user_id
        or household.type <> 'individual'
        or exists (
          select 1
          from public.memberships as other_membership
          where other_membership.household_id = household.id
            and other_membership.user_id <> target_user_id
        )
        or (
          select count(*)
          from public.memberships as membership_count
          where membership_count.household_id = household.id
        ) > 1
      )
  );
end;
$$;

revoke all on function public.account_deletion_has_unsafe_references(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_has_unsafe_references(uuid) to service_role;

create or replace function public.guard_personal_household_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.account_deletion_has_unsafe_references(old.id) then
    raise exception using
      errcode = 'P0001',
      message = 'ACCOUNT_DELETION_SHARED_HOUSEHOLD_BLOCKED';
  end if;

  -- Invites received by this address do not reference auth.users, so remove
  -- them explicitly in the same transaction as the Auth deletion.
  if old.email is not null
    and to_regclass('public.household_invites') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'household_invites'
        and column_name = 'email'
    )
  then
    execute $query$
      delete from public.household_invites
      where lower(btrim(email)) = lower(btrim($1))
    $query$ using old.email;
  end if;

  return old;
end;
$$;

revoke all on function public.guard_personal_household_account_deletion() from public, anon, authenticated;

drop trigger if exists guard_personal_household_account_deletion on auth.users;
create trigger guard_personal_household_account_deletion
  before delete on auth.users
  for each row
  execute function public.guard_personal_household_account_deletion();

notify pgrst, 'reload schema';
