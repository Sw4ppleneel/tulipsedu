# CLAUDE.md

This file provides strict, non-negotiable architectural guidance to Claude Code when editing, refactoring, or generating code within this repository.

# ⚠️ Current Data State (updated 2026-07-20)

Real onboarding has started. **Not all four live tenants are the same anymore** —
check the slug before touching anything.

## 🔒 `daffodilspublicschool` (DPS) and `premchandmahtoic` (PMIC) — REAL DATA. DO NOT TOUCH.

Both carry real students, real staff, real parents, and real fee amounts — DPS has 401
real students with a real fee structure and ₹-denominated ledger; PMIC has a real
imported teacher roster. As of 2026-07-18 the parent portal on both requires a real
password (`feature_flags.parent_password`), and real families are actively logging in.

**Rule: no ad-hoc data mutation, reset, wipe, regeneration, or test/seed script may run
against these two tenants without the owner explicitly authorizing that specific
operation in the moment.** This includes anything that was previously routine on mock
data — `reset_and_import_*`, fee regeneration, bulk password rotation, deleting/recreating
students, etc. Before running any one-off script or destructive operation anywhere in this
repo, check which tenant(s) it targets; if it's DPS or PMIC, stop and confirm with the
owner first, even if the operation looks the same as one that's been run safely before on
mock data. Reversible, tenant-scoped, read-only, and additive operations (e.g. a single
parent's phone-number correction the owner asked for) are fine — the rule is about
*unprompted or destructive* operations, not all interaction with these tenants.

## `premchandhighschool` and `vivekmemorialhighschool` — status unconfirmed

Both show a flat, round 30-student roster with zero placeholder phone numbers — this
looks like leftover seed/demo data rather than a real import, but it was never explicitly
confirmed either way (as of 2026-07-18). **Do not assume either way — verify with the
owner before doing anything destructive here too**, and update this section once
confirmed (mock → keep as a safe testing ground; real → fold into the DO NOT TOUCH rule
above).

## Keep this section current

Update it the moment another tenant's data state changes (new real onboarding, or a
confirmation that a tenant is still mock). Don't let it go stale like the previous
version of this note did — it said "all mock" for a month after DPS and PMIC went real.

# Project Overview

Tulips.edu is a multi-tenant School ERP SaaS built for rural and semi-urban Indian institutions (500–5,000 students).

Primary goals:

* Ultra-lightweight client footprint (<2 MB bundle target)
* Low-cost infrastructure (~₹2,000/month target)
* Offline-first attendance workflows
* Multi-tenant isolation
* Single codebase deployment
* Fast operation on low-end Android devices and unstable 3G/4G networks

---

# Development Philosophy

Priorities are ranked in this order:

1. Correctness
2. Security
3. Architectural Consistency
4. Maintainability
5. Performance
6. Development Speed

Do not sacrifice tenant isolation, data integrity, or security for implementation convenience.

---

# Phase 1 MVP Scope

IN SCOPE:

* Authentication & Authorization
* Multi-Tenant Infrastructure
* Student Management
* Staff Management
* ClassSwipe Attendance
* Finance & Fee Collection
* Homework & Classroom Feed
* Timetable Engine
* Examination Management
* Parent Portal
* Public Website CMS

OUT OF SCOPE:

* Library Management
* Asset Management
* Payroll
* HR Systems
* Transport Management
* GPS Tracking

HOSTEL RULE:

Only support:

* is_hosteler BOOLEAN

Do not build:

* Room allocation
* Bed assignment
* Warden workflows
* Hostel inventory systems

unless explicitly approved.

---

# Project Memory System

Two files act as persistent project memory.

## ARCHITECTURE.md

Source of truth for:

* System architecture
* Database schemas
* API catalog
* Event catalog
* Third-party integrations
* Deployment topology
* Major architectural decisions

## BUILD.md

Source of truth for:

* Current sprint
* Current TODOs
* Completed work
* Known issues
* Blockers
* Next recommended task

Before every implementation session:

1. Read BUILD.md
2. Read ARCHITECTURE.md
3. Determine project state
4. Continue from existing work

---

# Session Workflow

At the beginning of every session provide:

PROJECT STATE

Current Phase:
Current Sprint:
Completed:
In Progress:
Blocked:
Next Task:

Before implementation:

