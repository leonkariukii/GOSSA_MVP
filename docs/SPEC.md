# GOSSA System Specification

**Status:** Product and engineering baseline for the MVP
**Audience:** Coding agents, engineers, and reviewers
**Product:** GOSSA, a multi-tenant workshop/garage operations application

## 1. Purpose and product outcome

GOSSA helps an independent garage manage its customers, vehicles, staff, and repair work from one application. The MVP must let an authenticated garage team find a vehicle, create and assign a job card, follow its progress, and see the work that needs attention. Data belonging to one garage must never be visible to another.

Deliver a usable, responsive application backed by a persistent API and database. A frontend-only mockup, hard-coded dashboard, or browser-only data store is not a complete MVP. If implementation is staged, keep the application runnable at every stage and clearly mark any temporary development adapter as non-production.

### 1.1 Repository baseline

At the time this specification was written, the repository contains a minimal React 19 / Vite 8 frontend (`src/App.jsx`, `src/main.jsx`, and `src/index.css`) and has no implemented backend, data model, authentication flow, or product UI. Preserve the existing frontend stack unless the repository has since established a different convention. Inspect the current repository before choosing backend libraries, persistence, or deployment technology; prefer one maintainable application and database over unnecessary services.

Requirements below describe the target product, not features that already exist. Do not represent a planned feature as implemented.

## 2. Scope

### 2.1 MVP must include

1. Sign-in, sign-out, and authenticated application access.
2. Garage-scoped users and role-based access.
3. An operational dashboard showing active work and useful counts.
4. Customer records and each customer's vehicles.
5. Job cards, their work items, mechanic assignment, status changes, and history.
6. Search, filtering, sorting, and pagination for operational lists.
7. Validation, actionable errors, loading/empty states, and responsive layouts.
8. Persistent storage, tenant isolation, automated tests, and documented local setup.

### 2.2 Explicitly out of MVP scope

Unless an existing product requirement is added, do not implement payment processing, accounting/tax filing, supplier purchasing, parts inventory, payroll, customer self-service, SMS/email delivery, mobile-native apps, multiple currencies per job, or multi-garage reporting. Keep interfaces extensible without building these features preemptively.

## 3. Users, tenancy, and permissions

### 3.1 Tenant model

- A **garage** is the tenant and owns its users, customers, vehicles, job cards, and audit events.
- Every tenant-owned record has a server-assigned immutable `garage_id`. Never accept a client-supplied `garage_id` as proof of access.
- A user acts within one selected garage per authenticated session. The verified identity/session determines the active garage and role.
- Every read, write, relationship lookup, search, aggregate, and background task must be constrained to the active `garage_id`. Enforce this in the service/data-access boundary, not only in the UI.
- A request for a known record owned by another garage returns `403 FORBIDDEN`. A nonexistent record returns `404 NOT_FOUND`. Do not reveal foreign record details in an error.
- Validate that referenced customers, vehicles, and mechanics belong to the same garage as the job card.

### 3.2 Roles

Roles are scoped to a garage:

| Role | Capabilities |
|---|---|
| `owner` | All garage operations, user/garage settings, and role management. |
| `manager` | All operational records and staff assignment; cannot change ownership. |
| `service_advisor` | Manage customers, vehicles, job cards, and assignments; cannot manage users or garage settings. |
| `mechanic` | View assigned work and update permitted work/status fields on assigned job cards; cannot manage customers, users, or garage settings. |

Enforce authorization on the server for every route/action. Hiding a control in the frontend is not authorization. Reject unknown roles and deny by default. User invitations and account recovery may use a development-only mechanism until a real delivery provider is configured; do not create a public registration flow that permits users to choose a garage or role.

## 4. Core workflows

### 4.1 Find or register a customer and vehicle

An authorized staff member searches customers and vehicles, opens an existing record, or creates a customer and one or more vehicles. Prevent accidental duplicate vehicles in the same garage by normalizing registration identifiers and checking uniqueness. Allow an explicit, audited correction if a legitimate identifier changes.

Customer fields: `id`, `garage_id`, `first_name`, `last_name`, `phone`, optional `email`, optional `notes`, `created_at`, `updated_at`, `version`, and optional `archived_at`.

