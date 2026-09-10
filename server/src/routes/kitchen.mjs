/**
 * Recipes + copilots + personal kitchen state.
 * All of these require a live session — this is the content the user asked to
 * be locked behind login (the cards only render once /api/auth/me succeeds).
 */
import express from 'express';
import { asyncRoute, requireAuth } from '../http.mjs';
import { getDb, nowIso, tx } from '../db.mjs';
import { recipes } from '../data/recipes.mjs';
import { copilots } from '../data/copilots.mjs';

const router = express.Router();

function stateFor(userId) {
  if (!userId) return { favorites: new Set(), cooked: new Map() };
  const rows = getDb().prepare('SELECT recipe_id, favorite, cooked_at FROM recipe_state WHERE user_id = ?').all(userId);
  const favorites = new Set();
  const cooked = new Map();
  for (const row of rows) {
    if (row.favorite) favorites.add(row.recipe_id);
    if (row.cooked_at) cooked.set(row.recipe_id, row.cooked_at);
  }
  return { favorites, cooked };
}

function decorate(recipe, state) {
  return {
    ...recipe,
    favorite: state.favorites.has(recipe.id),
    cookedAt: state.cooked.get(recipe.id) ?? null,
    totalMinutes: recipe.minutes,
    stepCount: recipe.steps.length,
  };
}

router.get('/recipes', asyncRoute(async (req, res) => {
  const state = stateFor(req.user?.id);
  const q = String(req.query.q || '').trim().toLowerCase();
  const tag = String(req.query.tag || '').trim().toLowerCase();
  const difficulty = String(req.query.difficulty || '').trim().toLowerCase();
  const maxMinutes = Number(req.query.maxMinutes) || 0;

  let list = recipes.map((r) => decorate(r, state));
  if (q) {
    list = list.filter((r) =>
      [r.title, r.tagline, r.cuisine, ...r.tags, ...r.ingredients].join(' ').toLowerCase().includes(q)
    );
  }
  if (tag === 'favorites') list = list.filter((r) => r.favorite);
  else if (tag) list = list.filter((r) => r.tags.includes(tag));
  if (difficulty) list = list.filter((r) => r.difficulty.toLowerCase() === difficulty);
  if (maxMinutes) list = list.filter((r) => r.minutes <= maxMinutes);

  res.json({
    recipes: list,
    facets: {
      tags: [...new Set(recipes.flatMap((r) => r.tags))].sort(),
      difficulties: [...new Set(recipes.map((r) => r.difficulty))],
      cuisines: [...new Set(recipes.map((r) => r.cuisine))],
    },
    count: list.length,
  });
}));

router.get('/recipes/:id', asyncRoute(async (req, res) => {
  const recipe = recipes.find((r) => r.id === req.params.id);
  if (!recipe) return res.status(404).json({ error: 'No such recipe.' });
  const state = stateFor(req.user?.id);
  const related = recipes.filter((r) => r.id !== recipe.id && r.tags.some((t) => recipe.tags.includes(t))).slice(0, 3);
  res.json({
    recipe: decorate(recipe, state),
    related: related.map((r) => ({ id: r.id, title: r.title, emoji: r.emoji, minutes: r.minutes, palette: r.palette })),
  });
}));

/** "What can I cook with this?" — scores recipes by pantry overlap. */
router.get('/recipes-match', asyncRoute(async (req, res) => {
  const have = String(req.query.ingredients || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const state = stateFor(req.user?.id);
  const scored = recipes.map((recipe) => {
    const matched = recipe.pantry.filter((p) => have.includes(p.toLowerCase()));
    const missing = recipe.pantry.filter((p) => !matched.includes(p));
    return { ...decorate(recipe, state), matchScore: have.length ? matched.length / recipe.pantry.length : 0, matched, missing };
  });
  scored.sort((a, b) => b.matchScore - a.matchScore || a.minutes - b.minutes);
  res.json({ suggestions: scored.filter((s) => s.matchScore > 0).slice(0, 6), pantryKeys: [...new Set(recipes.flatMap((r) => r.pantry))].sort() });
}));

router.post('/recipes/:id/favorite', requireAuth, asyncRoute(async (req, res) => {
  const recipe = recipes.find((r) => r.id === req.params.id);
  if (!recipe) return res.status(404).json({ error: 'No such recipe.' });
  const favorite = Boolean(req.body?.favorite);
  tx((db) =>
    db
      .prepare(
        `INSERT INTO recipe_state (user_id, recipe_id, favorite, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, recipe_id) DO UPDATE SET favorite = excluded.favorite, updated_at = excluded.updated_at`
      )
      .run(req.user.id, recipe.id, favorite ? 1 : 0, nowIso())
  );
  res.json({ id: recipe.id, favorite });
}));

router.post('/recipes/:id/cooked', requireAuth, asyncRoute(async (req, res) => {
  const recipe = recipes.find((r) => r.id === req.params.id);
  if (!recipe) return res.status(404).json({ error: 'No such recipe.' });
  tx((db) =>
    db
      .prepare(
        `INSERT INTO recipe_state (user_id, recipe_id, cooked_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, recipe_id) DO UPDATE SET cooked_at = excluded.cooked_at, updated_at = excluded.updated_at`
      )
      .run(req.user.id, recipe.id, nowIso(), nowIso())
  );
  res.json({ id: recipe.id, cookedAt: nowIso() });
}));

router.get('/copilots', (_req, res) => {
  res.json({ copilots });
});

router.get('/stats', requireAuth, asyncRoute(async (req, res) => {
  const db = getDb();
  const row = db
    .prepare('SELECT SUM(favorite) AS favorites, SUM(CASE WHEN cooked_at IS NOT NULL THEN 1 ELSE 0 END) AS cooked FROM recipe_state WHERE user_id = ?')
    .get(req.user.id);
  const recent = db
    .prepare('SELECT recipe_id, cooked_at FROM recipe_state WHERE user_id = ? AND cooked_at IS NOT NULL ORDER BY cooked_at DESC LIMIT 5')
    .all(req.user.id);
  res.json({
    favorites: row.favorites || 0,
    cooked: row.cooked || 0,
    recipesAvailable: recipes.length,
    copilots: copilots.length,
    recent: recent.map((r) => ({ id: r.recipe_id, cookedAt: r.cooked_at, title: recipes.find((x) => x.id === r.recipe_id)?.title ?? r.recipe_id })),
  });
}));

export default router;
