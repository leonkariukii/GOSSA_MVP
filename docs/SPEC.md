# GOSSA REST API Specification

## 1. Overview

The **GOSSA (Garage Operations & Service Administration)** REST API handles garage workflow execution, job card intake, mechanic availability, and vehicle service assignments. It is the backend interface for the desktop and web manager portals.

## 2. Conventions

- **Base URL:** `/api/v1`
- **Transport and format:** HTTPS and JSON (`application/json`), as defined by RFC 8259.
- **Authentication:** Every endpoint in this specification requires valid authentication credentials. Requests without valid credentials receive `401 Unauthorized`; authenticated callers without permission receive `403 Forbidden`.
- **Timestamps:** UTC in ISO 8601 format, for example `2026-10-04T07:30:00Z`.
- **Identifiers:** Mechanic IDs are UUIDs. Job card IDs are system-generated strings, for example `JC-2026-091`.
- **Property naming:** JSON fields use `snake_case`.
- **Mutations:** Workflow operations that touch a job card or mechanic are atomic: either all affected records and versions are updated, or none are.

## 3. Data Models

### 3.1 Mechanic

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique mechanic identifier. |
| `name` | string | Full name; 1–100 characters after trimming. |
| `specialization` | string | Primary technical domain; 1–150 characters after trimming. |
| `status` | enum | `AVAILABLE`, `ACTIVE_JOB`, or `OFF_DUTY`. |
| `active_job_card_id` | string or `null` | ID of the assigned, non-terminal job card, if any. |
| `version` | integer | Positive resource version, incremented on every successful mechanic mutation. |
| `created_at` | timestamp | Creation time in UTC. |
| `updated_at` | timestamp | Most recent update time in UTC. |

`ACTIVE_JOB` means the mechanic is reserved for a non-terminal job card, including an assigned card that has not yet been started. A mechanic can have at most one such card. `AVAILABLE` mechanics have no active card; `OFF_DUTY` mechanics cannot be assigned.

### 3.2 Job card

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique, system-generated job card code. |
| `vehicle_reg` | string | Vehicle registration plate; must be non-empty after trimming. |
| `model` | string | Vehicle make/model; must be non-empty after trimming. |
| `reported_fault` | string | Intake description; must be non-empty after trimming. |
| `status` | enum | `UNASSIGNED`, `IN_PROGRESS`, `COMPLETED`, or `CANCELLED`. |
| `assigned_mechanic_id` | UUID or `null` | Assigned mechanic; `null` when no mechanic is assigned. |
| `version` | integer | Positive resource version, incremented on every successful job-card mutation. |
| `created_at` | timestamp | Creation time in UTC. |
| `updated_at` | timestamp | Most recent update time in UTC. |

`UNASSIGNED` is the pre-start state. A card in this state can have an assigned mechanic; `assigned_mechanic_id` distinguishes an assigned, not-yet-started card from one awaiting assignment.

## 4. Response and Error Formats

### 4.1 Resource responses

Single-resource responses contain the resource directly as JSON. Collection responses use a `data` array and a `meta.count` value. Successful single-resource reads and mutations return the resource's strong `ETag` response header in the format `"v<version>"`, for example `"v3"`. The `version` is also included in each resource body.

`POST /job-cards` and `POST /mechanics` return `201 Created`, a `Location` header containing the created resource URL, and its `ETag`. Successful reads and mutations otherwise return `200 OK`.

### 4.2 Error response

