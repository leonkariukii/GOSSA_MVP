import express from 'express';
import crypto from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { z } from 'zod';
import { ensureStore, saveStore } from './store.js';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);

let store = await ensureStore();

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

const garagePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  time_zone: z.string().trim().min(1).max(64).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required.',
});

const mechanicCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).nullable().optional(),
  skills: z.string().trim().max(500).nullable().optional(),
});

const mechanicPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  skills: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required.',
});

const jobCreateSchema = z.object({
  customer_name: z.string().trim().min(1).max(160),
  customer_phone: z.string().trim().max(32).nullable().optional(),
  vehicle_registration: z.string().trim().min(1).max(32),
  vehicle_make: z.string().trim().max(80).nullable().optional(),
  vehicle_model: z.string().trim().max(80).nullable().optional(),
  vehicle_year: z.number().int().min(1886).max(new Date().getFullYear() + 1).nullable().optional(),
  odometer_km: z.number().int().nonnegative().nullable().optional(),
  work_requested: z.string().trim().min(1).max(4000),
  diagnosis: z.string().trim().max(4000).nullable().optional(),
  work_performed: z.string().trim().max(4000).nullable().optional(),
  internal_notes: z.string().trim().max(4000).nullable().optional(),
});

const jobPatchSchema = z.object({
  customer_name: z.string().trim().min(1).max(160).optional(),
  customer_phone: z.string().trim().max(32).nullable().optional(),
  vehicle_registration: z.string().trim().min(1).max(32).optional(),
  vehicle_make: z.string().trim().max(80).nullable().optional(),
  vehicle_model: z.string().trim().max(80).nullable().optional(),
  vehicle_year: z.number().int().min(1886).max(new Date().getFullYear() + 1).nullable().optional(),
  odometer_km: z.number().int().nonnegative().nullable().optional(),
  work_requested: z.string().trim().min(1).max(4000).optional(),
  diagnosis: z.string().trim().max(4000).nullable().optional(),
  work_performed: z.string().trim().max(4000).nullable().optional(),
  internal_notes: z.string().trim().max(4000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required.',
});

const validStates = ['open', 'in_progress', 'waiting', 'completed', 'cancelled'];
const validDutyStatuses = ['available', 'busy', 'off_duty'];
const SORT_KEYS = {
  mechanics: ['name', 'created_at', 'updated_at'],
  jobs: ['updated_at', 'created_at', 'job_number'],
};

function nowIso() {
  return new Date().toISOString();
}

function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sanitizeText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value).trim();
}

function normalizeRegistration(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s\-_/.,]+/g, '');
}

function getGarageYear() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: store.garage.time_zone,
    year: 'numeric',
  }).format(new Date());
}

function buildJobNumber() {
  const year = getGarageYear();
  const current = Number(store.nextJobSequence[year] || 0) + 1;
  store.nextJobSequence[year] = current;
  return `JC-${year}-${String(current).padStart(3, '0')}`;
}

function withSaved(fn) {
  return async (...args) => {
    const result = await fn(...args);
    await saveStore(store);
    return result;
  };
}

function publicGarage(garage) {
  return {
    id: garage.id,
    name: garage.name,
    time_zone: garage.time_zone,
    version: garage.version,
  };
}

function sendError(req, res, status, code, message, details = []) {
  const payload = {
    error: {
      code,
      message,
      status,
      timestamp: nowIso(),
      request_id: req.requestId,
    },
  };
  if (details.length) {
    payload.error.details = details;
  }
  res.status(status).json(payload);
}

function parseIfMatch(req) {
  const header = req.headers['if-match'];
  if (!header) {
    return { ok: false, status: 428, version: null };
  }

  const match = String(header).match(/"?v(\d+)"?/i);
  if (!match) {
    return { ok: false, status: 428, version: null };
  }

  return { ok: true, status: 200, version: Number(match[1]) };
}

function ensureGarageOwnerAvailable() {
  if (!store.owner) {
    throw new Error('Owner account is not initialized. Run the bootstrap command.');
  }
}

function getSessionFromCookie(req) {
  const cookies = req.headers.cookie ?? '';
  const match = cookies
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('session_id='));

  if (!match) {
    return null;
  }

  return decodeURIComponent(match.slice('session_id='.length));
}

