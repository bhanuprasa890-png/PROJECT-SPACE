import { closeDb, getDb } from '../db/client';
import type { Queryable } from '../db/client';
import { runMigrations } from '../db/migrate';
import { refreshDataset } from '../repositories/dataset.repo';
import { DATASET_MINIMUMS, DATASET_TABLES } from '../../shared/dataset';

/**
 * Small operator CLI around the database layer.
 *
 *   npm run db:status            row counts + latest schema version
 *   npm run db:migrate           apply pending migrations (and seed if empty)
 *   npm run db:reset             re-apply the demo seed on top of the schema
 *   npm run db:verify            assert the canonical dataset is complete and well-formed
 *   npm run db:refresh           rebuild the canonical dataset from the network model
 *   npm run db:sql -- "select * from v_network_summary"
 */
const TABLES = [
  // canonical dataset
  'routes',
  'route_stops',
  'vehicle_snapshots',
  'occupancy_predictions',
  'route_options',
  'service_alerts',
  'app_users',
  // network model
  'agencies',
  'stops',
  'lines',
  'line_stops',
  'service_patterns',
  'vehicles',
  'crowd_observations',
  'crowd_forecasts',
  'alerts',
  'rider_profiles',
  'watchlist',
  'route_searches',
  'route_search_options',
  'model_config',
];

/**
 * `npm run db:verify` — an executable checklist for the canonical demo dataset.
 *
 * Asserts that every requested table exists with the requested columns, that
 * primary keys, foreign keys and indexes are in place, that the seed reaches the
 * required row counts, and that joins across the tables return real records.
 */
