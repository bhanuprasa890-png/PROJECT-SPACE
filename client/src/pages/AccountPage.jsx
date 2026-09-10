import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar.jsx';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useMotionMode } from '../three/sceneUtils.js';

const RELATIVE = (iso) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function Row({ label, value, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--size-space-4)', padding: 'var(--size-space-3) 0', borderBottom: 'var(--size-border-hair) solid var(--color-border-hairline)' }}>
      <span className="dim" style={{ fontSize: 'var(--font-size-sm)' }}>
        {label}
      </span>
      <span className="mono" style={{ fontSize: 'var(--font-size-sm)', color: tone }}>
        {value}
      </span>
    </div>
  );
}

export default function AccountPage() {
  const { user, config, logout } = useAuth();
  const sessions = useAsync(() => api('/auth/sessions'), []);
  const { enabled, label, cycle } = useMotionMode();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Mise · Account';
  }, []);

  const theme = document.documentElement.dataset.theme ?? 'dark';

  return (
    <div className="app">
      <TopBar />
      <main className="wrap section" id="main" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--size-space-4)', alignItems: 'start' }}>
        <div className="panel">
          <div className="panel__title">
            <span>Profile</span>
            <span className="chip">{user?.provider === 'google' ? 'Google session' : 'Email session'}</span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--size-space-4)', alignItems: 'center' }}>
            <span className="avatar avatar--lg" aria-hidden="true">
              {(user?.name || 'M').slice(0, 1).toUpperCase()}
            </span>
            <div>
              <b style={{ fontSize: 'var(--font-size-lg)' }}>{user?.name}</b>
              <p className="dim" style={{ fontSize: 'var(--font-size-sm)' }}>
                {user?.email}
              </p>
            </div>
          </div>
          <div style={{ marginTop: 'var(--size-space-4)' }}>
            <Row label="Created" value={RELATIVE(user?.createdAt)} />
            <Row label="Last login" value={user?.lastLoginAt ? RELATIVE(user.lastLoginAt) : 'first session'} />
            <Row label="Password stored as" value="scrypt N=16384 r=8 p=1" tone="var(--color-ink-ok)" />
            <Row label="Session lifetime" value={`${config?.sessionTtlDays ?? 14} days, sliding`} />
            <Row label="Google mode" value={config?.googleMode ?? 'demo'} tone={config?.googleMode === 'live' ? 'var(--color-accent-herb)' : undefined} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--size-space-2)', marginTop: 'var(--size-space-5)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                document.documentElement.dataset.theme = next;
                localStorage.setItem('mise:theme', next);
              }}
            >
              Theme: {theme}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={cycle}>
              3D: {label} {enabled ? '· live' : '· static'}
            </button>
            <Link to="/logout" className="btn btn--danger btn--sm">
              Log out
            </Link>
          </div>
        </div>

        <div className="panel">
          <div className="panel__title">
            <span>Active sessions</span>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={async () => {
                await api('/auth/sessions/revoke-others', { method: 'POST', body: {} });
                sessions.reload();
              }}
            >
              Revoke others
            </button>
          </div>
          <p className="dim" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--size-space-3)' }}>
            The server keeps only sha256 of the session token, so a database leak cannot be replayed as a cookie.
          </p>
          <ul style={{ display: 'grid', gap: 'var(--size-space-2)' }}>
            {(sessions.data?.sessions ?? []).map((session) => (
              <li key={session.id} className="suggest__row">
                <span style={{ display: 'grid', gap: 2 }}>
                  <span>
                    {session.current ? 'This device' : 'Other device'}
                    {session.current ? <span className="chip" style={{ marginLeft: 8 }}>current</span> : null}
                  </span>
                  <small className="dim">
                    last seen {RELATIVE(session.lastSeenAt)} · expires {RELATIVE(session.expiresAt)}
                  </small>
                  <small className="dim mono" style={{ fontSize: 11 }}>{session.device}</small>
                </span>
                {!session.current ? (
                  <span className="chip" style={{ color: 'var(--color-ink-danger)' }}>
                    revoked by “Revoke others”
                  </span>
                ) : null}
              </li>
            ))}
            {sessions.loading ? <li className="dim">Loading…</li> : null}
          </ul>
        </div>

        <div className="panel">
          <div className="panel__title">How this login works</div>
          <ol style={{ display: 'grid', gap: 'var(--size-space-3)', counterReset: 'sec', fontSize: 'var(--font-size-sm)' }}>
            {[
              ['Google', 'Live mode verifies the GIS ID token against Google JWKS (iss / aud / exp / email_verified). Demo mode verifies a passcode against a scrypt hash on the server.'],
              ['Cookies', 'mise_sid is httpOnly + SameSite=Lax (+ Secure over HTTPS). The browser can never read it; the CSRF token is a separate readable cookie bound to the session id.'],
              ['Brute force', 'Per-IP sliding window plus 5 failed attempts per email → 15 minute pause. Failed logins are written to the auth_events table.'],
              ['Never', 'Passwords, tokens or secrets are not in the client bundle, not in localStorage, and not logged.'],
            ].map(([title, body]) => (
              <li key={title} style={{ display: 'grid', gap: 4 }}>
                <b>{title}</b>
                <span className="muted">{body}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn btn--ghost btn--block"
            style={{ marginTop: 'var(--size-space-5)' }}
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            Log out of this device
          </button>
        </div>
      </main>
    </div>
  );
}