function currentSession(req) {
  const token = getSessionFromCookie(req);
  if (!token) {
    return null;
  }

  const sessionHash = hashToken(token);
  return store.sessions.find((session) => session.session_id_hash === sessionHash) ?? null;
}

async function requireAuth(req, res, next) {
  const session = currentSession(req);
  if (!session) {
    sendError(req, res, 401, 'UNAUTHENTICATED', 'Authentication required.');
    return;
  }

  const now = Date.now();
  const idleExpiresAt = new Date(session.idle_expires_at).getTime();
  const absoluteExpiresAt = new Date(session.absolute_expires_at).getTime();

  if (session.revoked_at || now > idleExpiresAt || now > absoluteExpiresAt) {
    session.revoked_at = nowIso();
    await saveStore(store);
    sendError(req, res, 401, 'UNAUTHENTICATED', 'Authentication required.');
    return;
  }

  session.last_activity_at = nowIso();
  session.idle_expires_at = new Date(now + 8 * 60 * 60 * 1000).toISOString();
  if (new Date(session.idle_expires_at).getTime() > absoluteExpiresAt) {
    session.idle_expires_at = new Date(absoluteExpiresAt).toISOString();
  }
  await saveStore(store);

  const owner = store.owner;
  req.owner = owner;
  req.session = session;
  next();
}

function requireCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'];
  if (!token || !req.session) {
    sendError(req, res, 403, 'CSRF_FAILED', 'Invalid CSRF token.');
    return;
  }

  const baseValue = Buffer.from(String(token));
  const expected = Buffer.from(String(req.session.csrf_token));
  if (baseValue.length !== expected.length || !crypto.timingSafeEqual(baseValue, expected)) {
    sendError(req, res, 403, 'CSRF_FAILED', 'Invalid CSRF token.');
    return;
  }

  next();
}

function resolveMechanic(mechanicId) {
  return store.mechanics.find((mechanic) => mechanic.id === mechanicId && mechanic.garage_id === store.garage.id) ?? null;
}

function reconcileMechanicDutyStatus(mechanic) {
  if (!mechanic || mechanic.archived_at) {
    return;
  }

  const activeInProgress = store.jobs.some(
    (job) => job.assigned_mechanic_id === mechanic.id && !job.archived_at && job.status === 'in_progress',
  );

  if (activeInProgress) {
    mechanic.duty_status = 'busy';
    mechanic.version += 1;
    mechanic.updated_at = nowIso();
    return;
  }

  if (mechanic.duty_status === 'busy') {
    mechanic.duty_status = 'available';
  } else if (mechanic.duty_status !== 'off_duty') {
    mechanic.duty_status = 'available';
  }
  mechanic.updated_at = nowIso();
}

function ensureMechanicAssignmentAllowed(mechanic, job) {
  if (!mechanic || mechanic.archived_at || mechanic.garage_id !== store.garage.id) {
    throw Object.assign(new Error('mechanic_id'), { code: 'VALIDATION_ERROR', details: [{ field: 'mechanic_id', code: 'invalid', message: 'Mechanic not found.' }] });
  }

  if (mechanic.duty_status === 'off_duty') {
    throw Object.assign(new Error('Mechanic is off duty.'), { code: 'MECHANIC_UNAVAILABLE' });
  }

  const otherActive = store.jobs.some(
    (candidate) => candidate.id !== job.id && candidate.assigned_mechanic_id === mechanic.id && !candidate.archived_at && candidate.status === 'in_progress',
  );

  if (otherActive) {
    throw Object.assign(new Error('Mechanic already assigned to an active job.'), { code: 'MECHANIC_OCCUPIED' });
  }
}

