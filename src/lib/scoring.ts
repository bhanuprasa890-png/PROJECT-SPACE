import { COMFORT_META, CROWD_LEVEL_META } from '@shared/crowd';
import type { ComfortLevel, RouteOption } from '@shared/types';

/**
 * Presentation helpers for the commuter-facing route score.
 *
 * The planner computes the score from database values (timetable + crowd model
 * output) as:
 *
 *     route score = travel time + waiting time + crowd penalty
 *
 * Everything here only *labels* those server-provided numbers — no score is ever
 * calculated or invented in the UI.
 */

export type ScoreKey = 'travelMinutes' | 'waitingMinutes' | 'crowdPenaltyMinutes';

export interface ScoreTerm {
  key: ScoreKey;
  label: string;
  hint: string;
  /** Bar colour, matching the crowd language used elsewhere. */
  bar: string;
}

export const SCORE_TERMS: ScoreTerm[] = [
  {
    key: 'travelMinutes',
    label: 'Travel time',
    hint: 'Time moving between stops, including any walking',
    bar: 'bg-sky-400/80',
  },
  {
    key: 'waitingMinutes',
    label: 'Waiting time',
    hint: 'Platform and interchange waiting before you board',
    bar: 'bg-violet-400/80',
  },
  {
    key: 'crowdPenaltyMinutes',
    label: 'Crowd penalty',
    hint: 'How much the predicted crowding costs you, in minutes',
    bar: 'bg-crowd-high',
  },
];

export const SCORE_FORMULA = 'Travel time + Waiting time + Crowd penalty';

/** `41.6` → `41.6 min` (web-safe text). */
export function formatScore(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} min`;
}

/** Each term's contribution as a share of the total score, for the stacked bar. */
export function scoreShares(option: RouteOption): { term: ScoreTerm; value: number; pct: number }[] {
  const total = Math.max(option.scoreBreakdown.totalScore, 1);
  return SCORE_TERMS.map((term) => {
    const value = option.scoreBreakdown[term.key];
    return { term, value, pct: Math.max(2, Math.round((value / total) * 100)) };
  });
}

export interface ComfortTone {
  label: string;
  description: string;
  text: string;
  bg: string;
  border: string;
  dot: string;
}

const COMFORT_TONES: Record<ComfortLevel, ComfortTone> = {
  comfortable: {
    label: COMFORT_META.comfortable.label,
    description: COMFORT_META.comfortable.description,
    text: 'text-crowd-low',
    bg: 'bg-crowd-low/10',
    border: 'border-crowd-low/35',
    dot: 'bg-crowd-low',
  },
  standing: {
    label: COMFORT_META.standing.label,
    description: COMFORT_META.standing.description,
    text: 'text-crowd-moderate',
    bg: 'bg-crowd-moderate/10',
    border: 'border-crowd-moderate/35',
    dot: 'bg-crowd-moderate',
  },
  packed: {
    label: COMFORT_META.packed.label,
    description: COMFORT_META.packed.description,
    text: 'text-crowd-critical',
    bg: 'bg-crowd-critical/10',
    border: 'border-crowd-critical/40',
    dot: 'bg-crowd-critical',
  },
};

export function comfortTone(comfort: ComfortLevel): ComfortTone {
  return COMFORT_TONES[comfort];
}

/** Confidence bands for the "AI confidence" read-out. */
export function confidenceTone(pct: number): { text: string; label: string } {
  if (pct >= 85) return { text: 'text-crowd-low', label: 'high confidence' };
  if (pct >= 70) return { text: 'text-crowd-moderate', label: 'fair confidence' };
  return { text: 'text-mist-400', label: 'wide uncertainty' };
}

/** Human label for a crowd level, e.g. `high` → `High (above 85%)`. */
export function crowdLevelLabel(level: keyof typeof CROWD_LEVEL_META): string {
  const meta = CROWD_LEVEL_META[level];
  return `${meta.label} (${meta.range})`;
}