Vehicle fields: `id`, `garage_id`, `customer_id`, `registration`, optional `make`, `model`, `year`, `color`, optional `vin`, optional `odometer_km`, `created_at`, `updated_at`, `version`, and optional `archived_at`. A VIN, when supplied, must be validated and unique within a garage. Store registration in normalized form for comparisons while preserving a display form.

### 4.2 Create and manage a job card

An authorized advisor or manager creates a job for a vehicle, records the customer's reported concern, odometer reading, optional target completion date, one or more work items, and an optional mechanic assignment. The job number is unique and human-readable within its garage (for example, `JC-2026-004`); allocate it atomically on the server.

Job card fields: `id`, `garage_id`, `job_number`, `vehicle_id`, `customer_id`, `created_by`, optional `assigned_mechanic_id`, `status`, `customer_concern`, optional `diagnosis`, optional `internal_notes`, optional `odometer_km`, `line_items`, optional `estimated_completion_at`, `created_at`, `updated_at`, `version`, and optional `archived_at`.

Each line item has an immutable ID, description, positive quantity, unit price, and line total. Use a decimal-safe representation (integer minor units internally or a decimal type); never use floating-point arithmetic for money. API monetary values are decimal strings with an explicit garage currency, for example `{ "amount": "125.50", "currency": "USD" }`. Currency is configured per garage and cannot be changed on an existing job. Do not assume a particular country, currency, tax regime, or time zone.

### 4.3 Track repair work

Job statuses and allowed transitions:

| Status | Meaning | Allowed next status |
|---|---|---|
| `draft` | Work has been recorded but not authorized to begin. | `awaiting_approval`, `approved`, `cancelled` |
| `awaiting_approval` | Estimate is awaiting customer authorization. | `approved`, `cancelled` |
| `approved` | Authorized and ready to start. | `in_progress`, `cancelled` |
| `in_progress` | Work is actively being performed. | `waiting_for_parts`, `completed`, `cancelled` |
| `waiting_for_parts` | Work is blocked pending parts. | `in_progress`, `completed`, `cancelled` |
| `completed` | Recorded work is complete. | `invoiced` |
| `invoiced` | Job has been handed off to an external invoicing process or marked invoiced. | No further transition in MVP. |
| `cancelled` | Work was cancelled. | No further transition in MVP. |

Only the server performs transitions, validates the transition graph, and records actor, timestamp, previous status, next status, and optional note in an append-only job history. The frontend must not optimistically show a transition as successful before the server confirms it. A mechanic may start, pause for parts, resume, and complete only an assigned job; completion by a mechanic requires all work items to be resolved. Managers/advisors may perform operational transitions. Ownership, assignment, and transition permissions are checked server-side.

A mechanic may have at most one job in `in_progress` at a time. Enforce this atomically when assigning or transitioning jobs; return `409 MECHANIC_OCCUPIED` with a safe, useful explanation when the constraint is violated. Jobs in `waiting_for_parts` do not occupy a mechanic.

### 4.4 Dashboard and work queues

The dashboard is scoped to the active garage and provides:

- Counts of open jobs and jobs by actionable status.
- A prioritized list of active/recent jobs with job number, vehicle, customer, assignee, status, and last update.
- Work assigned to the current mechanic when the signed-in role is `mechanic`.
- Clear paths to create a job, add a customer, and open a job.

All counts and rows must come from persisted data, respect permissions, and use the same filters as their corresponding list views. Do not fabricate demo metrics in production.

## 5. Data and business rules

- Use opaque, non-guessable IDs for API resource identifiers. IDs and `garage_id` are immutable.
- Use UTC ISO 8601 timestamps in the API. Render dates/times in the garage's configured time zone; store that time zone explicitly.
- Store phone numbers as entered plus a normalized searchable representation where practical. Validate email format without rejecting valid international addresses.
- Trim and validate user text server-side. Set documented maximum lengths and reject invalid values with field-level errors.
- Do not hard-delete customers, vehicles, users, or jobs that have operational history. Use archive/deactivate semantics and preserve historical references.
- Job line-item totals and job totals are calculated server-side. The client may preview them but cannot set authoritative totals.
- Changes to job status, assignment, line items, customer/vehicle links, archival, and role membership increment the affected record's `version`.
- Record an audit event for sign-in/security events as appropriate, user/role changes, archival, job creation, assignment, status transitions, and edits to job financial/work details. Audit records are tenant-scoped, append-only, and readable only by authorized owner/manager roles. Never put credentials, tokens, or unnecessary personal data in logs.
- Define database foreign keys, tenant-aware uniqueness constraints, and indexes for frequent garage-scoped lookups. At minimum index tenant ID, job status/update time, job number, customer name/phone, vehicle registration, mechanic assignment/status, and foreign keys.
- Database migrations must be versioned, repeatable in deployment, and safe for existing data. Do not rely on production auto-sync or destructive schema generation.

