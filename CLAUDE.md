# CLAUDE.md

This file provides strict, non-negotiable architectural guidance to Claude Code when editing, refactoring, or generating code within this repository.

# ⚠️ Current Data State (2026-06-19)

**ALL DATA — including everything on PRODUCTION (`swap@62.72.13.103`) — is MOCK/seed data.**
There are no real students, parents, staff, fees, or payments yet; the four live tenants
(`daffodilspublicschool`, `premchandhighschool`, `premchandmahtoic`, `vivekmemorialhighschool`)
are seeded demos for testing and demos. Consequences:

* Destructive prod data operations (wiping/regenerating fees, deleting students, etc.) are
  **low-risk right now** — but still confirm scope and keep operations tenant-scoped + reversible.
* No real PII or real money is involved yet; the ₹1 "test" fees and seed logins are deliberate.
* **Revisit this note before first real onboarding.** Once a real institution's data lands on
  prod, this section must be removed and prod data treated as production-grade (no ad-hoc mutations).

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

## Pre-deploy gate (run BEFORE any deploy)

```bash
scripts/predeploy_gate.sh && <deploy sequence below>
```

Builds a disposable backend+Postgres from the current source and runs the L1 write-path
suite (`pytest -m "not live"`, ephemeral `qa-test` tenant, cascade-cleaned). Exits non-zero on
any red test — only deploy if it passes. Never touches prod. The L3 live-data audit is separate
(read-only, runs on cron — see below).

## Live-data audit (daily cron on prod)

`backend/scripts/audit_live_tenants.py` runs 13 read-only invariant checks over every real tenant
and exits non-zero on any violation. Installed crontab entry:

```
0 2 * * *  docker exec tulips-backend-1 python scripts/audit_live_tenants.py >> ~/tulips/audit.log 2>&1 || echo "LIVE AUDIT FAILED $(date)" >> ~/tulips/audit-alerts.log
```

Check `~/tulips/audit-alerts.log` for violations (wire to a real alert channel later).

## rsync inode warning — DO NOT ignore

`rsync` creates a **new inode** when it overwrites a file, even if the content is identical.
Docker bind-mounted files (e.g. `nginx.prod.conf`, `index.html`) are attached to the
**original inode**. After an rsync overwrite the container still sees the old file; the
new one is orphaned on disk.

**Rule**: After any rsync push, always run:

```bash
docker compose -f docker-compose.prod.yml restart nginx
```

For config files that are bind-mounted, prefer writing in-place on the server:

```bash
ssh swap@62.72.13.103 "cat > ~/tulips/nginx.prod.conf" < nginx.prod.conf
```

This overwrites the same inode and Docker picks it up without a restart.

## Standard deploy sequence (backend-only change, no migration, no frontend)

```bash
rsync -az --exclude='backend/.env' --exclude='backend/.venv' \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='frontend/node_modules' --exclude='frontend/dist' \
  ~/Tulips.edu/ swap@62.72.13.103:~/tulips/

ssh swap@62.72.13.103 "cd ~/tulips && \
  docker compose -f docker-compose.prod.yml build backend && \
  docker compose -f docker-compose.prod.yml up -d backend"
```

## Full deploy (migration + backend + frontend)

```bash
# rsync (same exclusions as above)
ssh swap@62.72.13.103 "cd ~/tulips && \
  docker compose -f docker-compose.prod.yml build backend worker && \
  docker compose -f docker-compose.prod.yml up -d backend && \
  docker compose -f docker-compose.prod.yml run --rm frontend_build && \
  docker compose -f docker-compose.prod.yml restart nginx"
```

## Health check (no curl in slim image)

```bash
ssh swap@62.72.13.103 "docker exec tulips-backend-1 \
  python -c \"import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read().decode())\""
```

---

# Success Criteria

The goal is not to generate the most code.

The goal is to produce a maintainable, secure, production-grade School ERP capable of serving multiple institutions from a single deployment while remaining lightweight, cost-efficient, and reliable under real-world rural network conditions.
