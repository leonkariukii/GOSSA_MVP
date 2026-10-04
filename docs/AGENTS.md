# Agent System Guidelines (`AGENTS.md`)

## 1. Operating Rules for AI Coding Agents
1. **Read Contracts Before Coding:** Consult `docs/SPEC.md` for API endpoint contracts and JSON responses before generating backend or frontend code.
2. **Never Break Contracts:** Every request body, JSON key, error payload, and HTTP status code MUST match `docs/SPEC.md` exactly. Use `snake_case` for API JSON payloads and map to `camelCase` in React state.
3. **Atomic State Operations:** All state transitions (e.g., assigning a job card, completing a job) must be executed as atomic backend operations. Frontend TanStack Query mutations MUST invalidate BOTH `["job-cards"]` and `["mechanics"]` cache keys simultaneously upon success.
4. **No Speculative Assumptions:** If an endpoint parameter or state rule is missing or ambiguous, stop and consult `docs/SPEC.md`. Do not invent new fields, routes, or database columns.

---

## 2. Project Architecture & Stack

The repository uses an isolated client-server workspace structure:

```text
gossa-app/
├── client/                   # React (.jsx) Frontend (Vite)
│   ├── src/
│   │   ├── api/              # Axios/Fetch API wrappers matching SPEC.md
│   │   ├── components/       # Reusable UI components (Modal, Cards, Badges)
│   │   ├── features/         # Feature modules (job-cards, mechanics)
│   │   ├── hooks/            # Custom React hooks & TanStack Query options
│   │   └── App.jsx
│   └── package.json
├── server/                   # Node.js / Express REST API
│   ├── src/
│   │   ├── controllers/      # Route request handlers
│   │   ├── middleware/       # Auth, Tenant isolation, Validation
│   │   ├── models/           # Data access & database queries
│   │   ├── routes/           # Express router endpoints
│   │   └── server.js
│   └── package.json
├── docs/                     # System specifications
│   └── SPEC.md
└── AGENTS.md