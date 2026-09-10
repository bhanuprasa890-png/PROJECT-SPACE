/**
 * Render smoke test.
 *
 *   npm run smoke
 *
 * Boots the real React application inside jsdom against a running API server and
 * asserts that every route renders meaningful, data-backed content without
 * throwing. Requires `npm run dev:api` (or `npm run dev`) to be running.
 */
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { createServer } from 'vite';

const API_ORIGIN = process.env.SMOKE_API_ORIGIN ?? 'http://127.0.0.1:8787';
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS ?? 2200);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});

const { window } = dom;
const define = (key, value) =>
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });

define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('location', window.location);
define('HTMLElement', window.HTMLElement);
define('HTMLInputElement', window.HTMLInputElement);
define('Element', window.Element);
define('Node', window.Node);
define('Event', window.Event);
define('CustomEvent', window.CustomEvent);
define('MouseEvent', window.MouseEvent);
define('KeyboardEvent', window.KeyboardEvent);
define('getComputedStyle', window.getComputedStyle.bind(window));
define('localStorage', window.localStorage);
window.matchMedia ??= (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
define('requestAnimationFrame', (callback) => setTimeout(() => callback(performance.now()), 16));
define('cancelAnimationFrame', (handle) => clearTimeout(handle));
define('IS_REACT_ACT_ENVIRONMENT', false);

// The app calls relative `/api/...` URLs; point them at the running API.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const target = url.startsWith('/') ? `${API_ORIGIN}${url}` : url;
  return nativeFetch(target, init);
};

// `expect` mixes static copy with strings that can only come from Postgres
// (stop, line and model names), so a green run proves the data path works.
const ROUTES = [
  {
    path: '/',
    name: 'Commuter dashboard',
    expect: [
      'Know the crowd',
      'Find Best Route',
      'Commuter Dashboard',
      'Busiest right now',
      'Saved journeys',
      'Tambaram',
      'Network pressure',
    ],
  },
  {
    path: '/routes?origin=STN-12&destination=STN-04&avoidCrowding=true&maxTransfers=1',
    name: 'Route results',
    // Commuter flow: ranked options from the planner, the three recommendation
    // badges, the explainable score and the shared crowd bands.
    expect: [
      'crowd-aware route',
      'AI Recommended',
      'Why this route?',
      'Travel time',
      'Waiting time',
      'Crowd penalty',
      'Overall route score',
      'AI confidence',
      'Why this recommendation',
      'Crowding scale',
      'Tambaram',
    ],
  },
  {
    path: '/routes/details?origin=STN-12&destination=STN-04&lineId=LN-B12&stopId=STN-12',
    name: 'Route details',
    expect: [
      'Boarding plan',
      'Occupancy prediction',
      'AI confidence',
      'Crowd trend',
      'Alternatives on this corridor',
      'Crowd forecast',
      'Model breakdown',
      'Tambaram',
    ],
  },
  {
    // Prediction engine — pipeline stages, crowd classes and a live prediction,
    // all rendered from `/api/prediction/*` (nothing typed into the component).
    path: '/engine',
    name: 'Prediction engine',
    expect: [
      'Simulation Mode',
      'Prediction Engine',
      'Occupancy Prediction',
      'Crowd Classification',
      'Route Optimization',
      'How a prediction is produced',
      'Engine internals',
      'Predicted occupancy',
      'Factor contributions',
      'Model inputs',
      'heuristic-ensemble',
    ],
  },
  {
    // Operator Command Center — network overview, live route status, heatmap,
    // AI alerts, AI recommendations and route analytics, all from
    // `/api/operator/command-center`.
    path: '/operator',
    name: 'Operator command center',
    expect: [
      'Operations Control',
      'Network overview',
      'Active routes',
      'Active vehicles',
      'High crowd routes',
      'Live route status',
      'Crowd heatmap',
      'AI alerts',
      'AI recommendations',
      'Route analytics',
      'Predicted vs current',
      'Simulation Mode',
      'MTC 21G',
      'Tambaram',
    ],
  },
  {
    path: '/alerts',
    name: 'Alerts',
    expect: ['Service notices', 'Severity mix', 'Signal failure'],
  },
  {
    path: '/settings',
    name: 'Settings',
    expect: ['Routing preferences', 'Saved journeys', 'Ananya Raman'],
  },
  {
    // Data Explorer — proves the canonical Postgres dataset is readable from the
    // frontend (table names, record counts and real rows come from the database).
    path: '/database',
    name: 'Data explorer',
    expect: [
      'Supabase Postgres',
      'occupancy_predictions',
      'route_stops',
      'vehicle_snapshots',
      'service_alerts',
      'Row level security',
      'simulated data',
      'Metro Line 1',
    ],
  },
];

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((value) => (value instanceof Error ? value.message : String(value))).join(' '));
  originalError(...args);
};

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  root: path.resolve(process.cwd()),
});

let failures = 0;

try {
  const api = await nativeFetch(`${API_ORIGIN}/api/health`).then((response) => response.json());
  console.log(
    `[smoke] API ok · ${api.database.driver} · schema ${api.database.schemaVersion} · ` +
      `${api.database.rows.observation_count} observations · ` +
      `${api.database.rows.routes ?? 0} routes · ${api.database.rows.occupancy_predictions ?? 0} predictions`,
  );

  const { renderRoute } = await vite.ssrLoadModule('/src/smoke/entry.tsx');

  for (const route of ROUTES) {
    const before = errors.length;
    let html = '';
    try {
      html = await renderRoute(route.path, SETTLE_MS);
    } catch (error) {
      console.log(`✗ ${route.name} — threw during render: ${error.message}`);
      failures += 1;
      continue;
    }

    const missing = route.expect.filter((needle) => !html.includes(needle));
    const routeErrors = errors.slice(before);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!text.length) {
      console.log(`✗ ${route.name} — rendered an empty document`);
      failures += 1;
    } else if (missing.length || routeErrors.length) {
      console.log(`✗ ${route.name} — missing ${JSON.stringify(missing)}`);
      for (const message of routeErrors) console.log(`    console.error: ${message}`);
      failures += 1;
    } else {
      console.log(`✓ ${route.name} — ${text.length} chars · "${text.slice(0, 88)}…"`);
    }
  }
} finally {
  await vite.close();
  console.error = originalError;
}

if (failures) {
  console.log(`\n[smoke] ${failures} route(s) failed`);
  process.exit(1);
}
console.log('\n[smoke] all routes rendered successfully');