function findActiveVehicleJob(vehicleRegistration) {
  const normalized = normalizeRegistration(vehicleRegistration);
  return store.jobs.find(
    (job) => !job.archived_at && normalizeRegistration(job.vehicle_registration) === normalized && !['completed', 'cancelled'].includes(job.status),
  );
}

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/v1/auth/login', async (req, res) => {
  try {
    ensureGarageOwnerAvailable();
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(req, res, 401, 'UNAUTHENTICATED', 'Invalid credentials.');
      return;
    }

    const { email, password } = parsed.data;
    const owner = store.owner;
    if (!owner || owner.email !== email.toLowerCase()) {
      sendError(req, res, 401, 'UNAUTHENTICATED', 'Invalid credentials.');
      return;
    }

    const matches = await verify(owner.password_hash, password);
    if (!matches) {
      sendError(req, res, 401, 'UNAUTHENTICATED', 'Invalid credentials.');
      return;
    }

    const sessionId = crypto.randomUUID();
    const csrfToken = crypto.randomUUID();
    const now = nowIso();
    const session = {
      id: crypto.randomUUID(),
      session_id_hash: hashToken(sessionId),
      owner_user_id: owner.id,
      csrf_token: csrfToken,
      created_at: now,
      last_activity_at: now,
      idle_expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      revoked_at: null,
    };

    store.sessions.push(session);
    await saveStore(store);

    res.cookie('session_id', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
    });

    res.json({
      data: {
        user: {
          id: owner.id,
          email: owner.email,
          name: owner.name,
          role: 'owner',
        },
        garage: publicGarage(store.garage),
        csrf_token: csrfToken,
      },
    });
  } catch (error) {
    sendError(req, res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
  }
});

app.post('/api/v1/auth/logout', requireAuth, requireCsrf, async (req, res) => {
  req.session.revoked_at = nowIso();
  await saveStore(store);
  res.clearCookie('session_id', { path: '/' });
  res.status(204).send();
});

app.get('/api/v1/auth/me', requireAuth, async (req, res) => {
  res.json({
    data: {
      user: {
        id: req.owner.id,
        email: req.owner.email,
        name: req.owner.name,
        role: 'owner',
      },
      garage: publicGarage(store.garage),
      csrf_token: req.session.csrf_token,
    },
  });
});

app.get('/api/v1/garage', requireAuth, async (req, res) => {
  res.json({ data: publicGarage(store.garage) });
});

app.patch('/api/v1/garage', requireAuth, requireCsrf, async (req, res) => {
  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  if (match.version !== store.garage.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The garage version is stale.');
    return;
  }

  try {
    const parsed = garagePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(req, res, 422, 'VALIDATION_ERROR', 'Invalid garage details.', [{ field: 'garage', code: 'invalid', message: 'At least one field is required.' }]);
      return;
    }

    const changes = parsed.data;
    if (changes.name) {
      store.garage.name = changes.name.trim();
    }
    if (changes.time_zone) {
      const supportedZones = Intl.supportedValuesOf('timeZone');
      if (changes.time_zone !== 'UTC' && !supportedZones.includes(changes.time_zone)) {
        sendError(req, res, 422, 'VALIDATION_ERROR', 'Invalid time zone.', [{ field: 'time_zone', code: 'invalid', message: 'Must be a valid IANA time zone.' }]);
        return;
      }
      store.garage.time_zone = changes.time_zone;
    }

    store.garage.updated_at = nowIso();
    store.garage.version += 1;
    await saveStore(store);
    res.json({ data: publicGarage(store.garage) });
  } catch (error) {
    sendError(req, res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
  }
});

app.get('/api/v1/dashboard', requireAuth, async (req, res) => {
  const jobs = store.jobs.filter((job) => !job.archived_at);
  const recent = [...jobs]
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10)
    .map((job) => {
      const mechanic = resolveMechanic(job.assigned_mechanic_id);
      return {
        id: job.id,
        job_number: job.job_number,
        status: job.status,
        customer_name: job.customer_name,
        vehicle_registration: job.vehicle_registration,
        assigned_mechanic: mechanic ? { id: mechanic.id, name: mechanic.name } : null,
        updated_at: job.updated_at,
      };
    });

  const today = new Date();
  const timeZone = store.garage.time_zone;
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(today);
  const localDate = `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`;
  const startOfDay = new Date(`${localDate}T00:00:00Z`);
  const endOfDay = new Date(`${localDate}T23:59:59Z`);

  const completedToday = store.jobHistory.filter((entry) => {
    const created = new Date(entry.created_at).getTime();
    return entry.to_status === 'completed' && created >= startOfDay.getTime() && created <= endOfDay.getTime();
  }).length;

  res.json({
    data: {
      open_count: jobs.filter((job) => job.status === 'open').length,
      in_progress_count: jobs.filter((job) => job.status === 'in_progress').length,
      waiting_count: jobs.filter((job) => job.status === 'waiting').length,
      completed_today_count: completedToday,
      recent_jobs: recent,
    },
  });
});

