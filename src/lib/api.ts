import { db, hashPassword } from './neon';

export async function generateQrToken(
  durationSeconds: number = 45
): Promise<{ token: string; expires_at: string }> {
  const { data: rpcData, error: rpcError } = await db.rpc('create_qr_token', {
    p_duration_seconds: durationSeconds,
  });

  if (rpcError) {
    throw new Error(rpcError.message || 'Could not generate QR code.');
  }

  if (rpcData?.error) {
    throw new Error(rpcData.error);
  }

  if (!rpcData?.token) {
    throw new Error('Unable to generate QR code token.');
  }

  return rpcData;
}

export async function revokeQrTokens(): Promise<{
  success: boolean;
  message: string;
  revoked?: number;
}> {
  const { data, error } = await db.rpc('revoke_qr_tokens');
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.message || 'Could not revoke QR codes.');
  return data;
}

export async function recordAttendance(token: string): Promise<{
  success: boolean;
  message: string;
  time_in?: string;
  status?: string;
  already_recorded?: boolean;
}> {
  const { data: rpcData, error: rpcError } = await db.rpc('scan_attendance', {
    p_token: token,
  });

  if (rpcError) {
    throw new Error(
      rpcError.message || 'Error recording attendance. Please verify your database connection.'
    );
  }

  return rpcData;
}

export async function createEmployeeAccount(form: {
  full_name: string;
  employee_number: string;
  username: string;
  password: string;
  email?: string;
  role?: 'admin' | 'employee';
  shift?: 'morning' | 'afternoon';
  department?: string;
}): Promise<{ success: boolean; message: string; id?: string }> {
  const passwordHash = await hashPassword(form.password);

  const { data: rpcData, error: rpcError } = await db.rpc('admin_create_user', {
    p_full_name: form.full_name,
    p_employee_number: form.employee_number,
    p_username: form.username,
    p_password_hash: passwordHash,
    p_role: form.role || 'employee',
    p_shift: form.shift || 'morning',
    p_department: form.department || null,
    p_email: form.email?.trim() || null,
  });

  if (rpcError) {
    throw new Error(rpcError.message || 'Could not create account.');
  }
  if (!rpcData?.success) {
    throw new Error(rpcData?.message || 'Could not create account.');
  }
  return rpcData;
}

export async function adminDeleteEmployee(
  employeeId: string
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await db.rpc('admin_delete_employee', {
    p_employee_id: employeeId,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.message || 'Could not delete employee.');
  return data;
}

export async function adminResetPassword(
  employeeId: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const passwordHash = await hashPassword(newPassword);
  const { data, error } = await db.rpc('admin_reset_password', {
    p_employee_id: employeeId,
    p_password_hash: passwordHash,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.message || 'Could not reset password.');
  return data;
}

export async function adminUpdateEmployee(
  employeeId: string,
  form: { full_name: string; employee_number: string; department?: string; shift?: 'morning' | 'afternoon' }
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await db.rpc('admin_update_employee', {
    p_employee_id: employeeId,
    p_full_name: form.full_name,
    p_employee_number: form.employee_number,
    p_department: form.department || null,
    p_shift: form.shift || 'morning',
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.message || 'Could not update employee.');
  return data;
}
