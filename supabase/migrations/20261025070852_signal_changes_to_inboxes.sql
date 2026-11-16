-- Live updates by signals to private inboxes (2026-10-25).
--
-- The app heard about friend requests and invites through Realtime's
-- postgres_changes, which checks each listener's sign-in. Realtime can't
-- check sign-ins from Clerk on a domain of its own (clerk.thoughtdesk.org,
-- supabase/realtime#1791), so in production those updates never came and
-- the app's minute-by-minute refresh did the work.
--
-- Now the database itself sends an empty signal, "friends" or "sessions",
-- to the inbox of each of the two people a change concerns: a public
-- broadcast channel named by a random id that only its owner can read
-- (my_inbox). The app listens there with no sign-in at all, and fetches
-- what changed the usual way. The signal carries nothing else. A declined
-- request or an ended friendship now reaches the two people at once too,
-- and nobody else: the tables leave the postgres_changes publication, which
-- sent every deleted row's key to every listener.


-- Inboxes --------------------------------------------------------------------

create table private.inboxes (
  user_id text primary key references public.profiles (id) on delete cascade,
  inbox uuid not null unique default gen_random_uuid()
);
alter table private.inboxes enable row level security;
revoke all on table private.inboxes from public, anon, authenticated;

-- The caller's inbox id, made the first time it's asked for.
create function public.my_inbox()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant text := (select private.me());
  box uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into private.inboxes (user_id) values (me) on conflict (user_id) do nothing;
  select i.inbox into box from private.inboxes i where i.user_id = me;
  return box;
end;
$$;


-- Signals --------------------------------------------------------------------

-- After a row changes: an empty signal named tg_argv[0] to the inboxes of
-- the people in the columns tg_argv[1] and tg_argv[2]. Security definer,
-- because only the database may write broadcast messages (realtime.messages
-- has no policies). realtime.send turns its own errors into warnings, so a
-- change never fails for want of a signal.
create function private.signal_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  if tg_op = 'DELETE' then
    r := to_jsonb(old);
  else
    r := to_jsonb(new);
  end if;
  perform realtime.send('{}'::jsonb, tg_argv[0], 'inbox:' || i.inbox::text, false)
  from private.inboxes i
  where i.user_id in (r ->> tg_argv[1], r ->> tg_argv[2]);
  return null;
end;
$$;

create trigger signal_friends
  after insert or update or delete on public.friendships
  for each row execute function private.signal_change('friends', 'requester', 'addressee');

create trigger signal_sessions
  after insert or update or delete on public.cowork_sessions
  for each row execute function private.signal_change('sessions', 'host', 'guest');

-- postgres_changes no longer listens to these tables.
alter publication supabase_realtime drop table public.friendships, public.cowork_sessions;


-- Privileges -----------------------------------------------------------------

revoke execute on function public.my_inbox() from public, anon;
grant execute on function public.my_inbox() to authenticated;
revoke execute on function private.signal_change() from public, anon, authenticated;
