-- Replace __BOOTSTRAP_HASH__ with the SHA-256 of a freshly generated one-time link token.
-- Creates isolated application objects without altering other application tables.
begin;
create schema ai_fashion_shared_20261028;
revoke all on schema ai_fashion_shared_20261028 from public, anon, authenticated;

create table ai_fashion_shared_20261028.settings (
  singleton boolean primary key default true check (singleton),
  setup_hash text,
  key_hash text,
  vault_id uuid,
  configured boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table ai_fashion_shared_20261028.settings enable row level security;
revoke all on ai_fashion_shared_20261028.settings from public, anon, authenticated;
insert into ai_fashion_shared_20261028.settings (singleton, setup_hash) values (true, '__BOOTSTRAP_HASH__');

create table ai_fashion_shared_20261028.requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
alter table ai_fashion_shared_20261028.requests enable row level security;
revoke all on ai_fashion_shared_20261028.requests from public, anon, authenticated;
create index ai_fashion_requests_created_at_idx on ai_fashion_shared_20261028.requests (created_at);

CREATE OR REPLACE FUNCTION public.ai_fashion_reserve_request()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s ai_fashion_shared_20261028.settings%rowtype;
  secret text;
  last_day bigint;
  last_minute bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(83303501);
  select * into strict s from ai_fashion_shared_20261028.settings where singleton = true;
  if not s.configured then return pg_catalog.jsonb_build_object('error', 'not_configured'); end if;
  delete from ai_fashion_shared_20261028.requests where created_at < now() - interval '25 hours';
  select count(*) filter (where created_at >= now() - interval '24 hours'),
         count(*) filter (where created_at >= now() - interval '1 minute')
    into last_day, last_minute from ai_fashion_shared_20261028.requests;
  if last_day >= 100 or last_minute >= 25 then return pg_catalog.jsonb_build_object('error', 'rate_limit'); end if;
  select decrypted_secret into secret from vault.decrypted_secrets where id = s.vault_id;
  if secret is null or secret = '' then return pg_catalog.jsonb_build_object('error', 'not_configured'); end if;
  insert into ai_fashion_shared_20261028.requests default values;
  return pg_catalog.jsonb_build_object('key', secret);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ai_fashion_status()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_build_object('configured', s.configured, 'registered', s.key_hash is not null)
  from ai_fashion_shared_20261028.settings s where s.singleton = true;
$function$;

CREATE OR REPLACE FUNCTION public.ai_fashion_update_key(p_new_key text, p_current_key text, p_setup_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s ai_fashion_shared_20261028.settings%rowtype;
  secret_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(83303501);
  select * into strict s from ai_fashion_shared_20261028.settings where singleton = true for update;
  if s.key_hash is null then
    if p_new_key is null or s.setup_hash is null or pg_catalog.encode(extensions.digest(coalesce(p_setup_token, ''), 'sha256'), 'hex') <> s.setup_hash then
      return pg_catalog.jsonb_build_object('error', 'unauthorized');
    end if;
  elsif pg_catalog.encode(extensions.digest(coalesce(p_current_key, ''), 'sha256'), 'hex') <> s.key_hash then
    return pg_catalog.jsonb_build_object('error', 'unauthorized');
  end if;
  if p_new_key is not null and (pg_catalog.char_length(p_new_key) > 259 or p_new_key !~ '^sk-[A-Za-z0-9_-]{20,}$') then
    return pg_catalog.jsonb_build_object('error', 'invalid_key');
  end if;
  secret_id := s.vault_id;
  if secret_id is null then
    secret_id := vault.create_secret(p_new_key, 'ai_fashion_shared_openai_api_key', 'AI Fashion shared OpenAI key');
  else
    perform vault.update_secret(secret_id, coalesce(p_new_key, ''), 'ai_fashion_shared_openai_api_key', 'AI Fashion shared OpenAI key');
  end if;
  update ai_fashion_shared_20261028.settings set
    vault_id = secret_id,
    setup_hash = null,
    key_hash = case when p_new_key is null then s.key_hash else pg_catalog.encode(extensions.digest(p_new_key, 'sha256'), 'hex') end,
    configured = p_new_key is not null,
    updated_at = now()
  where singleton = true;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.ai_fashion_status() from public, anon, authenticated;
revoke all on function public.ai_fashion_update_key(text, text, text) from public, anon, authenticated;
revoke all on function public.ai_fashion_reserve_request() from public, anon, authenticated;
grant execute on function public.ai_fashion_status() to service_role;
grant execute on function public.ai_fashion_update_key(text, text, text) to service_role;
grant execute on function public.ai_fashion_reserve_request() to service_role;
commit;
