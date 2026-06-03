# ARCHITECTURE.md

# Current Reality

Implemented:
- Multi-tenant database schema (tenants, users, audit_events)
- JWT authentication with tenant isolation middleware
- Auth API: login / refresh / logout
- Event audit framework (STAFF_AUTHENTICATED)
- Migration runner
- Preact + Vite frontend shell with IndexedDB abstraction and service worker

Partially Implemented:
- Frontend: login form built, dashboard not yet built

Planned:
- Student Management
- Staff Management
- Attendance (offline-first)
- Finance
- Homework & Feed
- Timetable
- Examinations
- Parent Portal
- CMS

---

# System Overview

Tulips.edu is a multi-tenant School ERP SaaS platform designed for rural and semi-urban institutions.

Primary Constraints:

* Single codebase
* Multi-tenant architecture (shared DB, logical isolation by tenant_id)
* Offline-first attendance
* Sub-2MB frontend bundle target
* Low-cost deployment (~₹2,000/month)
* Low-end Android compatibility

---

# Technology Stack

## Backend

Framework: FastAPI
Language: Python 3.11+
Database: PostgreSQL 16
Driver: asyncpg
Authentication: JWT (python-jose, HS256)
Password Hashing: bcrypt (passlib)
Config: pydantic-settings
Background Jobs: TBD

## Frontend

Framework: Preact
Build Tool: Vite
Language: TypeScript
Offline Storage: IndexedDB
Caching: Service Worker

## Infrastructure

Reverse Proxy: Nginx
Containerization: Docker
Storage: Cloudflare R2 (planned)
Hosting: TBD
SSL: Let's Encrypt

---

# Folder Structure

```
Tulips.edu/
├── backend/
│   ├── api/v1/          Route handlers
│   ├── core/            security.py, events.py
│   ├── db/              asyncpg pool
│   ├── middleware/       tenant.py
│   ├── models/          Pydantic models
│   ├── services/         Business logic
│   ├── main.py
│   └── config.py
├── frontend/
│   ├── public/          sw.js, manifest.json
│   └── src/
│       ├── api/         HTTP client
│       ├── db/          IndexedDB abstraction
│       └── types/       TypeScript interfaces
├── migrations/          Versioned SQL files (001_, 002_, …)
├── scripts/             apply_migrations.py, seed_tenant.py
├── tests/
├── docs/
├── docker-compose.yml
└── nginx.conf
```

---

# Multi-Tenant Architecture

Strategy: Shared database, logical isolation by `tenant_id`.

Tenant resolution (in order):
1. `X-Tenant-Slug` request header (local dev / testing override)
2. Subdomain: `school1.tulipsedu.in` → slug = `school1`

Every request to a protected endpoint:
1. Middleware resolves slug → tenant row → sets `request.state.tenant_id`
2. JWT is decoded; `tenant_id` claim must match resolved tenant
3. Mismatch → 403 (logged with warning)

JWT-exempt paths (tenant resolution still runs, JWT validation skipped):
- `/api/v1/auth/login`
- `/api/v1/auth/refresh`
- `/api/v1/auth/logout`

Fully exempt paths (no DB lookup):
- `/health`

---

# Core Database Schema

## schema_migrations

Purpose: Migration tracking (managed by apply_migrations.py)

Fields:
* version (PK)
* applied_at

---

## tenants

Purpose: Institution registry

Fields:
* id (UUID PK)
* slug (VARCHAR 63, UNIQUE)
* name (VARCHAR 255)
* institution_type (VARCHAR 50, default 'school')
* feature_flags (JSONB)
* created_at

Indexes:
* UNIQUE (slug)

---

## users

Purpose: Staff and admin accounts. Phone number is the login identifier.

Fields:
* id (UUID PK)
* tenant_id (FK → tenants.id CASCADE)
* phone_number (VARCHAR 15)
* password_hash (VARCHAR 255)
* role (VARCHAR 50) — 'admin', 'teacher', 'staff', 'parent'
* is_active (BOOLEAN)
* created_at

