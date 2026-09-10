import type { RouteOption } from '@shared/types';

export type ScoreKey = keyof RouteOption['scoreBreakdown'];

/** Human labels for the planner's objective terms. */
export const PLANNER_WEIGHT_LABELS: Record<ScoreKey, string> = {
  time: 'Journey time',
  crowd: 'Predicted crowding',
  transfer: 'Changes',
  walk: 'Walking & waiting',
};

export const SCORE_ORDER: ScoreKey[] = ['time', 'crowd', 'transfer', 'walk'];
