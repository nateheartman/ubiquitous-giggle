-- Accounts, friends, presence and live co-editing sessions.
--
-- Thought Desk is local-first: notes never come here. This schema holds only
-- who people are (profiles), who is friends with whom (friendships), when
-- friends were last online (presence) and the invites and requests that open
-- a live co-editing session (cowork_sessions). The relay checks that someone
-- may join a session by reading cowork_sessions with their own JWT, so
-- row-level security decides.
--
-- Everything is reached through the Data API as `authenticated`; signed-out
-- callers (`anon`) get nothing. Helpers that policies call live in the
-- `private` schema, which the Data API does not expose.


-- The project's RLS auto-enable event trigger function must not be callable
-- over the API. (Guarded because a local stack doesn't have that function.)
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;


-- Tables ---------------------------------------------------------------------

-- One row per account, made by the sign-up trigger below.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- null until the person picks one
  username text unique
    constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default ''
    constraint profiles_display_name_length check (char_length(display_name) <= 50),
  avatar_url text
    constraint profiles_avatar_url_https check (avatar_url ~ '^https://'),
  created_at timestamptz not null default now()
);

-- A friend request from requester to addressee, 'accepted' once the addressee
-- says yes. Declining, withdrawing and unfriending all delete the row.
create table public.friendships (
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    constraint friendships_status_check check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  constraint friendships_not_self check (requester <> addressee)
);

-- At most one row per pair, whichever way the request went.
create unique index friendships_pair_key
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee_idx on public.friendships (addressee);

-- When each person was last seen. Written only by touch_presence().
create table public.presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);

