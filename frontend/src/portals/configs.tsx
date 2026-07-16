/**
 * Per-role portal definitions. Each role gets a dedicated app experience (its own
 * section set + big-button home) on the shared PortalShell, so every screen still
 * reads as one Tulips.edu product. The backend (require_roles + load_class_scope)
 * is the real authorization boundary; this only shapes what each role's app loads.
 */
import type { PortalConfig, PortalSection } from './PortalShell'
import type { FeatureFlags } from '../api/notifications'
import { Icon } from '../ui'

import { DashboardView } from '../views/Dashboard'
import { StudentsView } from '../views/Students'
import { StaffView } from '../views/Staff'
import { AttendanceView } from '../views/Attendance'
import { FeesAdminView } from '../views/FeesAdmin'
import { HomeworkView } from '../views/Homework'
import { TimetableView } from '../views/Timetable'
import { ExamView } from '../views/Exam'
import { CmsAdminView } from '../views/CmsAdmin'
import { SettingsView } from '../views/Settings'
import { SuperadminView } from '../views/Superadmin'
import { TeacherDashboard } from '../views/TeacherDashboard'
import { PaymentVerificationView } from '../views/PaymentVerification'
import { ClassAssignmentsView } from '../views/ClassAssignments'
import { AdmissionsView } from '../views/Admissions'
import { PayrollView } from '../views/Payroll'

type Mod = 'attendance' | 'fees' | 'homework' | 'timetable' | 'exams' | 'cms'

function flagOn(features: FeatureFlags | null, mod: Mod): boolean {
  return features ? features[mod] : true // default-on until flags load (4 live schools)
}

interface BuildArgs {
  role: string
  schoolName: string
  firstName?: string
  features: FeatureFlags | null
  onLogout: () => void
  logoUrl?: string | null
}

