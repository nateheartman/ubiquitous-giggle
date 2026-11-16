-- Hardening after a security review (2026-10-25).
--
-- Avatars. A profile's picture is fetched by everyone who sees the profile,
-- including someone with a request still waiting, so a picture on a server of
-- one's own would show its owner other people's IP addresses and when their
-- app is open. Pictures now come from sign-up alone (nobody can set their
-- own), and only from Google's and GitHub's picture hosts.
--
-- Friend requests. Each one puts a notification on someone's desktop, so a
-- person may have at most 20 waiting for an answer, and send at most 50 a day
-- (cancelled and declined ones count too).
--
-- Looking people up. find_profile answers exact usernames only; it now also
-- answers at most 100 times an hour per person, so usernames can't be listed
-- by trying them all.


-- Avatars --------------------------------------------------------------------

revoke update (avatar_url) on table public.profiles from authenticated;

update public.profiles
set avatar_url = null
where avatar_url !~ '^https://(lh[0-9]+\.googleusercontent\.com|avatars\.githubusercontent\.com)/';

alter table public.profiles
  add constraint profiles_avatar_url_known
  check (avatar_url ~ '^https://(lh[0-9]+\.googleusercontent\.com|avatars\.githubusercontent\.com)/');

-- As before, with the picture taken only from a known host.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  known constant text := '^https://(lh[0-9]+\.googleusercontent\.com|avatars\.githubusercontent\.com)/';
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
      when (meta ->> 'avatar_url') ~ known then meta ->> 'avatar_url'
      when (meta ->> 'picture') ~ known then meta ->> 'picture'
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


-- Friend requests ------------------------------------------------------------

-- Who sent a request when, for the daily limit: kept a day, whatever became
-- of the request.
create table private.friend_requests_sent (
  requester uuid not null,
  sent_at timestamptz not null default now()
);
create index friend_requests_sent_by on private.friend_requests_sent (requester, sent_at);
alter table private.friend_requests_sent enable row level security;

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

revoke all on function private.limit_friend_requests() from public;

create trigger limit_friend_requests
  before insert on public.friendships
  for each row execute function private.limit_friend_requests();


-- Looking people up -----------------------------------------------------------

create table private.profile_lookups (
  user_id uuid not null,
  looked_at timestamptz not null default now()
);
create index profile_lookups_by on private.profile_lookups (user_id, looked_at);
alter table private.profile_lookups enable row level security;

-- As before (exact usernames only, never yourself), counted.
create or replace function public.find_profile(name text)
returns table (id uuid, username text, display_name text, avatar_url text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me constant uuid := (select auth.uid());
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
