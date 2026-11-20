/**
 * Fetch wrapper. The API reports rule violations as `{ code, message, ...detail }`;
 * failures are rethrown as ApiError keeping both, so the UI can show the
 * readable message and still branch on the code.
 *
 * The session is an httpOnly cookie, so requests just include credentials.
 * A 401 on a signed-in page fires `onUnauthorized` (the auth provider sends
 * the user back to their login page).
 */
import type {
  ActivityEntry,
  AdminUser,
  Appointment,
  BusinessHour,
  HistoryEntry,
  Me,
  NotificationItem,
  Patient,
  PortalAppointment,
  ReminderLogEntry,
  Report,
  Service,
  Slot,
  Staff,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  detail: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  constructor(status: number, payload: { code?: string; message?: string } | null) {
    super(payload?.message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.code || 'http_error';
    this.detail = payload || {};
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function request<T>(
  path: string,
  { method = 'GET', body, params, quiet401 = false }: { method?: string; body?: unknown; params?: Params; quiet401?: boolean } = {},
): Promise<T> {
  let url = path;
  if (params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.append(key, String(value));
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { code: 'network_error', message: 'Cannot reach the server. Check your connection and try again.' });
  }

  if (response.status === 204) return null as T;
  const text = await response.text();
  let payload: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    if (response.status === 401 && !quiet401) unauthorizedHandler?.();
    throw new ApiError(response.status, payload);
  }
  return payload as T;
}

const get = <T>(path: string, params?: Params) => request<T>(path, { params });
const post = <T>(path: string, body?: unknown, params?: Params) => request<T>(path, { method: 'POST', body: body ?? {}, params });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body });
const del = <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body: body ?? {} });