async function verify(db: Queryable): Promise<boolean> {
  const results: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail });
  };

  // --- 1. tables exist, with the requested columns --------------------------
  const requested: Record<string, string[]> = {
    routes: ['id', 'route_number', 'route_name', 'origin', 'destination', 'estimated_duration_minutes', 'active', 'created_at'],
    route_stops: ['id', 'route_id', 'stop_name', 'latitude', 'longitude', 'stop_order', 'created_at'],
    vehicle_snapshots: ['id', 'vehicle_number', 'route_id', 'capacity', 'current_occupancy', 'status', 'latitude', 'longitude', 'updated_at'],
    occupancy_predictions: ['id', 'route_id', 'vehicle_id', 'prediction_time', 'predicted_occupancy_percentage', 'crowd_level', 'confidence_percentage', 'created_at'],
    route_options: ['id', 'route_id', 'travel_time_minutes', 'waiting_time_minutes', 'crowd_penalty', 'total_score', 'created_at'],
    service_alerts: ['id', 'route_id', 'alert_type', 'message', 'severity', 'predicted_occupancy', 'estimated_time_to_event', 'active', 'created_at'],
    app_users: ['id', 'name', 'email', 'role', 'created_at'],
  };

  for (const [table, columns] of Object.entries(requested)) {
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    const present = new Set(rows.map((row) => row.column_name));
    const missing = columns.filter((column) => !present.has(column));
    check(`columns ${table}`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${columns.length} columns`);
  }

  // --- 2. primary keys, foreign keys and indexes ----------------------------
  for (const table of Object.keys(requested)) {
    const pk = await db.one<{ count: string }>(
      `select count(*)::text as count from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and i.indisprimary`,
      [table],
    );
    check(`primary key ${table}`, Number(pk?.count ?? 0) > 0);
  }

  const fks = await db.query<{ table_name: string; count: string }>(
    `select tc.table_name, count(*)::text as count
     from information_schema.table_constraints tc
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
       and tc.table_name = any($1::text[])
     group by tc.table_name`,
    [Object.keys(requested)],
  );
  const fkByTable = new Map(fks.map((row) => [row.table_name, Number(row.count)]));
  for (const table of ['route_stops', 'vehicle_snapshots', 'occupancy_predictions', 'route_options', 'service_alerts']) {
    check(`foreign keys ${table}`, (fkByTable.get(table) ?? 0) > 0, `${fkByTable.get(table) ?? 0} fk`);
  }

  const indexes = await db.query<{ tablename: string; count: string }>(
    `select tablename, count(*)::text as count from pg_indexes
     where schemaname = 'public' and tablename = any($1::text[])
     group by tablename`,
    [Object.keys(requested)],
  );
  const idxByTable = new Map(indexes.map((row) => [row.tablename, Number(row.count)]));
  for (const table of Object.keys(requested)) {
    check(`indexes ${table}`, (idxByTable.get(table) ?? 0) >= 1, `${idxByTable.get(table) ?? 0} index(es)`);
  }

  // --- 3. no empty tables, and the seed reaches every minimum ---------------
  for (const [name, minimum] of Object.entries(DATASET_MINIMUMS)) {
    const def = DATASET_TABLES.find((table) => table.name === name);
    const table = def?.name ?? name;
    const row = await db.one<{ count: string }>(`select count(*)::text as count from ${table}`);
    const count = Number(row?.count ?? 0);
    check(`${table} ≥ ${minimum} rows`, count >= minimum, `${count} rows`);
  }

  // --- 4. integrity and shape of the data ----------------------------------
  const orphanStops = await db.one<{ count: string }>(
    `select count(*)::text as count from route_stops rs
     left join routes r on r.id = rs.route_id where r.id is null`,
  );
  check('route_stops reference existing routes', Number(orphanStops?.count ?? 0) === 0);

  const firstStop = await db.one<{ count: string }>(
    `select count(*)::text as count from route_stops where stop_order < 1`,
  );
  check('stop_order is 1-based', Number(firstStop?.count ?? 0) === 0);

  const badLevels = await db.one<{ count: string }>(
    `select count(*)::text as count from occupancy_predictions
     where crowd_level not in ('low', 'moderate', 'high')
        or crowd_level <> fn_crowd_level(predicted_occupancy_percentage / 100.0)
        or predicted_occupancy_percentage < 0
        or confidence_percentage not between 0 and 100`,
  );
  check('occupancy predictions within valid ranges and three bands', Number(badLevels?.count ?? 0) === 0);

  // The commuter score must be exactly additive — this is what the route cards
  // show as "Why this route?":
  //     total_score = travel time + waiting time + crowd penalty
  const scoreDrift = await db.one<{ count: string; worst: string | null }>(
    `select count(*)::text as count,
            max(abs(total_score - (travel_time_minutes + waiting_time_minutes + crowd_penalty)))::text as worst
     from route_options
     where abs(total_score - (travel_time_minutes + waiting_time_minutes + crowd_penalty)) > 0.001`,
  );
  check(
    'route score is travel + waiting + crowd penalty',
    Number(scoreDrift?.count ?? 0) === 0,
    `${scoreDrift?.count ?? 0} drift (max ${scoreDrift?.worst ?? '0'})`,
  );

  const bands = await db.query<{ ratio: string; level: string }>(
    `select r::text as ratio, fn_crowd_level(r) as level
     from (values (0.10::numeric), (0.60), (0.61), (0.85), (0.86), (1.20)) as v(r)`,
  );
  check(
    'shared bands: <60 low · 60-85 moderate · >85 high',
    bands.map((row) => row.level).join(',') === 'low,low,moderate,moderate,high,high',
    bands.map((row) => `${row.ratio}=${row.level}`).join(' '),
  );

  const penalty = await db.one<{ low: string; mid: string; high: string }>(
    `select fn_crowd_penalty_minutes(0.30)::text as low,
            fn_crowd_penalty_minutes(0.70)::text as mid,
            fn_crowd_penalty_minutes(1.00)::text as high`,
  );
  check(
    'crowd penalty rises with occupancy',
    Number(penalty?.low ?? 0) < Number(penalty?.mid ?? 0) &&
      Number(penalty?.mid ?? 0) < Number(penalty?.high ?? 0),
    `30%→${penalty?.low} · 70%→${penalty?.mid} · 100%→${penalty?.high} min`,
  );

  const roles = await db.query<{ role: string }>(
    `select distinct role from app_users order by role`,
  );
  const roleSet = roles.map((row) => row.role);
  check('all three roles present', ['admin', 'commuter', 'operator'].every((role) => roleSet.includes(role)), roleSet.join(', '));

  const alertTypes = await db.one<{ count: string }>(
    `select count(distinct alert_type)::text as count from service_alerts`,
  );
  check('alerts cover multiple types', Number(alertTypes?.count ?? 0) >= 3, `${alertTypes?.count} types`);

  // --- 5. joins return real records (the query the UI/BI tool would run) ----
  const join = await db.query<{ route_number: string; stop_name: string; vehicle_number: string; crowd_level: string }>(
    `select r.route_number, rs.stop_name, v.vehicle_number, p.crowd_level
     from routes r
     join route_stops rs on rs.route_id = r.id and rs.stop_order = 1
     join vehicle_snapshots v on v.route_id = r.id
     join occupancy_predictions p on p.route_id = r.id
     order by r.route_number, rs.stop_name, v.vehicle_number, p.prediction_time
     limit 5`,
  );
  check('joined route/stop/vehicle/prediction query', join.length > 0, `${join.length} rows`);

  const peak = await db.one<{ route_number: string; peak: string; level: string }>(
    `select r.route_number, max(p.predicted_occupancy_percentage)::text as peak,
            (array_agg(p.crowd_level order by p.predicted_occupancy_percentage desc))[1] as level
     from occupancy_predictions p join routes r on r.id = p.route_id
     group by r.route_number order by max(p.predicted_occupancy_percentage) desc limit 1`,
  );
  check('peak congestion is queryable', Boolean(peak), peak ? `${peak.route_number} at ${peak.peak}% (${peak.level})` : '');

  // --- 6. published views expose the requested names ------------------------
  for (const view of ['v_stops', 'v_vehicles', 'v_alerts', 'v_users']) {
    const row = await db.one<{ count: string }>(`select count(*)::text as count from ${view}`);
    check(`view ${view}`, Number(row?.count ?? 0) > 0, `${row?.count ?? 0} rows`);
  }

  // --- 7. demo data is labelled as such in the database itself --------------
  const comments = await db.one<{ count: string }>(
    `select count(*)::text as count from pg_description d
     join pg_class c on c.oid = d.objoid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1::text[])
       and d.description like 'DEMO DATA%'`,
    [Object.keys(requested)],
  );
  check('tables marked as DEMO DATA', Number(comments?.count ?? 0) === Object.keys(requested).length, `${comments?.count}/${Object.keys(requested).length}`);

  // --- report ---------------------------------------------------------------
  const passed = results.filter((result) => result.ok).length;
  console.log(`\n[db] verification — ${passed}/${results.length} checks passed\n`);
  for (const result of results) {
    const mark = result.ok ? '✓' : '✗';
    console.log(`  ${mark} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    console.log(`\n[db] ${failures.length} check(s) failed:`);
    for (const failure of failures) console.log(`  · ${failure.name} — ${failure.detail}`);
    return false;
  }

  console.log('\n[db] canonical dataset verified: schema, constraints, seed and joins are all good.\n');
  return true;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'status';
  const db = await getDb();

  if (command === 'sql') {
    const statement = process.argv.slice(3).join(' ');
    if (!statement) throw new Error('Provide a SQL statement, e.g. npm run db:sql -- "select 1"');
    const rows = await db.query(statement);
    console.table(rows);
    return;
  }

  if (command === 'verify') {
    process.exitCode = await verify(db) ? 0 : 1;
    return;
  }

  if (command === 'refresh') {
    const counts = await refreshDataset(db);
    console.log('[db] canonical dataset rebuilt');
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(22)} ${count}`);
    }
    return;
  }

  if (command === 'reset') {
    const report = await runMigrations(db, { forceSeeds: true });
    console.log(`[db] schema ${report.schemaVersion}`);
    console.log(`[db] reseeded: ${report.seedsApplied.join(', ') || 'nothing to do'}`);
  } else if (command === 'migrate') {
    const report = await runMigrations(db);
    console.log(`[db] schema ${report.schemaVersion}`);
    console.log(`[db] applied: ${report.applied.join(', ') || 'none'}`);
    console.log(`[db] seeds:   ${report.seedsApplied.join(', ') || 'none'}`);
  }

  console.log(`[db] driver: ${db.kind}`);
  for (const table of TABLES) {
    const row = await db.one<{ count: string }>(`select count(*)::text as count from ${table}`);
    console.log(`  ${table.padEnd(22)} ${row?.count ?? '0'}`);
  }
}

main()
  .catch((error) => {
    console.error('[db] error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
