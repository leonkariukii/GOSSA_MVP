# Coding Agent Guidelines

## Before making changes

1. Read `SPEC.md` for product behavior, domain rules, API contracts, security requirements, and acceptance criteria relevant to the task.
2. Inspect the current repository, package scripts, existing architecture, and working-tree changes before choosing where or how to implement something. The spec describes a target system; it does not mean every described feature or backend already exists.
3. Treat the specification as authoritative for product behavior. If a requirement conflicts with existing implementation conventions, preserve the specified behavior while fitting the established architecture. If requirements are genuinely ambiguous or conflict, ask for clarification rather than inventing product behavior.

## Implementation principles

- Make focused, complete changes that solve the requested problem without unrelated refactoring. Preserve existing user changes.
- Reuse existing frameworks, libraries, naming, and project structure. Do not assume a client/server folder layout, backend framework, database, or state-management library that is not present in the repository.
- Keep tenant isolation and authorization enforced on the server and data-access boundary. Never rely on frontend visibility checks or client-supplied tenant identifiers for access control.
- Validate and authorize every server-side input and action. Keep API paths, JSON fields, status codes, error responses, and concurrency behavior consistent with `SPEC.md`; do not add undocumented contract changes without updating the specification.
- Preserve the API's documented field naming. Map API data into frontend naming conventions only at a clear boundary when needed; do not impose a casing convention that the contract does not define.
- Implement job transitions, assignments, version checks, and multi-record writes atomically where the spec requires. Do not show a mutation as successful until the server confirms it.
- Surface failures explicitly. Do not silently swallow errors, return success-shaped fallback data, or expose credentials, tokens, personal data, or internal details in logs/errors.
- Keep temporary mocks, fixtures, and development credentials isolated from production configuration. Never commit secrets.
- Keep UI accessible and responsive; include loading, empty, and error states for data-driven views.

## Verification and documentation

- Add or update focused tests for changed behavior, including authorization, tenant isolation, validation, and concurrency when relevant.
- Run the smallest relevant test and lint/build commands available in the repository. Run broader checks when needed, and report any checks that could not be run.
- Update `SPEC.md` when a product contract changes. Update setup or operational documentation when implementation changes affect how the application is run, configured, or deployed.
- Do not claim a feature is complete unless it is implemented, persists as required, and its relevant acceptance criteria have been verified.
