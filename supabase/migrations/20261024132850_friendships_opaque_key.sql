-- Realtime sends a deleted row's primary key to everyone listening on the
-- table (row-level security can't filter deletes). With (requester,
-- addressee) as the key, that told every signed-in listener who had just
-- declined or unfriended whom. An opaque number as the key tells nothing.
-- The pair stays unique (friendships_pair_key), and requester keeps the
-- index the old key gave it.
alter table public.friendships drop constraint friendships_pkey;
alter table public.friendships add column id bigint generated always as identity;
alter table public.friendships add constraint friendships_pkey primary key (id);
create index friendships_requester_idx on public.friendships (requester);
