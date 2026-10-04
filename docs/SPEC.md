# GOSSA System Specification

**Status:** v1 product and engineering baseline
**Audience:** Coding agents, engineers, and reviewers
**Product:** GOSSA, a single-garage workshop operations application

## 1. Purpose and repository baseline

GOSSA v1 lets a garage owner keep a mechanic roster, create and assign repair jobs, and track work through a small operational lifecycle. The application must use persistent storage. A frontend mockup, hard-coded dashboard, or browser-only store is not a completed implementation.

The repository currently has a minimal React/Vite frontend at the repository root (`src/`, `index.html`) and does not yet implement the API, database, authentication, or product UI. Implement the server in a new root-level `server/` directory; do not move the existing frontend. See the root `AGENTS.md` for the pinned stack and coding-agent instructions.

## 2. v1 scope

### 2.1 In scope

- One garage and one owner account.
- Owner login, logout, and current-session lookup.
- Garage settings and a dashboard.
- Mechanic roster records (mechanics do not log in).
- Repair job creation, mechanic assignment, simple status transitions, history, search, filters, sorting, and pagination.
- Server-side validation, role/access checks, tenant isolation, optimistic concurrency, database migrations, and focused automated tests.
- Responsive, usable owner-facing React application with clear loading, empty, and error states.

### 2.2 Explicitly out of scope for v1

- Inventory, parts purchasing, billing, estimates, invoices, payments, taxes, accounting, and all money fields/calculations.
- Mechanic logins, staff accounts, invitations, multiple user roles, and public user registration.
- Customer and vehicle master records, customer portals, and customer self-service. Store the customer/vehicle details needed for each job directly on that job as a historical snapshot.
- Multi-garage users, garage switching, multi-garage reporting, and tenant provisioning over a public API.
- Notifications, integrations, and mobile-native applications.

Do not add out-of-scope fields, endpoints, UI, or dependencies preemptively.

## 3. Users, garage, and access

### 3.1 Garage entity

The database has exactly one garage in v1. Define a `garages` table with:

| Field | Type and rules |
|---|---|
| `id` | Opaque immutable ID, primary key. |
| `name` | Required trimmed string, 1-120 characters. |
| `time_zone` | Required valid IANA time-zone name, maximum 64 characters. |
| `created_at`, `updated_at` | UTC timestamps. |
| `version` | Positive integer, starts at 1. |

Every owner, mechanic, job, history record, and audit record has a server-assigned `garage_id` referencing this row. Never accept a client-supplied tenant ID as authorization. Keep tenant predicates in every database read/write, relationship lookup, search, aggregate, and background task even though v1 provisions only one garage. This preserves isolation if the product later grows.

### 3.2 Owner authentication

- There is exactly one `owner` user associated with the one garage. Only the owner can authenticate and use the application.
- Do not implement roles, mechanic credentials, staff accounts, public registration, or garage selection.
- Create the initial garage and owner using the idempotent command `npm --prefix server run bootstrap:owner`. It reads the garage name, time zone, owner name/email, and password from interactive secure input or documented environment variables, hashes the password, refuses to overwrite an existing owner, and never prints the password. Do not seed a default production password.
- Use server-managed sessions in the application-owned PostgreSQL sessions table; do not use `express-session`. Store a cryptographically random session ID hash, owner ID, the session's cryptographically random CSRF token itself (not only its hash), creation time, last activity time, idle expiry, absolute expiry, and revocation time. Generate a new session ID and CSRF token after successful login; never accept a session ID supplied in a URL or request body.
- The sessions table stores at least `id` (opaque row ID), `session_id_hash` (unique), `owner_user_id`, `csrf_token` (random secret), `created_at`, `last_activity_at`, `idle_expires_at`, `absolute_expires_at`, and nullable `revoked_at`. Index the session ID hash and expiry/revocation fields needed for lookup and cleanup. Never log session or CSRF token values.
- Set the session cookie as `HttpOnly; SameSite=Lax`; set `Secure` in production. Use a host-only cookie (no `Domain`) and `Path=/`. Enforce an 8-hour sliding idle lifetime and a 7-day absolute lifetime; activity may extend idle expiry but never beyond absolute expiry. Expired/revoked sessions are invalid, and logout revokes the current row and clears the cookie.
- Return the session-bound CSRF token in login and current-session responses. Require it in the `X-CSRF-Token` header for every state-changing authenticated request, including logout, and compare it in constant time. A missing/invalid token returns `403 CSRF_FAILED`; this response does not reveal whether a tenant resource exists.
- Use a same-origin deployment. In development, Vite proxies `/api` to Express. In production, Express serves the built frontend and API from the same origin. Do not enable cross-origin requests by default; the CORS allowlist is empty unless a separately approved deployment requires specific origins.
- The development API listens on port `3000` by default; Vite proxies `/api` to `http://localhost:3000`. In production, Express serves the repository-root frontend build output (`dist/`) after API routes are registered.
- A refresh-token flow does not exist in v1; do not issue refresh tokens or add refresh endpoints.
- Login failures must use a generic response that does not reveal whether an account exists. Rate-limit login attempts and use a maintained password-hashing library (Argon2id preferred).
- All application API routes require the authenticated owner session. Unauthenticated requests return `401 UNAUTHENTICATED`.

