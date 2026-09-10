import type { CrowdLevel } from './types';

/**
 * Crowd-level thresholds shared by the API (prediction + scoring) and the UI
 * (badges, meters, charts) so a colour always means the same thing.
 *
 * Ratios are occupancy / capacity, where 1.0 means "all seats and standing
 * room taken".
 */
export const CROWD_THRESHOLDS = {
  moderate: 0.55,
  high: 0.8,
  critical: 1.0,
} as const;

export const CROWD_LEVELS: CrowdLevel[] = ['low', 'moderate', 'high', 'critical'];

export function crowdLevelFromRatio(ratio: number): CrowdLevel {
  if (!Number.isFinite(ratio)) return 'low';
  if (ratio >= CROWD_THRESHOLDS.critical) return 'critical';
  if (ratio >= CROWD_THRESHOLDS.high) return 'high';
  if (ratio >= CROWD_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

export const CROWD_LEVEL_META: Record<
  CrowdLevel,
  { label: string; short: string; description: string; token: string }
> = {
  low: {
    label: 'Comfortable',
    short: 'Low',
    description: 'Seats available, plenty of personal space.',
    token: 'emerald',
  },
  moderate: {
    label: 'Moderate',
    short: 'Moderate',
    description: 'Filling up — most seats taken.',
    token: 'amber',
  },
  high: {
    label: 'Busy',
    short: 'Busy',
    description: 'Standing room only, tight on busy sections.',
    token: 'orange',
  },
  critical: {
    label: 'Crushed',
    short: 'Crushed',
    description: 'At or above crush capacity. Consider waiting.',
    token: 'rose',
  },
};

/** Formats an occupancy ratio for display, e.g. `0.83` -> `83%`. */
export function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Maps an occupancy ratio onto the 0..100 score used by the planner. */
export function crowdPenalty(ratio: number): number {
  // Penalty grows super-linearly past ~55% occupancy so "busy but fine" is
  // cheap while "crush loaded" is heavily punished.
  if (ratio <= CROWD_THRESHOLDS.moderate) return ratio * 30;
  if (ratio <= CROWD_THRESHOLDS.high) return 16.5 + (ratio - 0.55) * 90;
  return 39 + Math.pow(ratio - CROWD_THRESHOLDS.high, 1.35) * 320;
}
