/**
 * Canonical demo dataset registry.
 *
 * Single source of truth for the tables the Data Explorer exposes:
 *
 *   · `name`        — the physical table or view in Postgres
 *   · `requestedAs` — the table name in the canonical route-level schema
 *                     (see supabase/migrations/0004_canonical_dataset.sql)
 *   · `defaultOrder`— deterministic ordering so pagination is stable
 *
 * DEMO / SIMULATED DATA — these tables are generated from the network model by
 * `fn_refresh_demo_dataset()`; nothing in them describes real operations.
 *
 * The registry doubles as the server-side whitelist: table and column names are
 * never interpolated into SQL from user input.
 */

export interface DatasetTableDef {
  name: string;
  label: string;
  kind: 'table' | 'view';
  /** Table name in the requested canonical schema (may differ — see migration 0004). */
  requestedAs: string;
  primaryKey: string;
  defaultOrder: string;
  description: string;
}

export const DATASET_TABLES: DatasetTableDef[] = [
  {
    name: 'routes',
    label: 'Routes',
    kind: 'table',
    requestedAs: 'routes',
    primaryKey: 'id',
    defaultOrder: 'route_number',
    description: 'Published route list with endpoints and end-to-end duration.',
  },
  {
    name: 'route_stops',
    label: 'Stops (per route)',
    kind: 'table',
    requestedAs: 'stops',
    primaryKey: 'id',
    defaultOrder: 'route_id, stop_order',
    description: 'Ordered stop list for each route, with coordinates.',
  },
  {
    name: 'vehicle_snapshots',
    label: 'Vehicles',
    kind: 'table',
    requestedAs: 'vehicles',
    primaryKey: 'id',
    defaultOrder: 'route_id, vehicle_number',
    description: 'Live fleet snapshot: position, load and status per vehicle.',
  },
  {
    name: 'occupancy_predictions',
    label: 'Occupancy predictions',
    kind: 'table',
    requestedAs: 'occupancy_predictions',
    primaryKey: 'id',
    defaultOrder: 'prediction_time, route_id',
    description: 'Model output per route and time slot, with crowd level and confidence.',
  },
  {
    name: 'route_options',
    label: 'Route options',
    kind: 'table',
    requestedAs: 'route_options',
    primaryKey: 'id',
    defaultOrder: 'route_id, total_score',
    description: 'Scored itinerary alternatives per route (lower score wins).',
  },
  {
    name: 'service_alerts',
    label: 'Alerts',
    kind: 'table',
    requestedAs: 'alerts',
    primaryKey: 'id',
    defaultOrder: 'created_at desc',
    description: 'Route-level rider notices with severity and predicted occupancy.',
  },
  {
    name: 'app_users',
    label: 'Users',
    kind: 'table',
    requestedAs: 'users',
    primaryKey: 'id',
    defaultOrder: 'role, name',
    description: 'Application users and their role (commuter, operator, admin).',
  },
  {
    name: 'v_stops',
    label: 'stops (published name)',
    kind: 'view',
    requestedAs: 'stops',
    primaryKey: 'id',
    defaultOrder: 'route_id, stop_order',
    description: 'Read-only view exposing `route_stops` under the requested `stops` name.',
  },
  {
    name: 'v_vehicles',
    label: 'vehicles (published name)',
    kind: 'view',
    requestedAs: 'vehicles',
    primaryKey: 'id',
    defaultOrder: 'route_id, vehicle_number',
    description: 'Read-only view exposing `vehicle_snapshots` under the requested `vehicles` name.',
  },
  {
    name: 'v_alerts',
    label: 'alerts (published name)',
    kind: 'view',
    requestedAs: 'alerts',
    primaryKey: 'id',
    defaultOrder: 'created_at desc',
    description: 'Read-only view exposing `service_alerts` under the requested `alerts` name.',
  },
  {
    name: 'v_users',
    label: 'users (published name)',
    kind: 'view',
    requestedAs: 'users',
    primaryKey: 'id',
    defaultOrder: 'role, name',
    description: 'Read-only view exposing `app_users` under the requested `users` name.',
  },
  {
    name: 'ai_decisions',
    label: 'AI decisions',
    kind: 'table',
    requestedAs: 'ai_decisions',
    primaryKey: 'id',
    defaultOrder: 'detected_at desc',
    description:
      'AI congestion decisions and the interventions applied from the Operator Command Center.',
  },
  {
    name: 'ai_decision_actions',
    label: 'AI decision actions',
    kind: 'table',
    requestedAs: 'ai_decision_actions',
    primaryKey: 'id',
    defaultOrder: 'decision_id, seq',
    description: 'Numbered actions inside a decision, each with its modelled relief at the peak.',
  },
  {
    name: 'v_ai_interventions',
    label: 'AI interventions (joined)',
    kind: 'view',
    requestedAs: 'v_ai_interventions',
    primaryKey: 'id',
    defaultOrder: 'applied_at desc',
    description: 'Read-only view joining each decision to the vehicle it released and its alert.',
  },
];

export const DATASET_TABLE_NAMES: readonly string[] = DATASET_TABLES.map((table) => table.name);

export function findDatasetTable(name: string): DatasetTableDef | undefined {
  return DATASET_TABLES.find((table) => table.name === name);
}

/** Row counts every canonical table must reach for the demo dataset to be complete. */
export const DATASET_MINIMUMS: Record<string, number> = {
  routes: 6,
  route_stops: 12,
  vehicle_snapshots: 12,
  occupancy_predictions: 30,
  route_options: 20,
  service_alerts: 10,
  app_users: 3,
  ai_decisions: 2,
  ai_decision_actions: 5,
};