## 6. HTTP API contract

### 6.1 General conventions

- API base path: `/api/v1`.
- Transport: HTTPS in deployed environments; JSON request/response bodies use `Content-Type: application/json` and UTF-8.
- Resource collection endpoints are plural. Use standard HTTP semantics and appropriate status codes.
- Use `GET` for reads, `POST` for creation and explicit actions, `PATCH` for partial updates, and `DELETE` only where safe/permitted (normally archive instead).
- List endpoints support `page` (1-based), `page_size` (default 25, maximum 100), documented filters, and allowlisted sort fields/directions. Return stable ordering with an ID tie-breaker.
- List response shape:

```json
{
  "data": [],
  "page": 1,
  "page_size": 25,
  "total": 0
}
```

- Use `201 Created` and a `Location` header for creation, `204 No Content` only for successful responses without a body, `400` for malformed requests, `401` for missing/invalid authentication, `403` for insufficient permission/foreign tenant, `404` for missing resources, `409` for business/uniqueness conflicts, `412` for stale versions, `422` for field/domain validation, and `428` when a required precondition is missing.
- Never return stack traces, SQL details, secrets, or internal infrastructure information to clients.

### 6.2 Authentication and session security

- Authenticate API requests with `Authorization: Bearer <access-token>` or an equivalently secure server-managed session if the existing backend standard supports it.
- Tokens must be signed and verified by a trusted server configuration. Claims include `sub` (user ID), `garage_id`, `role`, `iat`, and `exp`. Do not trust client-decoded claims. Validate signature, issuer/audience where configured, expiry, and account/session revocation.
- Provide `POST /auth/login`, `POST /auth/logout`, and `GET /auth/me`. Login errors must not reveal whether a particular email exists. Rate-limit login and recovery endpoints.
- Keep browser access tokens in memory where bearer tokens are used; do not put access or refresh tokens in local storage, session storage, URLs, or logs. Prefer secure, HttpOnly, SameSite cookies for refresh/session credentials; apply CSRF defenses to cookie-authenticated state-changing requests.
- Require strong credential handling using a maintained password-hashing library (Argon2id preferred; otherwise a suitable adaptive hash). Never store plaintext or reversible passwords.
- Require authorization for all application data routes; unauthenticated requests receive `401`.

### 6.3 Required endpoints

Implement only endpoints required by MVP, but keep their contract consistent:

| Method and path | Purpose | Access |
|---|---|---|
| `POST /auth/login` | Authenticate. | Public, rate-limited |
| `POST /auth/logout` | End current session/token. | Authenticated |
| `GET /auth/me` | Return current user, role, and garage context. | Authenticated |
| `GET /dashboard` | Return tenant- and role-scoped summary and recent work. | Authenticated |
| `GET /customers` / `POST /customers` | Search/list and create customers. | Owner, manager, advisor |
| `GET /customers/{id}` / `PATCH /customers/{id}` | Read/update a customer. | Owner, manager, advisor |
| `GET /vehicles` / `POST /vehicles` | Search/list and create vehicles. | Owner, manager, advisor |
| `GET /vehicles/{id}` / `PATCH /vehicles/{id}` | Read/update a vehicle. | Owner, manager, advisor |
| `GET /jobs` / `POST /jobs` | Filter/list and create job cards. | Owner, manager, advisor; mechanic gets assigned jobs only |
| `GET /jobs/{id}` / `PATCH /jobs/{id}` | Read/update permitted job fields. | By role and assignment |
| `POST /jobs/{id}/transitions` | Apply a validated status transition. | By role and assignment |
| `GET /jobs/{id}/history` | Read status and audit history for a job. | By role and assignment |
| `GET /mechanics` | List active mechanics for assignment. | Owner, manager, advisor |
| `GET /users` / `POST /users` / `PATCH /users/{id}` | List, invite/create, deactivate, or change roles. | Owner; manager may list only |