app.get('/api/v1/mechanics', requireAuth, async (req, res) => {
  const { q, duty_status, include_archived, sort_by, order, page, page_size } = req.query;

  let mechanics = [...store.mechanics];
  if (include_archived !== 'true') {
    mechanics = mechanics.filter((mechanic) => !mechanic.archived_at);
  }

  if (duty_status && validDutyStatuses.includes(duty_status)) {
    mechanics = mechanics.filter((mechanic) => mechanic.duty_status === duty_status);
  }

  if (q) {
    const needle = String(q).trim().toLowerCase();
    mechanics = mechanics.filter((mechanic) => `${mechanic.name} ${mechanic.phone ?? ''}`.toLowerCase().includes(needle));
  }

  const allowedSort = SORT_KEYS.mechanics.includes(sort_by) ? sort_by : 'updated_at';
  const sortOrder = order === 'asc' ? 1 : -1;
  mechanics.sort((a, b) => {
    const left = a[allowedSort] ?? '';
    const right = b[allowedSort] ?? '';
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * sortOrder;
    }
    return String(left).localeCompare(String(right)) * sortOrder;
  });

  const pageNumber = Number(page) > 0 ? Number(page) : 1;
  const pageSize = Number(page_size) > 0 ? Number(page_size) : 25;
  const total = mechanics.length;
  const start = (pageNumber - 1) * pageSize;
  const end = start + pageSize;

  res.json({
    data: mechanics.slice(start, end),
    page: pageNumber,
    page_size: pageSize,
    total,
  });
});

app.post('/api/v1/mechanics', requireAuth, requireCsrf, async (req, res) => {
  try {
    const parsed = mechanicCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(req, res, 422, 'VALIDATION_ERROR', 'Invalid mechanic details.');
      return;
    }

    const payload = parsed.data;
    const mechanic = {
      id: crypto.randomUUID(),
      garage_id: store.garage.id,
      name: payload.name.trim(),
      phone: payload.phone ? payload.phone.trim() : null,
      skills: payload.skills ? payload.skills.trim() : null,
      duty_status: 'available',
      created_at: nowIso(),
      updated_at: nowIso(),
      version: 1,
      archived_at: null,
    };

    store.mechanics.push(mechanic);
    await saveStore(store);
    res.set('Location', `/api/v1/mechanics/${mechanic.id}`);
    res.status(201).json({ data: mechanic });
  } catch (error) {
    sendError(req, res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
  }
});

app.get('/api/v1/mechanics/:id', requireAuth, async (req, res) => {
  const mechanic = resolveMechanic(req.params.id);
  if (!mechanic) {
    sendError(req, res, 404, 'NOT_FOUND', 'Mechanic not found.');
    return;
  }

  res.json({ data: mechanic });
});

app.patch('/api/v1/mechanics/:id', requireAuth, requireCsrf, async (req, res) => {
  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  const mechanic = resolveMechanic(req.params.id);
  if (!mechanic) {
    sendError(req, res, 404, 'NOT_FOUND', 'Mechanic not found.');
    return;
  }

  if (match.version !== mechanic.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The mechanic version is stale.');
    return;
  }

  const parsed = mechanicPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendError(req, res, 422, 'VALIDATION_ERROR', 'Invalid mechanic update.');
    return;
  }

  const updates = parsed.data;
  if (updates.name) mechanic.name = updates.name.trim();
  if (updates.phone !== undefined) mechanic.phone = updates.phone ? updates.phone.trim() : null;
  if (updates.skills !== undefined) mechanic.skills = updates.skills ? updates.skills.trim() : null;

  mechanic.updated_at = nowIso();
  mechanic.version += 1;
  await saveStore(store);
  res.json({ data: mechanic });
});

