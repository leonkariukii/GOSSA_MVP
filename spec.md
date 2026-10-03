# System Specification: GOSSA REST API Backend (`SPEC.md`)

## 1. Overview
The **GOSSA (Garage Operations & Service Administration)** REST API handles garage workflow execution, job card intake, mechanic availability tracking, and vehicle service assignments. It serves as the primary backend interface for desktop and web manager portals.

---

## 2. Core Constraints & Architecture

* **Protocol:** HTTPS / JSON over REST
* **Authentication:** Bearer token (`Authorization: Bearer <jwt>`) required for all non-public endpoints
* **Data Interchange Standard:** Standard RFC 8259 JSON format
* **Timestamp Standard:** ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ssZ`)
* **Concurrency Handling:** Optimistic locking via eTag / version counters on status transitions

---

## 3. Data Models & Entities

### 3.1 Mechanic Entity
* `id` (UUID): Unique mechanic identifier
* `name` (String): Full name
* `specialization` (String): Primary technical domain
* `status` (Enum): `AVAILABLE`, `ACTIVE_JOB`, `OFF_DUTY`
* `created_at` (Timestamp)
* `updated_at` (Timestamp)

### 3.2 Job Card Entity
* `id` (String): Unique system job card code (e.g., `JC-2026-091`)
* `vehicle_reg` (String): Registration plate number
* `model` (String): Vehicle make/model
* `reported_fault` (String): Customer/intake issue description
* `status` (Enum): `UNASSIGNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`
* `assigned_mechanic_id` (UUID | null): FK references `Mechanic.id`
* `created_at` (Timestamp)
* `updated_at` (Timestamp)

---

## 4. API Endpoints Specification

### 4.1 Mechanics

#### GET `/api/v1/mechanics`
Lists registered mechanics with optional filtering.

* **Query Parameters:**
  * `status` (optional): Filter by `AVAILABLE`, `ACTIVE_JOB`, or `OFF_DUTY`
  * `search` (optional): Case-insensitive match on name or specialization
* **Success Response (`200 OK`):**
  ```json
  {
    "data": [
      {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "name": "Samuel Mwangi",
        "specialization": "Auto Electrics & ECU Tuning",
        "status": "AVAILABLE",
        "active_job_card_id": null,
        "created_at": "2026-10-01T08:00:00Z"
      }
    ],
    "meta": {
      "count": 1
    }
  }

#### POST `/api/v1/mechanics`
Registers a new mechanic. Default status is AVAILABLE.

**Request Body:**

```JSON
{
  "name": "David Ochieng",
  "specialization": "Brake Systems & Suspension"
}
```

**Validation Rules:**

* `name`: Required, string, max 100 chars

*`specialization`: Required, string, max 150 chars

**Success Response (201 Created):** Returns created Mechanic object.

#### PATCH `/api/v1/mechanics/{id}/status`
Updates duty status manually.

**Request Body:**

```JSON
{
  "status": "OFF_DUTY"
}
```

**Validation & Rules:**

* Cannot set status directly to ACTIVE_JOB via this endpoint (must go through job card assignment workflow).

* Setting status to OFF_DUTY while currently holding an ACTIVE_JOB returns 409 Conflict.

### 4.2 Job Cards & Workflow

### GET /api/v1/job-cards
Retrieves job cards sorted by creation date descending.

**Query Parameters:**

* status (optional): UNASSIGNED, IN_PROGRESS, COMPLETED

**Success Response (200 OK):**

```JSON
{
  "data": [
    {
      "id": "JC-2026-091",
      "vehicle_reg": "KDA 123X",
      "model": "Toyota Hilux 2018",
      "reported_fault": "Brake pad replacement & disc skimming",
      "status": "UNASSIGNED",
      "assigned_mechanic_id": null,
      "created_at": "2026-10-04T07:30:00Z"
    }
  ]
}
```

### POST /api/v1/job-cards
Creates an unassigned job card during vehicle intake.

**Request Body:**

```JSON
{
  "vehicle_reg": "KDA 123X",
  "model": "Toyota Hilux 2018",
  "reported_fault": "Brake pad replacement & disc skimming"
}
```