-- Harden the first-user-becomes-owner rule (security-review follow-up to the
-- v2 cutover): two concurrent first signups could both observe an empty
-- profiles table and both land role 'owner'. Serialize the decision with a
-- transaction-scoped advisory lock, and pin the single-owner invariant into
-- the schema so no code path can ever mint a second owner.

create unique index profiles_single_owner
  on public.profiles (role) where role = 'owner';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Serializes concurrent signups' role decision; released at commit.
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user'));
  insert into public.profiles (user_id, role)
  values (new.id,
          case when exists (select 1 from public.profiles) then 'user' else 'owner' end);
  insert into public.lists (user_id, kind, name, position)
  values (new.id, 'manual', 'Followed', 0);
  insert into public.settings (user_id) values (new.id);
  return new;
end $$;