* Explain plan
* List affected files
* List migrations
* List APIs
* List events

After implementation:

Update:

* BUILD.md
* ARCHITECTURE.md

Then provide:

WORK COMPLETED

Files Modified:
APIs Added:
Events Added:
Remaining Tasks:

---

# Mandatory Approval Gates

Stop and ask for approval before:

* Changing database schemas
* Adding dependencies
* Adding paid services
* Adding new top-level folders
* Modifying authentication architecture
* Modifying tenant isolation architecture
* Modifying deployment topology

Do not proceed automatically.

---

# Multi-Tenancy Requirements

Every tenant-owned table must contain:

tenant_id

All read and write queries must remain tenant-scoped.

All composite indexes must begin with tenant_id.

Examples:

(tenant_id, current_unit)

(tenant_id, created_at)

(tenant_id, status)

Cross-tenant access must be blocked by middleware validation.

Tenant feature differences must be controlled using feature flags.

Never create separate deployments per institution.

---

# Event-Driven Architecture

Every state-changing operation must emit an event.

Examples:

STUDENT_CREATED

STAFF_CREATED

STAFF_AUTHENTICATED

ATTENDANCE_MARKED

FEE_COLLECTED

HOMEWORK_ASSIGNED

EXAM_PUBLISHED

PARENT_LOGIN

Events must be documented in ARCHITECTURE.md.

No undocumented events.

---

# Database Rules

Use PostgreSQL.

Use versioned migrations.

Never modify schemas directly.

Example:

migrations/
001_initial.sql
002_auth.sql
003_students.sql

Every migration must be reversible.

All multi-step operations must execute inside explicit transactions.

Examples:

* Academic Year Rollover
* Fee Collection
* Bulk Attendance Processing

---

# Backend Rules

Use asynchronous execution.

Preferred stack:

* FastAPI
* asyncpg
* PostgreSQL

Never block request threads with:

* SMS sending
* Email sending
* PDF generation
* External API calls

Use background workers.

Target:

Return client response immediately.

Use 202 Accepted where appropriate.

Precompute expensive aggregates during writes.

Avoid expensive runtime calculations.

---

# Frontend Rules

Preferred stack:

* Preact
* Vite
* TypeScript

Use:

* Virtualized lists for collections larger than 50 items
* Hardware accelerated transforms
* IndexedDB for offline queues
* Service workers where appropriate

Avoid:

* Large UI frameworks
* Heavy animation libraries
* Custom font packages
* Large icon libraries

Use system fonts only.

---

# Offline First Requirements

Attendance must function without connectivity.

Workflow:

User Action
→ Local Storage / IndexedDB
→ Immediate UI Update
→ Background Sync

Network availability must not block attendance marking.

---

# File Upload Rules

Never proxy uploads through application servers.

Required flow:

Client
→ Presigned Upload URL
→ Cloudflare R2

Store only metadata and object URLs in PostgreSQL.

No binary file storage inside application containers.

---

# Security Requirements

No plaintext passwords.

Use password hashing.

No secrets committed to source control.

No PII inside debug logs.

Tenant boundaries must be validated on every request.

Audit events are immutable.

Uploads must use secure presigned URLs.

---

# Testing Rules

For MVP scaffolding:

* Tests encouraged
* Critical path tests preferred

For release candidates:

Required:

* Unit Tests
* Integration Tests
* Authentication Tests
* Tenant Isolation Tests
* Attendance Tests
* Fee Collection Tests

Critical business flows must be validated before release.

---

# Definition of Done

A task is complete only if:

* Implementation finished
* Code compiles
* Migration created (if required)
* APIs documented
* Events documented
* BUILD.md updated
* ARCHITECTURE.md updated
* Manual verification steps recorded

---

# Development Strategy

Build vertical slices.

For each feature:

Database
→ API
→ Frontend
→ Testing
→ Documentation

Finish one feature before starting another.

Priority Order:

1. Authentication & Tenant Isolation
2. Student Management
3. Staff Management
4. Attendance
5. Finance
6. Homework & Feed
7. Timetable
8. Examinations
9. Parent Portal
10. CMS

Never start future modules before the current slice is functional.

---

# Production Deployment

Server: `swap@62.72.13.103`, repo lives at `~/tulips/`.

