-- The two logs the limits keep (requests sent, lookups made) get keys of
-- their own, as every table should.
alter table private.friend_requests_sent add column id bigint generated always as identity primary key;
alter table private.profile_lookups add column id bigint generated always as identity primary key;
