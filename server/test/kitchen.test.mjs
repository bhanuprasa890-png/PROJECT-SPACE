import './env.mjs';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resetDbForTests } from '../src/db.mjs';
import { createFailureTracker, createRateLimiter } from '../src/http.mjs';
import { bootApp, makeClient } from './helpers.mjs';

function fakeReqIp(ip) {
  return { ip, socket: { remoteAddress: ip }, headers: { 'x-forwarded-for': ip } };
}

/** Runs a middleware synchronously and reports whether it called next(). */
function invoke(mw, req) {
  const result = { passed: false, status: 200, body: null };
  const res = {
    setHeader() {
      return res;
    },
    status(code) {
      result.status = code;
      return res;
    },
    json(body) {
      result.body = body;
      return res;
    },
  };
  mw(req, res, () => {
    result.passed = true;
  });
  return result;
}

describe('rate limiter', () => {
  test('blocks after the configured burst for one scope+ip', () => {
    const limit = createRateLimiter({ windowMs: 60_000, max: 3 });
    const mw = limit('login');
    const req = fakeReqIp('203.0.113.7');
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      const out = invoke(mw, req);
      statuses.push(out.passed ? 200 : out.status);
      if (!out.passed) assert.match(out.body.error, /Too many requests/);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });

  test('isolates scopes so a flooded endpoint cannot lock out the API', () => {
    const limit = createRateLimiter({ windowMs: 60_000, max: 2 });
    const login = limit('login');
    const api = limit('api');
    const req = fakeReqIp('198.51.100.4');
    invoke(login, req);
    invoke(login, req);
    assert.equal(invoke(login, req).passed, false);
    assert.equal(invoke(api, req).passed, true, 'other scopes still work');
  });
});

describe('per-account lockout', () => {
  test('locks after maxFailures and reports retry time', () => {
    const tracker = createFailureTracker({ max: 3, lockoutMs: 60_000 });
    const key = 'x@example.com';
    assert.equal(tracker.check(key).blocked, false);
    tracker.record(key);
    tracker.record(key);
    const third = tracker.record(key);
    assert.equal(third.blocked, true);
    assert.ok(third.retryAfterSeconds > 50);
    tracker.reset(key);
    assert.equal(tracker.check(key).blocked, false);
  });
});

describe('kitchen content', () => {
  let app;
  let client;

  before(async () => {
    resetDbForTests(':memory:');
    app = await bootApp();
    client = makeClient(app.base);
    const login = await client.post('/api/auth/google/demo', { email: 'priya.nair@gmail.com', passcode: 'MiseDemo#2026' });
    assert.equal(login.status, 200);
  });
  after(async () => app.close());

  test('every recipe is well formed and has copilots assigned', async () => {
    const res = await client.get('/api/recipes');
    const { recipes } = res.body;
    const copilots = (await client.get('/api/copilots')).body.copilots;
    const ids = new Set(copilots.map((c) => c.id));
    for (const recipe of recipes) {
      assert.ok(recipe.id && recipe.title && recipe.tagline, 'identity fields');
      assert.ok(recipe.ingredients.length >= 4, `${recipe.id} ingredients`);
      assert.ok(recipe.steps.length >= 4, `${recipe.id} steps`);
      assert.ok(ids.has(recipe.copilot), `${recipe.id} primary copilot exists`);
      for (const step of recipe.steps) {
        assert.ok(ids.has(step.copilot), `${recipe.id} step copilot ${step.copilot}`);
        assert.ok(step.cue, 'each step has a "how do I know it is ready" cue');
      }
      assert.ok(recipe.minutes > 0 && recipe.kcal > 0);
    }
  });

  test('favorites persist for the signed-in user only', async () => {
    const on = await client.post('/api/recipes/soy-ginger-chicken/favorite', { favorite: true });
    assert.equal(on.status, 200);
    const list = await client.get('/api/recipes?tag=favorites');
    assert.ok(list.body.recipes.some((r) => r.id === 'soy-ginger-chicken'));

    const other = makeClient(app.base);
    await other.post('/api/auth/google/demo', { email: 'arjun.mehta@gmail.com', passcode: 'MiseDemo#2026' });
    const otherList = await other.get('/api/recipes');
    assert.equal(otherList.body.recipes.find((r) => r.id === 'soy-ginger-chicken').favorite, false, 'no cross-user bleed');

    const off = await client.post('/api/recipes/soy-ginger-chicken/favorite', { favorite: false });
    assert.equal(off.body.favorite, false);
    const afterOff = await client.get('/api/recipes?tag=favorites');
    assert.ok(!afterOff.body.recipes.some((r) => r.id === 'soy-ginger-chicken'), 'unfavorite sticks');
  });

  test('cooking a recipe updates stats', async () => {
    await client.post('/api/recipes/lemon-garlic-pasta/cooked', {});
    const stats = await client.get('/api/stats');
    assert.ok(stats.body.cooked >= 4);
    assert.equal(stats.body.recipesAvailable, 12);
    assert.ok(stats.body.recent[0].title, 'recent history is labelled');
  });

  test('pantry matcher ranks by overlap and lists what is missing', async () => {
    const res = await client.get('/api/recipes-match?ingredients=paneer,butter,garlic');
    assert.equal(res.status, 200);
    const top = res.body.suggestions[0];
    assert.ok(top.matched.includes('paneer'));
    assert.ok(top.missing.length > 0);
  });

  test('search + filter + detail + related', async () => {
    const search = await client.get('/api/recipes?q=ferment');
    assert.ok(search.body.recipes.length >= 1);
    const filtered = await client.get('/api/recipes?tag=vegan&maxMinutes=30');
    assert.ok(filtered.body.recipes.every((r) => r.minutes <= 30 && r.tags.includes('vegan')));
    const detail = await client.get('/api/recipes/masala-dosa');
    assert.equal(detail.body.recipe.id, 'masala-dosa');
    assert.ok(detail.body.related.length > 0);
    const missing = await client.get('/api/recipes/not-a-dish');
    assert.equal(missing.status, 404);
  });
});
