-- Accounts move from Supabase Auth to Clerk (2026-10-25).
--
-- Clerk signs people in, and this project trusts the session tokens it
-- issues (Third-Party Auth, set up in the dashboard; see SETUP.md). Clerk's
-- user ids look like 'user_2abc…', not UUIDs, so auth.uid(), which casts
-- the token's sub to uuid, can't be used. private.me() reads sub instead,
-- and only from a token one of our Clerk instances issued.
--
-- There were no accounts yet, so the tables are rebuilt with text ids
-- rather than altered, with the same rules and limits as before. Nothing
-- refers to auth.users any more: ensure_profile(), which the app calls
-- after signing in, makes the profile from the name and picture in the
-- token. Session ids stay UUIDs.


-- Out with the Supabase Auth versions ------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- Functions that return a session row, then the tables (with their policies
-- and triggers), then the functions those used.
drop function if exists
  public.respond_session(uuid, boolean, text),
  public.end_session(uuid),
  public.find_profile(text),
  public.touch_presence();

drop table if exists
  public.cowork_sessions,
  public.presence,
  public.friendships,
  public.profiles,
  private.friend_requests_sent,
  private.profile_lookups;

drop function if exists
  private.is_connected(uuid),
  private.has_username(uuid),
  public.are_friends(uuid, uuid),
  private.limit_friend_requests();


-- Who's asking ---------------------------------------------------------------

