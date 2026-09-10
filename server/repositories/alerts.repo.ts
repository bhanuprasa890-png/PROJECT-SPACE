import type { Queryable } from '../db/client';
import type {
  Alert,
  AlertCategory,
  AlertSeverity,
  AlertStatus,
  CreateAlertInput,
} from '../../shared/types';

/**
 * Alerts repository — service notices shown to riders and to the control room.
 */

type AlertRow = {
  id: string;
  agency_id: string;
  line_id: string | null;
  line_code: string | null;
  line_color: string | null;
  stop_id: string | null;
  stop_name: string | null;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  body: string;
  starts_at: string | Date;
  ends_at: string | Date | null;
  status: AlertStatus;
  issued_by: string | null;
  created_at: string | Date;
  reach: number;
};

const mapAlert = (row: AlertRow): Alert => ({
  id: row.id,
  agencyId: row.agency_id,
  lineId: row.line_id,
  lineCode: row.line_code,
  lineColor: row.line_color,
  stopId: row.stop_id,
  stopName: row.stop_name,
  severity: row.severity,
  category: row.category,
  title: row.title,
  body: row.body,
  startsAt: new Date(row.starts_at).toISOString(),
  endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
  status: row.status,
  issuedBy: row.issued_by,
  createdAt: new Date(row.created_at).toISOString(),
  reach: Number(row.reach),
});

const SELECT_ALERT = `
  select a.id, a.agency_id, a.line_id, l.code as line_code, l.color as line_color,
         a.stop_id, s.name as stop_name, a.severity, a.category, a.title, a.body,
         a.starts_at, a.ends_at, a.status, a.issued_by, a.created_at, a.reach
  from alerts a
  left join lines l on l.id = a.line_id
  left join stops s on s.id = a.stop_id
`;

export async function listAlerts(
  db: Queryable,
  filters: {
    status?: AlertStatus | 'all';
    severity?: AlertSeverity;
    lineId?: string;
    stopId?: string;
    limit?: number;
  } = {},
): Promise<Alert[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filters.status && filters.status !== 'all') {
    params.push(filters.status);
    where.push(`a.status = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    where.push(`a.severity = $${params.length}`);
  }
  if (filters.lineId) {
    params.push(filters.lineId);
    where.push(`(a.line_id = $${params.length} or a.line_id is null)`);
  }
  if (filters.stopId) {
    params.push(filters.stopId);
    where.push(`(a.stop_id = $${params.length} or a.stop_id is null)`);
  }

  params.push(Math.min(filters.limit ?? 50, 200));

  const rows = await db.query<AlertRow>(
    `${SELECT_ALERT}
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by
       case a.status when 'active' then 0 when 'scheduled' then 1 else 2 end,
       case a.severity when 'critical' then 0 when 'major' then 1 when 'minor' then 2 else 3 end,
       a.starts_at desc
     limit $${params.length}`,
    params,
  );
  return rows.map(mapAlert);
}

export async function getAlert(db: Queryable, id: string): Promise<Alert | null> {
  const row = await db.one<AlertRow>(`${SELECT_ALERT} where a.id = $1`, [id]);
  return row ? mapAlert(row) : null;
}

export async function alertsForLine(db: Queryable, lineId: string): Promise<Alert[]> {
  const rows = await db.query<AlertRow>(
    `${SELECT_ALERT} where a.line_id = $1 and a.status <> 'resolved'
     order by case a.severity when 'critical' then 0 when 'major' then 1
                               when 'minor' then 2 else 3 end`,
    [lineId],
  );
  return rows.map(mapAlert);
}

export async function countActiveAlerts(db: Queryable): Promise<number> {
  const row = await db.one<{ count: string }>(
    `select count(*)::text as count from alerts where status = 'active'`,
  );
  return Number(row?.count ?? 0);
}

export async function createAlert(
  db: Queryable,
  agencyId: string,
  input: CreateAlertInput & { id?: string },
): Promise<Alert> {
  const id = input.id ?? `ALT-${Date.now().toString(36).toUpperCase()}`;
  await db.query(
    `insert into alerts (id, agency_id, line_id, stop_id, severity, category, title, body,
                         starts_at, ends_at, status, issued_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()),
             $10::timestamptz,
             case when $9::timestamptz is not null and $9::timestamptz > now() then 'scheduled' else 'active' end,
             $11)`,
    [
      id,
      agencyId,
      input.lineId ?? null,
      input.stopId ?? null,
      input.severity,
      input.category,
      input.title,
      input.body,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.issuedBy ?? 'Control Room',
    ],
  );
  const created = await getAlert(db, id);
  if (!created) throw new Error('Alert insert succeeded but the row could not be read back');
  return created;
}

export async function updateAlertStatus(
  db: Queryable,
  id: string,
  status: AlertStatus,
): Promise<Alert | null> {
  await db.query(
    `update alerts
     set status = $2,
         ends_at = case when $2 = 'resolved' then coalesce(ends_at, now()) else ends_at end
     where id = $1`,
    [id, status],
  );
  return getAlert(db, id);
}

/** Alerts raised in the trailing window vs the window before it. */
export async function alertCadence(
  db: Queryable,
  hours = 24,
): Promise<{ current: number; previous: number }> {
  const row = await db.one<{ current: number; previous: number }>(
    `select
       count(*) filter (where starts_at > now() - make_interval(hours => $1::integer))::int
         as current,
       count(*) filter (
         where starts_at <= now() - make_interval(hours => $1::integer)
           and starts_at > now() - make_interval(hours => ($1 * 2)::integer)
       )::int as previous
     from alerts`,
    [hours],
  );
  return { current: Number(row?.current ?? 0), previous: Number(row?.previous ?? 0) };
}

/** Retract a notice entirely (mis-published alerts). */
export async function deleteAlert(db: Queryable, id: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    'delete from alerts where id = $1 returning id',
    [id],
  );
  return rows.length > 0;
}

export async function alertSeverityBreakdown(
  db: Queryable,
): Promise<Record<AlertSeverity, number>> {
  const rows = await db.query<{ severity: AlertSeverity; count: number }>(
    `select severity, count(*)::int as count
     from alerts where status <> 'resolved' group by severity`,
  );
  const breakdown: Record<AlertSeverity, number> = { info: 0, minor: 0, major: 0, critical: 0 };
  for (const row of rows) breakdown[row.severity] = Number(row.count);
  return breakdown;
}