### 3.3 Mechanic roster

Mechanics are roster records, not system users; they have no password, session, or login endpoint. Only the owner manages the roster.

Owner user fields: `id`, `garage_id` (unique; only one owner per garage), `name` (required, 1-120 characters), `email` (required, valid, maximum 254 characters, normalized to lowercase and unique), `password_hash`, `created_at`, `updated_at`, and `version`. The login request password must contain 12-128 characters; never truncate passwords.

Mechanic fields: `id`, `garage_id`, `name`, optional `phone`, optional `skills`, stored `duty_status`, `created_at`, `updated_at`, `version`, and optional `archived_at`.

The three `duty_status` values are:

- `available`: can be assigned work.
- `busy`: currently assigned to a job in `in_progress`; maintained by the server as a stored value, never directly set by an API client.
- `off_duty`: owner-designated unavailable mechanic; cannot be assigned new work.

Update `duty_status` in the same database transaction as every job assignment, transition, or archival change that affects it. A mechanic assigned to at least one `in_progress` job is `busy`; otherwise the mechanic is `available` or owner-designated `off_duty`. Transactions must preserve the invariant that a mechanic cannot have more than one `in_progress` job. A mechanic cannot be set off duty while working a job. Mechanic roster changes never create or modify user accounts. Increment the mechanic's version whenever its stored duty status changes.

## 4. Jobs and lifecycle

### 4.1 Job record

A job contains a snapshot of identifying details rather than foreign keys to customer/vehicle master records. This avoids inconsistent `customer_id`/`vehicle_id` relationships and preserves the job details even if the customer or vehicle changes later.

Job fields:

| Field | Type and rules |
|---|---|
| `id` | Opaque immutable ID, primary key. |
| `garage_id` | Server-assigned tenant ID. |
| `job_number` | Server-generated, unique within garage, format `JC-YYYY-NNN` with a sequence that can grow beyond three digits. `YYYY` is the current year in the garage's configured time zone; the sequence is per garage per year. |
| `status` | One of `open`, `in_progress`, `waiting`, `completed`, `cancelled`. |
| `customer_name` | Required trimmed string, 1-160 characters. |
| `customer_phone` | Optional trimmed string, maximum 32 characters. |
| `vehicle_registration` | Required trimmed display string, 1-32 characters; normalize for search. |
| `vehicle_make` | Optional string, maximum 80 characters. |
| `vehicle_model` | Optional string, maximum 80 characters. |
| `vehicle_year` | Optional integer from 1886 through the current year + 1. |
| `odometer_km` | Optional non-negative integer. |
| `work_requested` | Required trimmed string, 1-4000 characters. |
| `diagnosis` | Optional trimmed string, maximum 4000 characters. |
| `work_performed` | Optional trimmed string, maximum 4000 characters. |
| `internal_notes` | Optional trimmed string, maximum 4000 characters. |
| `assigned_mechanic_id` | Optional mechanic ID belonging to this garage. |
| `created_by_user_id` | Server-assigned owner user ID. |
| `created_at`, `updated_at` | UTC timestamps. |
| `version` | Positive integer, starts at 1. |
| `archived_at` | Optional UTC timestamp; archive rather than hard-delete. |

There are no money, estimate, invoice, parts, approval, or line-item fields in v1.

### 4.2 Status transitions

| Current status | Allowed next status |
|---|---|
| `open` | `in_progress`, `cancelled` |
| `in_progress` | `waiting`, `completed`, `cancelled` |
| `waiting` | `in_progress`, `cancelled` |
| `completed` | None (terminal). |
| `cancelled` | None (terminal). |