## Branch model & pre-flight discipline (mandatory going forward)

Two long-lived branches on `origin` (GitHub `Sw4ppleneel/tulipsedu`):

* **`dev`** — active development; all feature work branches off and merges back here.
* **`prod`** — mirrors what is currently deployed on `62.72.13.103`. Only fast-forwarded
  from `dev` at deploy time.

Two non-negotiable pre-flight steps:

1. **Commit + push git before any rsync/deploy.** `scripts/deploy.sh` rsyncs the working
   tree to prod — never rsync code that isn't committed and pushed first, so the deployed
   state is always recoverable from git. Update `prod` to the deployed commit after a
   successful deploy.
2. **Back up the prod DB before any destructive DB operation** (wipes, bulk
   regenerations, migrations that drop/alter data). Run `ssh swap@62.72.13.103 "bash
   ~/tulips/scripts/backup_db.sh"` and confirm a fresh `~/tulips/backups/tulipsedu-*.sql.gz`
   exists before proceeding. `scripts/deploy.sh` already backs up before migrations; this
   rule covers ad-hoc destructive operations run outside the deploy path.

## The only way to deploy

```bash
scripts/deploy.sh                   # full deploy (gate + backend + frontend)
scripts/deploy.sh --frontend-only   # skip gate + backend build
scripts/deploy.sh --backend-only    # skip frontend build
scripts/deploy.sh --skip-gate       # DANGEROUS — only if gate environment is broken
```

**Never rsync + docker manually.** `scripts/deploy.sh` is the single entry point.
It enforces all five safeguards automatically.

## Five safeguards (in order)

| # | Safeguard | Failure action |
|---|-----------|----------------|
| 1 | **Pre-deploy gate** — L1 write-path suite (`pytest -m "not live"`) in a disposable docker stack | Aborts before touching prod |
| 2 | **Migration check + DB backup** — detects pending migrations; takes a `backup_db.sh` snapshot before the migration lands | Aborts if backup fails |
| 3 | **Rsync** | Aborts on network/permission error |
| 4 | **Health check with rollback** — polls `/health` 20 × 3 s; if backend never responds, re-tags `tulips-backend:rollback` and restores it | Auto-rollback to previous image |
| 5 | **Smoke tests** — `scripts/smoke_test.sh` checks backend + nginx endpoints | Exits non-zero with a warning |

## Manual rollback (if needed after a deploy)

```bash
ssh swap@62.72.13.103 "cd ~/tulips && \
  docker tag tulips-backend:rollback tulips-backend:latest && \
  docker compose -f docker-compose.prod.yml up -d --no-build backend worker"
```

To restore from a DB backup (last resort — only if migration corrupted data):

```bash
# List available backups
ssh swap@62.72.13.103 "ls -lh ~/tulips/backups/"
# Restore
ssh swap@62.72.13.103 \
  "gunzip -c ~/tulips/backups/tulipsedu-YYYY-MM-DD-HHMM.sql.gz | \
   docker exec -i tulips-postgres-1 psql -U tulips -d tulipsedu"
```

## Live-data audit (daily cron on prod)

`backend/scripts/audit_live_tenants.py` runs 13 read-only invariant checks over every real tenant
and exits non-zero on any violation. Installed crontab entry:

```
0 2 * * *  docker exec tulips-backend-1 python scripts/audit_live_tenants.py >> ~/tulips/audit.log 2>&1 || echo "LIVE AUDIT FAILED $(date)" >> ~/tulips/audit-alerts.log
```

Check `~/tulips/audit-alerts.log` for violations.

## rsync inode warning — DO NOT ignore

`rsync` creates a **new inode** when it overwrites a file. Docker bind-mounts are attached to
the **original inode**. `scripts/deploy.sh` handles this by always restarting nginx after
a frontend build. If you ever rsync manually, restart nginx:

```bash
docker compose -f docker-compose.prod.yml restart nginx
```

## Health check (manual)

```bash
ssh swap@62.72.13.103 "docker exec tulips-backend-1 \
  python -c \"import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read().decode())\""
```

---

# Success Criteria

The goal is not to generate the most code.

The goal is to produce a maintainable, secure, production-grade School ERP capable of serving multiple institutions from a single deployment while remaining lightweight, cost-efficient, and reliable under real-world rural network conditions.
