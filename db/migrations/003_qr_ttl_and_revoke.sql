-- ============================================================
-- Migration 003: bound QR token lifetime + admin revocation
-- ============================================================
-- Before this migration a "permanent" QR could live for 365 days: a single
-- photo of it allowed check-in from anywhere for a year. Tokens are now capped
-- at 24 hours, and admins can revoke every active code at once.
-- Run: node scripts/apply-sql.mjs db/migrations/003_qr_ttl_and_revoke.sql
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
  -- 30 seconds keeps the rotating QR meaningful; 24 hours is the hard ceiling.
  if v_duration < 30 then
    v_duration := 30;
  end if;
  if v_duration > 86400 then
    v_duration := 86400;
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

-- Revoke every QR code that is still valid. Employees mid-scan see
-- "This QR code has expired", which is the intended behaviour.
create or replace function public.revoke_qr_tokens()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_count int;
begin
  select public.is_admin() into v_is_admin;
  if not coalesce(v_is_admin, false) then
    return json_build_object('success', false, 'message', 'Unauthorized: Admin access required.');
  end if;

  delete from public.qr_tokens where expires_at > now();
  get diagnostics v_count = row_count;

  return json_build_object(
    'success', true,
    'message', 'Revoked ' || v_count || ' active QR code(s).',
    'revoked', v_count
  );
end;
$$;

grant execute on function public.revoke_qr_tokens() to authenticated;

-- One-time cleanup: drop the 365-day tokens issued by the old "Fixed" mode.
delete from public.qr_tokens where expires_at > now() + interval '1 day';

notify pgrst, 'reload schema';