Only the server applies transitions. Every successful transition appends a history record with `id`, `garage_id`, `job_id`, `actor_user_id`, `from_status`, `to_status`, optional `note`, and `created_at`. History is append-only and retained indefinitely in v1; do not delete history when a job or mechanic is archived. Archived jobs remain available by ID, including their history. A transition to `in_progress` requires an assigned mechanic whose stored duty status is `available`.

#### Assignment rules

- Assignment and unassignment are allowed only for non-archived jobs in `open`, `waiting`, or `in_progress`. Terminal (`completed`, `cancelled`) or archived jobs cannot be assigned or unassigned.
- A mechanic may be assigned to `open` or `waiting` jobs while `busy`, allowing work to be queued. Assignment is rejected if the mechanic is `off_duty` or archived. Assignment alone does not change duty status.
- A job entering or resuming `in_progress` must have an assigned, non-archived mechanic with stored status `available`. If the mechanic is already `busy`, return `409 MECHANIC_OCCUPIED`.
- Assignment on a job that is already `in_progress` is allowed only if the new mechanic is not already busy with another in-progress job; since the mutation immediately affects an active job, reject a busy mechanic with `409 MECHANIC_OCCUPIED`. Unassigning an `in_progress` job is rejected with `409 ACTIVE_JOB_CANNOT_BE_UNASSIGNED`.
- An unknown, archived, or foreign-garage `mechanic_id` is a validation failure: return `422 VALIDATION_ERROR` with a safe field detail for `mechanic_id`. Do not reveal whether a foreign-garage mechanic exists.
- In one transaction, every job change that affects occupancy updates the job, history where applicable, and all affected mechanics' stored `duty_status` and `version`. Keep `assigned_mechanic_id` on completed and cancelled jobs as historical assignment data.

## 5. Validation and data rules

- Trim text input and reject empty required values, invalid types, unknown fields, oversized request bodies, and invalid enum values. Never silently truncate. Unknown body fields return `422 VALIDATION_ERROR`; malformed JSON/query syntax remains `400 BAD_REQUEST`.
- For `PATCH`, omitted fields remain unchanged; nullable optional fields explicitly set to `null` are cleared; required fields cannot be set to `null`.
- Request and response JSON uses `snake_case`.
- Validate phone numbers permissively for international formats; do not assume a country. Validate `time_zone` against IANA time-zone data.
- Normalize vehicle registration for searching and duplicate detection by trimming, uppercasing, and removing internal whitespace and separator punctuation. Preserve the submitted display form. Within the garage, reject a job create or registration edit if another non-archived job has the same normalized registration and is not `completed` or `cancelled`; return `409 DUPLICATE_ACTIVE_VEHICLE_JOB`. Enforce this with a PostgreSQL partial unique index on `(garage_id, normalized_vehicle_registration)` for non-archived jobs whose status is not `completed` or `cancelled`. Historical completed/cancelled jobs may share a registration.
- Archived jobs and mechanics are excluded from list responses by default. `include_archived=true` includes them in lists. Direct `GET` by ID returns an archived record to the authorized owner; archiving does not make the record inaccessible or remove its history.
- Store timestamps in UTC and return ISO 8601 strings. Render them in the garage's configured time zone.
- IDs and `garage_id` are immutable. Use database foreign keys, tenant-aware uniqueness constraints, and indexes for tenant ID, job status/update time, job number, normalized registration, mechanic assignment/status, and foreign keys.
- Apply optimistic concurrency to updates, assignment changes, transitions, and archival. Every successful mutation increments the affected record's `version`.
- Use versioned database migrations, safe for existing data. Do not use destructive production schema auto-sync.
- Log useful request context and request IDs, but never passwords, cookies, authorization/session tokens, or unnecessary personal data.

## 6. HTTP API contract

### 6.1 Conventions