app.post('/api/v1/mechanics/:id/off-duty', requireAuth, requireCsrf, async (req, res) => {
  const mechanic = resolveMechanic(req.params.id);
  if (!mechanic) {
    sendError(req, res, 404, 'NOT_FOUND', 'Mechanic not found.');
    return;
  }

  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  if (match.version !== mechanic.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The mechanic version is stale.');
    return;
  }

  const activeJob = store.jobs.some(
    (job) => job.assigned_mechanic_id === mechanic.id && job.status === 'in_progress' && !job.archived_at,
  );
  if (activeJob) {
    sendError(req, res, 409, 'MECHANIC_HAS_ACTIVE_JOB', 'This mechanic is currently working a job.');
    return;
  }

  mechanic.duty_status = 'off_duty';
  mechanic.version += 1;
  mechanic.updated_at = nowIso();
  await saveStore(store);
  res.json({ data: mechanic });
});

app.post('/api/v1/mechanics/:id/available', requireAuth, requireCsrf, async (req, res) => {
  const mechanic = resolveMechanic(req.params.id);
  if (!mechanic) {
    sendError(req, res, 404, 'NOT_FOUND', 'Mechanic not found.');
    return;
  }

  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  if (match.version !== mechanic.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The mechanic version is stale.');
    return;
  }

  const activeJob = store.jobs.some(
    (job) => job.assigned_mechanic_id === mechanic.id && job.status === 'in_progress' && !job.archived_at,
  );
  if (activeJob) {
    sendError(req, res, 409, 'MECHANIC_HAS_ACTIVE_JOB', 'This mechanic is currently working a job.');
    return;
  }

  if (mechanic.duty_status !== 'off_duty') {
    sendError(req, res, 409, 'MECHANIC_HAS_ACTIVE_JOB', 'This mechanic is not off duty.');
    return;
  }

  mechanic.duty_status = 'available';
  mechanic.version += 1;
  mechanic.updated_at = nowIso();
  await saveStore(store);
  res.json({ data: mechanic });
});

app.post('/api/v1/mechanics/:id/archive', requireAuth, requireCsrf, async (req, res) => {
  const mechanic = resolveMechanic(req.params.id);
  if (!mechanic) {
    sendError(req, res, 404, 'NOT_FOUND', 'Mechanic not found.');
    return;
  }

  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  if (match.version !== mechanic.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The mechanic version is stale.');
    return;
  }

  const hasNonterminalJobs = store.jobs.some(
    (job) => job.assigned_mechanic_id === mechanic.id && !job.archived_at && ['open', 'in_progress', 'waiting'].includes(job.status),
  );

  if (hasNonterminalJobs) {
    sendError(req, res, 409, 'MECHANIC_HAS_NONTERMINAL_JOBS', 'This mechanic still has active jobs.');
    return;
  }

  mechanic.archived_at = nowIso();
  mechanic.version += 1;
  mechanic.updated_at = nowIso();
  await saveStore(store);
  res.json({ data: mechanic });
});

app.get('/api/v1/jobs', requireAuth, async (req, res) => {
  const { q, status, mechanic_id, include_archived, page, page_size, sort_by, order } = req.query;
  let jobs = [...store.jobs];
  if (include_archived !== 'true') {
    jobs = jobs.filter((job) => !job.archived_at);
  }

  if (status && validStates.includes(status)) {
    jobs = jobs.filter((job) => job.status === status);
  }

  if (mechanic_id) {
    jobs = jobs.filter((job) => job.assigned_mechanic_id === mechanic_id);
  }

  if (q) {
    const needle = String(q).trim().toLowerCase();
    jobs = jobs.filter((job) => `${job.job_number} ${job.customer_name} ${job.vehicle_registration}`.toLowerCase().includes(needle));
  }

  const allowedSort = SORT_KEYS.jobs.includes(sort_by) ? sort_by : 'updated_at';
  const sortOrder = order === 'asc' ? 1 : -1;
  jobs.sort((a, b) => {
    const left = a[allowedSort] ?? '';
    const right = b[allowedSort] ?? '';
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * sortOrder;
    }
    return String(left).localeCompare(String(right)) * sortOrder;
  });

  const pageNumber = Number(page) > 0 ? Number(page) : 1;
  const pageSize = Number(page_size) > 0 ? Number(page_size) : 25;
  const total = jobs.length;
  const start = (pageNumber - 1) * pageSize;
  const end = start + pageSize;

  res.json({
    data: jobs.slice(start, end),
    page: pageNumber,
    page_size: pageSize,
    total,
  });
});

