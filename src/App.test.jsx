import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import App from './App';

vi.mock('axios', () => ({
  default: {
    request: vi.fn(),
  },
}));

const session = {
  user: { id: 'owner-1', name: 'Owner User', email: 'owner@example.com', role: 'owner' },
  garage: { id: 'garage-1', name: 'Northside Garage', time_zone: 'UTC', version: 1 },
  csrf_token: 'csrf-token',
};

function jsonResponse(data, status = 200) {
  return { data, status };
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    axios.request.mockReset();
  });

  beforeEach(() => {
    axios.request.mockRejectedValue({
      response: { data: { error: { message: 'Authentication required.' } } },
    });
  });

  it('renders the owner sign-in screen when no session is active', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: /gossa owner sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveValue('');
    expect(screen.getByLabelText(/password/i)).toHaveValue('');
  });

  it('renders mechanics from the paginated list response', async () => {
    axios.request.mockImplementation(async ({ url }) => {
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
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'mechanics' }));

    expect(await screen.findByText('Alex Mechanic')).toBeInTheDocument();
  });

  it('refreshes the mechanics list after a successful create', async () => {
    let mechanics = [];
    axios.request.mockImplementation(async ({ url, method = 'get' }) => {
      if (url.endsWith('/auth/me')) {
        return jsonResponse({ data: session });
      }
      if (url.endsWith('/mechanics') && method.toUpperCase() === 'POST') {
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
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'mechanics' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add mechanic' }));

    expect(await screen.findByText('Alex Mechanic')).toBeInTheDocument();
  });

  it('renders jobs from the paginated list response', async () => {
    axios.request.mockImplementation(async ({ url }) => {
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
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'jobs' }));

    expect(await screen.findByText('JC-2026-001')).toBeInTheDocument();
  });
});
