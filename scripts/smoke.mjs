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
// The mocked-maps run needs longer: the planner holds its answer for 1.4 s before
// the map panel mounts and starts fetching its own geometry.
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS ?? (process.env.SMOKE_MOCK_MAPS === '1' ? 4000 : 2200));

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
const fetched = [];
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const target = url.startsWith('/') ? `${API_ORIGIN}${url}` : url;
  fetched.push(url);
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
      'Live map',
      'Commuter Dashboard',
      'Busiest right now',
      'Saved journeys',
      'Tambaram',
      'Network pressure',
      // Round-7 refinement: section hierarchy on the rider dashboard.
      'Today at a glance',
      // Round-8: the Google Maps surface with the crowd layer on top.
      'Where the crowds are right now',
      'Network map',
      'SIMULATED DATA',
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
      'Why this recommendation',
      // Round-8: journey map beside the ranked options.
      'Corridor colour = predicted crowd band',
      'SIMULATED DATA',
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
      'Your routing profile',
      // Round-8: the itinerary drawn on the map above the tabs.
      'Route on the map',
      'SIMULATED DATA',
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
      // AI Decision console — detection, actions, projection and the apply flow.
      'AI decision console',
      'AI Decision',
      'Time to congestion',
      'AI Recommended Action',
      'Apply AI Recommendation',
      'Without intervention',
      'With recommended intervention',
      'Simulated projection',
      'Interventions applied',
      // Round-8: control-room map with the status / alert / action rail.
      'Network status',
      'Average occupancy',
      'AI alert',
      'AI action',
      'Apply AI recommendation',
      // Vehicle locations live on the map surface itself.
      'Network map',
    ],
  },
  {
    path: '/alerts',
    name: 'Alerts',
    expect: ['Service notices', 'Severity mix', 'Signal failure', 'Notice overview'],
  },
  {
    path: '/settings',
    name: 'Settings',
    expect: ['Routing preferences', 'Saved journeys', 'Ananya Raman', 'Preferences'],
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

/**
 * Optional mocked Google Maps Platform SDK.
 *
 *   npm run smoke:maps
 *
 * The Maps JavaScript API cannot be loaded for real in a headless sandbox (it
 * needs a referrer-restricted browser key), so this run installs a recording mock
 * of the SDK the client actually calls — `Map`, `Marker`, `Polyline`, `InfoWindow`,
 * `geometry.spherical` — plus a build-time key, then asserts that the map is
 * created and that the TransitPulse layer really draws corridors, stops, vehicles
 * and notices onto it. Text needle checks are identical to the normal run.
 */
const MOCK_MAPS = process.env.SMOKE_MOCK_MAPS === '1';
const sdk = { maps: 0, markers: [], polylines: [], infoWindows: 0 };

if (MOCK_MAPS) {
  class MVCObject {
    addListener() {
      return { remove() {} };
    }
  }
  class MapMock extends MVCObject {
    constructor(element, options) {
      super();
      sdk.maps += 1;
      this.element = element;
      this.options = options;
    }
    fitBounds() {}
    setCenter() {}
    setZoom() {}
    getZoom() {
      return 12;
    }
  }
  class MarkerMock extends MVCObject {
    constructor(options) {
      super();
      this.options = options;
      sdk.markers.push(this);
    }
    setMap(map) {
      this.map = map;
    }
    setPosition() {}
    setIcon() {}
    setZIndex() {}
  }
  class PolylineMock extends MVCObject {
    constructor(options) {
      super();
      this.options = options;
      sdk.polylines.push(this);
    }
    setMap(map) {
      this.map = map;
    }
    getPath() {
      return this.options.path;
    }
  }
  class InfoWindowMock extends MVCObject {
    constructor(options) {
      super();
      this.options = options;
      sdk.infoWindows += 1;
    }
    setContent() {}
    setOptions() {}
    open() {}
    close() {}
  }
  class LatLngMock {
    constructor(lat, lng) {
      this.lat = lat;
      this.lng = lng;
    }
  }
  const googleMock = {
    maps: {
      Map: MapMock,
      Marker: MarkerMock,
      Polyline: PolylineMock,
      InfoWindow: InfoWindowMock,
      LatLng: LatLngMock,
      LatLngBounds: class {},
      SymbolPath: { CIRCLE: 0 },
      event: {
        trigger() {},
        clearInstanceListeners() {},
        addListener() {
          return { remove() {} };
        },
      },
      geometry: { spherical: { computeDistanceBetween: () => 1234 } },
    },
  };
  define('google', googleMock);
  window.google = googleMock;
  define(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
}

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  root: path.resolve(process.cwd()),
  define: MOCK_MAPS
    ? { 'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify('smoke-test-browser-key') }
    : undefined,
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
    const sdkBefore = { maps: sdk.maps, markers: sdk.markers.length, polylines: sdk.polylines.length };
    const fetchBefore = fetched.length;
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
      if (process.env.SMOKE_DEBUG === '1') {
        console.log(`    urls: ${fetched.slice(fetchBefore).join(' ')}`);
      }
      const mapsDrawn = sdk.maps - sdkBefore.maps;
      const drawn = MOCK_MAPS
        ? ` · sdk +${mapsDrawn} map(s) +${sdk.polylines.length - sdkBefore.polylines} line(s) +${
            sdk.markers.length - sdkBefore.markers
          } marker(s)`
        : '';
      console.log(`✓ ${route.name} — ${text.length} chars · "${text.slice(0, 88)}…"${drawn}`);
    }
  }

  if (MOCK_MAPS) {
    // The four map surfaces are on '/' (network), '/routes' and '/routes/details'
    // (journey) and '/operator' (control room). If the SDK calls below happened,
    // the Google Maps path is wired correctly end to end.
    const crowdColors = ['#34d399', '#fbbf24', '#fb7185'];
    const crowdPaths = sdk.polylines.filter((line) => crowdColors.includes(line.options.strokeColor));
    const issues = [];
    if (sdk.maps < 4) issues.push(`expected ≥4 google.maps.Map instances, got ${sdk.maps}`);
    if (sdk.polylines.length < 12) issues.push(`expected ≥12 polylines, got ${sdk.polylines.length}`);
    if (crowdPaths.length < 4) issues.push(`expected ≥4 crowd-coloured corridors, got ${crowdPaths.length}`);
    if (sdk.markers.length < 40) issues.push(`expected ≥40 markers, got ${sdk.markers.length}`);
    if (sdk.infoWindows < 4) issues.push(`expected ≥4 info windows, got ${sdk.infoWindows}`);

    console.log(
      `[smoke] Google Maps SDK (mocked) · ${sdk.maps} maps · ${sdk.polylines.length} polylines ` +
        `(${crowdPaths.length} crowd-tinted) · ${sdk.markers.length} markers · ${sdk.infoWindows} info windows`,
    );
    if (issues.length) {
      for (const issue of issues) console.log(`✗ ${issue}`);
      failures += issues.length;
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