app.post('/api/v1/jobs', requireAuth, requireCsrf, async (req, res) => {
  try {
    const parsed = jobCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(req, res, 422, 'VALIDATION_ERROR', 'Invalid job details.');
      return;
    }

    const payload = parsed.data;
    const normalizedReg = normalizeRegistration(payload.vehicle_registration);
    const duplicate = findActiveVehicleJob(normalizedReg);
    if (duplicate) {
      sendError(req, res, 409, 'DUPLICATE_ACTIVE_VEHICLE_JOB', 'Another active job uses this vehicle registration.');
      return;
    }

    const job = {
      id: crypto.randomUUID(),
      garage_id: store.garage.id,
      job_number: buildJobNumber(),
      status: 'open',
      customer_name: payload.customer_name.trim(),
      customer_phone: payload.customer_phone ? payload.customer_phone.trim() : null,
      vehicle_registration: payload.vehicle_registration.trim(),
      vehicle_make: payload.vehicle_make ? payload.vehicle_make.trim() : null,
      vehicle_model: payload.vehicle_model ? payload.vehicle_model.trim() : null,
      vehicle_year: payload.vehicle_year ?? null,
      odometer_km: payload.odometer_km ?? null,
      work_requested: payload.work_requested.trim(),
      diagnosis: payload.diagnosis ? payload.diagnosis.trim() : null,
      work_performed: payload.work_performed ? payload.work_performed.trim() : null,
      internal_notes: payload.internal_notes ? payload.internal_notes.trim() : null,
      assigned_mechanic_id: null,
      created_by_user_id: req.owner.id,
      created_at: nowIso(),
      updated_at: nowIso(),
      version: 1,
      archived_at: null,
    };

    store.jobs.push(job);
    await saveStore(store);
    res.set('Location', `/api/v1/jobs/${job.id}`);
    res.status(201).json({ data: job });
  } catch (error) {
    sendError(req, res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
  }
});

app.get('/api/v1/jobs/:id', requireAuth, async (req, res) => {
  const job = store.jobs.find((entry) => entry.id === req.params.id && entry.garage_id === store.garage.id);
  if (!job) {
    sendError(req, res, 404, 'NOT_FOUND', 'Job not found.');
    return;
  }

  res.json({ data: job });
});

app.patch('/api/v1/jobs/:id', requireAuth, requireCsrf, async (req, res) => {
  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  const job = store.jobs.find((entry) => entry.id === req.params.id && entry.garage_id === store.garage.id);
  if (!job) {
    sendError(req, res, 404, 'NOT_FOUND', 'Job not found.');
    return;
  }

  if (match.version !== job.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The job version is stale.');
    return;
  }

  const parsed = jobPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendError(req, res, 422, 'VALIDATION_ERROR', 'Invalid job update.');
    return;
  }

  const updates = parsed.data;
  if (updates.customer_name) job.customer_name = updates.customer_name.trim();
  if (updates.customer_phone !== undefined) job.customer_phone = updates.customer_phone ? updates.customer_phone.trim() : null;
  if (updates.vehicle_registration) {
    const duplicate = findActiveVehicleJob(updates.vehicle_registration);
    if (duplicate && duplicate.id !== job.id) {
      sendError(req, res, 409, 'DUPLICATE_ACTIVE_VEHICLE_JOB', 'Another active job uses this vehicle registration.');
      return;
    }
    job.vehicle_registration = updates.vehicle_registration.trim();
  }
  if (updates.vehicle_make !== undefined) job.vehicle_make = updates.vehicle_make ? updates.vehicle_make.trim() : null;
  if (updates.vehicle_model !== undefined) job.vehicle_model = updates.vehicle_model ? updates.vehicle_model.trim() : null;
  if (updates.vehicle_year !== undefined) job.vehicle_year = updates.vehicle_year ?? null;
  if (updates.odometer_km !== undefined) job.odometer_km = updates.odometer_km ?? null;
  if (updates.work_requested) job.work_requested = updates.work_requested.trim();
  if (updates.diagnosis !== undefined) job.diagnosis = updates.diagnosis ? updates.diagnosis.trim() : null;
  if (updates.work_performed !== undefined) job.work_performed = updates.work_performed ? updates.work_performed.trim() : null;
  if (updates.internal_notes !== undefined) job.internal_notes = updates.internal_notes ? updates.internal_notes.trim() : null;

  job.updated_at = nowIso();
  job.version += 1;
  await saveStore(store);
  res.json({ data: job });
});

