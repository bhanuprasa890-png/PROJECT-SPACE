import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';

const G_LOGO = (
  <svg className="gbtn__mark" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const initials = (name = '', email = '') =>
  (name || email.split('@')[0])
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

/**
 * "Continue with Google".
 *  live mode → loads Google Identity Services and uses the real consent popup.
 *  demo mode → a faithful re-creation of the Google account chooser, wired to
 *              the server's demo provider so the flow (and its failures) are real.
 */
export default function GoogleButton({ onError, onSignedIn }) {
  const { config, googleDemo, googleCredential } = useAuth();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scriptRef = useRef(null);
  const buttonRef = useRef(null);
  const mode = config?.googleMode ?? 'demo';
  const accounts = config?.demoAccounts ?? [];

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const first = document.getElementById('gsheet-first');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Live mode: render Google's own button once the GIS script is ready.
  useEffect(() => {
    if (mode !== 'live' || !config?.googleClientId) return undefined;
    const google = window.google;
    if (!google?.accounts?.id || !buttonRef.current) return undefined;
    try {
      google.accounts.id.initialize({
        client_id: config.googleClientId,
        ux_mode: 'popup',
        callback: async (response) => {
          try {
            await googleCredential(response.credential);
            onSignedIn?.();
          } catch (err) {
            onError?.(err.message);
          }
        },
      });
      google.accounts.id.renderButton(buttonRef.current, {
        theme: 'filled_blue',
        size: 'large',
        width: 340,
        text: 'continue_with',
        shape: 'pill',
      });
    } catch (err) {
      setError(String(err?.message || err));
    }
    return undefined;
  }, [mode, config, googleCredential, onSignedIn, onError]);

  async function submitDemo(event) {
    event?.preventDefault();
    if (!selected) {
      setError('Pick an account to continue.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await googleDemo(selected.email, passcode);
      setOpen(false);
      onSignedIn?.();
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  const subtitle = useMemo(
    () => (mode === 'live' ? 'Use your real Google account' : 'Demo mode — choose one of the seeded test accounts'),
    [mode]
  );

  return (
    <>
      {mode === 'live' ? (
        <div ref={buttonRef} style={{ display: 'grid', justifyItems: 'center' }} />
      ) : (
        <button
          type="button"
          className="gbtn"
          onClick={() => {
            setOpen(true);
            setSelected(accounts[0] ?? null);
            setPasscode(accounts[0]?.passcode ?? '');
            setError(accounts.length ? '' : 'No demo accounts are enabled on this server.');
          }}
          aria-haspopup="dialog"
        >
          {G_LOGO}
          <span>Continue with Google</span>
          <span className="gbtn__tag">demo</span>
        </button>
      )}

      {open ? (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="gsheet" role="dialog" aria-modal="true" aria-label="Choose an account to continue to Mise">
            <header className="gsheet__head">
              <span className="gsheet__logo">
                {G_LOGO}
                <span style={{ fontWeight: 400 }}>Sign in</span>
              </span>
              <h2 className="gsheet__title">Choose an account</h2>
              <p className="gsheet__sub">
                to continue to <b style={{ color: '#202124' }}>mise.kitchen</b>
              </p>
            </header>

            <ul className="gsheet__list">
              {accounts.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    id={account === (selected ?? accounts[0]) ? 'gsheet-first' : undefined}
                    className="gacct"
                    aria-selected={selected?.email === account.email}
                    onClick={() => {
                      setSelected(account);
                      setPasscode(account.passcode ?? '');
                      setError('');
                    }}
                  >
                    <span className="gacct__avatar" style={{ background: account.color ?? '#4285F4' }}>
                      {initials(account.name, account.email)}
                    </span>
                    <span>
                      <span className="gacct__name" style={{ display: 'block' }}>
                        {account.name}
                      </span>
                      <span className="gacct__mail" style={{ display: 'block' }}>
                        {account.email}
                      </span>
                      {account.role ? <span className="gacct__mail" style={{ display: 'block' }}>{account.role}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <form className="gsheet__code" onSubmit={submitDemo}>
              <label htmlFor="gsheet-passcode">Demo passcode</label>
              <input
                id="gsheet-passcode"
                type="password"
                value={passcode}
                autoComplete="current-password"
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="MiseDemo#2026"
              />
              <p className="gsheet__error" role="alert">
                {error}
              </p>
              <div className="gsheet__actions">
                <button type="button" className="gsheet__lang" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="gsheet__next" disabled={busy}>
                  {busy ? 'Signing in…' : 'Next'}
                </button>
              </div>
            </form>

            <p className="gsheet__foot">
              {subtitle}. To switch to real Google OAuth, set <code>GOOGLE_OAUTH_CLIENT_ID</code> and{' '}
              <code>GOOGLE_MODE=live</code> in <code>.env</code>.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