-- The signed-in person's Clerk user id: the token's sub, if one of our Clerk
-- instances issued the token (development, then production) and its session
-- is fully signed in; otherwise null, so a token from anywhere else (Supabase
-- Auth's own included) gets nothing. Every policy and function asks this.
create function private.me()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt() ->> 'sub'
  where auth.jwt() ->> 'iss' in ('https://smiling-sunbird-3571.clerk.accounts.dev', 'https://clerk.thoughtdesk.org')
    and coalesce(auth.jwt() ->> 'sts', 'active') <> 'pending';
$$;


-- Tables ---------------------------------------------------------------------

-- One row per account, made by ensure_profile().
create table public.profiles (
  id text primary key
    constraint profiles_id_format check (id ~ '^user_[A-Za-z0-9]{1,64}$'),
  -- null until the person picks one
  username text unique
    constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default ''
    constraint profiles_display_name_length check (char_length(display_name) <= 50),
  -- Everyone who sees a profile fetches its picture, so it may come only from
  -- Clerk's picture host: one on a server of the owner's own would show them
  -- other people's IP addresses and when their app is open.
  avatar_url text
    constraint profiles_avatar_url_clerk check (avatar_url ~ '^https://img\.clerk\.com/' and char_length(avatar_url) <= 2000),
  created_at timestamptz not null default now()
);

-- A friend request from requester to addressee, 'accepted' once the addressee
-- says yes. Declining, withdrawing and unfriending all delete the row. The
-- key is an opaque number: Realtime sends a deleted row's key to everyone
-- listening, and (requester, addressee) would tell them who unfriended whom.
create table public.friendships (
  id bigint generated always as identity primary key,
  requester text not null references public.profiles (id) on delete cascade,
  addressee text not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    constraint friendships_status_check check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint friendships_not_self check (requester <> addressee)
);

-- At most one row per pair, whichever way the request went.
create unique index friendships_pair_key
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_requester_idx on public.friendships (requester);
create index friendships_addressee_idx on public.friendships (addressee);

-- When each person was last seen. Written only by touch_presence().
create table public.presence (
  user_id text primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);

-- A live co-editing session on one of the host's pages. kind 'invite': the
-- host asks the guest in. kind 'request': the guest asks to join. After the
-- insert, rows change only through respond_session(), end_session() and the
-- expiry sweep.
create table public.cowork_sessions (
  id uuid primary key default gen_random_uuid(),
  host text not null references public.profiles (id) on delete cascade,
  guest text not null references public.profiles (id) on delete cascade,
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

-- Who sent a friend request when, for the daily limit: kept a day, whatever
-- became of the request.
create table private.friend_requests_sent (
  id bigint generated always as identity primary key,
  requester text not null,
  sent_at timestamptz not null default now()
);
create index friend_requests_sent_by on private.friend_requests_sent (requester, sent_at);

-- Who looked someone up when, for the hourly limit.
create table private.profile_lookups (
  id bigint generated always as identity primary key,
  user_id text not null,
  looked_at timestamptz not null default now()
);
create index profile_lookups_by on private.profile_lookups (user_id, looked_at);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.presence enable row level security;
alter table public.cowork_sessions enable row level security;
alter table private.friend_requests_sent enable row level security;
alter table private.profile_lookups enable row level security;


-- Helpers for policies -------------------------------------------------------

-- Does the signed-in person share a friendships row, pending or accepted,
-- with `other`? Security definer so the profiles policy can ask without going
-- through the friendships policies; it only ever answers about the caller.
create function private.is_connected(other text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships f
    where (f.requester = (select private.me()) and f.addressee = is_connected.other)
       or (f.addressee = (select private.me()) and f.requester = is_connected.other)
  );
$$;

-- Has this person picked a username? Friend requests can only go to someone
-- who has. Security definer because the requester can't see a stranger's
-- profile yet.
create function private.has_username(user_id text)
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

-- Make the caller's profile if it isn't there yet, and return it. The app
-- calls this after signing in. Name and picture come from the token, which
-- Clerk signs, never from the caller: the name only for a new profile
-- (people may change theirs here), the picture every time (it changes only
-- in Clerk), and only from Clerk's picture host and only if the person has
-- one (has_image), else the app shows initials.
create function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant text := (select private.me());
  claims constant jsonb := auth.jwt();
  picture constant text := case
    when claims ->> 'has_image' is distinct from 'false'
     and claims ->> 'picture' ~ '^https://img\.clerk\.com/'
     and char_length(claims ->> 'picture') <= 2000
    then claims ->> 'picture'
  end;
  mine public.profiles;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (me, left(coalesce(btrim(claims ->> 'name'), ''), 50), picture)
  on conflict (id) do update
    set avatar_url = excluded.avatar_url
    where profiles.avatar_url is distinct from excluded.avatar_url;

  select * into mine from public.profiles p where p.id = me;
  return mine;
end;
$$;

-- Are a and b friends (accepted)? Security invoker on purpose: the friendships
-- policy shows a caller only their own rows, so for a pair that doesn't
-- include the caller this answers false instead of revealing someone else's
-- friendships. Every policy that calls it includes the caller.
create function public.are_friends(a text, b text)
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
-- nothing when signed out. At most 100 lookups an hour per person, so
-- usernames can't be listed by trying them all.
create function public.find_profile(name text)
returns table (id text, username text, display_name text, avatar_url text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me constant text := (select private.me());
begin
  if me is null then
    return;
  end if;
  delete from private.profile_lookups l where l.user_id = me and l.looked_at < now() - interval '1 hour';
  if (select count(*) from private.profile_lookups l where l.user_id = me) >= 100 then
    raise exception 'Too many lookups for now. Try again in a while.';
  end if;
  insert into private.profile_lookups (user_id) values (me);
  return query
    select p.id, p.username, p.display_name, p.avatar_url
    from public.profiles p
    where p.id <> me
      and p.username = lower(regexp_replace(btrim(find_profile.name), '^@', ''));
end;
$$;

-- Mark the caller as seen now. The app calls this every so often while open.
create function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant text := (select private.me());
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
-- an hour: answering a stale one raises 'session expired', and the sweep
-- marks it cancelled (a change made here would be rolled back by the error).
create function public.respond_session(session_id uuid, accept boolean, page_title text default null)
returns public.cowork_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant text := (select private.me());
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
  me constant text := (select private.me());
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


-- Triggers -------------------------------------------------------------------

-- Keep accepted_at in step with status (the function is unchanged).
create trigger friendships_set_accepted_at
  before insert or update on public.friendships
  for each row execute function private.set_friendship_accepted_at();

-- Each friend request puts a notification on someone's desktop, so a person
-- may have at most 20 waiting for an answer, and send at most 50 a day
-- (cancelled and declined ones count too).
create function private.limit_friend_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.friendships f where f.requester = new.requester and f.status = 'pending') >= 20 then
    raise exception 'You have 20 friend requests waiting for an answer. Send more once some are answered.';
  end if;
  delete from private.friend_requests_sent s where s.requester = new.requester and s.sent_at < now() - interval '1 day';
  if (select count(*) from private.friend_requests_sent s where s.requester = new.requester) >= 50 then
    raise exception 'That''s a lot of friend requests for one day. Try again tomorrow.';
  end if;
  insert into private.friend_requests_sent (requester) values (new.requester);
  return new;
end;
$$;

create trigger limit_friend_requests
  before insert on public.friendships
  for each row execute function private.limit_friend_requests();


-- Policies -------------------------------------------------------------------

-- profiles: see yourself and anyone you share a friendships row with, so a
-- pending request shows who it's from or to. Edit only yourself.
create policy "profiles: read self and connections"
  on public.profiles for select to authenticated
  using (id = (select private.me()) or private.is_connected(id));

create policy "profiles: update self"
  on public.profiles for update to authenticated
  using (id = (select private.me()))
  with check (id = (select private.me()));

-- friendships: both people see the row and either can delete it. Requests go
-- out as yourself, pending, to someone with a username. Only the addressee
-- updates, and only to 'accepted'.
create policy "friendships: read own"
  on public.friendships for select to authenticated
  using ((select private.me()) in (requester, addressee));

create policy "friendships: send request"
  on public.friendships for insert to authenticated
  with check (
    requester = (select private.me())
    and status = 'pending'
    and private.has_username(addressee)
  );

create policy "friendships: addressee accepts"
  on public.friendships for update to authenticated
  using (addressee = (select private.me()) and status = 'pending')
  with check (addressee = (select private.me()) and status = 'accepted');

create policy "friendships: either removes"
  on public.friendships for delete to authenticated
  using ((select private.me()) in (requester, addressee));

-- presence: yourself and accepted friends.
create policy "presence: read self and friends"
  on public.presence for select to authenticated
  using (user_id = (select private.me()) or public.are_friends((select private.me()), user_id));

-- cowork_sessions: host and guest see the row. A session starts pending,
-- between friends, created by the host (invite) or by the guest (request).
create policy "cowork_sessions: read own"
  on public.cowork_sessions for select to authenticated
  using ((select private.me()) in (host, guest));

create policy "cowork_sessions: start with a friend"
  on public.cowork_sessions for insert to authenticated
  with check (
    status = 'pending'
    and (   (kind = 'invite' and host = (select private.me()))
         or (kind = 'request' and guest = (select private.me())))
    and public.are_friends(host, guest)
  );


-- Privileges -----------------------------------------------------------------

-- Tables: nothing for anon. For authenticated, what the policies allow, with
-- the writable columns spelled out. Profiles are made only by
-- ensure_profile(), and pictures set only by it.
revoke all on table public.profiles, public.friendships, public.presence, public.cowork_sessions
  from anon, authenticated;
revoke all on table private.friend_requests_sent, private.profile_lookups
  from public, anon, authenticated;

grant select on table public.profiles, public.friendships, public.presence, public.cowork_sessions
  to authenticated;
grant update (username, display_name) on table public.profiles to authenticated;
grant insert (requester, addressee, status) on table public.friendships to authenticated;
grant update (status) on table public.friendships to authenticated;
grant delete on table public.friendships to authenticated;
grant insert (id, host, guest, kind, title, status) on table public.cowork_sessions to authenticated;

-- Functions: signed-in people only.
revoke execute on function
  private.me(),
  private.is_connected(text),
  private.has_username(text),
  public.ensure_profile(),
  public.are_friends(text, text),
  public.find_profile(text),
  public.touch_presence(),
  public.respond_session(uuid, boolean, text),
  public.end_session(uuid)
  from public, anon;

grant execute on function
  private.me(),
  private.is_connected(text),
  private.has_username(text),
  public.ensure_profile(),
  public.are_friends(text, text),
  public.find_profile(text),
  public.touch_presence(),
  public.respond_session(uuid, boolean, text),
  public.end_session(uuid)
  to authenticated;

-- Trigger functions are never called directly.
revoke execute on function private.limit_friend_requests() from public, anon, authenticated;


-- Realtime -------------------------------------------------------------------

-- The app listens for friend requests and session invites. (Dropping the
-- tables took them out of the publication; the expiry sweep's pg_cron jobs
-- call private.expire_stale_sessions() by name, so they carry on.)
alter publication supabase_realtime add table public.friendships, public.cowork_sessions;