Do not expose unrestricted mass assignment. Accept only fields permitted for the endpoint and role. Filter fields, sort keys, and page sizes must be validated/allowlisted. Add endpoint-specific request/response schemas and tests.

### 6.4 Error envelope

Every API error uses this shape and a status value matching the HTTP response:

```json
{
  "error": {
    "code": "MECHANIC_OCCUPIED",
    "message": "This mechanic is assigned to another active job.",
    "status": 409,
    "timestamp": "2026-10-04T08:15:00Z",
    "request_id": "req_01J...",
    "details": []
  }
}
```

`details` may contain safe field-level validation errors such as `{ "field": "registration", "code": "duplicate", "message": "This registration is already in use." }`. Omit `details` when not applicable. `request_id` must be safe to share with support and correlate to server logs. Error messages must not disclose foreign-tenant data or implementation internals. The UI presents useful messages and preserves unsaved form values after recoverable errors.

## 7. Concurrency and consistency

- Every persisted mutable record has an integer `version` starting at 1 and an HTTP `ETag` derived from that version.
- Every update, archive, assignment change, and status transition requires `If-Match` with the current `ETag` (for example, `If-Match: "v2"`). Creation and read-only calls do not require it.
- Missing required `If-Match` returns `428 PRECONDITION_REQUIRED`; stale version returns `412 PRECONDITION_FAILED` with the current version/ETag where safe. The client must refresh/reconcile and ask the user to retry; never silently overwrite concurrent changes.
- Apply version check and mutation atomically in the database. Enforce unique job numbers, normalized registrations, and mechanic active-job occupancy with database constraints or transaction-safe locking as appropriate.
- Multi-record changes (for example, creating a job and its line items/history) must be transactional. Failed transactions must leave no partial records.

## 8. Frontend requirements

- Build a clear operational application shell with garage identity, primary navigation, current-user menu, and sign-out.
- Required views: sign-in; dashboard; customer list/detail/create/edit; vehicle list/detail/create/edit; job list/detail/create/edit; role-appropriate mechanic work queue; and useful not-found/forbidden/error states.
- Reuse shared layout, form controls, tables/lists, status badges, dialogs, and notification patterns. Keep domain logic out of giant page components; use focused components and API/service modules consistent with existing project conventions.
- Every data view must implement loading, empty, success, and failure states. Forms must label inputs, validate on both client and server, identify field errors accessibly, prevent duplicate submissions, and warn before discarding meaningful unsaved changes.
- Provide confirmation for irreversible or high-impact actions (cancel job, archive record, change role). Provide recoverable undo only if the backend can safely support it.
- Search and filters must be reflected in page state and be shareable via the URL where practical. Paginate large datasets instead of downloading all records.
- Treat API data as untrusted. Render user-supplied content as text; do not inject HTML.
- UI must be usable at 360px viewport width and at common desktop widths, with no horizontal page overflow. Tables may become cards or use a deliberate contained scroll region on small screens.
- Meet WCAG 2.2 AA fundamentals: semantic landmarks/headings, keyboard operation, visible focus, adequate contrast, associated labels, accessible names for icon controls, announced asynchronous errors/status changes, and reduced-motion support.
- Use a consistent design system rather than starter-template styling. Do not add decorative animation or dependencies without a user-visible need.

## 9. Performance and reliability

- Keep list requests paginated and return only fields required for the view. Add server-side search/filter/sort rather than fetching all tenant data to filter in the browser.
- Avoid N+1 database access in dashboard and list endpoints. Use appropriate indexes and bounded queries.
- Set request/body size limits, timeouts, and a documented maximum page size. Handle database/network failure explicitly; do not return success-shaped empty data.
- Avoid duplicate requests/submissions and cancel or ignore stale frontend requests when filters change.
- Target: common list/dashboard requests complete within 500 ms at the 95th percentile under the MVP's expected small-garage load, excluding network latency; define and measure a representative local/staging dataset before claiming this target.
- The application must build cleanly and display a clear recoverable error if the API is unavailable. Production data must persist across restarts and deployments.

## 10. Security and privacy