-- A live co-editing session on one of the host's pages. kind 'invite': the
-- host asks the guest in. kind 'request': the guest asks to join. After the
-- insert, rows change only through respond_session(), end_session() and the
-- expiry sweep.
create table public.cowork_sessions (
  id uuid primary key default gen_random_uuid(),
  host uuid not null references public.profiles (id) on delete cascade,
  guest uuid not null references public.profiles (id) on delete cascade,
  kind text not null
    constraint cowork_sessions_kind_check check (kind in ('invite', 'request')),
  title text not null default ''
    constraint cowork_sessions_title_length check (char_length(title) <= 200),
  status text not null default 'pending'
    constraint cowork_sessions_status_check
    check (status in ('pending', 'active', 'declined', 'cancelled', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cowork_sessions_not_self check (host <> guest)
);

create index cowork_sessions_host_idx on public.cowork_sessions (host);
create index cowork_sessions_guest_idx on public.cowork_sessions (guest);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.presence enable row level security;
alter table public.cowork_sessions enable row level security;


-- Helpers for policies -------------------------------------------------------

-- Does the signed-in user share a friendships row, pending or accepted, with
-- `other`? Security definer so the profiles policy can ask without going
-- through the friendships policies; it only ever answers about the caller.
create function private.is_connected(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships f
    where (f.requester = (select auth.uid()) and f.addressee = is_connected.other)
       or (f.addressee = (select auth.uid()) and f.requester = is_connected.other)
  );
$$;

-- Has this person picked a username? Friend requests can only go to someone
-- who has. Security definer because the requester can't see a stranger's
-- profile yet.
create function private.has_username(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = has_username.user_id
      and p.username is not null
  );
$$;


-- Functions the app calls ----------------------------------------------------

-- Are a and b friends (accepted)? Security invoker on purpose: the friendships
-- policy shows a caller only their own rows, so for a pair that doesn't
-- include the caller this answers false instead of revealing someone else's
-- friendships. Every policy that calls it includes the caller.
create function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (   (f.requester = are_friends.a and f.addressee = are_friends.b)
           or (f.requester = are_friends.b and f.addressee = are_friends.a))
  );
$$;

-- Find someone by exact username. Case, surrounding spaces and one leading
-- '@' are ignored, so '@Ben' finds ben. Never returns the caller; returns
-- nothing when signed out.
create function public.find_profile(name text)
returns table (id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where (select auth.uid()) is not null
    and p.id <> (select auth.uid())
    and p.username = lower(regexp_replace(btrim(find_profile.name), '^@', ''));
$$;

-- Mark the caller as seen now. The app calls this every so often while open.
create function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.presence (user_id, seen_at)
  values (me, now())
  on conflict (user_id) do update set seen_at = excluded.seen_at;
end;
$$;

-- Answer a pending session: the guest answers an invite, the host answers a
-- request. Accepting a request needs the title of the page being shared, and
-- accepting needs the two to still be friends. Pending sessions expire after
-- an hour: answering a stale one raises 'session expired', and the sweep at
-- the end of this file marks it cancelled (a change made here would be rolled
-- back by the error).
create function public.respond_session(session_id uuid, accept boolean, page_title text default null)
returns public.cowork_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  s public.cowork_sessions;
begin
  if accept is null then
    raise exception 'accept must be true or false' using errcode = '22004';
  end if;

  select * into s
  from public.cowork_sessions cs
  where cs.id = respond_session.session_id
  for update;

  if not found or me is null or me not in (s.host, s.guest) then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if s.kind = 'invite' and me <> s.guest then
    raise exception 'only the guest can respond to an invite' using errcode = '42501';
  end if;
  if s.kind = 'request' and me <> s.host then
    raise exception 'only the host can respond to a request' using errcode = '42501';
  end if;
  if s.status <> 'pending' then
    raise exception 'session is %, not pending', s.status;
  end if;
  if s.created_at < now() - interval '1 hour' then
    raise exception 'session expired' using hint = 'Pending sessions expire after an hour.';
  end if;

  if not accept then
    update public.cowork_sessions
    set status = 'declined', updated_at = now()
    where id = s.id
    returning * into s;
    return s;
  end if;

  if s.kind = 'request' and coalesce(btrim(page_title), '') = '' then
    raise exception 'accepting a request needs a page title' using errcode = '22023';
  end if;
  if not public.are_friends(s.host, s.guest) then
    raise exception 'you are not friends' using errcode = '42501';
  end if;

  update public.cowork_sessions
  set status = 'active',
      title = case when s.kind = 'request' then page_title else title end,
      updated_at = now()
  where id = s.id
  returning * into s;
  return s;
end;
$$;

-- End or cancel a session. Either person can end an active one; whoever
-- created a pending one (the host of an invite, the guest of a request) can
-- cancel it. Anything else is an error.
create function public.end_session(session_id uuid)
returns public.cowork_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  s public.cowork_sessions;
begin
  select * into s
  from public.cowork_sessions cs
  where cs.id = end_session.session_id
  for update;

  if not found or me is null or me not in (s.host, s.guest) then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if s.status = 'active' then
    update public.cowork_sessions
    set status = 'ended', updated_at = now()
    where id = s.id
    returning * into s;
  elsif s.status = 'pending' then
    if me <> (case s.kind when 'invite' then s.host else s.guest end) then
      raise exception 'only whoever sent it can cancel a pending session' using errcode = '42501';
    end if;
    update public.cowork_sessions
    set status = 'cancelled', updated_at = now()
    where id = s.id
    returning * into s;
  else
    raise exception 'session is already %', s.status;
  end if;

  return s;
end;
$$;


-- Maintenance ----------------------------------------------------------------

-- Cancel pending sessions older than an hour and return how many. pg_cron
-- runs it (see the end of this file) so stale invites disappear for both
-- people even if nobody answers them.
create function private.expire_stale_sessions()
returns integer
language sql
set search_path = ''
as $$
  with expired as (
    update public.cowork_sessions
    set status = 'cancelled', updated_at = now()
    where status = 'pending'
      and created_at < now() - interval '1 hour'
    returning 1
  )
  select count(*)::integer from expired;
$$;


-- Triggers -------------------------------------------------------------------

-- Give every new account a profile. display_name is the first non-blank of
-- full_name, name and user_name in the sign-up metadata, else the email
-- before '@', cut to 50 characters. avatar_url is avatar_url or picture,
-- whichever starts with https://.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(meta ->> 'full_name'), ''),
        nullif(btrim(meta ->> 'name'), ''),
        nullif(btrim(meta ->> 'user_name'), ''),
        split_part(coalesce(new.email, ''), '@', 1)
      ),
      50
    ),
    case
      when (meta ->> 'avatar_url') ~ '^https://' then meta ->> 'avatar_url'
      when (meta ->> 'picture') ~ '^https://' then meta ->> 'picture'
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep accepted_at in step with status.
create function private.set_friendship_accepted_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'accepted' then
    new.accepted_at := null;
  elsif tg_op = 'UPDATE' and old.status = 'accepted' then
    new.accepted_at := old.accepted_at;
  else
    new.accepted_at := now();
  end if;
  return new;