- Base path: `/api/v1`. Deployed environments use HTTPS.
- JSON request and response bodies use UTF-8 and `Content-Type: application/json`.
- `GET` reads, `POST` creates or performs an explicit action, `PATCH` partially updates, and `DELETE` is not used for operational records; use archive actions/fields.
- Creation returns `201 Created` with a `Location` header. Successful updates/actions return `200 OK` with the updated resource unless noted. Logout returns `204 No Content`.
- All mutable resources expose `version` and an `ETag`, for example response header `ETag: "v2"`. Clients build `If-Match` from `version` as `"v" + version` (for example, `version: 2` becomes `If-Match: "v2"`); no additional fetch is needed before a mutation. Every `PATCH`, assignment, transition, or archive request must include `If-Match`. Missing precondition returns `428`; stale version returns `412`. Check and update atomically.
- Do not mass-assign input. Accept only fields defined for each operation. Query sort keys and filters are allowlisted.
- All list endpoints use these common query parameters:
  - `page`: positive integer, default `1`.
  - `page_size`: integer `1..100`, default `25`.
  - `sort_by`: endpoint-specific allowlist.
  - `order`: `asc` or `desc`, default `desc`.
- List response. Results use stable ordering with an ID tie-breaker; reject unsupported sort keys and directions.

```json
{
  "data": [],
  "page": 1,
  "page_size": 25,
  "total": 0
}
```

- Status codes: `400` malformed JSON/query, `401` unauthenticated, `403` CSRF failure, `404` missing or foreign-tenant resource, `409` business/uniqueness conflict, `412` stale version, `422` field/domain validation, `428` missing `If-Match`, `429` rate limit, and `500` unexpected server error.
- Return `404 NOT_FOUND` for both nonexistent and foreign-tenant resources. Do not reveal whether a foreign resource exists.

### 6.2 Authentication and garage endpoints

| Method and path | Request body | Success |
|---|---|---|
| `POST /auth/login` | `{ "email": "owner@example.com", "password": "..." }`; email max 254 chars, password 12-128 chars. | `200` `{ "data": { "user": { "id": "...", "email": "...", "name": "...", "role": "owner" }, "garage": { "id": "...", "name": "...", "time_zone": "..." }, "csrf_token": "..." } }`; sets secure session cookie. |
| `POST /auth/logout` | No body; requires `X-CSRF-Token`. | `204`; revokes current session and clears cookie. |
| `GET /auth/me` | No body. | `200` `{ "data": { "user": { "id": "...", "email": "...", "name": "...", "role": "owner" }, "garage": { "id": "...", "name": "...", "time_zone": "..." }, "csrf_token": "..." } }`. |
| `GET /garage` | No body. | `200` `{ "data": { "id": "...", "name": "...", "time_zone": "...", "version": 1 } }`. |
| `PATCH /garage` | `{ "name": "Northside Garage", "time_zone": "Africa/Nairobi" }`; either field may be omitted, but at least one is required. | `200` with updated garage. Requires `If-Match`. |

`POST /auth/login` and logout are the only public/session lifecycle endpoints; there is no register, refresh, garage-selection, or refresh-token endpoint. The bootstrap command is the only initial account creation path.

### 6.3 Dashboard endpoints

| Method and path | Query/body | Success |
|---|---|---|
| `GET /dashboard` | No query parameters. | `200` `{ "data": { "open_count": 0, "in_progress_count": 0, "waiting_count": 0, "completed_today_count": 0, "recent_jobs": [] } }`. Counts and recent jobs exclude archived jobs. `completed_today_count` counts transition-history events to `completed` during the garage's local calendar day. `recent_jobs` contains at most 10 job summaries ordered by `updated_at desc`. |

Job summary shape: `{ "id": "...", "job_number": "...", "status": "open", "customer_name": "...", "vehicle_registration": "...", "assigned_mechanic": { "id": "...", "name": "..." } | null, "updated_at": "..." }`. “Today” means midnight-to-midnight in the garage's configured IANA time zone, converted to UTC bounds for database queries.

### 6.4 Mechanic endpoints

