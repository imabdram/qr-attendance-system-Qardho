-- ============================================================
-- Migration 002: admins with a real email address
-- ============================================================
-- admin_create_user gains an optional p_email. When it is provided the account
-- signs in with that real address (e.g. dhomdesign@gmail.com); otherwise the old
-- username@attendance-login.example.com convention is kept for employees.
-- Run: node scripts/apply-sql.mjs db/migrations/002_admin_email.sql
-- Then: neon data-api refresh-schema
-- ============================================================

drop function if exists public.admin_create_user(text, text, text, text, text, text, text);

create or replace function public.admin_create_user(
  p_full_name text,
  p_employee_number text,
  p_username text,
  p_password_hash text,
  p_role text default 'employee',
  p_shift text default 'morning',
  p_department text default null,
  p_email text default null
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

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    v_email := v_clean_username || '@attendance-login.example.com';
  elsif v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return json_build_object('success', false, 'message', 'Enter a valid email address.');
  end if;

  if exists (select 1 from neon_auth.user where lower(email) = v_email) then
    return json_build_object('success', false, 'message', 'An account with that email already exists.');
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
    'message', case
      when v_clean_role = 'admin' then 'Admin account created. Sign in with ' || v_email || '.'
      else 'Employee account created successfully.'
    end,
    'id', v_new_id,
    'email', v_email
  );
exception
  when others then
    return json_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.admin_create_user(text, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
