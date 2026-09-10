import { closeDb, getDb } from '../db/client';
import { runMigrations } from '../db/migrate';

/**
 * Small operator CLI around the database layer.
 *
 *   npm run db:status            row counts + latest schema version
 *   npm run db:migrate           apply pending migrations (and seed if empty)
 *   npm run db:reset             re-apply the demo seed on top of the schema
 *   npm run db:sql -- "select * from v_network_summary"
 */
const TABLES = [
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
