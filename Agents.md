# Agent System Guidelines (`AGENTS.md`)

## 1. Project Overview & Scope
**GOSSA (Garage Operations & Service Administration)** is a specialized SaaS platform designed for automotive garage managers to streamline vehicle intakes, track technician availability, manage digital job card lifecycles, and handle spare parts billing. 

This repository contains the web application client and backend API contract designed to run across workshop manager desktops and mobile shop-floor interfaces.

---

## 2. Technology Stack & Technical Principles

When writing or refactoring code in this repository, strictly adhere to the following stack and guidelines:

* **Frontend Framework:** React (Vite) using Functional Components and standard React Hooks.
* **Styling:** Tailwind CSS for all layout, spacing, typography, and state-driven UI states. Do not use custom raw CSS files unless adding specialized keyframe animations.
* **State Management & Data Fetching:** 
  * Use **TanStack Query (`@tanstack/react-query`)** for all server-state management, cache invalidation, and optimistic UI updates.
  * Use **React Context API** or **Zustand** only for client-only global state (e.g., UI modal states, active shop bay selection, active user session).
* **Validation & Schemas:** **Zod** schemas for validating form inputs and runtime API payloads.
* **Backend Contract:** RESTful API returning standard RFC 8259 JSON format over HTTPS.
* **Database Target:** PostgreSQL / Supabase with Row Level Security (RLS) enabled.

---

## 3. Repository Architecture

Keep the codebase modular, predictable, and feature-driven:

```text
gossa-app/
├── docs/
│   ├── SPEC.md                  # REST API & Business Logic Specification
│   └── DATABASE.md              # Database Schema & Migrations
├── src/
│   ├── api/                     # Centralized API client & HTTP fetch wrappers
│   ├── assets/                  # Images, SVGs, and static assets
│   ├── components/              # Shared atomic UI components (Button, Modal, Input, Badge)
│   ├── context/                 # Application Context Providers
│   ├── features/                # Domain-driven feature modules
│   │   ├── job-cards/           # Intake forms, assignment modals, queue lists
│   │   ├── mechanics/           # Roster cards, status filters, workload metrics
│   │   └── inventory/           # Parts catalog, stock alerts, job line items
│   ├── hooks/                   # Generic custom React hooks
│   ├── layouts/                 # Root App Layout, Navigation Bar, Sidebar
│   ├── routes/                  # Route configurations and view pages
│   └── utils/                   # Utility functions, formatters (currency, dates)
├── AGENTS.md                    # Coding agent system instructions
└── package.json