export function buildPortalConfig(args: BuildArgs): PortalConfig {
  const { role, schoolName, firstName, features, onLogout, logoUrl } = args

  const base = (name: string, sections: PortalSection[], showBell = true): PortalConfig =>
    ({ name, schoolName, staffName: firstName, sections, showBell, logoUrl, onLogout })

  const ic = (n: Parameters<typeof Icon>[0]['name']) => <Icon name={n} size={24} />

  // ── Super admin — platform only ──────────────────────────────────────────
  if (role === 'superadmin') {
    return base('Platform', [
      { key: 'platform', label: 'Institutions', icon: ic('platform'), desc: 'Tenants, provisioning, platform administration', render: () => <SuperadminView /> },
    ], false)
  }

  // ── Teacher / class teacher — daily classroom ops, assigned classes only ──
  // Homework, Announcements and Study Material are SEPARATE sections (no longer
  // clubbed under one "feed").
  if (role === 'teacher' || role === 'class_teacher') {
    return base('Teacher', [
      { key: 'today',        label: 'Today',         icon: ic('dashboard'),    desc: 'Your classes, pending attendance, notices', render: nav => <TeacherDashboard onGoToAttendance={() => nav('attendance')} /> },
      { key: 'attendance',   label: 'Attendance',    icon: ic('attendance'),   desc: "Mark today's attendance for your classes",  render: () => <AttendanceView role={role} /> },
      { key: 'homework',     label: 'Homework',      icon: ic('homework'),     desc: 'Assign and review homework',                render: () => <HomeworkView defaultType="homework" /> },
      { key: 'announcements',label: 'Announcements', icon: ic('announcement'), desc: 'Post notices to your classes',              render: () => <HomeworkView defaultType="announcement" /> },
      { key: 'material',     label: 'Study Material',icon: ic('material'),     desc: 'Share study resources',                     render: () => <HomeworkView defaultType="resource" /> },
      { key: 'timetable',    label: 'Timetable',     icon: ic('timetable'),    desc: 'Your weekly teaching schedule',             render: () => <TimetableView /> },
      { key: 'exams',        label: 'Exams',         icon: ic('exams'),        desc: 'Enter marks for your subjects',             render: () => <ExamView role={role} /> },
    ])
  }

  // ── Accountant — finance only ────────────────────────────────────────────
  if (role === 'accountant') {
    return base('Accountant', [
      { key: 'dashboard', label: 'Dashboard',         icon: ic('dashboard'), desc: 'Fee collection summary and defaulter count',     render: () => <DashboardView schoolName={schoolName} role={role} /> },
      { key: 'fees',      label: 'Fees & Collections',icon: ic('fees'),    desc: 'Fee ledger, receipts, collections, outstanding', render: () => <FeesAdminView /> },
      { key: 'verify',    label: 'Verify Payments',   icon: ic('results'), desc: 'Approve parent-reported UPI payments',           render: () => <PaymentVerificationView /> },
    ])
  }

  // ── Principal / vice-principal — full institution ────────────────────────
  const isPrincipal = role === 'principal'
  const sections: PortalSection[] = [
    { key: 'dashboard', label: 'Dashboard', icon: ic('dashboard'), desc: 'Counts, attendance and fee collection at a glance', render: () => <DashboardView schoolName={schoolName} role={role} /> },
    { key: 'students',  label: 'Students',  icon: ic('students'),  desc: 'Enrolment, roster and student records',             render: () => <StudentsView /> },
    { key: 'staff',     label: 'Staff',     icon: ic('staff'),     desc: 'Teachers, roles and class assignments',             render: () => <StaffView role={role} /> },
    { key: 'assign',      label: 'Assignments', icon: ic('timetable'), desc: 'Assign teachers to classes and subjects',           render: () => <ClassAssignmentsView /> },
    { key: 'admissions',  label: 'Admissions',  icon: ic('students'),  desc: 'Enquiry pipeline and student enrolment',            render: () => <AdmissionsView /> },
  ]
  if (flagOn(features, 'attendance')) sections.push({ key: 'attendance', label: 'Attendance', icon: ic('attendance'), desc: 'Monitor and override attendance', render: () => <AttendanceView /> })
  if (flagOn(features, 'fees')) {
    sections.push({ key: 'fees',   label: 'Fees',            icon: ic('fees'),    desc: 'Structures, ledger and collections', render: () => <FeesAdminView /> })
    sections.push({ key: 'verify', label: 'Verify Payments', icon: ic('results'), desc: 'Approve parent-reported UPI payments', render: () => <PaymentVerificationView /> })
  }
  if (flagOn(features, 'homework')) {
    sections.push({ key: 'homework',      label: 'Homework',      icon: ic('homework'),     desc: 'Classroom homework',            render: () => <HomeworkView defaultType="homework" /> })
    sections.push({ key: 'announcements', label: 'Announcements', icon: ic('announcement'), desc: 'Notices to classes',            render: () => <HomeworkView defaultType="announcement" /> })
    sections.push({ key: 'material',      label: 'Study Material',icon: ic('material'),     desc: 'Shared study resources',        render: () => <HomeworkView defaultType="resource" /> })
  }
  if (flagOn(features, 'timetable'))  sections.push({ key: 'timetable',  label: 'Timetable',  icon: ic('timetable'), desc: 'Weekly schedules and teachers',      render: () => <TimetableView /> })
  if (flagOn(features, 'exams'))      sections.push({ key: 'exams',      label: 'Exams',      icon: ic('exams'),     desc: 'Terms, marks and results',           render: () => <ExamView role={role} /> })
  if (isPrincipal) sections.push({ key: 'payroll', label: 'Payroll', icon: ic('staff'), desc: 'Staff salaries, class assignments and monthly payslips', render: () => <PayrollView /> })
  if (isPrincipal && flagOn(features, 'cms')) sections.push({ key: 'cms', label: 'Website', icon: ic('website'), desc: 'Public site pages and announcements', render: () => <CmsAdminView /> })
  if (isPrincipal) sections.push({ key: 'settings', label: 'Settings', icon: ic('settings'), desc: 'School profile and payment settings', render: () => <SettingsView /> })

  return base(isPrincipal ? 'Principal' : 'Vice-Principal', sections)
}
