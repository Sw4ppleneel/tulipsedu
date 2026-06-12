import { request } from './client'

export interface TimetableSlot {
  id: string
  tenant_id: string
  academic_year_id: string
  class_id: string
  section_id: string
  day_of_week: number
  day_name: string | null
  period_number: number
  start_time: string
  end_time: string
  subject: string
  staff_id: string | null
  staff_name: string | null
  room: string | null
  created_at: string
}

export interface WeeklyTimetable {
  class_id: string
  section_id: string
  academic_year_id: string
  class_name: string
  section_name: string
  slots: TimetableSlot[]
}

export interface SlotUpsert {
  academic_year_id: string
  class_id: string
  section_id: string
  day_of_week: number
  period_number: number
  start_time: string
  end_time: string
  subject: string
  staff_id?: string
  room?: string
}

export function getClassTimetable(params: {
  academic_year_id: string
  class_id: string
  section_id: string
}): Promise<WeeklyTimetable> {
  const p = new URLSearchParams(params)
  return request<WeeklyTimetable>(`/timetable/class?${p}`)
}

export function upsertSlot(data: SlotUpsert): Promise<TimetableSlot> {
  return request<TimetableSlot>('/timetable/slots', { method: 'PUT', body: JSON.stringify(data) })
}

export async function deleteSlot(params: {
  academic_year_id: string
  class_id: string
  section_id: string
  day_of_week: number
  period_number: number
}): Promise<void> {
  const p = new URLSearchParams({
    academic_year_id: params.academic_year_id,
    class_id: params.class_id,
    section_id: params.section_id,
    day_of_week: String(params.day_of_week),
    period_number: String(params.period_number),
  })
  await request<void>(`/timetable/slots?${p}`, { method: 'DELETE' })
}
