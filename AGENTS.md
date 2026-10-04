# Coding Agent Guidelines

## Before making changes

1. Read `docs/SPEC.md` for product behavior, domain rules, API contracts, security requirements, and acceptance criteria relevant to the task.
2. Inspect the current repository, package scripts, and working-tree changes before editing. The root `src/` React/Vite app exists; the API and database are target work and may not yet exist.
3. Treat `docs/SPEC.md` as authoritative for product behavior. If requirements are genuinely ambiguous or conflict, ask for clarification rather than inventing product behavior.

## Pinned v1 stack and layout

- Runtime: Node.js 24 LTS for both frontend tooling and the Express server; declare this in `engines` in both package manifests.
- Frontend: React JSX with Vite, kept in the existing root `src/` directory.
- Client-side server-state fetching/caching: TanStack Query.
- Backend: Node.js with Express, located in a new root-level `server/` directory.
- Database: PostgreSQL, with versioned, non-destructive migrations.
- Database access: `pg` (node-postgres); do not add an ORM.
- SQL migrations: `node-pg-migrate`.
- Password hashing: `argon2`.
- Request and environment validation: `zod`.
- Authentication sessions: a project-owned PostgreSQL sessions table storing the session ID hash, owner ID, CSRF token itself, creation/last-activity times, idle and absolute expiries, and revocation time. Do not use `express-session`; persist and revoke sessions through the application’s own data-access layer, following cookie and CSRF rules in `docs/SPEC.md`.
- Server tests: Vitest and Supertest.
- Client tests: Vitest and React Testing Library.
- Keep API calls behind a focused frontend service/client layer. Keep server routes, validation, domain logic, and persistence separated enough to test without building unnecessary abstraction or services.
- Do not move the frontend into a `client/` folder or replace the pinned stack without an explicit product decision.

```text
/
├── src/                 # Existing React JSX + Vite frontend
├── server/              # Own package.json; Node.js + Express API and PostgreSQL integration
├── docs/
│   └── SPEC.md
├── AGENTS.md
├── CLAUDE.md
├── index.html
└── package.json
```

## Commands

The frontend uses the repository-root `package.json`. The backend has its own `server/package.json`.

| Task | Command |
|---|---|
| Start frontend | `npm run dev` |
| Start API | `npm --prefix server run dev` |
| Build frontend | `npm run build` |
| Lint frontend | `npm run lint` |
| Lint API | `npm --prefix server run lint` |
| Test frontend | `npm test` |
| Test API | `npm --prefix server test` |
| Apply database migrations | `npm --prefix server run migrate:up` |
| Bootstrap the initial garage and owner | `npm --prefix server run bootstrap:owner` |

Set `TEST_DATABASE_URL` to a dedicated disposable PostgreSQL database before running tests. Test setup must create a second garage directly in that test database to verify tenant isolation; do not add an API endpoint to create another garage. These commands define the required scripts as the server is implemented. Keep the root frontend scripts and server scripts separately runnable. The Express server is plain JavaScript and has no separate build step.

Later operational follow-up, not required for the initial auth slice: add `npm --prefix server run reset:owner-password` with secure interactive input and session revocation.

## v1 scope guard

Follow the v1 scope in `docs/SPEC.md`. In particular, do not add inventory, billing or other money features, mechanic logins, or staff accounts. Mechanics are roster records only. Customer and vehicle master records are deferred; a job stores the customer and vehicle details it needs.

## Implementation principles

- Make focused, complete changes that solve the requested problem without unrelated refactoring. Preserve existing user changes.
- Reuse the pinned stack, existing naming, and project structure. Add dependencies only when needed for implementation.
- Keep tenant isolation and authorization enforced on the server and data-access boundary. Never rely on frontend visibility checks or client-supplied tenant identifiers for access control.
- Validate and authorize every server-side input and action. Keep API paths, JSON fields, status codes, error responses, and concurrency behavior consistent with `docs/SPEC.md`; do not add undocumented contract changes without updating the specification.
- Use the `snake_case` API fields defined in `docs/SPEC.md`; map them only at a clear boundary if frontend code benefits from another convention.
- Implement job transitions, assignments, version checks, and multi-record writes atomically where the spec requires. Do not show a mutation as successful until the server confirms it.
- Surface failures explicitly. Do not silently swallow errors, return success-shaped fallback data, or expose credentials, tokens, personal data, or internal details in logs/errors.
- Keep temporary mocks, fixtures, and development credentials isolated from production configuration. Never commit secrets.
- Keep UI accessible and responsive; include loading, empty, and error states for data-driven views.

## Verification and documentation

- Add or update focused tests for changed behavior, including authorization, tenant isolation, validation, and concurrency when relevant.
- Run the smallest relevant test and lint/build commands available in the repository. Run broader checks when needed, and report any checks that could not be run.
- Update `docs/SPEC.md` when a product contract changes. Update setup or operational documentation when implementation changes affect how the application is run, configured, or deployed.
- Do not claim a feature is complete unless it is implemented, persists as required, and its relevant acceptance criteria have been verified.
