-- ============================================================
-- Neon migration: user creation + password reset for Neon Auth
-- ============================================================
-- Neon Auth (Managed Better Auth) stores credentials in
-- neon_auth.user / neon_auth.account. Better Auth hashes passwords
-- with scrypt (N=16384, r=16, p=1, dkLen=64) as "<salt_hex>:<key_hex>",
-- so the browser hashes the password and this RPC stores the hash.
-- Run with: node scripts/apply-sql.mjs db/migrations/001_neon_auth_scrypt_rpcs.sql
-- ============================================================

-- 1) admin_create_user ------------------------------------------------
drop function if exists public.admin_create_user(text, text, text, text, text, text, text);

create or replace function public.admin_create_user(
  p_full_name text,
  p_employee_number text,
  p_username text,
  p_password_hash text,
  p_role text default 'employee',
  p_shift text default 'morning',
  p_department text default null
)
returns json
language plpgsql
security definer
set search_path = public, neon_auth
as $$
declare
  v_is_admin boolean;
  v_new_id uuid := gen_random_uuid();
  v_clean_username text;
  v_clean_role text;
  v_clean_shift text;
  v_email text;
begin
  select public.is_admin() into v_is_admin;
  if not coalesce(v_is_admin, false) then
    return json_build_object('success', false, 'message', 'Unauthorized: Admin access required.');
  end if;

  v_clean_username := lower(trim(coalesce(p_username, '')));
  if length(v_clean_username) < 3 then
    return json_build_object('success', false, 'message', 'Username must be at least 3 characters.');
  end if;
  if v_clean_username !~ '^[a-z0-9._-]+$' then
    return json_build_object('success', false, 'message', 'Username may only contain letters, numbers, dots, dashes and underscores.');
  end if;

  if trim(coalesce(p_full_name, '')) = '' or trim(coalesce(p_employee_number, '')) = '' then
    return json_build_object('success', false, 'message', 'Full name and Phone Number cannot be empty.');
  end if;

  -- scrypt hash produced by the client: 32 hex salt chars : 128 hex key chars
  if coalesce(p_password_hash, '') !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' then
    return json_build_object('success', false, 'message', 'Invalid password hash provided.');
  end if;

  v_clean_role := case when lower(trim(coalesce(p_role, ''))) = 'admin' then 'admin' else 'employee' end;
  v_clean_shift := case when lower(trim(coalesce(p_shift, ''))) = 'afternoon' then 'afternoon' else 'morning' end;

  if exists (select 1 from public.profiles where username = v_clean_username) then
    return json_build_object('success', false, 'message', 'Username is already taken.');
  end if;
  if exists (select 1 from public.profiles where employee_number = trim(p_employee_number)) then
    return json_build_object('success', false, 'message', 'Phone Number is already taken.');
  end if;

  v_email := v_clean_username || '@attendance-login.example.com';
  if exists (select 1 from neon_auth.user where email = v_email) then
    return json_build_object('success', false, 'message', 'That username is already registered.');
  end if;

  insert into neon_auth.user (id, name, email, "emailVerified", role, banned, "createdAt", "updatedAt")
  values (v_new_id, trim(p_full_name), v_email, true, 'user', false, now(), now());

  insert into neon_auth.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  values (gen_random_uuid(), v_new_id::text, 'credential', v_new_id, p_password_hash, now(), now());

  insert into public.profiles (id, full_name, employee_number, username, role, department, shift, is_active, created_at)
  values (
    v_new_id,
    trim(p_full_name),
    trim(p_employee_number),
    v_clean_username,
    v_clean_role,
    nullif(trim(p_department), ''),
    v_clean_shift,
    true,
    now()
  );

  return json_build_object(
    'success', true,
    'message', case when v_clean_role = 'admin' then 'Admin account created successfully.' else 'Employee account created successfully.' end,
    'id', v_new_id
  );
exception
  when others then
    return json_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.admin_create_user(text, text, text, text, text, text, text) to authenticated;

-- 2) admin_reset_password ---------------------------------------------
-- Signature changes from (uuid, text password) to (uuid, text scrypt hash),
-- because Better Auth verifies scrypt only (bcrypt hashes never match).
drop function if exists public.admin_reset_password(uuid, text);

create or replace function public.admin_reset_password(p_employee_id uuid, p_password_hash text)
returns json
language plpgsql
security definer
set search_path = public, neon_auth
as $$
declare
  v_is_admin boolean;
  v_target_role text;
begin
  select public.is_admin() into v_is_admin;
  if not coalesce(v_is_admin, false) then
    return json_build_object('success', false, 'message', 'Unauthorized: Admin access required.');
  end if;

  if coalesce(p_password_hash, '') !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' then
    return json_build_object('success', false, 'message', 'Invalid password hash provided.');
  end if;

  select role into v_target_role from public.profiles where id = p_employee_id;
  if v_target_role is null then
    return json_build_object('success', false, 'message', 'Employee not found.');
  end if;

  update neon_auth.account
  set password = p_password_hash,
      "updatedAt" = now()
  where "userId" = p_employee_id and "providerId" = 'credential';

  if not found then
    insert into neon_auth.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
    values (gen_random_uuid(), p_employee_id::text, 'credential', p_employee_id, p_password_hash, now(), now());
  end if;

  delete from neon_auth.session where "userId" = p_employee_id;

  return json_build_object('success', true, 'message', 'Password reset successfully.');
exception
  when others then
    return json_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.admin_reset_password(uuid, text) to authenticated;

-- 3) Refresh PostgREST schema cache --------------------------------
notify pgrst, 'reload schema';