| Method and path | Request/query | Success |
|---|---|---|
| `GET /mechanics` | Common pagination; optional `q` (1-120 chars, matches name/phone), `duty_status` (`available`, `busy`, `off_duty`), `include_archived` (`true`/`false`, default `false`); `sort_by`: `name`, `created_at`, `updated_at`. | `200` paginated mechanics. |
| `POST /mechanics` | `{ "name": "Alex Mechanic", "phone": "+254700000000", "skills": "Diagnostics, brakes" }`; `name` required (1-120 chars); optional `phone` (max 32 chars) and `skills` (max 500 chars) may be omitted or null. | `201` mechanic. Initial duty status is `available`. |
| `GET /mechanics/{id}` | No body. | `200` mechanic. |
| `PATCH /mechanics/{id}` | `{ "name": "Alex M.", "phone": "+254700000000", "skills": "Diagnostics" }`; name 1-120 chars; phone max 32 chars; skills max 500 chars; at least one field required. No direct `duty_status` or `garage_id` input. | `200` mechanic. Requires `If-Match`. |
| `POST /mechanics/{id}/off-duty` | No body. | `200` updated mechanic with `duty_status: "off_duty"`. Requires `If-Match`; rejected with `409 MECHANIC_HAS_ACTIVE_JOB` if currently working. |
| `POST /mechanics/{id}/available` | No body. | `200` updated mechanic with `duty_status: "available"`. Requires `If-Match`; only changes `off_duty` to `available`. A `busy` mechanic cannot be manually set to available and returns `409 MECHANIC_HAS_ACTIVE_JOB`. |
| `POST /mechanics/{id}/archive` | No body. | `200` archived mechanic. Requires `If-Match`; rejected with `409 MECHANIC_HAS_NONTERMINAL_JOBS` if assigned to any non-terminal job (`open`, `in_progress`, or `waiting`). |

Mechanic response shape: `{ "data": { "id": "...", "garage_id": "...", "name": "...", "phone": null, "skills": null, "duty_status": "available", "created_at": "...", "updated_at": "...", "version": 1, "archived_at": null } }`.

### 6.5 Job endpoints

| Method and path | Request/query | Success |
|---|---|---|
| `GET /jobs` | Common pagination; optional `q` (1-120 chars, searches job number, customer name, and normalized registration), `status` (one exact lifecycle value), `mechanic_id`, `include_archived` (`true`/`false`, default `false`), `created_from`, `created_to` (`YYYY-MM-DD`, interpreted in garage time zone); `sort_by`: `job_number`, `status`, `created_at`, `updated_at`. Date range must be valid, `created_from` must not be later than `created_to`, and the range must be no longer than 366 days. | `200` paginated jobs. |
| `POST /jobs` | `{ "customer_name": "Sam Example", "customer_phone": "+254700000000", "vehicle_registration": "KDA 123A", "vehicle_make": "Toyota", "vehicle_model": "Corolla", "vehicle_year": 2020, "odometer_km": 85000, "work_requested": "Inspect front brakes", "internal_notes": "Call before extra work" }`. Required: `customer_name`, `vehicle_registration`, `work_requested`. Other fields optional and nullable. No client may supply `garage_id`, `job_number`, `status`, `version`, timestamps, or `created_by_user_id`. | `201` job created with `status: "open"` and unassigned mechanic. |
| `GET /jobs/{id}` | No body. | `200` job. |
| `PATCH /jobs/{id}` | `{ "customer_name": "...", "customer_phone": "...", "vehicle_registration": "...", "vehicle_make": "...", "vehicle_model": "...", "vehicle_year": 2020, "odometer_km": 85000, "work_requested": "...", "diagnosis": "...", "work_performed": "...", "internal_notes": "..." }`; any subset of editable fields, at least one required. Cannot update status, assignment, tenant, number, version, or timestamps here. Registration edits enforce the same active-job duplicate check as creation. | `200` updated job. Requires `If-Match`. |
| `POST /jobs/{id}/assignment` | `{ "mechanic_id": "opaque-id" }` to assign, or `{ "mechanic_id": null }` to unassign. | `200` updated job. Requires `If-Match`; follows all assignment rules in §4.2. Unknown, archived, or foreign-garage mechanic IDs return `422 VALIDATION_ERROR` with a `mechanic_id` field detail. |
| `POST /jobs/{id}/transitions` | `{ "to_status": "in_progress", "note": "Started inspection" }`; `to_status` required; `note` optional, maximum 500 characters. | `200` updated job. Requires `If-Match`. |
| `GET /jobs/{id}/history` | Common pagination; `sort_by` only `created_at`; `order` must be `desc` (newest first). Available for archived jobs too. | `200` paginated immutable history events. |
| `POST /jobs/{id}/archive` | No body. | `200` archived job. Requires `If-Match`; terminal jobs only. |

Job response shape:

```json
{
  "data": {
    "id": "opaque-id",
    "garage_id": "opaque-id",
    "job_number": "JC-2026-004",
    "status": "open",
    "customer_name": "Sam Example",
    "customer_phone": null,
    "vehicle_registration": "KDA 123A",
    "vehicle_make": "Toyota",
    "vehicle_model": "Corolla",
    "vehicle_year": 2020,
    "odometer_km": 85000,
    "work_requested": "Inspect front brakes",
    "diagnosis": null,
    "work_performed": null,
    "internal_notes": null,
    "assigned_mechanic_id": null,
    "created_by_user_id": "opaque-id",
    "created_at": "2026-10-04T08:15:00Z",
    "updated_at": "2026-10-04T08:15:00Z",
    "version": 1,
    "archived_at": null
  }
}
```

