import { useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { errorText, request, useAuth, type AuthUser } from '@/data/authClient';
import { useUi } from '@/state/ui';

/** Profile, settings, password and sessions. Credentials never leave this form except to the server over the same origin. */
export function AccountScreen() {
  const { user, setUser, signOut, status } = useAuth();
  const notify = useUi((s) => s.notify);
  const [name, setName] = useState(user?.displayName ?? '');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [err, setErr] = useState<string | null>(null); const [pending, setPending] = useState<string | null>(null);
  if (status === 'open' || !user) return <section className="pe-screen"><h1 className="pe-h">Account</h1><p className="pe-hint">This local server runs without accounts (single-player development mode).</p></section>;

  const save = async (body: Record<string, unknown>, what: string) => {
    setPending(what); setErr(null);
    const r = await request<{ user: AuthUser }>('/api/auth/profile', { method: 'POST', body }); setPending(null);
    if (r.status !== 200) { setErr(errorText(r)); return; }
    setUser(r.body.user); notify({ tone: 'success', title: 'Saved' });
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault(); setPending('pw'); setErr(null);
    const r = await request('/api/auth/password', { method: 'POST', body: { currentPassword: pw.current, newPassword: pw.next } }); setPending(null);
    if (r.status !== 200) { setErr(errorText(r)); return; }
    setPw({ current: '', next: '' }); notify({ tone: 'success', title: 'Password changed', message: 'Other devices have been signed out.' });
  };
  const logout = async (all: boolean) => {
    setPending('logout'); setErr(null);
    try { await signOut(all); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not sign out. Please try again.'); } finally { setPending(null); }
  };
  const toggle = (k: keyof AuthUser['settings']) => save({ settings: { [k]: !user.settings[k] } }, k);

  return (
    <section className="pe-screen pe-account">
      <h1 className="pe-h">Account</h1>
      {err && <p className="pe-field-error" role="alert">{err}</p>}
      <div className="pe-cards">
        <form className="pe-card pe-form-card" onSubmit={(e) => { e.preventDefault(); void save({ displayName: name }, 'name'); }}>
          <h2>Profile</h2>
          <dl className="pe-kv"><dt>Username</dt><dd>{user.username}</dd><dt>Role</dt><dd>{user.role === 'admin' ? 'Administrator' : 'Player'}</dd></dl>
          <Field label="Display name" hint="Shown to other players."><input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} /></Field>
          <Button type="submit" variant="primary" pending={pending === 'name'}>Save name</Button>
        </form>
        <div className="pe-card">
          <h2>Settings</h2>
          <div className="pe-checks">
            {([['notifications', 'Pop-up alerts for real events'], ['reducedMotion', 'Reduce city animation'], ['hideOnboarding', 'Hide the getting-started checklist']] as const).map(([k, label]) => (
              <label key={k} className="pe-check"><input type="checkbox" checked={k === 'notifications' ? user.settings.notifications !== false : !!user.settings[k]} onChange={() => (k === 'notifications' ? save({ settings: { notifications: user.settings.notifications === false } }, k) : toggle(k))} disabled={pending === k} /> {label}</label>
            ))}
          </div>
        </div>
        <form className="pe-card pe-form-card" onSubmit={changePw}>
          <h2>Password</h2>
          <Field label="Current password"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password" hint="At least 10 characters. Changing it signs out your other devices."><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Button type="submit" pending={pending === 'pw'}>Change password</Button>
          <p className="pe-hint">Forgotten passwords are reset with a one-time code from an administrator.</p>
        </form>
        <div className="pe-card">
          <h2>Sessions</h2>
          <div className="pe-actions"><Button pending={pending === 'logout'} onClick={() => void logout(false)}>Sign out</Button><Button variant="destructive" pending={pending === 'logout'} onClick={() => void logout(true)}>Sign out everywhere</Button></div>
        </div>
      </div>
    </section>
  );
}