- Enforce TLS in deployment, least privilege for database/service credentials, secure secret injection, and separate development/test/production configuration.
- Validate and authorize on the server; use parameterized database operations and allowlisted sort/filter fields.
- Protect against XSS, CSRF where cookie auth is used, brute-force login, credential leakage, and insecure direct object references.
- Apply secure cookie flags where cookies are used; configure CORS to explicit trusted origins, never wildcard credentialed origins.
- Do not commit secrets or use production credentials in tests. Provide a safe `.env.example` containing placeholders only.
- Logs must be structured, include request ID and useful operational context, redact credentials/tokens, and avoid unnecessary customer personal data. Never log passwords, authorization headers, or full tokens.
- Define backup/restore expectations for the selected database before production deployment. Document data retention/deletion responsibilities; do not claim compliance certifications without verification.

## 11. Configuration and operations

- Configure database URL, signing/session secrets, allowed frontend origins, environment, and logging level through environment variables or the deployment platform's secret manager.
- Validate required configuration at startup and fail clearly if production configuration is incomplete. Never silently fall back to insecure production defaults.
- Provide local development instructions for installing dependencies, starting frontend and backend, applying migrations, seeding non-sensitive demo data, running tests, linting, and building.
- Demo/seed accounts and sample records are development/test only, explicitly documented, and must not be enabled with production defaults.
- Provide health/readiness endpoints appropriate to the chosen backend. Readiness checks required dependencies without disclosing secrets or internal topology.
- Document deployment, migration order, backup/restore, and a rollback strategy for schema/application releases.

## 12. Testing and acceptance criteria

### 12.1 Required automated coverage

- Unit tests for domain validation, permitted status transitions, totals, normalization, role permissions, and pagination.
- API/integration tests for authentication, tenant isolation, authorization, validation, uniqueness conflicts, transaction behavior, optimistic concurrency, and mechanic occupancy.
- Frontend tests for critical forms and status actions, loading/empty/error states, and role-specific navigation/actions.
- End-to-end smoke tests for sign-in, customer/vehicle creation, job creation and assignment, mechanic workflow, completion, and sign-out.
- Tests must use isolated test data and must not call production services.

### 12.2 MVP acceptance checklist

The MVP is acceptable only when all of the following are true:

1. A user can authenticate and receives only the correct garage context and role permissions.
2. A manager/advisor can create and find a customer and vehicle; duplicate normalized registrations are rejected with an actionable conflict.
3. A manager/advisor can create a job with line items; the server assigns a unique job number and calculates authoritative totals.
4. A permitted user can assign a mechanic and move a job through only allowed transitions; invalid transitions are rejected.
5. A mechanic cannot access unassigned jobs or perform manager-only actions, and cannot start a second active job.
6. Two garages cannot read or mutate each other's records, including by guessing IDs, searching, filtering, or using relationships.
7. Concurrent stale updates fail with `412` and do not erase the first successful update.
8. Refreshing the browser or restarting the application does not lose persisted records.
9. Dashboard and lists show persisted, garage-scoped data and provide accessible loading, empty, and error states.
10. The application passes its production build, configured linter, and relevant automated tests with no new errors.

## 13. Implementation guidance for coding agents

1. Inspect the repository and identify existing conventions, uncommitted changes, available tooling, and any backend or design work added since this spec was written. Preserve unrelated user work.
2. Turn the requirements into small vertical slices: persistence/auth/tenant boundary; customer and vehicle management; job lifecycle; dashboard and UI refinement. Keep each slice runnable and test it before moving on.
3. Reuse existing dependencies and patterns. Add a dependency only when it is needed, justified, and compatible with the current stack. Do not introduce a distributed architecture for this MVP.
4. Implement authorization, validation, transactions, tenant scoping, and concurrency in the backend first; then connect the UI to the real API. Temporary mocks must be isolated behind an adapter and must never masquerade as production persistence.
5. Add or update tests with each behavior change. Run the smallest relevant tests/linter/build after changes, then the full required checks before declaring completion.
6. Update setup/API/deployment documentation when implementation decisions affect how another engineer runs or operates the system.
7. When a requirement cannot be met due to a missing product decision or external service, document the blocker and a safe default; do not silently invent billing, legal, tax, or regional behavior.

### Decisions intentionally left to implementation discovery

The repository does not currently establish a backend language/framework, database vendor, deployment platform, email provider, garage currency, or time zone. Select the simplest suitable options after inspecting the repo and deployment context. Keep the API and domain behavior defined here stable, document the choices, and do not treat a vendor-specific choice as a product requirement.
