import type { Queryable } from '../db/client';
import type { RiderProfile, SettingsOptions, TransitMode, WatchlistItem } from '../../shared/types';

/**
 * Rider repository — preferences, saved journeys and the option lists the
 * Settings screen populates from the database.
 */

type ProfileRow = {
  id: string;
  display_name: string;
  email: string;
  home_stop_id: string | null;
  work_stop_id: string | null;
  home_stop_name: string | null;
  work_stop_name: string | null;
  crowd_tolerance: number | string;
  max_walk_minutes: number;
  max_transfers: number;
  preferred_modes: TransitMode[];
  notify_push: boolean;
  notify_email: boolean;
  notify_sms: boolean;
  crowd_threshold_alert: number | string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  theme: RiderProfile['theme'];
  units: RiderProfile['units'];
  language: string;
  personalization_enabled: boolean;
};

const mapProfile = (row: ProfileRow): RiderProfile => ({
  id: row.id,
  displayName: row.display_name,
  email: row.email,
  homeStopId: row.home_stop_id,
  workStopId: row.work_stop_id,
  homeStopName: row.home_stop_name,
  workStopName: row.work_stop_name,
  crowdTolerance: Number(row.crowd_tolerance),
  maxWalkMinutes: Number(row.max_walk_minutes),
  maxTransfers: Number(row.max_transfers),
  preferredModes: row.preferred_modes ?? [],
  notifyPush: row.notify_push,
  notifyEmail: row.notify_email,
  notifySms: row.notify_sms,
  crowdThresholdAlert: Number(row.crowd_threshold_alert),
  quietHoursStart: row.quiet_hours_start?.slice(0, 5) ?? null,
  quietHoursEnd: row.quiet_hours_end?.slice(0, 5) ?? null,
  theme: row.theme,
  units: row.units,
  language: row.language,
  personalizationEnabled: row.personalization_enabled,
});

const SELECT_PROFILE = `
  select p.id, p.display_name, p.email, p.home_stop_id, p.work_stop_id,
         hs.name as home_stop_name, ws.name as work_stop_name,
         p.crowd_tolerance, p.max_walk_minutes, p.max_transfers, p.preferred_modes,
         p.notify_push, p.notify_email, p.notify_sms, p.crowd_threshold_alert,
         p.quiet_hours_start::text as quiet_hours_start,
         p.quiet_hours_end::text as quiet_hours_end,
         p.theme, p.units, p.language, p.personalization_enabled
  from rider_profiles p
  left join stops hs on hs.id = p.home_stop_id
  left join stops ws on ws.id = p.work_stop_id
`;

export async function getProfile(db: Queryable, profileId: string): Promise<RiderProfile | null> {
  const row = await db.one<ProfileRow>(`${SELECT_PROFILE} where p.id = $1`, [profileId]);
  return row ? mapProfile(row) : null;
}

export async function getDefaultProfileId(db: Queryable, preferred: string): Promise<string | null> {
  const row = await db.one<{ id: string }>(
    `select id from rider_profiles order by (id = $1) desc, created_at limit 1`,
    [preferred],
  );
  return row?.id ?? null;
}

export async function updateProfile(
  db: Queryable,
  profileId: string,
  patch: Partial<RiderProfile>,
): Promise<RiderProfile | null> {
  const columns: Record<string, string> = {
    displayName: 'display_name',
    email: 'email',
    homeStopId: 'home_stop_id',
    workStopId: 'work_stop_id',
    crowdTolerance: 'crowd_tolerance',
    maxWalkMinutes: 'max_walk_minutes',
    maxTransfers: 'max_transfers',
    preferredModes: 'preferred_modes',
    notifyPush: 'notify_push',
    notifyEmail: 'notify_email',
    notifySms: 'notify_sms',
    crowdThresholdAlert: 'crowd_threshold_alert',
    quietHoursStart: 'quiet_hours_start',
    quietHoursEnd: 'quiet_hours_end',
    theme: 'theme',
    units: 'units',
    language: 'language',
    personalizationEnabled: 'personalization_enabled',
  };

  const assignments: string[] = [];
  const params: unknown[] = [profileId];

  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch)) continue;
    params.push((patch as Record<string, unknown>)[key] ?? null);
    assignments.push(`${column} = $${params.length}`);
  }

  if (!assignments.length) return getProfile(db, profileId);

  await db.query(
    `update rider_profiles set ${assignments.join(', ')} where id = $1`,
    params,
  );
  return getProfile(db, profileId);
}