All errors use this shape; `details` is omitted when there are no field-specific details.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more request fields are invalid.",
    "details": {
      "name": "Must contain between 1 and 100 characters."
    }
  }
}
```

| HTTP status | Error code | Meaning |
|---|---|---|
| `400 Bad Request` | `VALIDATION_ERROR` | Invalid JSON, missing/invalid fields, or invalid query parameter. |
| `401 Unauthorized` | `UNAUTHENTICATED` | Missing, expired, or invalid authentication credentials. |
| `403 Forbidden` | `FORBIDDEN` | Caller is authenticated but not permitted to perform the operation. |
| `404 Not Found` | `RESOURCE_NOT_FOUND` | Job card or mechanic ID does not exist. |
| `409 Conflict` | `WORKFLOW_CONFLICT` | Operation conflicts with the current workflow state, mechanic availability, or uniqueness constraint. |
| `412 Precondition Failed` | `VERSION_MISMATCH` | `If-Match` does not match the current resource ETag. |
| `415 Unsupported Media Type` | `UNSUPPORTED_MEDIA_TYPE` | Request body is not `application/json`. |
| `428 Precondition Required` | `IF_MATCH_REQUIRED` | A required `If-Match` header was not supplied. |

## 5. ETag and Version Rules

1. A new mechanic and job card start at `version: 1`.
2. `GET /mechanics/{id}` and `GET /job-cards/{id}` return the resource ETag. List responses include each resource's `version`; clients must fetch an individual resource to obtain its ETag before mutating it.
3. Every mutation to an existing mechanic or job card requires `If-Match` with that resource's current ETag, including `PATCH /mechanics/{id}/status` and every job-card workflow action. Creation does not require `If-Match`.
4. ETags are strong, quoted tags of the form `"v<version>"`. The header must identify the exact current version; wildcard and weak validators are not accepted.
5. The server checks preconditions and applies the mutation atomically. A stale tag returns `412 VERSION_MISMATCH`, with no record changed. On success, the affected resource version increments by exactly one and the response includes the new `ETag` and version.
6. When an operation updates both a job card and a mechanic, both records and both versions change atomically. The response's `ETag` identifies the job card. Fetch the mechanic resource for its current ETag and version.

## 6. Mechanics Endpoints

### 6.1 List mechanics

`GET /api/v1/mechanics`

Optional query parameters:

| Parameter | Description |
|---|---|
| `status` | Filter by `AVAILABLE`, `ACTIVE_JOB`, or `OFF_DUTY`. |
| `search` | Case-insensitive substring match against `name` or `specialization`. |

Returns `200 OK`. `meta.count` is the number of returned records.

```json
{
  "data": [
    {
      "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "name": "Samuel Mwangi",
      "specialization": "Auto Electrics & ECU Tuning",
      "status": "AVAILABLE",
      "active_job_card_id": null,
      "version": 1,
      "created_at": "2026-10-01T08:00:00Z",
      "updated_at": "2026-10-01T08:00:00Z"
    }
  ],
  "meta": {
    "count": 1
  }
}
```

### 6.2 Get a mechanic

`GET /api/v1/mechanics/{id}`

Returns `200 OK`, the mechanic resource, and its `ETag`. A missing ID returns `404 RESOURCE_NOT_FOUND`.

### 6.3 Register a mechanic

`POST /api/v1/mechanics`

Request:

```json
{
  "name": "David Ochieng",
  "specialization": "Brake Systems & Suspension"
}
```

Both fields are required strings; whitespace is trimmed before validating lengths. The new mechanic has `status: "AVAILABLE"`, `active_job_card_id: null`, and `version: 1`. Returns `201 Created`, the mechanic resource, `Location: /api/v1/mechanics/{id}`, and `ETag: "v1"`.

### 6.4 Update mechanic duty status

`PATCH /api/v1/mechanics/{id}/status`

Requires `If-Match` with the current mechanic ETag.

Request:

```json
{
  "status": "OFF_DUTY"
}
```

Only `AVAILABLE` and `OFF_DUTY` are accepted. `ACTIVE_JOB` can only be set by the job-card workflow. A mechanic with an active job card cannot be set to `OFF_DUTY` (`409 WORKFLOW_CONFLICT`). On success, returns `200 OK`, the updated mechanic resource, and the new mechanic ETag.

## 7. Job Card Endpoints and Workflow

### 7.1 List job cards

`GET /api/v1/job-cards`

Optional query parameter `status` accepts `UNASSIGNED`, `IN_PROGRESS`, `COMPLETED`, or `CANCELLED`. Results are sorted by `created_at` descending. Returns `200 OK`.

```json
{
  "data": [
    {
      "id": "JC-2026-091",
      "vehicle_reg": "KDA 123X",
      "model": "Toyota Hilux 2018",
      "reported_fault": "Brake pad replacement & disc skimming",
      "status": "UNASSIGNED",
      "assigned_mechanic_id": null,
      "version": 1,
      "created_at": "2026-10-04T07:30:00Z",
      "updated_at": "2026-10-04T07:30:00Z"
    }
  ],
  "meta": {
    "count": 1
  }
}
```

### 7.2 Create a job card

`POST /api/v1/job-cards`

Creates a job card during vehicle intake.

Request:

```json
{
  "vehicle_reg": "KDA 123X",
  "model": "Toyota Hilux 2018",
  "reported_fault": "Brake pad replacement & disc skimming"
}
```

All fields are required non-empty strings after trimming. The server generates `id`; the new card has `status: "UNASSIGNED"`, `assigned_mechanic_id: null`, and `version: 1`. Returns `201 Created`, the job-card resource, `Location: /api/v1/job-cards/{id}`, and `ETag: "v1"`.

### 7.3 Get a job card

`GET /api/v1/job-cards/{id}`

Returns `200 OK`, the job-card resource, and its `ETag`. A missing ID returns `404 RESOURCE_NOT_FOUND`.

### 7.4 Assign a mechanic

`POST /api/v1/job-cards/{id}/assign`

Requires the current job-card ETag in `If-Match`.

Request:

```json
{
  "mechanic_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

The card must be `UNASSIGNED` and have no assigned mechanic. The mechanic must exist, be `AVAILABLE`, and have no active job card. Assignment atomically sets the card's `assigned_mechanic_id`, sets the mechanic's status to `ACTIVE_JOB` and `active_job_card_id` to this card, and increments both versions. The card remains `UNASSIGNED` until started. Returns `200 OK`, the updated job-card resource, and its new ETag. Invalid state or unavailable mechanic returns `409 WORKFLOW_CONFLICT`.

### 7.5 Start work

`POST /api/v1/job-cards/{id}/start`

Requires the current job-card ETag in `If-Match`. The card must be `UNASSIGNED` and assigned to a mechanic that is `ACTIVE_JOB` for this card. Sets the card status to `IN_PROGRESS`, increments its version, and returns `200 OK`, the updated job-card resource, and its new ETag. A card that is unassigned or in any other status returns `409 WORKFLOW_CONFLICT`.

### 7.6 Complete work

`POST /api/v1/job-cards/{id}/complete`

Requires the current job-card ETag in `If-Match`. The card must be `IN_PROGRESS`. Atomically sets the card status to `COMPLETED`, clears `assigned_mechanic_id`, sets its assigned mechanic to `AVAILABLE` with `active_job_card_id: null`, and increments the card and mechanic versions. Returns `200 OK`, the updated job-card resource, and its new ETag. A card not in progress returns `409 WORKFLOW_CONFLICT`.

### 7.7 Cancel a job card

`POST /api/v1/job-cards/{id}/cancel`

Requires the current job-card ETag in `If-Match`. A card in `UNASSIGNED` or `IN_PROGRESS` may be cancelled. Atomically sets its status to `CANCELLED`; if a mechanic is assigned, clears `assigned_mechanic_id` and sets that mechanic to `AVAILABLE` with `active_job_card_id: null`. Increments the card version and, when applicable, the mechanic version. Returns `200 OK`, the updated job-card resource, and its new ETag. A `COMPLETED` or already `CANCELLED` card returns `409 WORKFLOW_CONFLICT`.

### 7.8 Allowed state transitions

| Operation | Required current card state | Resulting card state |
|---|---|---|
| Create | — | `UNASSIGNED` |
| Assign | `UNASSIGNED`, no mechanic assigned | `UNASSIGNED`, mechanic assigned |
| Start | `UNASSIGNED`, mechanic assigned | `IN_PROGRESS` |
| Complete | `IN_PROGRESS` | `COMPLETED`, mechanic released |
| Cancel | `UNASSIGNED` or `IN_PROGRESS` | `CANCELLED`, mechanic released if assigned |

`COMPLETED` and `CANCELLED` are terminal states. Reassignment, restart, completion of a non-started card, and cancellation of a terminal card are not supported.
