/**
 * Thin fetch wrapper.
 *
 * The backend reports rule violations as a structured body
 * ({code, message, ...detail}), so errors are rethrown as an ApiError that
 * keeps both, letting the UI show the clinic-readable message and still
 * branch on the code.
 */

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.code = payload?.code || 'http_error'
    this.detail = payload || {}
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  let url = path
  if (params) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        search.append(key, value)
      }
    }
    const qs = search.toString()
    if (qs) url += `?${qs}`
  }

  let response
  try {
    response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, {
      code: 'network_error',
      message: 'Cannot reach the server. Is the backend running on port 8000?',
    })
  }

  if (response.status === 204) return null

  let payload = null
  const text = await response.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { message: text }
    }
  }

  if (!response.ok) {
    // FastAPI's own validation errors arrive as {detail: [...]}; flatten the
    // first one so the user sees something specific rather than "[object]".
    if (Array.isArray(payload?.detail)) {
      const first = payload.detail[0]
      const field = first?.loc?.filter((p) => p !== 'body').join('.')
      throw new ApiError(response.status, {
        code: 'validation_error',
        message: field ? `${field}: ${first.msg}` : first?.msg,
      })
    }
    throw new ApiError(response.status, payload)
  }

  return payload
}

export const api = {
  health: () => request('/api/health'),

  listAppointments: (params) => request('/api/appointments', { params }),
  searchAppointments: (params) => request('/api/appointments/search', { params }),
  getAppointment: (id) => request(`/api/appointments/${id}`),
  createAppointment: (body) => request('/api/appointments', { method: 'POST', body }),
  updateStatus: (id, status, note = null) =>
    request(`/api/appointments/${id}/status`, {
      method: 'PATCH',
      body: { status, note },
    }),
  reschedule: (id, body) =>
    request(`/api/appointments/${id}/reschedule`, { method: 'PATCH', body }),

  getHistory: (id) => request(`/api/appointments/${id}/history`),

  dailySummary: (params) => request('/api/reports/daily-summary', { params }),
  utilisation: (params) => request('/api/reports/utilisation', { params }),
  cancellations: (params) => request('/api/reports/cancellations', { params }),

  dueReminders: (params) => request('/api/reminders/due', { params }),
  dispatchReminders: (params) =>
    request('/api/reminders/dispatch', { method: 'POST', params }),
  reminderLog: (params) => request('/api/reminders/log', { params }),

  listPatients: (params) => request('/api/patients', { params }),
  createPatient: (body) => request('/api/patients', { method: 'POST', body }),

  listStaff: (params) => request('/api/staff', { params }),
  createStaff: (body) => request('/api/staff', { method: 'POST', body }),
  updateStaff: (id, body) => request(`/api/staff/${id}`, { method: 'PATCH', body }),
  getBusinessHours: (id) => request(`/api/staff/${id}/business-hours`),
  putBusinessHours: (id, body) =>
    request(`/api/staff/${id}/business-hours`, { method: 'PUT', body }),

  listServices: (params) => request('/api/services', { params }),
  createService: (body) => request('/api/services', { method: 'POST', body }),
  updateService: (id, body) => request(`/api/services/${id}`, { method: 'PATCH', body }),
}