/** Option lists for the Settings screen, read from the database. */
export async function getSettingsOptions(db: Queryable): Promise<SettingsOptions> {
  const [stops, modes] = await Promise.all([
    db.query<{ id: string; name: string; code: string; is_interchange: boolean }>(
      `select id, name, code, is_interchange from stops
       order by is_interchange desc, daily_boardings desc, name`,
    ),
    db.query<{ mode: TransitMode }>(
      `select distinct mode from lines where is_active order by mode`,
    ),
  ]);

  return {
    stops: stops.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      isInterchange: row.is_interchange,
    })),
    modes: modes.map((row) => row.mode),
    languages: [
      { code: 'en', label: 'English' },
      { code: 'es', label: 'Español' },
      { code: 'fr', label: 'Français' },
      { code: 'hi', label: 'हिन्दी' },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Watchlist                                                                  */
/* -------------------------------------------------------------------------- */

type WatchlistRow = {
  id: string;
  profile_id: string;
  label: string;
  origin_stop_id: string;
  destination_stop_id: string;
  origin_stop_name: string;
  destination_stop_name: string;
  depart_time: string | null;
  days: string[];
  avoid_crowded: boolean;
  notify: boolean;
};

const mapWatchlist = (row: WatchlistRow): WatchlistItem => ({
  id: row.id,
  profileId: row.profile_id,
  label: row.label,
  originStopId: row.origin_stop_id,
  destinationStopId: row.destination_stop_id,
  originStopName: row.origin_stop_name,
  destinationStopName: row.destination_stop_name,
  departTime: row.depart_time?.slice(0, 5) ?? null,
  days: row.days ?? [],
  avoidCrowded: row.avoid_crowded,
  notify: row.notify,
});

export async function listWatchlist(db: Queryable, profileId: string): Promise<WatchlistItem[]> {
  const rows = await db.query<WatchlistRow>(
    `select w.id, w.profile_id, w.label, w.origin_stop_id, w.destination_stop_id,
            o.name as origin_stop_name, d.name as destination_stop_name,
            w.depart_time::text as depart_time, w.days, w.avoid_crowded, w.notify
     from watchlist w
     join stops o on o.id = w.origin_stop_id
     join stops d on d.id = w.destination_stop_id
     where w.profile_id = $1
     order by w.created_at`,
    [profileId],
  );
  return rows.map(mapWatchlist);
}

export async function createWatchlistItem(
  db: Queryable,
  profileId: string,
  input: {
    label: string;
    originStopId: string;
    destinationStopId: string;
    departTime?: string | null;
    days?: string[];
    avoidCrowded?: boolean;
    notify?: boolean;
  },
): Promise<WatchlistItem> {
  const id = `WL-${Date.now().toString(36).toUpperCase()}`;
  await db.query(
    `insert into watchlist (id, profile_id, label, origin_stop_id, destination_stop_id,
                            depart_time, days, avoid_crowded, notify)
     values ($1, $2, $3, $4, $5, $6::time, $7::text[], $8, $9)`,
    [
      id,
      profileId,
      input.label,
      input.originStopId,
      input.destinationStopId,
      input.departTime ?? null,
      input.days ?? ['mon', 'tue', 'wed', 'thu', 'fri'],
      input.avoidCrowded ?? true,
      input.notify ?? true,
    ],
  );

  const created = await db.one<WatchlistRow>(
    `select w.id, w.profile_id, w.label, w.origin_stop_id, w.destination_stop_id,
            o.name as origin_stop_name, d.name as destination_stop_name,
            w.depart_time::text as depart_time, w.days, w.avoid_crowded, w.notify
     from watchlist w
     join stops o on o.id = w.origin_stop_id
     join stops d on d.id = w.destination_stop_id
     where w.id = $1`,
    [id],
  );
  if (!created) throw new Error('Watchlist row could not be read back after insert');
  return mapWatchlist(created);
}

export async function deleteWatchlistItem(
  db: Queryable,
  profileId: string,
  id: string,
): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `delete from watchlist where id = $1 and profile_id = $2 returning id`,
    [id, profileId],
  );
  return rows.length > 0;
}

export async function toggleWatchlistItem(
  db: Queryable,
  profileId: string,
  id: string,
): Promise<WatchlistItem | null> {
  await db.query(
    `update watchlist set avoid_crowded = not avoid_crowded
     where id = $1 and profile_id = $2`,
    [id, profileId],
  );
  const items = await listWatchlist(db, profileId);
  return items.find((item) => item.id === id) ?? null;
}
