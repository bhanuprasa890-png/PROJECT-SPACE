import type { ComfortLevel, CrowdLevel } from './types';

/**
 * Crowd-level thresholds shared by the API (prediction, scoring, alerts) and the
 * UI (badges, meters, charts) so a colour always means the same thing.
 *
 * Ratios are occupancy / capacity, where 1.0 means "all seats and standing room
 * taken". The commuter-facing bands are deliberately simple:
 *
 *   below 60%   → Low       (green)   seats available
 *   60% – 85%   → Moderate  (yellow)  filling up, standing room
 *   above 85%   → High      (red)     packed, consider another option
 */
export const CROWD_THRESHOLDS = {
  /** Above this ratio the service counts as Moderate. */
  moderate: 0.6,
  /** Above this ratio the service counts as High. */
  high: 0.85,
} as const;

export const CROWD_LEVELS: CrowdLevel[] = ['low', 'moderate', 'high'];

export function crowdLevelFromRatio(ratio: number): CrowdLevel {
  if (!Number.isFinite(ratio)) return 'low';
  if (ratio > CROWD_THRESHOLDS.high) return 'high';
  if (ratio > CROWD_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

export const CROWD_LEVEL_META: Record<
  CrowdLevel,
  { label: string; short: string; range: string; description: string; token: string }
> = {
  low: {
    label: 'Low',
    short: 'Low',
    range: 'under 60%',
    description: 'Seats available and plenty of personal space.',
    token: 'emerald',
  },
  moderate: {
    label: 'Moderate',
    short: 'Moderate',
    range: '60–85%',
    description: 'Filling up — most seats taken, standing room left.',
    token: 'amber',
  },
  high: {
    label: 'High',
    short: 'High',
    range: 'above 85%',
    description: 'Packed: standing only, crush conditions on busy sections.',
    token: 'rose',
  },
};

/** Comfort indicator shown on route cards — the rider-facing read of the same ratio. */
export const COMFORT_META: Record<
  ComfortLevel,
  { label: string; description: string; icon: 'seat' | 'standing' | 'alert' }
> = {
  comfortable: {
    label: 'Comfortable',
    description: 'Likely to get a seat',
    icon: 'seat',
  },
  standing: {
    label: 'Standing room',
    description: 'No seat, but space to stand',
    icon: 'standing',
  },
  packed: {
    label: 'Packed',
    description: 'Crush load expected — expect to be squeezed',
    icon: 'alert',
  },
};

export function comfortFromRatio(ratio: number): ComfortLevel {
  if (!Number.isFinite(ratio)) return 'comfortable';
  if (ratio > CROWD_THRESHOLDS.high) return 'packed';
  if (ratio > CROWD_THRESHOLDS.moderate) return 'standing';
  return 'comfortable';
}

/** Formats an occupancy ratio for display, e.g. `0.83` -> `83%`. */
export function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Base crowd penalty curve, expressed in **minute-equivalents** so it can be
 * added to travel and waiting time:
 *
 *   Route score = travel time + waiting time + crowd penalty
 *
 * Low loads are almost free, the penalty grows steadily through the Moderate
 * band and rises steeply past 85%, where a crush load costs more than a
 * detour. The planner multiplies this by the rider's crowd sensitivity.
 */
export function crowdPenaltyMinutes(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio <= CROWD_THRESHOLDS.moderate) return ratio * 8;
  if (ratio <= CROWD_THRESHOLDS.high) {
    return 4.8 + (ratio - CROWD_THRESHOLDS.moderate) * 40;
  }
  return 14.8 + Math.pow(ratio - CROWD_THRESHOLDS.high, 1.35) * 120;
}