History response item: `{ "id": "...", "job_id": "...", "actor_user_id": "...", "from_status": "open", "to_status": "in_progress", "note": null, "created_at": "..." }`.

### 6.6 Error response contract

All errors use this JSON envelope; `status` equals the HTTP status:

```json
{
  "error": {
    "code": "MECHANIC_OCCUPIED",
    "message": "This mechanic is already assigned to an active job.",
    "status": 409,
    "timestamp": "2026-10-04T08:15:00Z",
    "request_id": "req_01J...",
    "details": []
  }
}
```

`details` is optional and, when present, contains safe field errors of shape `{ "field": "customer_name", "code": "too_long", "message": "Must be 160 characters or fewer." }`. Never include secrets, stack traces, SQL details, or foreign-tenant data.

| HTTP status | Error code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON, invalid query encoding, or malformed request syntax. |
| 401 | `UNAUTHENTICATED` | Missing, expired, or invalid session; login credentials are invalid. |
| 403 | `CSRF_FAILED` | Missing or invalid session-bound CSRF token. |
| 404 | `NOT_FOUND` | Resource is nonexistent or belongs to another tenant. |
| 409 | `CONFLICT` | Generic uniqueness or business-rule conflict. |
| 409 | `MECHANIC_OCCUPIED` | Mechanic already has another in-progress job. |
| 409 | `MECHANIC_UNAVAILABLE` | Mechanic is off duty and cannot be assigned or started. |
| 409 | `MECHANIC_HAS_ACTIVE_JOB` | Attempt to set a mechanic off duty or available while it has an in-progress job. |
| 409 | `MECHANIC_HAS_NONTERMINAL_JOBS` | Mechanic cannot be archived while assigned to open, in-progress, or waiting jobs. |
| 409 | `ACTIVE_JOB_CANNOT_BE_UNASSIGNED` | An in-progress job cannot be left without an assigned mechanic. |
| 409 | `DUPLICATE_ACTIVE_VEHICLE_JOB` | Another active job has the same normalized registration. |
| 409 | `INVALID_STATUS_TRANSITION` | Requested status transition is not allowed. |
| 412 | `PRECONDITION_FAILED` | `If-Match` version is stale. |
| 422 | `VALIDATION_ERROR` | A field or domain constraint is invalid. |
| 428 | `PRECONDITION_REQUIRED` | Required `If-Match` header is absent. |
| 429 | `RATE_LIMITED` | Request limit exceeded. |
| 500 | `INTERNAL_ERROR` | Unexpected server error; client receives no internal details. |

## 7. Concurrency and consistency

- Every mutable resource has an integer `version` starting at 1 and an `ETag` derived from it (for example, version 2 returns `"v2"`).
- Every `PATCH`, assignment, transition, or archive mutation requires `If-Match`. Missing header returns `428 PRECONDITION_REQUIRED`; stale version returns `412 PRECONDITION_FAILED` and may include the current version/ETag.
- Check the version and apply the mutation atomically. Never silently overwrite a concurrent update. The frontend refreshes and lets the owner reconcile a `412`.
- Job-number allocation, mechanic occupancy, status transitions, and history insertion must be transaction-safe. If a mutation fails, no partial history/job changes remain.
- Lock affected mechanic rows in a consistent order (or use an equivalent transaction-safe strategy) when changing assignments or job status. Enforce one in-progress job per mechanic with a PostgreSQL partial unique index on `(garage_id, assigned_mechanic_id)` where `status = 'in_progress'`, `assigned_mechanic_id IS NOT NULL`, and `archived_at IS NULL`.
- Reassignment of an in-progress job must atomically release the old mechanic, validate the new mechanic, and assign the new mechanic. Update stored mechanic duty status and increment the mechanic's version in that same transaction.

## 8. Frontend requirements

