import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const session = {
  user: { id: 'owner-1', name: 'Owner User', email: 'owner@example.com', role: 'owner' },
  garage: { id: 'garage-1', name: 'Northside Garage', time_zone: 'UTC', version: 1 },
  csrf_token: 'csrf-token',
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Authentication required.' } }),
    })));
  });

  it('renders the owner sign-in screen when no session is active', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: /gossa owner sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('renders mechanics from the paginated list response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/auth/me')) {
        return jsonResponse({ data: session });
      }
      if (url.endsWith('/mechanics')) {
        return jsonResponse({
          data: [{
            id: 'mechanic-1',
            name: 'Alex Mechanic',
            phone: '+254700000000',
            duty_status: 'available',
          }],
          page: 1,
          page_size: 25,
          total: 1,
        });
      }
      return jsonResponse({ data: {} });
    }));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'mechanics' }));

    expect(await screen.findByText('Alex Mechanic')).toBeInTheDocument();
  });

  it('refreshes the mechanics list after a successful create', async () => {
    let mechanics = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.endsWith('/auth/me')) {
        return jsonResponse({ data: session });
      }
      if (url.endsWith('/mechanics') && options.method === 'POST') {
        mechanics = [{
          id: 'mechanic-1',
          name: 'Alex Mechanic',
          phone: '+254700000000',
          duty_status: 'available',
        }];
        return jsonResponse({ data: mechanics[0] }, 201);
      }
      if (url.endsWith('/mechanics')) {
        return jsonResponse({
          data: mechanics,
          page: 1,
          page_size: 25,
          total: mechanics.length,
        });
      }
      return jsonResponse({ data: {} });
    }));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'mechanics' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add mechanic' }));

    expect(await screen.findByText('Alex Mechanic')).toBeInTheDocument();
  });

  it('renders jobs from the paginated list response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/auth/me')) {
        return jsonResponse({ data: session });
      }
      if (url.endsWith('/jobs')) {
        return jsonResponse({
          data: [{
            id: 'job-1',
            job_number: 'JC-2026-001',
            customer_name: 'Sam Example',
            status: 'open',
          }],
          page: 1,
          page_size: 25,
          total: 1,
        });
      }
      return jsonResponse({ data: {} });
    }));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'jobs' }));

    expect(await screen.findByText('JC-2026-001')).toBeInTheDocument();
  });
});
