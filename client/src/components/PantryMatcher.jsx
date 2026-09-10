import { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';

/**
 * "What can I cook right now?" — picks pantry keys, the server scores every
 * recipe by overlap and returns the ranking plus what is still missing.
 */
export default function PantryMatcher({ onOpen }) {
  const [picked, setPicked] = useState(['eggs', 'tomato', 'onion', 'butter']);
  const query = useMemo(() => picked.join(','), [picked]);
  const { data, loading, reload } = useAsync(() => api(`/recipes-match?ingredients=${encodeURIComponent(query)}`), [query]);

  const keys = data?.pantryKeys ?? [];
  const suggestions = data?.suggestions ?? [];

  const toggle = (key) => {
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <div className="panel">
      <div className="panel__title">
        <span>
          What can I cook?
          <span className="dim" style={{ fontWeight: 400, fontSize: 'var(--font-size-sm)' }}>
            {' '}
            — tick what is in the fridge
          </span>
        </span>
        <button type="button" className="btn btn--quiet btn--sm" onClick={reload} disabled={loading}>
          {loading ? 'Matching…' : 'Re-run'}
        </button>
      </div>

      <div className="pantry">
        {keys.map((key) => (
          <button type="button" key={key} className="chip" data-on={picked.includes(key)} onClick={() => toggle(key)} aria-pressed={picked.includes(key)}>
            <span style={{ marginRight: 4 }}>{picked.includes(key) ? '✓' : '+'}</span>
            {key}
          </button>
        ))}
      </div>

      <div className="suggest" style={{ marginTop: 'var(--size-space-4)' }}>
        {suggestions.length === 0 && !loading ? <p className="dim">Nothing matches yet — tick a few more ingredients.</p> : null}
        {suggestions.map((recipe) => (
          <div className="suggest__row" key={recipe.id}>
            <button type="button" onClick={() => onOpen?.(recipe.id)} style={{ textAlign: 'left', display: 'grid', gap: 4 }}>
              <span>
                <span style={{ marginRight: 8 }}>{recipe.emoji}</span>
                <b>{recipe.title}</b>
                <span className="dim"> · {recipe.minutes} min</span>
              </span>
              {recipe.missing.length ? (
                <span className="dim" style={{ fontSize: 'var(--font-size-xs)' }}>
                  still need: {recipe.missing.slice(0, 4).join(', ')}
                </span>
              ) : (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-ink-ok)' }}>you have everything</span>
              )}
            </button>
            <span className="suggest__bar" title={`${Math.round(recipe.matchScore * 100)}% covered`}>
              <i style={{ width: `${Math.round(recipe.matchScore * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
