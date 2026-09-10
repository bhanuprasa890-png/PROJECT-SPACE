/**
 * Fake backend for component tests: the same routes, the same cookie/CSRF
 * contract, no network. `calls` is exported so tests can assert what the UI
 * actually sent.
 */
export const calls = [];
let state = {};

export function resetApi() {
  calls.length = 0;
  state = {
    session: null,
    csrf: null,
    favourites: new Set(),
    cooked: new Set(),
    config: {
      googleMode: 'demo',
      googleClientId: null,
      passwordMinLength: 10,
      passwordMaxLength: 200,
      sessionTtlDays: 14,
      demoAccounts: [
        { email: 'priya.nair@gmail.com', name: 'Priya Nair', role: 'Weeknight cook', passcode: 'MiseDemo#2026' },
        { email: 'arjun.mehta@gmail.com', name: 'Arjun Mehta', role: 'Bread + fermenting', passcode: 'MiseDemo#2026' },
        { email: 'sana.cooks@gmail.com', name: 'Sana Qureshi', role: 'Sunday batch cook', passcode: 'MiseDemo#2026' },
      ],
      demoPasswordAccount: { email: 'chef@mise.dev', password: 'MiseDemo#2026', label: 'Local demo account' },
    },
    copilots: [
      { id: 'sigma', name: 'Sigma', role: 'Prep & knife skills', blurb: 'b', mesh: 'sigma', accent: '#FF8A3D', strengths: ['Cut sizing'], signatureMove: 's', stat: 'x' },
      { id: 'manus', name: 'Manus', role: 'Hands-on technique', blurb: 'b', mesh: 'manus', accent: '#7ED9A6', strengths: ['Dough'], signatureMove: 's', stat: 'x' },
      { id: 'nova', name: 'Nova', role: 'Heat & timing', blurb: 'b', mesh: 'nova', accent: '#FF4D5E', strengths: ['Sear'], signatureMove: 's', stat: 'x' },
      { id: 'atlas', name: 'Atlas', role: 'Flavour', blurb: 'b', mesh: 'atlas', accent: '#7CC5F7', strengths: ['Subs'], signatureMove: 's', stat: 'x' },
      { id: 'miso', name: 'Miso', role: 'Ferments', blurb: 'b', mesh: 'miso', accent: '#C9A2FF', strengths: ['Brine'], signatureMove: 's', stat: 'x' },
    ],
    recipes: [
      {
        id: 'garlic-butter-paneer', title: 'Garlic Butter Paneer', tagline: 't', cuisine: 'North Indian', emoji: '🧈',
        palette: ['#FF8A3D', '#FFD28A'], minutes: 15, activeMinutes: 10, difficulty: 'Easy', servings: 2, kcal: 520, protein: 22,
        tags: ['vegetarian', 'quick'], pantry: ['paneer'],
        ingredients: ['400 g paneer, cut into 2.5 cm cubes', '3 tbsp butter, divided', '10 garlic cloves, thinly sliced', '60 ml heavy cream'],
        steps: [
          { text: 'Pat the paneer completely dry — wet cheese steams instead of searing.', minutes: 3, copilot: 'sigma', cue: 'No shine on the surface' },
          { text: 'Melt butter in cast iron on high; when it stops foaming, lay the paneer in one layer.', minutes: 4, copilot: 'nova', cue: 'Golden underside, edges crisp' },
          { text: 'Flip, add butter plus garlic, and swirl so the garlic fries in the butter.', minutes: 2, copilot: 'manus', cue: 'Garlic pale gold' },
          { text: 'Cream and soy in, crush the kasuri methi, gloss for 60 seconds.', minutes: 2, copilot: 'atlas', cue: 'Sauce coats the spoon' },
        ],
        tips: ['tip'], copilot: 'nova', favorite: false, cookedAt: null, stepCount: 4, totalMinutes: 15,
      },
      {
        id: 'weeknight-dal', title: 'Weeknight Yellow Dal', tagline: 't', cuisine: 'Indian', emoji: '🫘',
        palette: ['#F5C451', '#FFE9A8'], minutes: 30, activeMinutes: 10, difficulty: 'Easy', servings: 4, kcal: 240, protein: 13,
        tags: ['vegan'], pantry: ['toor dal'],
        ingredients: ['150 g toor dal, rinsed 4×', '1/2 tsp turmeric', '1 tsp salt', '1 tomato, finely chopped'],
        steps: [
          { text: 'Rinse the dal until the water runs clear.', minutes: 4, copilot: 'sigma', cue: 'Water nearly transparent' },
          { text: 'Cook with 4× water, turmeric and salt; skim the first foam.', minutes: 20, copilot: 'manus', cue: 'No resistance between fingers' },
          { text: 'Whisk smooth with a ladle; add hot water until it pours.', minutes: 3, copilot: 'manus', cue: 'Ladle leaves a slow trail' },
          { text: 'Temper cumin, garlic, chilli and curry leaves; pour over.', minutes: 3, copilot: 'nova', cue: 'Garlic straw-yellow' },
        ],
        tips: ['tip'], copilot: 'manus', favorite: false, cookedAt: null, stepCount: 4, totalMinutes: 30,
      },
    ],
  };
}
resetApi();

