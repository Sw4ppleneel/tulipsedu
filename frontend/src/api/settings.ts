import { request } from './client'

export interface SchoolSettings {
  name: string
  upi_id: string | null
}

export const settingsApi = {
  get: () => request<SchoolSettings>('/settings'),
  setUpi: (upi_id: string | null) =>
    request<SchoolSettings>('/settings/upi', {
      method: 'PATCH',
      body: JSON.stringify({ upi_id }),
    }),
}
