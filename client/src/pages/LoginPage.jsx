import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BrandMark from '../components/BrandMark.jsx';
import Field from '../components/Field.jsx';
import GoogleButton from '../components/GoogleSheet.jsx';
import Stage, { KitchenHeroScene } from '../three/Stage.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';

const REMEMBER_KEY = 'mise:remember-email';

/**
 * The first screen of the product. Nothing else is rendered on it: no nav bar,
 * no feature headings, no cards — just the log-in form, Google, and the link to
 * create a new account.
 */
export default function LoginPage() {
  const { login, config, isAuthenticated, flash } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(true);

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    document.title = 'Mise · Log in';
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setErrors({});
    setFormError('');
    setBusy(true);
    try {
      await login(email, password);
      localStorage.setItem(REMEMBER_KEY, email.trim().toLowerCase());
      navigate('/', { replace: true });
    } catch (error) {
      setErrors(error.fields ?? {});
      setFormError(error.fields ? 'Check the highlighted fields.' : error.message);
    } finally {
      setBusy(false);
    }
  }

  const demoAccounts = config?.demoAccounts ?? [];
  const localAccount = config?.demoPasswordAccount;

  return (
    <main className="auth" id="main">
      <aside className="auth__aside" aria-hidden="true">
        <Stage
          className="auth__aside-canvas"
          style={{ position: 'absolute', inset: 0 }}
          camera={{ position: [0, 1.1, 6.2], fov: 42 }}
          fallback={<div className="auth__aside-poster" aria-hidden="true" />}
        >
          <KitchenHeroScene />
        </Stage>
        <div className="auth__aside-copy">
          <BrandMark />
          <p className="auth__aside-sub" style={{ marginTop: 'var(--size-space-4)', maxWidth: 280 }}>
            Mise reads the recipe, watches the heat and tells you what to do next.
          </p>
        </div>
      </aside>

      <section className="auth__panel-wrap">
        <div className="auth__panel">
          <h1 className="auth__title">Log in</h1>
          <p className="auth__lede">Welcome back. Pick up where your kitchen left off.</p>

          {flash ? (
            <div className="notice notice--ok" style={{ marginTop: 'var(--size-space-4)' }}>
              <span>{flash}</span>
            </div>
          ) : null}

          <div style={{ marginTop: 'var(--size-space-5)' }}>
            <GoogleButton onError={setFormError} />
          </div>

          <p className="divider" style={{ margin: 'var(--size-space-5) 0 var(--size-space-4)' }}>
            or use your email
          </p>

          <form className="auth__form" onSubmit={onSubmit} noValidate>
            {formError ? (
              <div className="notice notice--error" role="alert">
                <span>{formError}</span>
              </div>
            ) : null}

            <Field
              label="Email"
              type="email"
              name="email"
              required
              autoComplete="username"
              placeholder="you@gmail.com"
              value={email}
              error={errors.email}
              onChange={(value) => {
                setEmail(value);
                setErrors((prev) => ({ ...prev, email: undefined }));
                setFormError('');
              }}
            />

            <Field
              label="Password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••••"
              value={password}
              error={errors.password}
              hintRight={
                <span className="dim" style={{ fontSize: 'var(--font-size-xs)' }}>
                  reset is not wired in this demo
                </span>
              }
              onChange={(value) => {
                setPassword(value);
                setErrors((prev) => ({ ...prev, password: undefined }));
                setFormError('');
              }}
            />

            <button className="btn btn--primary btn--block" type="submit" disabled={busy || !email || !password}>
              {busy ? <span className="btn__spinner" aria-hidden="true" /> : null}
              {busy ? 'Logging in…' : 'Log in'}
            </button>
          </form>

          <footer className="auth__foot">
            <p className="auth__switch">
              New here? <Link to="/create-account">Create new account</Link>
            </p>

            {demoAccounts.length || localAccount ? (
              <div className="demo-keys">
                <div
                  className="demo-keys__head"
                  role="button"
                  tabIndex={0}
                  aria-expanded={showKeys}
                  onClick={() => setShowKeys((v) => !v)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setShowKeys((v) => !v)}
                >
                  <span className="demo-keys__title">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
                      <path d="M8 10.5V8a4 4 0 018 0v2.5" />
                    </svg>
                    Demo credentials (sandbox only)
                  </span>
                  <span className="dim" style={{ fontSize: 'var(--font-size-xs)' }}>
                    {showKeys ? 'hide' : 'show'}
                  </span>
                </div>

                {showKeys ? (
                  <div className="demo-keys__list">
                    <span className="dim" style={{ fontSize: 'var(--font-size-xs)' }}>
                      Use any of these — click to fill the form. All share the demo passcode.
                    </span>
                    {demoAccounts.map((account) => (
                      <button
                        type="button"
                        className="demo-key"
                        key={account.email}
                        onClick={() => {
                          setEmail(account.email);
                          setPassword(account.passcode);
                          setFormError('');
                        }}
                      >
                        <span>
                          <b style={{ color: 'var(--color-text-hi)' }}>Google</b> · {account.name} → <code>{account.email}</code>
                        </span>
                        <code>passcode: {account.passcode}</code>
                      </button>
                    ))}
                    {localAccount ? (
                      <button
                        type="button"
                        className="demo-key"
                        onClick={() => {
                          setEmail(localAccount.email);
                          setPassword(localAccount.password);
                        }}
                      >
                        <span>
                          <b style={{ color: 'var(--color-text-hi)' }}>Email</b> · {localAccount.label} → <code>{localAccount.email}</code>
                        </span>
                        <code>pw: {localAccount.password}</code>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </footer>
        </div>
      </section>
    </main>
  );
}
