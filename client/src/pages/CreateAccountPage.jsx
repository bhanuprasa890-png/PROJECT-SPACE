import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BrandMark from '../components/BrandMark.jsx';
import Field, { StrengthMeter } from '../components/Field.jsx';
import GoogleButton from '../components/GoogleSheet.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';

/** Client-side mirror of the server policy — the server is still the authority. */
function localProblems(password, { email, name }) {
  const problems = [];
  if (password.length < 10) problems.push('At least 10 characters.');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/].filter((re) => re.test(password)).length;
  if (classes < 2) problems.push('Mix letters, numbers or symbols.');
  if (email && password.toLowerCase().includes(String(email).split('@')[0].toLowerCase())) problems.push('Do not reuse your email.');
  if (name && password.toLowerCase().includes(String(name).toLowerCase().replace(/\s+/g, ''))) problems.push('Do not reuse your name.');
  return problems;
}

function scoreOf(password, problems) {
  if (!password) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/].filter((re) => re.test(password)).length;
  const unique = new Set(password).size;
  let score = Math.min(4, Math.floor((password.length / 6 + classes * 1.5 + unique / 6) / 2));
  if (problems.length) score = Math.min(score, 2);
  return score;
}

export default function CreateAccountPage() {
  const { register, isAuthenticated, config } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    document.title = 'Mise · Create new account';
  }, []);

  const problems = useMemo(
    () => localProblems(form.password, { email: form.email, name: form.name }),
    [form.password, form.email, form.name]
  );
  const score = scoreOf(form.password, problems);
  // live feedback: the moment the two fields differ, say so
  const mismatch = Boolean(form.confirm) && form.confirm !== form.password;

  const set = (key) => (value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, form: undefined }));
    setFormError('');
  };

  async function onSubmit(event) {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setErrors((prev) => ({ ...prev, confirm: 'The two passwords do not match.' }));
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/', { replace: true });
    } catch (error) {
      setErrors(error.fields ?? {});
      setFormError(error.fields ? 'Check the highlighted fields.' : error.message);
    } finally {
      setBusy(false);
    }
  }

  const min = config?.passwordMinLength ?? 10;

  return (
    <main className="auth" id="main">
      <aside className="auth__aside" aria-hidden="true">
        <div className="auth__aside-copy">
          <BrandMark />
        </div>
        <div className="auth__aside-copy" style={{ maxWidth: 420 }}>
          <h2 className="auth__aside-title">Cook dinner in 20 minutes, starting tonight.</h2>
          <ul className="auth__aside-points">
            {[
              ['12 tested recipes', 'step timers, doneness cues and pantry matching.'],
              ['Five 3D copilots', 'Sigma chops, Manus kneads, Nova owns the heat.'],
              ['Your kitchen, remembered', 'favourites, history and make-ahead plans.'],
            ].map(([title, body]) => (
              <li className="auth__point" key={title}>
                <span className="auth__point-dot" />
                <span>
                  <b>{title}</b> — {body}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth__aside-foot dim">No card, no ads, no spam. Delete your account any time.</p>
      </aside>

      <section className="auth__panel-wrap">
        <div className="auth__panel">
          <h1 className="auth__title">Create new account</h1>
          <p className="auth__lede">One email and password is all it takes — or continue with Google.</p>

          <div style={{ marginTop: 'var(--size-space-5)' }}>
            <GoogleButton onError={setFormError} />
          </div>

          <p className="divider" style={{ margin: 'var(--size-space-5) 0 var(--size-space-4)' }}>
            or with email
          </p>

          <form className="auth__form" onSubmit={onSubmit} noValidate>
            {formError ? (
              <div className="notice notice--error" role="alert">
                <span>{formError}</span>
              </div>
            ) : null}

            <Field
              label="Name"
              name="name"
              required
              autoComplete="name"
              placeholder="Priya Nair"
              value={form.name}
              error={errors.name}
              onChange={set('name')}
            />

            <Field
              label="Email"
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@gmail.com"
              value={form.email}
              error={errors.email}
              onChange={set('email')}
            />

            <Field
              label="Password"
              type="password"
              name="password"
              required
              autoComplete="new-password"
              placeholder={`At least ${min} characters`}
              value={form.password}
              error={errors.password}
              hint={`Mise stores a scrypt hash — never the password itself. Minimum ${min} characters with two character types.`}
              onChange={set('password')}
            >
              <StrengthMeter score={score} problems={problems} />
            </Field>

            <Field
              label="Re-enter password"
              type="password"
              name="confirm"
              required
              autoComplete="new-password"
              placeholder="Repeat it"
              value={form.confirm}
              error={mismatch ? 'The two passwords do not match.' : errors.confirm}
              onChange={set('confirm')}
            />

            <button
              className="btn btn--primary btn--block"
              type="submit"
              disabled={busy || problems.length > 0 || !form.name || !form.email || form.password !== form.confirm}
            >
              {busy ? <span className="btn__spinner" aria-hidden="true" /> : null}
              {busy ? 'Creating account…' : 'Create new account'}
            </button>
          </form>

          <footer className="auth__foot">
            <p className="auth__switch">
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </footer>
        </div>
      </section>
    </main>
  );
}