app.post('/api/v1/jobs/:id/assignment', requireAuth, requireCsrf, async (req, res) => {
  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  const job = store.jobs.find((entry) => entry.id === req.params.id && entry.garage_id === store.garage.id);
  if (!job) {
    sendError(req, res, 404, 'NOT_FOUND', 'Job not found.');
    return;
  }

  if (match.version !== job.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The job version is stale.');
    return;
  }

  if (['completed', 'cancelled'].includes(job.status) || job.archived_at) {
    sendError(req, res, 409, 'CONFLICT', 'This job cannot be reassigned.');
    return;
  }

  const payload = req.body ?? {};
  const targetId = payload.mechanic_id ?? null;

  if (targetId === null) {
    if (job.status === 'in_progress') {
      sendError(req, res, 409, 'ACTIVE_JOB_CANNOT_BE_UNASSIGNED', 'An in-progress job cannot be left without an assigned mechanic.');
      return;
    }

    job.assigned_mechanic_id = null;
    job.updated_at = nowIso();
    job.version += 1;
    for (const mechanic of store.mechanics) {
      if (mechanic.id === job.assigned_mechanic_id || mechanic.id === job.assigned_mechanic_id) {
        reconcileMechanicDutyStatus(mechanic);
      }
    }
    await saveStore(store);
    res.json({ data: job });
    return;
  }

  const mechanic = resolveMechanic(targetId);
  if (!mechanic) {
    sendError(req, res, 422, 'VALIDATION_ERROR', 'Mechanic not found.', [{ field: 'mechanic_id', code: 'invalid', message: 'Mechanic not found.' }]);
    return;
  }

  if (mechanic.archived_at || mechanic.duty_status === 'off_duty') {
    sendError(req, res, 409, 'MECHANIC_UNAVAILABLE', 'This mechanic is not available.');
    return;
  }

  if (job.status === 'in_progress') {
    const activeWithAnother = store.jobs.some(
      (candidate) => candidate.id !== job.id && candidate.assigned_mechanic_id === mechanic.id && candidate.status === 'in_progress' && !candidate.archived_at,
    );
    if (activeWithAnother) {
      sendError(req, res, 409, 'MECHANIC_OCCUPIED', 'This mechanic is already assigned to an active job.');
      return;
    }
  }

  if (job.status === 'in_progress' && mechanic.duty_status === 'busy') {
    sendError(req, res, 409, 'MECHANIC_OCCUPIED', 'This mechanic is already assigned to an active job.');
    return;
  }

  job.assigned_mechanic_id = mechanic.id;
  if (job.status === 'in_progress') {
    mechanic.duty_status = 'busy';
    mechanic.version += 1;
    mechanic.updated_at = nowIso();
  }
  job.updated_at = nowIso();
  job.version += 1;

  for (const storedMechanic of store.mechanics) {
    if (storedMechanic.id !== mechanic.id) {
      const activeForMechanic = store.jobs.some(
        (entry) => entry.assigned_mechanic_id === storedMechanic.id && entry.status === 'in_progress' && !entry.archived_at,
      );
      if (activeForMechanic) {
        storedMechanic.duty_status = 'busy';
      } else {
        storedMechanic.duty_status = storedMechanic.duty_status === 'off_duty' ? 'off_duty' : 'available';
      }
      storedMechanic.updated_at = nowIso();
    }
  }

  await saveStore(store);
  res.json({ data: job });
});

