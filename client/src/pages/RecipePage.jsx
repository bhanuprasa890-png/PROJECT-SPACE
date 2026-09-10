import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import TopBar from '../components/TopBar.jsx';
import Timer from '../components/Timer.jsx';
import CopilotCard from '../components/CopilotCard.jsx';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';

const SCALE_OPTIONS = [
  { factor: 0.5, label: '½×' },
  { factor: 1, label: '1×' },
  { factor: 2, label: '2×' },
  { factor: 3, label: '3×' },
];

/** Scales the leading quantity of an ingredient line (handles 1/2 and 0.25). */
function scaleLine(line, factor) {
  if (factor === 1) return line;
  return line.replace(/(\d+\s\/\s\d+|\d*\.\d+|\d+)/, (match) => {
    const value = match.includes('/') ? Number(match.split('/')[0].trim()) / Number(match.split('/')[1].trim()) : Number(match);
    if (!Number.isFinite(value) || value === 0) return match;
    const scaled = value * factor;
    const rounded = scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 100) / 100;
    return String(rounded);
  });
}

export default function RecipePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const [doneSteps, setDoneSteps] = useState(() => new Set());
  const [checked, setChecked] = useState(() => new Set());
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const detail = useAsync(() => api(`/recipes/${id}`), [id]);
  const copilots = useAsync(() => api('/copilots'), []);

  const recipe = detail.data?.recipe;
  const copilotById = useMemo(() => new Map((copilots.data?.copilots ?? []).map((c) => [c.id, c])), [copilots.data]);
  const totalSteps = recipe?.steps?.length ?? 0;
  const progress = totalSteps ? (doneSteps.size / totalSteps) * 100 : 0;

  useEffect(() => {
    setActive(0);
    setDoneSteps(new Set());
    setChecked(new Set());
  }, [id]);

  useEffect(() => {
    if (recipe?.title) document.title = `${recipe.title} · Mise`;
  }, [recipe?.title]);

  if (detail.error) {
    return (
      <div className="app">
        <TopBar />
        <main className="wrap section" id="main">
          <div className="empty">
            <p>{detail.error.message}</p>
            <Link to="/" className="auth__link">
              Back to the board
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="app">
        <TopBar />
        <main className="boot" id="main">
          <div className="boot__ring" />
        </main>
      </div>
    );
  }

  const stepMinutes = recipe.steps[active]?.minutes ?? 1;

  async function finish() {
    setSaving(true);
    try {
      await api(`/recipes/${recipe.id}/cooked`, { method: 'POST', body: {} });
      navigate('/', { replace: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app">
      <TopBar />

      <main id="main">
        <section className="wrap recipe-hero">
          <div>
            <nav className="crumbs" aria-label="Breadcrumb">
              <Link to="/">Kitchen</Link>
              <span aria-hidden="true">/</span>
              <Link to="/?tag=recipes">Recipes</Link>
              <span aria-hidden="true">/</span>
              <span>{recipe.title}</span>
            </nav>

            <h1 className="recipe-title">{recipe.title}</h1>
            <p className="muted" style={{ marginTop: 'var(--size-space-2)', maxWidth: '60ch' }}>
              {recipe.tagline}
            </p>

            <div className="rcard__meta" style={{ marginTop: 'var(--size-space-4)', fontSize: 'var(--font-size-sm)' }}>
              <span className="chip">{recipe.cuisine}</span>
              <span className="chip">⏱ {recipe.minutes} min total</span>
              <span className="chip">{recipe.activeMinutes} min active</span>
              <span className="chip">
                serves <b>{Math.round(recipe.servings * scale)}</b>
              </span>
              <span className="chip">{recipe.kcal} kcal</span>
              <span className="chip">{recipe.protein} g protein</span>
              <span className="chip">{recipe.difficulty}</span>
            </div>

            <div style={{ display: 'flex', gap: 'var(--size-space-3)', marginTop: 'var(--size-space-5)', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="eyebrow">Scale</span>
              {SCALE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.label}
                  className="chip"
                  data-on={scale === option.factor}
                  aria-pressed={scale === option.factor}
                  onClick={() => setScale(option.factor)}
                >
                  {option.label}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await api(`/recipes/${recipe.id}/favorite`, { method: 'POST', body: { favorite: !recipe.favorite } });
                  detail.reload();
                }}
              >
                {recipe.favorite ? '★ Favourited' : '☆ Add to favourites'}
              </button>
            </div>
          </div>

          <div className="panel" style={{ background: `linear-gradient(var(--card-gradient-angle), ${recipe.palette?.[0] ?? '#FF8A3D'}22, transparent), var(--color-bg-raise)` }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 62 }}>{recipe.emoji}</div>
              <p className="eyebrow" style={{ marginTop: 'var(--size-space-3)' }}>
                Step {active + 1} of {totalSteps}
              </p>
              <div style={{ height: 6, background: 'var(--color-border-hairline)', borderRadius: 999, marginTop: 'var(--size-space-3)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${recipe.palette?.[0]}, ${recipe.palette?.[1]})`, transition: 'width var(--motion-duration-base) var(--motion-easing-out)' }} />
              </div>
              <p className="dim" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'var(--size-space-3)' }}>
                {doneSteps.size === totalSteps ? 'Every step done — plate it.' : `${totalSteps - doneSteps.size} steps to go`}
              </p>
            </div>
            <button type="button" className="btn btn--primary btn--block" style={{ marginTop: 'var(--size-space-5)' }} onClick={finish} disabled={saving}>
              {saving ? 'Logging…' : 'Finish & log this cook'}
            </button>
            <p className="dim" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'var(--size-space-3)', textAlign: 'center' }}>
              Marks the dish cooked on your account
            </p>
          </div>
        </section>

        <section className="wrap recipe-grid">
          <div className="panel">
            <div className="panel__title">
              <span>Cook mode</span>
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => {
                  navigator.clipboard?.writeText(
                    [recipe.title, '', 'Ingredients:', ...recipe.ingredients.map((i) => ` - ${i}`), '', 'Method:', ...recipe.steps.map((s, i) => `${i + 1}. ${s.text}`)].join('\n')
                  );
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? 'Copied ✓' : 'Copy as text'}
              </button>
            </div>

            <ol className="steps">
              {recipe.steps.map((step, index) => {
                const copilot = copilotById.get(step.copilot);
                const isDone = doneSteps.has(index);
                return (
                  <motion.li
                    key={`${recipe.id}-${index}`}
                    className="step"
                    data-active={index === active}
                    data-done={isDone}
                    layout
                    onClick={() => setActive(index)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="step__no">{isDone ? '✓' : index + 1}</span>
                    <div>
                      <p className="step__text">{step.text}</p>
                      <div className="step__foot">
                        <span className="chip" style={{ color: copilot?.accent, borderColor: `${copilot?.accent}55` }}>
                          {copilot?.name ?? step.copilot}
                        </span>
                        {step.minutes ? <span className="chip mono">{step.minutes} min</span> : null}
                        <span className="step__cue">→ {step.cue}</span>
                        <button
                          type="button"
                          className="btn btn--quiet btn--sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDoneSteps((prev) => {
                              const next = new Set(prev);
                              if (next.has(index)) next.delete(index);
                              else next.add(index);
                              return next;
                            });
                          }}
                        >
                          {isDone ? 'Undo' : 'Done'}
                        </button>
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          </div>

          <div style={{ display: 'grid', gap: 'var(--size-space-4)' }}>
            <div className="panel">
              <div className="panel__title">Ingredients</div>
              <ul className="ing">
                {recipe.ingredients.map((line, index) => (
                  <li key={`${line}-${index}`}>
                    <button
                      type="button"
                      data-on={checked.has(index)}
                      onClick={() =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                    >
                      <span className="ing__box">{checked.has(index) ? '✓' : ''}</span>
                      <span>{scaleLine(line, scale)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel">
              <Timer seconds={Math.max(30, stepMinutes * 60)} label={`Step ${active + 1} · ${stepMinutes} min`} />
            </div>

            <div className="panel">
              <div className="panel__title">Mise notes</div>
              <ul style={{ display: 'grid', gap: 'var(--size-space-3)' }}>
                {recipe.tips.map((tip) => (
                  <li key={tip} className="muted" style={{ fontSize: 'var(--font-size-sm)', display: 'flex', gap: 'var(--size-space-3)' }}>
                    <span style={{ color: 'var(--color-accent-saffron)' }}>◆</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            <CopilotCard copilot={copilotById.get(recipe.copilot) ?? { name: recipe.copilot, role: 'Lead copilot', blurb: '', strengths: [], accent: '#FF8A3D', mesh: 'nova', signatureMove: '' }} />

            {detail.data?.related?.length ? (
              <div className="panel">
                <div className="panel__title">Cook next</div>
                <ul style={{ display: 'grid', gap: 'var(--size-space-2)' }}>
                  {detail.data.related.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="usermenu__row" style={{ width: '100%' }} onClick={() => navigate(`/recipes/${item.id}`)}>
                        <span>{item.emoji}</span>
                        <span style={{ flex: 1, textAlign: 'left' }}>{item.title}</span>
                        <small className="dim">{item.minutes} min</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="foot">
        <span className="wrap" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--size-space-3)' }}>
          <span>{recipe.title} · {totalSteps} steps · lead copilot {copilotById.get(recipe.copilot)?.name ?? recipe.copilot}</span>
          <Link to="/">← Back to cards</Link>
        </span>
      </footer>
    </div>
  );
}
