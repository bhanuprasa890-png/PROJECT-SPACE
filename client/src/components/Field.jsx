import { useId, useState } from 'react';

/** Labelled input with inline error, hint and a reveal toggle for passwords. */
export default function Field({ label, type = 'text', error, hint, hintRight, autoComplete, value, onChange, placeholder, required, maxLength, children, ...rest }) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && revealed ? 'text' : type;
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <div className="field__label">
        <label htmlFor={id}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </label>
        {hintRight}
      </div>
      <div className="field__control">
        <input
          id={id}
          name={rest.name ?? id}
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          maxLength={maxLength}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange?.(event.target.value, event)}
          {...rest}
        />
        {isPassword ? (
          <button
            type="button"
            className="field__icon-btn"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
          >
            {revealed ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 3l18 18M10.6 10.7a2 2 0 002.8 2.6M6.7 6.9C4.6 8.2 3 10.1 2 12c1.9 4 6 6.5 10 6.5 1.7 0 3.3-.4 4.8-1.2M12 5.5c4 0 8.1 2.5 10 6.5-.6 1.3-1.5 2.5-2.6 3.5" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            )}
          </button>
        ) : null}
      </div>
      {hint && !error ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function StrengthMeter({ score, problems = [] }) {
  const words = ['Too weak', 'Weak', 'Okay', 'Good', 'Strong'];
  return (
    <div className="strength" data-score={score}>
      <div className="strength__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className="strength__bar" />
        ))}
      </div>
      <div className="strength__label">
        <span>Password: {words[score] ?? 'Too weak'}</span>
        <span>{score >= 3 ? 'passes the policy' : 'needs more variety'}</span>
      </div>
      {problems.length ? (
        <ul style={{ display: 'grid', gap: 2 }}>
          {problems.map((problem) => (
            <li key={problem} className="field__hint">
              · {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