export const api = {
  health: () => get<{ ok: boolean; db: string }>('/api/health'),

  // ---- Auth ----
  me: () => request<Me>('/api/auth/me', { quiet401: true }),
  login: (email: string, password: string, portal: 'patient' | 'staff') =>
    request<Me>('/api/auth/login', { method: 'POST', body: { email, password, portal }, quiet401: true }),
  register: (body: { email: string; password: string; first_name: string; last_name: string; phone: string; date_of_birth?: string | null }) =>
    post<Me>('/api/auth/register', body),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  forgotPassword: (email: string) => post<{ ok: boolean; message: string }>('/api/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => post<{ ok: boolean }>('/api/auth/reset-password', { token, password }),
  changePassword: (current_password: string | undefined, new_password: string) =>
    post<{ ok: boolean }>('/api/auth/change-password', { current_password, new_password }),
  googleEnabled: () => get<{ enabled: boolean }>('/api/auth/google/enabled'),

  // ---- Appointments (employee) ----
  listAppointments: (params?: Params) => get<Appointment[]>('/api/appointments', params),
  searchAppointments: (params?: Params) => get<Appointment[]>('/api/appointments/search', params),
  getAppointment: (id: number) => get<Appointment>(`/api/appointments/${id}`),
  createAppointment: (body: { patient_id: number; staff_id: number; service_id: number; starts_at: string; reason: string | null }) =>
    post<Appointment>('/api/appointments', body),
  updateStatus: (id: number, status: string, note: string | null = null) =>
    patch<Appointment>(`/api/appointments/${id}/status`, { status, note }),
  reschedule: (id: number, body: { starts_at: string; staff_id?: number; service_id?: number; note?: string | null }) =>
    patch<Appointment>(`/api/appointments/${id}/reschedule`, body),
  approve: (id: number, reason?: string | null) => post<Appointment>(`/api/appointments/${id}/approve`, { reason }),
  decline: (id: number, reason: string) => post<Appointment>(`/api/appointments/${id}/decline`, { reason }),
  getHistory: (id: number) => get<HistoryEntry[]>(`/api/appointments/${id}/history`),

  // ---- Reports & reminders ----
  dailySummary: (params?: Params) => get<Report>('/api/reports/daily-summary', params),
  utilisation: (params?: Params) => get<Report>('/api/reports/utilisation', params),
  cancellations: (params?: Params) => get<Report>('/api/reports/cancellations', params),
  dueReminders: (params?: Params) => get<Appointment[]>('/api/reminders/due', params),
  dispatchReminders: (params?: Params) => post<Report>('/api/reminders/dispatch', undefined, params),
  reminderLog: (params?: Params) => get<ReminderLogEntry[]>('/api/reminders/log', params),

  // ---- Records ----
  listPatients: (params?: Params) => get<Patient[]>('/api/patients', params),
  createPatient: (body: Partial<Patient>) => post<Patient>('/api/patients', body),
  updatePatient: (id: number, body: Partial<Patient>) => patch<Patient>(`/api/patients/${id}`, body),
  listStaff: (params?: Params) => get<Staff[]>('/api/staff', params),
  createStaff: (body: Partial<Staff>) => post<Staff>('/api/staff', body),
  updateStaff: (id: number, body: Partial<Staff>) => patch<Staff>(`/api/staff/${id}`, body),
  getBusinessHours: (id: number) => get<BusinessHour[]>(`/api/staff/${id}/business-hours`),
  putBusinessHours: (id: number, body: BusinessHour[]) => put<BusinessHour[]>(`/api/staff/${id}/business-hours`, body),
  listServices: (params?: Params) => get<Service[]>('/api/services', params),
  createService: (body: Partial<Service>) => post<Service>('/api/services', body),
  updateService: (id: number, body: Partial<Service>) => patch<Service>(`/api/services/${id}`, body),

  // ---- Notifications ----
  notifications: (params?: Params) => get<{ unread: number; items: NotificationItem[] }>('/api/notifications', params),
  markRead: (id: number) => post<{ ok: boolean }>(`/api/notifications/${id}/read`),
  markAllRead: () => post<{ ok: boolean }>('/api/notifications/read-all'),

  // ---- Patient portal ----
  portal: {
    services: () => get<Pick<Service, 'id' | 'name' | 'duration_minutes' | 'description'>[]>('/api/portal/services'),
    staff: () => get<Pick<Staff, 'id' | 'full_name' | 'role'>[]>('/api/portal/staff'),
    availability: (params: { service_id: number; staff_id: number; date: string; exclude_appointment_id?: number }) =>
      get<{ date: string; slots: Slot[] }>('/api/portal/availability', params),
    appointments: () => get<PortalAppointment[]>('/api/portal/appointments'),
    book: (body: { service_id: number; staff_id: number; starts_at: string; reason: string | null }) =>
      post<PortalAppointment>('/api/portal/appointments', body),
    cancel: (id: number, reason: string | null) => post<PortalAppointment>(`/api/portal/appointments/${id}/cancel`, { reason }),
    reschedule: (id: number, starts_at: string, staff_id?: number) =>
      post<PortalAppointment>(`/api/portal/appointments/${id}/reschedule`, { starts_at, staff_id }),
    profile: () => get<Patient>('/api/portal/profile'),
    updateProfile: (body: Partial<Pick<Patient, 'first_name' | 'last_name' | 'phone' | 'date_of_birth'>>) =>
      patch<Patient>('/api/portal/profile', body),
  },

  // ---- Admin ----
  admin: {
    users: (params?: Params) => get<AdminUser[]>('/api/admin/users', params),
    createUser: (body: { email: string; full_name: string; role: 'employee' | 'admin'; password: string; staff_id?: number | null }) =>
      post<AdminUser>('/api/admin/users', body),
    updateUser: (id: number, body: Partial<{ full_name: string; role: 'employee' | 'admin'; is_active: boolean; staff_id: number | null }>) =>
      patch<AdminUser>(`/api/admin/users/${id}`, body),
    setPassword: (id: number, password: string) => post<{ ok: boolean }>(`/api/admin/users/${id}/password`, { password }),
    deleteUser: (id: number) => del<{ ok: boolean }>(`/api/admin/users/${id}`),
    deletePatient: (id: number, reason: string) => del<{ ok: boolean; deleted_appointments: number }>(`/api/admin/patients/${id}`, { reason }),
    deleteAppointment: (id: number, reason: string) => del<{ ok: boolean }>(`/api/admin/appointments/${id}`, { reason }),
    activity: (params?: Params) => get<{ total: number; items: ActivityEntry[] }>('/api/admin/activity', params),
    actions: () => get<string[]>('/api/admin/activity/actions'),
    setTimezone: (timezone: string) => put<{ timezone: string }>('/api/admin/settings', { timezone }),
  },
};
