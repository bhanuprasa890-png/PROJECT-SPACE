import type { Queryable } from '../db/client';
import type { DemandSignal, RecommendationKind } from '../../shared/types';

/**
 * Journey-search repository — every planner run is persisted so the operator
 * dashboard can report real demand instead of illustrative numbers.
 */

export interface SearchOptionRecord {
  id: string;
  kind: RecommendationKind;
  totalMinutes: number;
  transfers: number;
  crowdRisk: number;
  avgCrowdRatio: number;
  score: number;
  crowdingAvoidedPct: number;
  legs: unknown;
}

export async function recordSearch(
  db: Queryable,
  input: {
    profileId: string | null;
    originStopId: string;
    destinationStopId: string;
    departAfter: string;
    avoidCrowding: boolean;
    recommendedOptionId: string | null;
    options: SearchOptionRecord[];
  },
): Promise<number> {
  const search = await db.one<{ id: string }>(
    `insert into route_searches (
       profile_id, origin_stop_id, destination_stop_id, depart_after,
       avoid_crowding, options_returned, recommended_option_id
     ) values ($1, $2, $3, $4::timestamptz, $5, $6, $7)
     returning id`,
    [
      input.profileId,
      input.originStopId,
      input.destinationStopId,
      input.departAfter,
      input.avoidCrowding,
      input.options.length,
      input.recommendedOptionId,
    ],
  );

  const searchId = Number(search?.id ?? 0);
  if (!searchId) throw new Error('Failed to persist route search');

  // The API-facing option id is stable per kind (e.g. `opt-best-0`); the stored
  // primary key adds the search id so options are unique across all searches.
  for (const [index, option] of input.options.entries()) {
    await db.query(
      `insert into route_search_options (
         id, search_id, kind, total_minutes, transfers, crowd_risk,
         avg_crowd_ratio, score, crowding_avoided_pct, legs
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        `rso-${searchId}-${index + 1}`,
        searchId,
        option.kind,
        option.totalMinutes,
        option.transfers,
        option.crowdRisk,
        option.avgCrowdRatio,
        option.score,
        option.crowdingAvoidedPct,
        JSON.stringify(option.legs),
      ],
    );
  }

  return searchId;
}

export async function listDemandSignals(
  db: Queryable,
  options: { windowDays?: number; limit?: number } = {},
): Promise<DemandSignal[]> {
  const rows = await db.query<{
    origin_stop_id: string;
    origin_stop_name: string;
    destination_stop_id: string;
    destination_stop_name: string;
    searches: number;
    avoid_share: number | string | null;
    recommended_share: number | string | null;
    last_searched_at: string | Date;
  }>(
    `select
       s.origin_stop_id,
       o.name as origin_stop_name,
       s.destination_stop_id,
       d.name as destination_stop_name,
       count(*)::int as searches,
       round(100.0 * count(*) filter (where s.avoid_crowding) / greatest(count(*), 1), 1) as avoid_share,
       round(
         100.0 * count(*) filter (where s.chosen_option_id like '%quietest')
         / greatest(count(*) filter (where s.chosen_option_id is not null), 1),
         1
       ) as recommended_share,
       max(s.created_at) as last_searched_at
     from route_searches s
     join stops o on o.id = s.origin_stop_id
     join stops d on d.id = s.destination_stop_id
     where s.created_at > now() - make_interval(days => $1::integer)
     group by s.origin_stop_id, o.name, s.destination_stop_id, d.name
     order by searches desc, last_searched_at desc
     limit $2`,
    [options.windowDays ?? 14, options.limit ?? 8],
  );

  return rows.map((row) => ({
    id: `${row.origin_stop_id}-${row.destination_stop_id}`,
    originStopName: row.origin_stop_name,
    destinationStopName: row.destination_stop_name,
    searches: Number(row.searches),
    avoidCrowdingPct: Number(row.avoid_share ?? 0),
    recommendedShare: Number(row.recommended_share ?? 0),
    lastSearchedAt: new Date(row.last_searched_at).toISOString(),
  }));
}

export async function searchVolumeStats(
  db: Queryable,
  hours = 24,
): Promise<{
  searches: number;
  previousSearches: number;
  crowdingAvoidedPct: number;
  previousCrowdingAvoidedPct: number;
}> {
  const row = await db.one<{
    current_count: number;
    previous_count: number;
    avoided: number | string | null;
    previous_avoided: number | string | null;
  }>(
    `select
       count(*) filter (where s.created_at > now() - make_interval(hours => $1::integer))::int
         as current_count,
       count(*) filter (
         where s.created_at <= now() - make_interval(hours => $1::integer)
           and s.created_at > now() - make_interval(hours => ($1 * 2)::integer)
       )::int as previous_count,
       round(avg(o.crowding_avoided_pct) filter (
         where s.created_at > now() - make_interval(hours => $1::integer)
       ), 2) as avoided,
       round(avg(o.crowding_avoided_pct) filter (
         where s.created_at <= now() - make_interval(hours => $1::integer)
       ), 2) as previous_avoided
     from route_searches s
     left join route_search_options o on o.search_id = s.id and o.kind = 'quietest'
     where s.created_at > now() - make_interval(hours => ($1 * 2)::integer)`,
    [hours],
  );

  return {
    searches: Number(row?.current_count ?? 0),
    previousSearches: Number(row?.previous_count ?? 0),
    crowdingAvoidedPct: Number(row?.avoided ?? 0),
    previousCrowdingAvoidedPct: Number(row?.previous_avoided ?? 0),
  };
}

export async function listRecentSearches(
  db: Queryable,
  profileId: string,
  limit = 6,
): Promise<
  {
    id: string;
    originStopId: string;
    originStopName: string;
    destinationStopId: string;
    destinationStopName: string;
    departAfter: string;
    avoidCrowding: boolean;
    optionsReturned: number;
    createdAt: string;
  }[]
> {
  const rows = await db.query<{
    id: string;
    origin_stop_id: string;
    origin_stop_name: string;
    destination_stop_id: string;
    destination_stop_name: string;
    depart_after: string | Date;
    avoid_crowding: boolean;
    options_returned: number;
    created_at: string | Date;
  }>(
    `select s.id::text as id, s.origin_stop_id, o.name as origin_stop_name,
            s.destination_stop_id, d.name as destination_stop_name,
            s.depart_after, s.avoid_crowding, s.options_returned, s.created_at
     from route_searches s
     join stops o on o.id = s.origin_stop_id
     join stops d on d.id = s.destination_stop_id
     where s.profile_id = $1
     order by s.created_at desc
     limit $2`,
    [profileId, limit],
  );

  return rows.map((row) => ({
    id: String(row.id),
    originStopId: row.origin_stop_id,
    originStopName: row.origin_stop_name,
    destinationStopId: row.destination_stop_id,
    destinationStopName: row.destination_stop_name,
    departAfter: new Date(row.depart_after).toISOString(),
    avoidCrowding: row.avoid_crowding,
    optionsReturned: Number(row.options_returned),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
