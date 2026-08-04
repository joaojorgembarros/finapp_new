-- Rich dream details: motivation, private cover photo and member-safe storage.
alter table public.goals
  add column if not exists motivation text
  check (motivation is null or char_length(motivation) <= 1000);

alter table public.goals
  add column if not exists cover_photo_path text
  check (cover_photo_path is null or char_length(cover_photo_path) between 1 and 500);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'goal-photos',
  'goal-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_goal_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select exists (
    select 1
    from public.memberships as membership
    where membership.user_id = auth.uid()
      and membership.household_id::text = (storage.foldername(object_name))[1]
  );
$$;

create or replace function public.can_manage_goal_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select public.can_access_goal_photo(object_name)
    and auth.uid()::text = (storage.foldername(object_name))[2];
$$;

revoke all on function public.can_access_goal_photo(text) from public;
grant execute on function public.can_access_goal_photo(text) to authenticated;
revoke all on function public.can_manage_goal_photo(text) from public;
grant execute on function public.can_manage_goal_photo(text) to authenticated;

drop policy if exists goal_photos_select_member on storage.objects;
create policy goal_photos_select_member
  on storage.objects
  for select
  using (bucket_id = 'goal-photos' and public.can_access_goal_photo(name));

drop policy if exists goal_photos_insert_owner on storage.objects;
create policy goal_photos_insert_owner
  on storage.objects
  for insert
  with check (bucket_id = 'goal-photos' and public.can_manage_goal_photo(name));

drop policy if exists goal_photos_update_owner on storage.objects;
create policy goal_photos_update_owner
  on storage.objects
  for update
  using (bucket_id = 'goal-photos' and public.can_manage_goal_photo(name))
  with check (bucket_id = 'goal-photos' and public.can_manage_goal_photo(name));

drop policy if exists goal_photos_delete_owner on storage.objects;
create policy goal_photos_delete_owner
  on storage.objects
  for delete
  using (bucket_id = 'goal-photos' and public.can_manage_goal_photo(name));

notify pgrst, 'reload schema';
