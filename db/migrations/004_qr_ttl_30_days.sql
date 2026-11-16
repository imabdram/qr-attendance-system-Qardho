-- ============================================================
-- Migration 004: allow long-lived manual QR codes (30 days)
-- ============================================================
-- The "changed by hand" mode must keep working until an administrator presses
-- Change QR Code, so its token lives for 30 days. Automatic codes still use
-- interval + 25 s. The hard ceiling stays bounded (30 days, never a year) and
-- revoke_qr_tokens() remains available.
-- Run: node scripts/apply-sql.mjs db/migrations/004_qr_ttl_30_days.sql
-- Then: neon data-api refresh-schema
-- ============================================================

create or replace function public.create_qr_token(p_duration_seconds integer default 45)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_role text;
  v_is_active boolean;
  v_token text;
  v_token_hash text;
  v_expires_at timestamptz;
  v_duration int;
begin
  select role, is_active into v_user_role, v_is_active
  from public.profiles
  where id = auth.uid();

  if v_user_role is distinct from 'admin' or v_is_active is not true then
    return json_build_object('error', 'Administrator access required.');
  end if;

  v_duration := coalesce(p_duration_seconds, 45);
  -- 30 seconds keeps automatic rotation meaningful; 30 days is the hard ceiling.
  if v_duration < 30 then
    v_duration := 30;
  end if;
  if v_duration > 2592000 then
    v_duration := 2592000;
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');
  v_expires_at := now() + (v_duration || ' seconds')::interval;

  insert into public.qr_tokens (token_hash, expires_at)
  values (v_token_hash, v_expires_at);

  delete from public.qr_tokens where expires_at < now() - interval '1 hour';

  return json_build_object('token', v_token, 'expires_at', v_expires_at);
end;
$$;

grant execute on function public.create_qr_token(integer) to authenticated;

notify pgrst, 'reload schema';
