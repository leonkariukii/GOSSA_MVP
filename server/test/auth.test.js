import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { app } from '../src/index.js';
import { ensureStore, saveStore } from '../src/store.js';

const agent = request.agent(app);

beforeAll(async () => {
  const store = await ensureStore();
  if (!store.owner) {
    store.owner = {
      id: 'owner_seed',
      garage_id: store.garage.id,
      name: 'Owner User',
      email: 'owner@example.com',
      password_hash: await hash('ChangeMe123!'),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
    store.garage.name = 'Northside Garage';
    store.garage.time_zone = 'UTC';
    await saveStore(store);
  }
});

afterEach(async () => {
  const store = await ensureStore();
  store.sessions = [];
  await saveStore(store);
});

describe('owner auth and garage', () => {
  it('logs the owner in and returns the session data', async () => {
    const response = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'owner@example.com', password: 'ChangeMe123!' })
      .expect(200);

    expect(response.body.data.user.role).toBe('owner');
    expect(response.body.data.garage.name).toBe('Northside Garage');
    expect(response.body.data.csrf_token).toBeTruthy();
  });

  it('requires auth for protected routes', async () => {
    await request(app).get('/api/v1/garage').expect(401);
  });

  it('allows garage updates with CSRF and If-Match', async () => {
    const loginResponse = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'owner@example.com', password: 'ChangeMe123!' })
      .expect(200);

    const csrfToken = loginResponse.body.data.csrf_token;
    await agent.get('/api/v1/garage').expect(200);

    const response = await agent
      .patch('/api/v1/garage')
      .set('X-CSRF-Token', csrfToken)
      .set('If-Match', '"v1"')
      .send({ name: 'Updated Garage', time_zone: 'UTC' })
      .expect(200);

    expect(response.body.data.name).toBe('Updated Garage');
  });
});
