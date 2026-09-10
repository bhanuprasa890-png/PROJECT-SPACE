import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const RADIUS = 68;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function format(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Step timer that survives re-renders by ticking against a timestamp, not an interval count. */
export default function Timer({ seconds = 60, label = 'Step timer', autoStart = false, onDone }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(autoStart);
  const endsAt = useRef(null);
  const raf = useRef(0);
  const done = remaining <= 0.05;

  useEffect(() => {
    setRemaining(seconds);
    endsAt.current = null;
    setRunning(autoStart);
  }, [seconds, autoStart]);

  useEffect(() => {
    if (!running) return undefined;
    endsAt.current = Date.now() + remaining * 1000;
    const tick = () => {
      const left = Math.max(0, (endsAt.current - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        setRunning(false);
        onDone?.();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const start = useCallback(() => setRunning(true), []);
  const pause = useCallback(() => setRunning(false), []);
  const reset = useCallback(() => {
    setRunning(false);
    setRemaining(seconds);
  }, [seconds]);

  const progress = useMemo(() => 1 - remaining / (seconds || 1), [remaining, seconds]);

  return (
    <div className="timer" data-running={running} data-done={done} role="timer" aria-live={running ? 'off' : 'polite'}>
      <p className="eyebrow">{label}</p>
      <div className="timer__face">
        <svg className="timer__ring" width="168" height="168" viewBox="0 0 168 168" aria-hidden="true">
          <circle cx="84" cy="84" r={RADIUS} fill="none" stroke="var(--color-border-hairline)" strokeWidth="8" />
          <circle
            cx="84"
            cy="84"
            r={RADIUS}
            fill="none"
            stroke={done ? 'var(--color-accent-herb)' : 'var(--color-accent-saffron)'}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * progress}
            style={{ transition: 'stroke-dashoffset 120ms linear, stroke 300ms' }}
          />
        </svg>
        <span className="timer__value" style={{ fontSize: 'var(--font-size-2xl)' }}>
          {format(remaining)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--size-space-2)' }}>
        {running ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={pause}>
            Pause
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--sm" onClick={start} disabled={done}>
            {done ? 'Time!' : remaining < seconds ? 'Resume' : 'Start'}
          </button>
        )}
        <button type="button" className="btn btn--quiet btn--sm" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}
