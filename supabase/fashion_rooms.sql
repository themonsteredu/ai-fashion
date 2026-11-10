begin;
create table public.fashion_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  title text not null check (length(title) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.fashion_clips (
  id uuid primary key,
  room_id uuid not null references public.fashion_rooms(id),
  group_no integer not null check (group_no between 1 and 6),
  title text not null check (length(title) between 1 and 60),
  path text not null unique,
  mime text not null check (mime in ('video/mp4','video/webm')),
  bytes bigint not null check (bytes between 1 and 52428800),
  duration numeric not null check (duration > 0 and duration <= 61),
  ready boolean not null default false,
  created_at timestamptz not null default now()
);
create index fashion_clips_scope_idx on public.fashion_clips(room_id,group_no,created_at desc);
create table public.fashion_teacher_auth (singleton boolean primary key default true check(singleton), pin_hash text not null);
insert into public.fashion_teacher_auth values (true,extensions.crypt('3035',extensions.gen_salt('bf')));
create table public.fashion_auth_limits (key text primary key, started_at timestamptz not null, attempts integer not null);
alter table public.fashion_rooms enable row level security;
alter table public.fashion_clips enable row level security;
alter table public.fashion_teacher_auth enable row level security;
alter table public.fashion_auth_limits enable row level security;
revoke all on public.fashion_rooms,public.fashion_clips,public.fashion_teacher_auth,public.fashion_auth_limits from public,anon,authenticated;
grant all on public.fashion_rooms,public.fashion_clips,public.fashion_teacher_auth,public.fashion_auth_limits to service_role;
create function public.fashion_check_teacher(p_pin text) returns boolean language sql security invoker set search_path='' as $$
  select coalesce((select pin_hash=extensions.crypt(p_pin,pin_hash) from public.fashion_teacher_auth where singleton),false);
$$;
create function public.fashion_take_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  insert into public.fashion_auth_limits as limits values(p_key,now(),1)
  on conflict(key) do update set
    attempts=case when limits.started_at < now()-make_interval(secs=>p_seconds) then 1 else limits.attempts+1 end,
    started_at=case when limits.started_at < now()-make_interval(secs=>p_seconds) then now() else limits.started_at end
  returning attempts into n;
  return n<=p_limit;
end;
$$;
revoke all on function public.fashion_check_teacher(text),public.fashion_take_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.fashion_check_teacher(text),public.fashion_take_limit(text,integer,integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('fashion-group-clips','fashion-group-clips',false,52428800,array['video/mp4','video/webm']);
create policy fashion_private_clips_guard on storage.objects as restrictive for all to anon,authenticated
using (bucket_id <> 'fashion-group-clips') with check (bucket_id <> 'fashion-group-clips');
commit;
