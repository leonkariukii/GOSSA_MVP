// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the owner sign-in form when no authenticated session exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => ({ error: { message: 'Unauthenticated' } }),
      }),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'GOSSA owner sign in' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });
});
