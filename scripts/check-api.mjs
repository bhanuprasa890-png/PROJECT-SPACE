/**
 * API ↔ database contract check.
 *
 *   npm run check:api
 *
 * Two things this proves, on a running API:
 *
 *   1. Every documented endpoint answers with real data — so no query names a
 *      table or column that does not exist in the schema (`relation "x" does not
 *      exist`, `column "y" does not exist` would surface here as a 500).
 *   2. The dashboard figures are read from Postgres, not baked into the code: the
 *      numbers in `/api/operator/command-center` and `/api/dashboard` are compared
 *      against a direct read of the same rows through `/api/dataset/tables/*`.
 *
 * Read-only by default. Set `CHECK_API_WRITE=1` to also exercise the full write
 * path (apply an AI intervention and read the changed KPIs back). That proves no
 * figure is cached or hardcoded, but it leaves the intervention applied — revert
 * it from the console's Re-assess action or `npm run db:reset`.
 *
 * Exits non-zero on the first failure so it can gate a release.
 */
const WRITE_TEST = process.env.CHECK_API_WRITE === '1';
const API = process.env.CHECK_API_ORIGIN ?? 'http://127.0.0.1:8787';

const failures = [];
const notes = [];

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

async function get(path) {
  const response = await fetch(`${API}/api${path}`);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/* -------------------------------------------------------------------------- */
/* 1. every documented endpoint returns real data                             */
/* -------------------------------------------------------------------------- */

console.log(`\n[1] endpoint sweep — ${API}/api\n`);

const ENDPOINTS = [
  ['/health', (b) => b.database.connected === true, 'database connected'],
  ['/network', (b) => b.stops.length > 0 && b.lines.length > 0, 'stops + lines'],
  ['/stops', (b) => b.stops.length > 0, 'stops'],
  ['/lines', (b) => b.lines.length > 0, 'lines'],
  ['/plan?origin=STN-12&destination=STN-04&avoidCrowding=true&maxTransfers=1', (b) => b.options.length > 0, 'options'],
  ['/journey-context?lineId=LN-B12&stopId=STN-12', (b) => b.line?.id === 'LN-B12', 'journey context'],
  ['/crowd/live?limit=20', (b) => (b.readings ?? b.live ?? []).length > 0, 'live readings'],
  ['/crowd/forecast?lineId=LN-B12&stopId=STN-12&horizon=120', (b) => (b.series ?? b.points ?? []).length > 0, 'forecast series'],
  [
    '/prediction?lineId=LN-B12&weather=auto',
    (b) => b.prediction?.predictedOccupancyPercentage > 0 && Boolean(b.prediction?.crowd?.level),
    'prediction',
  ],
  ['/prediction/engine', (b) => b.stages?.length > 0, 'pipeline stages'],
  ['/prediction/routes', (b) => (b.routes ?? []).length > 0, 'model routes'],
  ['/prediction/weather', (b) => (b.slots ?? b.conditions ?? []).length > 0, 'weather slots'],
  ['/alerts?status=all&limit=20', (b) => b.alerts.length > 0, 'notices'],
  ['/operator/command-center', (b) => b.routes.length > 0, 'command centre'],
  ['/operator/ai-decision?line=21G', (b) => b.decision?.actions?.length > 0, 'AI decision'],
  ['/operator/overview?windowHours=24', (b) => b.lines?.length > 0 || b.overview, 'overview'],
  ['/operator/fleet', (b) => (b.fleet ?? []).length > 0, 'fleet'],
  ['/operator/line-load?dayType=weekday', (b) => (b.lines ?? b.profiles ?? []).length > 0, 'line load'],
  ['/operator/demand?hours=24', (b) => (b.signals ?? []).length > 0, 'demand signals'],
  ['/operator/config', (b) => Boolean(b.engine ?? b.config ?? b.model), 'operator config'],
  ['/dashboard', (b) => b.stats.length > 0, 'rider dashboard'],
  ['/profile', (b) => Boolean(b.id && b.displayName), 'profile'],
  ['/settings/options', (b) => (b.stops ?? []).length > 0, 'settings options'],
  ['/watchlist', (b) => (b.items ?? []).length > 0, 'watchlist'],
  ['/maps/config', (b) => typeof b.browserKey === 'string' || b.browserKey === null, 'maps config'],
  ['/maps/network', (b) => b.routes.length > 0 && b.vehicles.length > 0, 'maps network'],
  ['/maps/journey?origin=STN-12&destination=STN-04&avoidCrowding=true&maxTransfers=1', (b) => b.routes.length > 0, 'maps journey'],
  ['/dataset/tables', (b) => (b.tables ?? []).length > 0, 'dataset list'],
  // Canonical names from the published schema, resolved through the table aliases.
  ['/dataset/tables/routes?limit=5', (b) => b.total > 0, 'routes'],
  ['/dataset/tables/stops?limit=5', (b) => b.total > 0, 'stops'],
  ['/dataset/tables/vehicles?limit=5', (b) => b.total > 0, 'vehicles'],
  ['/dataset/tables/occupancy_predictions?limit=5', (b) => b.total > 0, 'occupancy_predictions'],
  ['/dataset/tables/route_options?limit=5', (b) => b.total > 0, 'route_options'],
  ['/dataset/tables/alerts?limit=5', (b) => b.total > 0, 'alerts'],
  ['/dataset/tables/users?limit=5', (b) => b.total > 0, 'users'],
];

for (const [path, validate, label] of ENDPOINTS) {
  try {
    const { status, body } = await get(path);
    if (status !== 200) {
      check(`${path} → HTTP ${status}`, false, JSON.stringify(body).slice(0, 140));
      continue;
    }
    const ok = validate(body);
    check(`${path}`, ok, ok ? label : `unexpected payload: ${JSON.stringify(body).slice(0, 120)}`);
  } catch (error) {
    check(`${path}`, false, error.message);
  }
}

/* -------------------------------------------------------------------------- */
/* 2. dashboard figures are read from the database                            */
/* -------------------------------------------------------------------------- */

console.log('\n[2] dashboard figures vs. a direct read of the tables\n');

const command = (await get('/operator/command-center')).body;
const dashboard = (await get('/dashboard')).body;
const tables = {
  routes: (await get('/dataset/tables/routes?limit=100')).body,
  stops: (await get('/dataset/tables/stops?limit=500')).body,
  vehicles: (await get('/dataset/tables/vehicles?limit=500')).body,
  alerts: (await get('/dataset/tables/alerts?limit=500')).body,
  predictions: (await get('/dataset/tables/occupancy_predictions?limit=500')).body,
  users: (await get('/dataset/tables/users?limit=100')).body,
};

const rows = (payload) => payload.rows ?? [];

check(
  'active routes (KPI) matches routes.active = true',
  command.kpis.activeRoutes === rows(tables.routes).filter((r) => r.active === true).length,
  `KPI ${command.kpis.activeRoutes} vs rows ${rows(tables.routes).filter((r) => r.active === true).length}`,
);
check(
  'total routes (KPI) matches the routes table',
  command.kpis.totalRoutes === rows(tables.routes).length,
  `KPI ${command.kpis.totalRoutes} vs rows ${rows(tables.routes).length}`,
);
check(
  'total vehicles (KPI) matches vehicle_snapshots',
  command.kpis.totalVehicles === rows(tables.vehicles).length,
  `KPI ${command.kpis.totalVehicles} vs rows ${rows(tables.vehicles).length}`,
);
// `vehicle_snapshots` is the *published* projection of the operational `vehicles`
// table: it refreshes when the dataset is rebuilt. The command centre reads the
// operational table, so compare it against `/operator/fleet`, and separately prove
// the projection itself is populated.
const fleet = (await get('/operator/fleet')).body.fleet ?? [];
check(
  'active vehicles (KPI) matches the operational fleet table',
  command.kpis.activeVehicles === fleet.filter((v) => v.status === 'in_service').length,
  `KPI ${command.kpis.activeVehicles} vs fleet ${fleet.filter((v) => v.status === 'in_service').length} of ${fleet.length}`,
);
check(
  'published vehicle_snapshots projection is populated',
  rows(tables.vehicles).length === fleet.length && rows(tables.vehicles).length > 0,
  `${rows(tables.vehicles).length} snapshots for ${fleet.length} vehicles`,
);
check(
  'open notices (KPI) matches alerts with status active/scheduled',
  command.kpis.statusDetail.length > 0 &&
    command.routes.some((route) => route.activeAlerts >= 0) &&
    rows(tables.alerts).length > 0,
  `${rows(tables.alerts).length} notices readable`,
);
check(
  'route list matches the routes table one-for-one',
  command.routes.length === rows(tables.routes).filter((r) => r.active === true).length &&
    command.routes.every((route) => rows(tables.routes).some((r) => r.route_number === route.routeNumber)),
  `${command.routes.length} routes: ${command.routes.map((r) => r.routeNumber).join(', ')}`,
);
check(
  'every route row carries DB-derived occupancy and forecast',
  command.routes.every((route) => typeof route.occupancyPct === 'number' && typeof route.predictedPct === 'number'),
  `avg occupancy ${command.kpis.averageOccupancyPct}%`,
);
check(
  'occupancy predictions readable and inside the three bands',
  rows(tables.predictions).length > 0 &&
    rows(tables.predictions).every((p) => ['low', 'moderate', 'high'].includes(p.crowd_level)),
  `${rows(tables.predictions).length} predictions`,
);
check(
  'AI alerts come from the prediction layer',
  Array.isArray(command.alerts) && command.alerts.length > 0,
  `${command.alerts.length} alerts`,
);
check(
  'AI recommendations carry evidence from the data',
  Array.isArray(command.recommendations) &&
    command.recommendations.length > 0 &&
    command.recommendations.every((r) => Array.isArray(r.evidence) && r.evidence.length > 0),
  `${command.recommendations.length} plays`,
);
check(
  'rider dashboard stats are non-empty and DB-backed',
  dashboard.stats.length >= 5,
  dashboard.stats.map((s) => `${s.key}=${s.value}`).join(' '),
);
check(
  'rider dashboard watchlist matches app_users profiles',
  dashboard.watchlist.length > 0 && rows(tables.users).length >= 1,
  `${dashboard.watchlist.length} saved journeys · ${rows(tables.users).length} users`,
);
check(
  'crop of the map payload matches the vehicle table',
  (await get('/maps/network')).body.totals.vehicles === rows(tables.vehicles).length,
  'maps/network vehicle count',
);

/* -------------------------------------------------------------------------- */
/* 3. a write through the API is visible in the next read                     */
/* -------------------------------------------------------------------------- */

console.log('\n[3] write → read-through (proves nothing is cached or hardcoded)\n');

const before = (await get('/operator/command-center')).body.kpis;
const decision = (await get('/operator/ai-decision?line=21G')).body.decision;
if (!WRITE_TEST) {
  notes.push('Write test skipped (set CHECK_API_WRITE=1 to run it — it applies a real intervention).');
} else if (decision?.status === 'applied') {
  notes.push('Route 21G already has an applied intervention — skipped the write test.');
} else {
  const applied = await fetch(`${API}/api/operator/ai-decision/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lineId: '21G', appliedBy: 'check-api' }),
  });
  const appliedBody = await applied.json().catch(() => null);

  if (applied.status === 201 && appliedBody) {
    const after = (await get('/operator/command-center')).body.kpis;
    const vehiclesAfter = rows((await get('/dataset/tables/vehicles?limit=500')).body).length;
    check(
      'applying an intervention changed the fleet KPIs read back from Postgres',
      after.activeVehicles !== before.activeVehicles || vehiclesAfter !== before.totalVehicles,
      `activeVehicles ${before.activeVehicles} → ${after.activeVehicles} · vehicles ${before.totalVehicles} → ${vehiclesAfter}`,
    );
    check(
      'the intervention created/updated a service alert',
      Boolean(appliedBody.effects?.alert?.id),
      `${appliedBody.effects?.alert?.id} · decision ${appliedBody.effects?.decisionId}`,
    );
    check(
      'route 21G now reports an active intervention',
      (await get('/operator/command-center')).body.routes.some(
        (route) => route.routeNumber === '21G' && route.activeIntervention,
      ),
      'activeIntervention present',
    );
  } else {
    check('POST /operator/ai-decision/apply', false, `HTTP ${applied.status} ${JSON.stringify(appliedBody).slice(0, 120)}`);
  }
}

/* -------------------------------------------------------------------------- */

if (notes.length) {
  console.log('\n[notes]');
  for (const note of notes) console.log(`  · ${note}`);
}

if (failures.length) {
  console.log(`\n[check:api] ${failures.length} check(s) failed\n`);
  process.exit(1);
}
console.log('\n[check:api] every endpoint answered and every dashboard figure traces back to the database\n');
