import { useState } from 'preact/hooks'
import { AttendanceView } from './Attendance'
import { HomeworkView } from './Homework'
import { TimetableView } from './Timetable'
import { ExamView } from './Exam'
import { NotificationsBell } from './NotificationsBell'
import { TeacherDashboard } from './TeacherDashboard'

// Teacher portal: a distinct app, not the admin shell with menus hidden. It loads
// ONLY the modules a teacher uses; the underlying views are already scoped to the
// teacher's assigned classes by the backend (load_class_scope). Staff/finance/
// settings/CMS are never imported here.
type TView = 'today' | 'attendance' | 'homework' | 'timetable' | 'exams'

const NAV: { key: TView; label: string; icon: string }[] = [
  { key: 'today',      label: 'Today',      icon: '⊞' },
  { key: 'attendance', label: 'Attendance', icon: '✓' },
  { key: 'homework',   label: 'Homework',   icon: '📚' },
  { key: 'timetable',  label: 'Timetable',  icon: '🗓' },
  { key: 'exams',      label: 'Exams',      icon: '📝' },
]

export function TeacherShell({ onLogout, role, schoolName }: {
  onLogout: () => void; role: string; schoolName: string
}) {
  const [view, setView] = useState<TView>('today')

  function navBtn(item: { key: TView; label: string; icon: string }) {
    const active = view === item.key
    return (
      <button
        key={item.key}
        onClick={() => setView(item.key)}
        style={{
          display: 'flex', alignItems: 'center', gap: '.375rem', padding: '.35rem .7rem',
          background: active ? 'rgba(255,255,255,.18)' : 'transparent',
          color: active ? '#fff' : 'rgba(255,255,255,.75)',
          border: active ? '1px solid rgba(255,255,255,.25)' : '1px solid transparent',
          borderRadius: 5, cursor: 'pointer', fontSize: '.8125rem',
          fontWeight: active ? 600 : 400, fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: '.875rem', lineHeight: 1 }}>{item.icon}</span>
        {item.label}
      </button>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', fontFamily: 'var(--font)' }}>
      <header style={{
        background: 'linear-gradient(135deg, #047857 0%, #065f46 100%)',
        color: '#fff', padding: '0 1.25rem', height: 54,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(4,120,87,.3)', position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
            <div style={{ width: 30, height: 30, background: 'rgba(255,255,255,.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1rem' }}>T</div>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontWeight: 800, fontSize: '.9rem', letterSpacing: '-.01em' }}>Teacher</div>
              {schoolName && <div style={{ fontSize: '.65rem', opacity: .75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{schoolName}</div>}
            </div>
          </div>
          <nav style={{ display: 'flex', gap: '.2rem', flexWrap: 'nowrap', overflow: 'hidden' }}>
            {NAV.map(navBtn)}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexShrink: 0 }}>
          <NotificationsBell />
          <button
            onClick={onLogout}
            style={{ background: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.9)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, padding: '.3rem .75rem', cursor: 'pointer', fontSize: '.75rem', fontFamily: 'inherit' }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main>
        {view === 'today'      && <TeacherDashboard onGoToAttendance={() => setView('attendance')} />}
        {view === 'attendance' && <AttendanceView />}
        {view === 'homework'   && <HomeworkView />}
        {view === 'timetable'  && <TimetableView />}
        {view === 'exams'      && <ExamView />}
      </main>
    </div>
  )
}
