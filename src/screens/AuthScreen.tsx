import { useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Tabs } from '@/ui/Tabs';
import { errorText, request, useAuth, type AuthUser } from '@/data/authClient';

type Mode = 'signin' | 'join' | 'reset';

/** Sign in / join with an invite / reset with an administrator's code. Shown before the game when the server requires accounts. */
export function AuthScreen() {
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<Mode>(params.get('invite') ? 'join' : 'signin');
  const [f, setF] = useState({ username: '', password: '', displayName: '', invite: params.get('invite') ?? '', code: '' });
  const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null); const [pending, setPending] = useState(false);
  const setUser = useAuth((s) => s.setUser);
  const on = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setInfo(null); setPending(true);
    try {
      if (mode === 'reset') {
        const r = await request('/api/auth/reset', { method: 'POST', body: { username: f.username, code: f.code.trim(), newPassword: f.password } });
        if (r.status !== 200) setError(errorText(r)); else { setInfo('Password changed. Sign in with your new password.'); setMode('signin'); setF({ ...f, password: '', code: '' }); }
        return;
      }
      const r = await request<{ user: AuthUser }>(mode === 'join' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: mode === 'join' ? { invite: f.invite.trim(), username: f.username, password: f.password, displayName: f.displayName || f.username } : { username: f.username, password: f.password } });
      if (r.status !== 200) { setError(errorText(r)); return; }
      if (mode === 'join') window.history.replaceState(null, '', '/city');
      setUser(r.body.user);
    } catch { setError('Could not reach the game server.'); } finally { setPending(false); }
  }

  return (
    <main className="pe-auth" id="main">
      <div className="pe-auth-card pe-card">
        <div className="pe-brand"><span className="pe-brand-mark" aria-hidden="true">PE</span><div><strong>PENNY EMPIRE</strong><small>Private alpha · Bristol</small></div></div>
        <Tabs label="Account" value={mode} onChange={(m) => { setMode(m as Mode); setError(null); }} tabs={[{ id: 'signin', label: 'Sign in' }, { id: 'join', label: 'Join with invite' }, { id: 'reset', label: 'Reset password' }]}>
        <form onSubmit={submit} className="pe-forms" noValidate>
          {mode === 'join' && <Field label="Invite code" hint="Invites are single-use. Ask the alpha organiser for one."><input value={f.invite} onChange={on('invite')} autoComplete="off" required /></Field>}
          <Field label="Username" hint={mode === 'join' ? '3–20 characters: lowercase letters, digits, underscores.' : undefined}><input value={f.username} onChange={on('username')} autoComplete="username" autoCapitalize="none" required /></Field>
          {mode === 'join' && <Field label="Display name" hint="Shown to other players on rankings and the exchange."><input value={f.displayName} onChange={on('displayName')} maxLength={32} /></Field>}
          {mode === 'reset' && <Field label="Reset code" hint="An administrator gives you a one-time code. It expires after 24 hours."><input value={f.code} onChange={on('code')} autoComplete="one-time-code" required /></Field>}
          <Field label={mode === 'signin' ? 'Password' : 'New password'} hint={mode === 'signin' ? undefined : 'At least 10 characters.'}><input type="password" value={f.password} onChange={on('password')} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required /></Field>
          {error && <p className="pe-field-error" role="alert">{error}</p>}
          {info && <p className="pe-callout" role="status">{info}</p>}
          <Button type="submit" variant="primary" block pending={pending}>{mode === 'signin' ? 'Sign in' : mode === 'join' ? 'Create account' : 'Set new password'}</Button>
        </form>
        </Tabs>
        <p className="pe-hint">Penny Empire uses game coins only. The GBP wallet in this alpha is SIMULATED: no real money can be deposited, won or withdrawn.</p>
      </div>
    </main>
  );
}
