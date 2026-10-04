# GOSSA

GOSSA is an owner-facing workshop operations app for a single garage. It provides a dashboard, a mechanic roster, and repair-job tracking without mechanic logins or money-related features.

> **Project status:** This repository is an MVP in active development. The current API uses a local JSON file for persistence. PostgreSQL schema and migration files are present, but PostgreSQL is not yet wired into the running API and the migration command does not apply migrations. Do not deploy this version or use it for production data.

## What it does today

- Owner sign-in and sign-out using a server-managed session.
- Dashboard counts and a recent-jobs list.
- Create and list mechanic roster records.
- Create and list repair jobs with customer and vehicle details stored on the job.
- Server-side request validation, CSRF checks, and job/mechanic lifecycle API routes.
- Same-origin local development: Vite serves the React app and forwards `/api` requests to Express.

The frontend currently offers dashboard, mechanic, and job screens. Job assignment and status-transition controls are not yet exposed in the UI, even though corresponding API routes exist. The v1 product scope and intended API contract are documented in [docs/SPEC.md](./docs/SPEC.md).

## Requirements

- Node.js 24 or newer.
- npm.

PostgreSQL is **not required to run the current local prototype**. The server writes its local data to `server/data/store.json`, which is ignored by Git.

## Set up

From the repository root, install frontend and server dependencies:

```sh
npm install
npm --prefix server install
```

Create the initial garage and owner:

```sh
npm --prefix server run bootstrap:owner
```

The bootstrap command is idempotent and will not replace an existing owner. It asks for the garage and owner details, with development defaults for some non-secret fields. Provide an owner password of 12–128 characters. The sign-in form currently starts with example values; use the email and password configured during bootstrap.

The bootstrap script also accepts `GOSSA_GARAGE_NAME`, `GOSSA_GARAGE_TIMEZONE`, `GOSSA_OWNER_NAME`, `GOSSA_OWNER_EMAIL`, and `GOSSA_OWNER_PASSWORD` from its process environment. Do not commit credentials or put real credentials in a checked-in file.

## Run locally

Start the API and frontend in separate terminals from the repository root:

```sh
npm --prefix server run dev
```

```sh
npm run dev
```

Open the local URL printed by Vite (normally <http://localhost:5173>). The API listens on port `3000` by default and exposes a health check at <http://localhost:3000/health>. Vite proxies `/api` to that API.

To use another API port, set `PORT` in the API process environment and update the proxy target in [vite.config.js](./vite.config.js) to match.

## Checks

Run the frontend checks from the repository root:

```sh
npm test
npm run lint
npm run build
```

Run the server checks:

```sh
npm --prefix server test
npm --prefix server run lint
```

The root lint command currently includes server files as well as frontend files; some existing server lint findings may cause it to fail. The API test suite uses the local store, so tests can change local data in `server/data/store.json`. Back up or remove that file before a run if its contents matter.

## Repository layout

```text
.
├── src/                    # React + Vite frontend
├── server/
│   ├── src/                # Express API, bootstrap, and local store
│   ├── migrations/         # PostgreSQL schema migration files (not applied yet)
│   └── test/               # API tests
├── docs/
│   └── SPEC.md             # Product scope, domain rules, and API contract
├── index.html
├── package.json            # Frontend scripts and dependencies
└── vite.config.js
```

## Important implementation notes

- There is one garage and one owner account in the current product scope.
- Mechanics are roster records, not user accounts, and cannot sign in.
- The frontend and API are designed for same-origin use. Do not add cross-origin access without an approved deployment requirement.
- The local JSON store is suitable only for development and evaluation. It does not provide PostgreSQL transactions, concurrent-write safety, or production operational guarantees.
- `npm --prefix server run migrate:up` currently only reports the migration files; it does not connect to a database or apply them.
- Database-backed persistence, production deployment configuration, and complete owner UI workflows remain implementation work. See [docs/SPEC.md](./docs/SPEC.md) for the authoritative v1 requirements.

## Scope

GOSSA v1 intentionally excludes inventory, parts purchasing, billing, estimates, invoices, payments, taxes, accounting, mechanic/staff accounts, customer and vehicle master records, multi-garage access, and public registration.