const json = (body, init = {}) => ({ ok: init.status === undefined ? true : init.status < 400, status: init.status ?? 200, json: async () => body, headers: new Headers(), ...init });

export function installFakeFetch() {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, method: options.method ?? 'GET', body });

    if (path === '/api/health') return json({ ok: true });
    if (path === '/api/auth/config') return json(state.config);

    if (path === '/api/auth/me') {
      if (!state.session) return json({ error: 'Not signed in.', code: 'AUTH_REQUIRED' }, { status: 401 });
      return json({ user: state.session.user, csrfToken: state.csrf, expiresAt: new Date(Date.now() + 86400000).toISOString(), sessions: 1 });
    }

    if (path === '/api/auth/login') {
      if (body.email === 'chef@mise.dev' && body.password === 'MiseDemo#2026') {
        state.session = { user: { id: 9, email: body.email, name: 'Mise Demo Chef', provider: 'password', createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString(), avatarUrl: null } };
        state.csrf = 'test.csrf';
        return json({ user: state.session.user, csrfToken: state.csrf, expiresAt: new Date().toISOString() });
      }
      return json({ error: 'Email or password is not correct.' }, { status: 401 });
    }

    if (path === '/api/auth/register') {
      if (body.password.length < 10) return json({ error: 'Check the highlighted fields.', fields: { password: 'Use at least 10 characters.' } }, { status: 400 });
      state.session = { user: { id: 10, email: body.email, name: body.name, provider: 'password', createdAt: new Date().toISOString(), lastLoginAt: null, avatarUrl: null } };
      state.csrf = 'test.csrf';
      return json({ user: state.session.user, csrfToken: state.csrf, expiresAt: new Date().toISOString() }, { status: 201 });
    }

    if (path === '/api/auth/google/demo') {
      const account = state.config.demoAccounts.find((a) => a.email === body.email);
      if (!account || body.passcode !== account.passcode) return json({ error: 'Demo passcode is not correct.' }, { status: 401 });
      state.session = { user: { id: 1, email: account.email, name: account.name, provider: 'google', createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString(), avatarUrl: null } };
      state.csrf = 'test.csrf';
      return json({ user: state.session.user, csrfToken: state.csrf, expiresAt: new Date().toISOString() });
    }

    if (path === '/api/auth/logout') {
      state.session = null;
      state.csrf = null;
      return json({ ok: true });
    }

    if (path === '/api/auth/sessions') {
      return json({ current: 'abc', sessions: [{ id: 'abc', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), expiresAt: new Date().toISOString(), current: true, device: 'jsdom' }] });
    }

    if (path === '/api/copilots') return json({ copilots: state.copilots });

    if (path.startsWith('/api/recipes?') || path === '/api/recipes') {
      if (!state.session) return json({ error: 'Not signed in.', code: 'AUTH_REQUIRED' }, { status: 401 });
      const params = new URLSearchParams(path.split('?')[1] ?? '');
      const tag = params.get('tag');
      let recipes = state.recipes.map((r) => ({ ...r, favorite: state.favourites.has(r.id), cookedAt: state.cooked.has(r.id) ? new Date().toISOString() : null }));
      if (tag === 'favorites') recipes = recipes.filter((r) => r.favorite);
      return json({ recipes, count: recipes.length, facets: { tags: ['vegan'], difficulties: ['Easy'], cuisines: ['Indian'] } });
    }

    if (path.includes('/favorite')) {
      const id = path.split('/')[3];
      if (body.favorite) state.favourites.add(id);
      else state.favourites.delete(id);
      return json({ id, favorite: Boolean(body.favorite) });
    }

    if (path.includes('/cooked')) {
      state.cooked.add(path.split('/')[3]);
      return json({ ok: true });
    }

    if (path.startsWith('/api/recipes/')) {
      const id = path.split('/')[3];
      const recipe = state.recipes.find((r) => r.id === id);
      if (!recipe) return json({ error: 'No such recipe.' }, { status: 404 });
      return json({ recipe: { ...recipe, favorite: state.favourites.has(id) }, related: [] });
    }

    if (path.startsWith('/api/stats')) return json({ favorites: state.favourites.size, cooked: state.cooked.size, recipesAvailable: 12, copilots: 5, recent: [] });
    if (path.startsWith('/api/recipes-match')) return json({ suggestions: [], pantryKeys: ['paneer', 'eggs'] });

    return json({ error: `unhandled ${path}` }, { status: 500 });
  };
}
