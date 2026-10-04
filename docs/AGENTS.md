# Agent System Guidelines (`AGENTS.md`)

## 1. Operating Rules for AI Agents
1. **Read Specifications First:** Before modifying or creating code, consult `docs/SPEC.md`, `docs/DATABASE.md`, and `docs/WORKFLOWS.md`. Do NOT guess API routes, table schemas, or state transitions.
2. **Never Break Contracts:** API request payloads, database column names, and state enum values must match `docs/SPEC.md` and `docs/DATABASE.md` exactly.
3. **Strict Validation:** Use Zod schemas for form inputs and API response validation.
4. **No Direct State Manipulation:** All status changes (e.g., mechanic duty status, job card state) must flow through defined RPC functions or TanStack Query mutations that preserve atomic side effects.
5. **Ask When Uncertain:** If a requirement is ambiguous or absent from the `docs/` folder, state your assumption clearly before writing code.

---

## 2. Technical Stack & Tooling

* **Language:** TypeScript (Strict mode enabled)
* **Frontend:** React 18+ (Vite), React Router v6+, Tailwind CSS
* **State & Data Fetching:** TanStack Query v5 (`@tanstack/react-query`)
* **Backend Platform:** Supabase (PostgreSQL, Auth, PostgREST, RLS, Edge Functions)
* **Form & Validation:** React Hook Form + Zod
* **Testing:** Vitest, React Testing Library, Mock Service Worker (MSW)

---

## 3. Essential CLI Commands

```bash
# Development
npm run dev              # Starts Vite dev server
npm run build            # Typecheck and production build
npm run preview          # Preview production build locally

# Code Quality & Testing
npm run typecheck        # Run tsc --noEmit
npm run lint             # ESLint execution
npm run format           # Prettier code formatting
npm run test             # Run unit and integration tests via Vitest
npm run test:ui          # Vitest UI mode

# Supabase Local Development
npx supabase start       # Start local PostgreSQL / Auth containers
npx supabase gen types   # Generate TypeScript types from local DB schema
npx supabase db reset    # Apply migrations and seeds
```