- Keep the frontend in the existing root `src/` directory. Implement sign-in, dashboard, job list/detail/create/edit, mechanic roster/list/detail/edit, assignment, status actions, and useful not-found/error states.
- Use React JSX and TanStack Query as specified in the root `AGENTS.md`. Keep API calls in a small client/service layer; keep components focused and domain rules testable.
- Show loading, empty, success, and failure states. Forms need labels, field errors, duplicate-submit prevention, and preservation of entered data after recoverable server errors.
- Search/filter/sort/page state should be reflected in the URL where practical. Use server pagination; do not download all jobs or mechanics to filter locally.
- Do not mark a transition or assignment successful before the server confirms it. On success, update/invalidate relevant job, history, mechanic, and dashboard queries; do not assume a specific cache key name.
- Render user-supplied values as text, never injected HTML. Require confirmation for job cancellation and archiving.
- Keep the UI usable on narrow and desktop screens, with semantic HTML, keyboard-operable controls, visible focus, and accessible labels.

## 9. Security, performance, and reliability

- Enforce server-side input validation, authorization, tenant scoping, and allowlisted query fields. Use parameterized SQL.
- Use HTTPS in deployment, least-privilege database credentials, secret injection, and separate development/test/production configuration. Provide a placeholder-only `.env.example`; never commit secrets.
- Use the same-origin deployment described in §3.2: Vite proxies `/api` in development and Express serves the built frontend in production. CORS is disabled by default (empty allowlist); only configure explicit origins if a separately approved deployment requires them. Never use wildcard credentialed origins.
- Store the random session-bound CSRF token in the session row as specified in §3.2. Enforce `SameSite=Lax`, `HttpOnly`, production `Secure`, host-only `Path=/` cookies, and the 8-hour idle/7-day absolute session lifetimes.
- Apply request body limits, timeouts, rate limiting for login, and structured logs with request IDs. Redact passwords, cookies, session identifiers, and personal data not needed for operations.
- Paginate list endpoints and select only required fields. Avoid N+1 database queries; index frequent tenant-scoped lookups. Do not return success-shaped empty results when dependencies fail.
- Validate required production configuration at startup. Do not silently use development defaults in production.
- The application must build and display a recoverable error when the API is unavailable. Persistent records must survive service restarts.

## 10. MVP acceptance criteria

The core MVP is acceptable when:

1. The documented bootstrap command creates the initial garage and owner safely and idempotently; the owner can log in, retrieve the session, and log out.
2. Unauthenticated access is rejected, and session cookies are configured securely.
3. The owner can create, search, update, mark off duty/available, and archive mechanics; mechanics have no login or user account.
4. The owner can create and search jobs with customer/vehicle snapshots and no money fields; job numbers are unique and server-generated.
5. The owner can assign/unassign mechanics and transition jobs only along the defined lifecycle; mechanic occupancy/off-duty constraints are atomic.
6. Job history records each successful transition; invalid transitions do not change the job or append history.
7. Every mutable API operation enforces `ETag`/`If-Match`; stale updates return `412` without overwriting data.
8. Foreign-tenant and nonexistent resource identifiers both return `404`; tenant scope is applied in all relevant data paths.
9. Data survives browser refreshes and application/database restarts.
10. The configured production build, linter, focused unit tests, and API/integration tests pass.

## 11. Hardening phase (after core MVP)

The following are valuable but must not block declaring the core MVP complete. Plan and track them separately:

- Full WCAG 2.2 AA audit and remediation beyond accessible semantic/keyboard fundamentals required for usable forms.
- Measure and optimize a representative staging workload toward dashboard/list API latency below 500 ms at p95, excluding network latency.
- Production end-to-end browser coverage for full owner and job workflows.
- Document and rehearse production backup, restore, retention, and disaster-recovery procedures.
- Additional load, resilience, and observability work based on deployment context.

Do not claim these hardening targets have been met without measurement or evidence.

## 12. Implementation guidance

1. Inspect the current repository, worktree, and available scripts before editing; preserve unrelated changes and the existing root frontend.
2. Build vertical slices: PostgreSQL schema/migrations and owner bootstrap; session/auth and tenant boundary; mechanic roster; job lifecycle/API; frontend screens and integration.
3. Implement server-side validation, authorization, transactions, tenant scoping, and concurrency before relying on frontend checks.
4. Add focused tests with each slice, and run the smallest relevant checks before the full MVP verification set. Tenant-isolation tests must create a second garage and its fixture records directly in the disposable test database; do not add an API endpoint for garage provisioning.
5. Update this specification when a product/API contract changes; update setup documentation when stack or operations change.
6. If an external decision is truly required, ask instead of inventing billing, legal, regional, or out-of-scope behavior.
