import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthGate } from '@/app/AuthGate';
import { request, useAuth } from '@/data/authClient';

afterEach(() => { vi.unstubAllGlobals(); useAuth.setState({ status: 'unknown', user: null }); });

it.each([503, 502, 401, 404])('keeps the game closed when the session service returns %s', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>', { status })));
  render(<MemoryRouter><AuthGate server>{() => <p>Private game</p>}</AuthGate></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Bristol is temporarily unavailable' })).toBeInTheDocument();
  expect(screen.queryByText('Private game')).not.toBeInTheDocument();
});

it.each([{}, { authenticated: true, requireAuth: true, user: null }])('refuses malformed successful session responses: %j', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  await useAuth.getState().check();
  expect(useAuth.getState().status).toBe('error');
});

it('recovers from a network error only after an explicit valid session response', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify({ authenticated: false, requireAuth: false, user: null })));
  vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><AuthGate server>{() => <p>Local game</p>}</AuthGate></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Local game')).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('requires sign-in when the private server reports no session', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ authenticated: false, requireAuth: true, user: null }))));
  await useAuth.getState().check();
  expect(useAuth.getState().status).toBe('signed-out');
});

it('returns a recoverable error for failed account requests', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const r = await request('/api/auth/profile', { method: 'POST', body: { displayName: 'Alice' } });
  expect(r.status).toBe(0);
  expect(r.body.error?.message).toContain('try again');
});

it('does not claim the server session was revoked when logout fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  useAuth.setState({ status: 'signed-in' });
  await expect(useAuth.getState().signOut()).rejects.toThrow();
  expect(useAuth.getState().status).toBe('signed-in');
});
