import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import TopBar from '../components/TopBar.jsx';
import CopilotCard from '../components/CopilotCard.jsx';
import RecipeCard from '../components/RecipeCard.jsx';
import PantryMatcher from '../components/PantryMatcher.jsx';
import Stage, { KitchenHeroScene } from '../three/Stage.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'favorites', label: '★ Favourites' },
  { key: 'quick', label: 'Under 20 min' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'high-protein', label: 'High protein' },
  { key: 'batch-cook', label: 'Batch cook' },
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'one-pan', label: 'One pan' },
];

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still cooking';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [maxMinutes, setMaxMinutes] = useState(0);
  const [busyId, setBusyId] = useState(null);

  const copilots = useAsync(() => api('/copilots'), []);
  const stats = useAsync(() => api('/stats'), []);
  const list = useAsync(
    () => api(`/recipes?q=${encodeURIComponent(search)}&tag=${encodeURIComponent(filter)}&maxMinutes=${maxMinutes || ''}`),
    [search, filter, maxMinutes]
  );

  useEffect(() => {
    document.title = 'Mise · Kitchen';
  }, []);

  const recipes = list.data?.recipes ?? [];
  const facets = list.data?.facets;
  const firstName = (user?.name || 'chef').split(' ')[0];
  const heroRecipes = useMemo(() => recipes.slice(0, 8), [recipes]);

  async function toggleFavorite(recipe) {
    const next = !recipe.favorite;
    // optimistic UI, then confirmed by the server
    list.setData({ ...list.data, recipes: recipes.map((r) => (r.id === recipe.id ? { ...r, favorite: next } : r)) });
    setBusyId(recipe.id);
    try {
      await api(`/recipes/${recipe.id}/favorite`, { method: 'POST', body: { favorite: next } });
      await Promise.all([list.reload(), stats.reload()]);
    } catch (error) {
      list.setData({ ...list.data, recipes: recipes.map((r) => (r.id === recipe.id ? { ...r, favorite: !next } : r)) });
      window.alert(error.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="app">
      <TopBar />

      <main id="main">
        {/* ---------------- hero + 3D ---------------- */}
        <section className="wrap">
          <div className="hero">
            <div className="hero__copy">
              <span className="eyebrow">{greeting()}, {firstName}</span>
              <h1 className="hero__title" style={{ marginTop: 'var(--size-space-3)' }}>
                Put your <em>mise en place</em> on autopilot.
              </h1>
              <p className="hero__sub">
                Twelve tested recipes with per-step doneness cues, five 3D copilots that own prep, heat, technique, flavour and
                make-ahead work — and a pantry matcher that decides dinner for you.
              </p>
              <div className="hero__actions">
                <button type="button" className="btn btn--primary" onClick={() => document.getElementById('recipes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  See tonight’s cards
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => document.getElementById('copilots')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  Meet the 3D crew
                </button>
              </div>

              <div className="stats">
                {[
                  { label: 'Recipes ready', value: stats.data?.recipesAvailable ?? '—' },
                  { label: 'Favourites', value: stats.data?.favorites ?? '—' },
                  { label: 'Cooks logged', value: stats.data?.cooked ?? '—' },
                  { label: 'Copilots', value: copilots.data?.copilots?.length ?? '—' },
                ].map((stat) => (
                  <div className="stat" key={stat.label}>
                    <div className="stat__value mono">{stat.value}</div>
                    <div className="stat__label">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hero__stage">
              <Stage camera={{ position: [0, 1.05, 5.6], fov: 44 }} fallback={<div className="hero__poster" aria-hidden="true"><span>🍲</span></div>}>
                <KitchenHeroScene />
              </Stage>
              <span className="hero__stage-hint">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
                  <circle cx="12" cy="12" r="3.4" />
                </svg>
                move your cursor — the rig leans with you
              </span>
              <span className="hero__glow" />
            </div>
          </div>
        </section>

        {/* ---------------- 3D copilot cards ---------------- */}
        <section className="wrap section" id="copilots">
          <div className="section__head">
            <div>
              <span className="eyebrow">The crew · WebGL</span>
              <h2 className="section__title">Five copilots, each with one job</h2>
              <p className="section__sub">
                Every card is a live 3D scene built from primitives (no downloaded models). Hover to tilt it, or flip 3D off from the
                top bar — the cards keep working as still art.
              </p>
            </div>
            <span className="chip chip--accent">{copilots.data?.copilots?.length ?? 0} online</span>
          </div>

          <div className="copilots">
            {(copilots.data?.copilots ?? []).map((copilot, index) => (
              <CopilotCard key={copilot.id} copilot={copilot} index={index} />
            ))}
          </div>
        </section>

        {/* ---------------- recipe cards ---------------- */}
        <section className="wrap section" id="recipes">
          <div className="section__head">
            <div>
              <span className="eyebrow">Tonight’s board</span>
              <h2 className="section__title">Recipe cards</h2>
              <p className="section__sub">
                {list.loading ? 'Loading your board…' : `${list.data?.count ?? 0} card${list.data?.count === 1 ? '' : 's'} · favourites sync to your account`}
              </p>
            </div>
            <div className="filters">
              <label className="search">
                <span className="sr-only">Search recipes</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="6.4" />
                  <path d="M16 16l4.5 4.5" />
                </svg>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search dish or ingredient" />
              </label>
              <button
                type="button"
                className="chip"
                data-on={maxMinutes === 20}
                aria-pressed={maxMinutes === 20}
                onClick={() => setMaxMinutes((v) => (v === 20 ? 0 : 20))}
              >
                {maxMinutes === 20 ? '✓ ≤ 20 min' : '≤ 20 min'}
              </button>
            </div>
          </div>

          <div className="filters" style={{ marginBottom: 'var(--size-space-4)' }}>
            {FILTERS.map((item) => (
              <button
                type="button"
                key={item.key || 'all'}
                data-filter={item.key || 'all'}
                className="chip"
                data-on={filter === item.key}
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
            {facets?.difficulties?.length ? (
              <span className="dim" style={{ fontSize: 'var(--font-size-xs)', marginLeft: 'auto' }}>
                {facets.difficulties.join(' · ')} · {facets.cuisines.length} cuisines
              </span>
            ) : null}
          </div>

          {list.error ? (
            <div className="notice notice--error" role="alert">
              <span>{list.error.message}</span>
            </div>
          ) : null}

          {heroRecipes.length === 0 && !list.loading ? (
            <div className="empty">No recipe matches those filters. Clear the search or pick another chip.</div>
          ) : (
            <div className="recipes">
              {heroRecipes.map((recipe, index) => (
                <RecipeCard key={recipe.id} recipe={recipe} index={index} onToggleFavorite={toggleFavorite} busy={busyId === recipe.id} />
              ))}
            </div>
          )}

          {recipes.length > heroRecipes.length ? (
            <motion.p className="dim" style={{ marginTop: 'var(--size-space-4)', fontSize: 'var(--font-size-sm)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {recipes.length - heroRecipes.length} more match these filters — narrow them to see the rest.
            </motion.p>
          ) : null}
        </section>

        {/* ---------------- pantry matcher ---------------- */}
        <section className="wrap section" id="pantry" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(260px,.75fr)', gap: 'var(--size-space-4)', alignItems: 'start' }}>
          <PantryMatcher onOpen={(id) => navigate(`/recipes/${id}`)} />
          <div className="panel">
            <div className="panel__title">Recent cooks</div>
            {(stats.data?.recent ?? []).length === 0 ? (
              <p className="dim" style={{ fontSize: 'var(--font-size-sm)' }}>
                Nothing logged yet. Open a card and finish cook mode — Mise marks the date.
              </p>
            ) : (
              <ul style={{ display: 'grid', gap: 'var(--size-space-2)' }}>
                {stats.data.recent.map((row) => (
                  <li key={`${row.id}-${row.cookedAt}`}>
                    <button type="button" className="usermenu__row" style={{ width: '100%' }} onClick={() => navigate(`/recipes/${row.id}`)}>
                      <span style={{ color: 'var(--color-ink-ok)' }}>✓</span>
                      <span style={{ flex: 1, textAlign: 'left' }}>{row.title}</span>
                      <small className="dim">{new Date(row.cookedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <footer className="foot">
        <span className="wrap" style={{ display: 'flex', gap: 'var(--size-space-4)', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%' }}>
          <span>Mise · kitchen co-pilot — session for {user?.email} · {user?.provider === 'google' ? 'Google' : 'email'} login</span>
          <span>
            <Link to="/account" style={{ textDecoration: 'underline' }}>
              Account &amp; sessions
            </Link>{' '}
            ·{' '}
            <Link to="/logout" style={{ textDecoration: 'underline' }}>
              Log out
            </Link>
          </span>
        </span>
      </footer>
    </div>
  );
}