app.post('/api/v1/jobs/:id/transitions', requireAuth, requireCsrf, async (req, res) => {
  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  const job = store.jobs.find((entry) => entry.id === req.params.id && entry.garage_id === store.garage.id);
  if (!job) {
    sendError(req, res, 404, 'NOT_FOUND', 'Job not found.');
    return;
  }

  if (match.version !== job.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The job version is stale.');
    return;
  }

  const toStatus = req.body?.to_status;
  if (!validStates.includes(toStatus)) {
    sendError(req, res, 422, 'VALIDATION_ERROR', 'Invalid status transition.', [{ field: 'to_status', code: 'invalid', message: 'Status must be a valid job state.' }]);
    return;
  }

  const allowed = {
    open: ['in_progress', 'cancelled'],
    in_progress: ['waiting', 'completed', 'cancelled'],
    waiting: ['in_progress', 'cancelled'],
    completed: [],
    cancelled: [],
  };

  if (!allowed[job.status]?.includes(toStatus)) {
    sendError(req, res, 409, 'INVALID_STATUS_TRANSITION', 'The requested status transition is not allowed.');
    return;
  }

  if (toStatus === 'in_progress') {
    if (!job.assigned_mechanic_id) {
      sendError(req, res, 409, 'MECHANIC_UNAVAILABLE', 'A mechanic must be assigned before starting work.');
      return;
    }
    const mechanic = resolveMechanic(job.assigned_mechanic_id);
    if (!mechanic || mechanic.archived_at || mechanic.duty_status === 'off_duty') {
      sendError(req, res, 409, 'MECHANIC_UNAVAILABLE', 'Assigned mechanic is unavailable.');
      return;
    }
    const activeJob = store.jobs.some(
      (candidate) => candidate.id !== job.id && candidate.assigned_mechanic_id === mechanic.id && candidate.status === 'in_progress' && !candidate.archived_at,
    );
    if (activeJob) {
      sendError(req, res, 409, 'MECHANIC_OCCUPIED', 'This mechanic is already assigned to an active job.');
      return;
    }
  }

  const fromStatus = job.status;
  job.status = toStatus;
  job.updated_at = nowIso();
  job.version += 1;

  if (job.assigned_mechanic_id) {
    const mechanic = resolveMechanic(job.assigned_mechanic_id);
    if (mechanic) {
      reconcileMechanicDutyStatus(mechanic);
    }
  }

  store.jobHistory.push({
    id: crypto.randomUUID(),
    garage_id: job.garage_id,
    job_id: job.id,
    actor_user_id: req.owner.id,
    from_status: fromStatus,
    to_status: toStatus,
    note: req.body?.note ? String(req.body.note).trim().slice(0, 500) : null,
    created_at: nowIso(),
  });

  await saveStore(store);
  res.json({ data: job });
});

app.get('/api/v1/jobs/:id/history', requireAuth, async (req, res) => {
  const items = store.jobHistory.filter((entry) => entry.job_id === req.params.id && entry.garage_id === store.garage.id);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ data: items, page: 1, page_size: items.length, total: items.length });
});

app.post('/api/v1/jobs/:id/archive', requireAuth, requireCsrf, async (req, res) => {
  const match = parseIfMatch(req);
  if (!match.ok) {
    sendError(req, res, 428, 'PRECONDITION_REQUIRED', 'If-Match header is required.');
    return;
  }

  const job = store.jobs.find((entry) => entry.id === req.params.id && entry.garage_id === store.garage.id);
  if (!job) {
    sendError(req, res, 404, 'NOT_FOUND', 'Job not found.');
    return;
  }

  if (match.version !== job.version) {
    sendError(req, res, 412, 'PRECONDITION_FAILED', 'The job version is stale.');
    return;
  }

  if (!['completed', 'cancelled'].includes(job.status)) {
    sendError(req, res, 409, 'CONFLICT', 'Only terminal jobs can be archived.');
    return;
  }

  job.archived_at = nowIso();
  job.updated_at = nowIso();
  job.version += 1;
  await saveStore(store);
  res.json({ data: job });
});

app.use((req, res) => {
  sendError(req, res, 404, 'NOT_FOUND', 'Resource not found.');
});

app.use((error, req, res, next) => {
  if (error instanceof z.ZodError) {
    sendError(req, res, 422, 'VALIDATION_ERROR', 'Request validation failed.');
    return;
  }
  sendError(req, res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
  next();
});

const server = app.listen(port, () => {
  console.log(`GOSSA server listening on http://localhost:${port}`);
});

export { app, server };