end;
$$;

create trigger friendships_set_accepted_at
  before insert or update on public.friendships
  for each row execute function private.set_friendship_accepted_at();


-- Policies -------------------------------------------------------------------

-- profiles: see yourself and anyone you share a friendships row with, so a
-- pending request shows who it's from or to. Edit only yourself.
create policy "profiles: read self and connections"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_connected(id));

create policy "profiles: update self"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- friendships: both people see the row and either can delete it. Requests go
-- out as yourself, pending, to someone with a username. Only the addressee
-- updates, and only to 'accepted'.
create policy "friendships: read own"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester, addressee));

create policy "friendships: send request"
  on public.friendships for insert to authenticated
  with check (
    requester = (select auth.uid())
    and status = 'pending'
    and private.has_username(addressee)
  );

create policy "friendships: addressee accepts"
  on public.friendships for update to authenticated
  using (addressee = (select auth.uid()) and status = 'pending')
  with check (addressee = (select auth.uid()) and status = 'accepted');

create policy "friendships: either removes"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester, addressee));

-- presence: yourself and accepted friends.
create policy "presence: read self and friends"
  on public.presence for select to authenticated
  using (user_id = (select auth.uid()) or public.are_friends((select auth.uid()), user_id));

-- cowork_sessions: host and guest see the row. A session starts pending,
-- between friends, created by the host (invite) or by the guest (request).
create policy "cowork_sessions: read own"
  on public.cowork_sessions for select to authenticated
  using ((select auth.uid()) in (host, guest));

create policy "cowork_sessions: start with a friend"
  on public.cowork_sessions for insert to authenticated
  with check (
    status = 'pending'
    and (   (kind = 'invite' and host = (select auth.uid()))
         or (kind = 'request' and guest = (select auth.uid())))
    and public.are_friends(host, guest)
  );


-- Privileges -----------------------------------------------------------------

-- Tables: nothing for anon. For authenticated, what the policies allow, with
-- the writable columns spelled out.
revoke all on table public.profiles, public.friendships, public.presence, public.cowork_sessions
  from anon, authenticated;

grant select on table public.profiles, public.friendships, public.presence, public.cowork_sessions
  to authenticated;
grant update (username, display_name, avatar_url) on table public.profiles to authenticated;
grant insert (requester, addressee, status) on table public.friendships to authenticated;
grant update (status) on table public.friendships to authenticated;
grant delete on table public.friendships to authenticated;
grant insert (id, host, guest, kind, title, status) on table public.cowork_sessions to authenticated;

-- Functions: signed-in users only.
revoke execute on function
  private.is_connected(uuid),
  private.has_username(uuid),
  public.are_friends(uuid, uuid),
  public.find_profile(text),
  public.touch_presence(),
  public.respond_session(uuid, boolean, text),
  public.end_session(uuid)
  from public, anon;

grant execute on function
  private.is_connected(uuid),
  private.has_username(uuid),
  public.are_friends(uuid, uuid),
  public.find_profile(text),
  public.touch_presence(),
  public.respond_session(uuid, boolean, text),
  public.end_session(uuid)
  to authenticated;

-- Trigger and maintenance functions are never called directly.
revoke execute on function
  public.handle_new_user(),
  private.set_friendship_accepted_at(),
  private.expire_stale_sessions()
  from public, anon, authenticated;


-- Realtime and scheduled jobs ------------------------------------------------

-- The app listens for friend requests and session invites.
alter publication supabase_realtime add table public.friendships, public.cowork_sessions;

-- Expire stale pending sessions every five minutes, and keep a day of that
-- job's run history (pg_cron never prunes it by itself).
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'expire-pending-cowork-sessions',
  '*/5 * * * *',
  'select private.expire_stale_sessions()'
);

select cron.schedule(
  'prune-expire-pending-cowork-sessions-history',
  '30 3 * * *',
  $$delete from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'expire-pending-cowork-sessions')
      and end_time < now() - interval '1 day'$$
);
