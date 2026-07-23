/**
 * Tulips.edu icon set — hand-built inline SVG line icons (no icon library, per the
 * lightweight mandate). Single stroke style, currentColor, so icons inherit the
 * surrounding text colour and the design tokens. Add new glyphs here only.
 */
import type { JSX } from 'preact'

export type IconName =
  | 'dashboard' | 'students' | 'staff' | 'attendance' | 'fees' | 'homework'
  | 'announcement' | 'material' | 'timetable' | 'exams' | 'results' | 'website'
  | 'settings' | 'platform' | 'bell' | 'back' | 'home' | 'eye' | 'eye-off' | 'activity'

const P: Record<IconName, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  students: <><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1.2 2.7 3 6 3s6-1.8 6-3v-5" /></>,
  staff: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 5.5a3 3 0 0 1 0 5.8" /><path d="M17 15.2c2.3.6 4 2.3 4 4.8" /></>,
  attendance: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  fees: <><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11h6M9 8c2.5 0 3.5 1.5 3.5 3S11.5 14 9 14l4 3" /></>,
  homework: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M4 19a2 2 0 0 0 2 2h13" /><path d="M9 7h6M9 10h4" /></>,
  announcement: <><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15 8a5 5 0 0 1 0 8" /><path d="M18 5a9 9 0 0 1 0 14" /></>,
  material: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></>,
  timetable: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /><path d="M7 13h2M11 13h2M15 13h2M7 16.5h2M11 16.5h2" /></>,
  exams: <><path d="M8 3h8a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1V4a1 1 0 0 1 1-1Z" /><path d="M8 3v3h8V3" /><path d="M8.5 12l2 2 4-4" /></>,
  results: <><circle cx="12" cy="9" r="5" /><path d="M9 13.5 7.5 21l4.5-2.6L16.5 21 15 13.5" /></>,
  website: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.5 3.5 5.8 3.5 9S14.5 18.5 12 21C9.5 18.5 8.5 15.2 8.5 12S9.5 5.5 12 3Z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5l1.6 2.4 2.8-.6.5 2.8 2.4 1.6-1.2 2.6 1.2 2.6-2.4 1.6-.5 2.8-2.8-.6L12 21.5l-1.6-2.4-2.8.6-.5-2.8L4.7 15.3 5.9 12.7 4.7 10.1l2.4-1.6.5-2.8 2.8.6L12 2.5Z" /></>,
  platform: <><path d="M4 21V6l8-3 8 3v15" /><path d="M2 21h20" /><path d="M9 21v-5h6v5M8 8h2M14 8h2M8 11.5h2M14 11.5h2" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  activity: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" /></>,
  eye: <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" /><path d="M3 3l18 18" /></>,
}

export function Icon({
  name, size = 22, stroke = 1.8, class: cls, style,
}: { name: IconName; size?: number; stroke?: number; class?: string; style?: JSX.CSSProperties }) {
  return (
    <svg
      class={cls} style={style}
      width={`${size}`} height={`${size}`} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width={`${stroke}`} stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  )
}