Indexes:
* UNIQUE (tenant_id, phone_number)
* (tenant_id, created_at)
* (tenant_id, role)

---

## audit_events

Purpose: Immutable event log. Never updated, never deleted.

Fields:
* id (BIGSERIAL PK)
* tenant_id (FK → tenants.id CASCADE)
* event_type (VARCHAR 100)
* payload (JSONB)
* created_at

Indexes:
* (tenant_id, created_at)
* (tenant_id, event_type)

---

# Planned Modules

## Student Management

Status: Next
Schema: students (tenant_id, admission_no, name, class_id, section_id, is_hosteler, …)

## Staff Management

Status: Planned

## Attendance

Status: Planned
Notes: Offline-first. Queue in IndexedDB, sync in background.

## Finance

Status: Planned

## Homework & Feed

Status: Planned

## Timetable

Status: Planned

## Examinations

Status: Planned

## Parent Portal

Status: Planned

## CMS

Status: Planned

---

# Event Catalog

## STAFF_AUTHENTICATED

Producer: Authentication Service (services/auth.py)
Consumers: Audit Engine
Payload:
* tenant_id
* user_id
* timestamp (auto-set by created_at)

---

## STUDENT_CREATED (planned)

Producer: Student Service
Consumers: Audit Engine
Payload:
* tenant_id
* student_id
* timestamp

---

## ATTENDANCE_MARKED (planned)

Producer: Attendance Service
Consumers: Audit Engine, Analytics Engine
Payload:
* tenant_id
* student_id
* status
* timestamp

---

## FEE_COLLECTED (planned)

Producer: Finance Service
Consumers: Audit Engine, Reporting Engine
Payload:
* tenant_id
* student_id
* amount
* timestamp

---

# API Catalog

## Authentication

### POST /api/v1/auth/login
Status: Implemented
Auth: none (JWT-exempt)
Body: `{ phone_number, password }`
Response: `{ access_token, refresh_token, token_type }`
Events: STAFF_AUTHENTICATED

### POST /api/v1/auth/refresh
Status: Implemented
Auth: none (JWT-exempt)
Body: `{ refresh_token }`
Response: `{ access_token, refresh_token, token_type }`

### POST /api/v1/auth/logout
Status: Implemented
Auth: none (JWT-exempt)
Response: `{ detail: "Logged out" }`
Notes: Stateless — client discards tokens. Future: refresh token blocklist.

---

# Third-Party Integrations

## Cloudflare R2

Purpose: Document and media storage
Status: Planned
Notes: Never proxy uploads through app server; use presigned URLs.

## SMS Provider

Purpose: Parent notifications
Status: Planned
Provider: TBD

## Payment Gateway

Purpose: Online fee collection
Status: Planned
Provider: TBD (Razorpay likely)

---

# Deployment Topology

```
Internet
  ↓
Nginx (subdomain routing: school1.tulipsedu.in)
  ↓
FastAPI (port 8000)
  ↓
PostgreSQL (port 5432)
  ↓
Background Workers (TBD)
  ↓
Cloudflare R2
```

Local dev: `docker compose up postgres` + `uvicorn main:app --reload --port 8000` + `npm run dev`

---

# Performance Constraints

Frontend Bundle: < 2 MB
Attendance: Offline-first
List Rendering: Virtualized above 50 rows
Media: Presigned uploads only
Database: Tenant-first indexing on all composite indexes
API: Async only (no blocking I/O in request handlers)

---

# Security Rules

* Tenant isolation on every request (middleware enforced)
* JWT tenant_id claim validated against subdomain on every protected request
* Password hashing: bcrypt
* No plaintext secrets in source or logs
* No PII in log output
* Audit events are immutable (append-only)
* File uploads via presigned URLs only (when implemented)

---

# Future Decisions

Reserved for approved architectural changes.
