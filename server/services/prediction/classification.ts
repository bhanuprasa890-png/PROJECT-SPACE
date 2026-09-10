import { CROWD_LEVEL_META, CROWD_THRESHOLDS, crowdLevelFromRatio } from '../../../shared/crowd';
import type { CrowdClass, CrowdLevel } from '../../../shared/types';

/**
 * Stage 4 — Crowd Classification
 * ==============================
 *
 * The prediction engine predicts a *number*; this stage turns that number into
 * the band riders actually think in. Thresholds live in `shared/crowd.ts` (the
 * same constants Postgres uses through `fn_crowd_level`), so a prediction, a
 * stored forecast and a SQL query always agree.
 *
 *   < 60%  → Low        48% → Low
 *   60–85% → Moderate   72% → Moderate
 *   > 85%  → High       91% → High
 */

export interface CrowdClassification {
  level: CrowdLevel;
  label: string;
  description: string;
  /** Inclusive lower bound in percent. */
  fromPercentage: number;
  /** Exclusive upper bound in percent (`null` = open ended). */
  toPercentage: number | null;
  glyph: string;
}

/** The classification table, in the order it is presented to judges. */
export const CROWD_CLASSES: CrowdClassification[] = [
  {
    level: 'low',
    label: CROWD_LEVEL_META.low.label,
    description: CROWD_LEVEL_META.low.description,
    fromPercentage: 0,
    toPercentage: CROWD_THRESHOLDS.moderate * 100,
    glyph: '●',
  },
  {
    level: 'moderate',
    label: CROWD_LEVEL_META.moderate.label,
    description: CROWD_LEVEL_META.moderate.description,
    fromPercentage: CROWD_THRESHOLDS.moderate * 100,
    toPercentage: CROWD_THRESHOLDS.high * 100,
    glyph: '◐',
  },
  {
    level: 'high',
    label: CROWD_LEVEL_META.high.label,
    description: CROWD_LEVEL_META.high.description,
    fromPercentage: CROWD_THRESHOLDS.high * 100,
    toPercentage: null,
    glyph: '▲',
  },
];

/** Ready-made examples used in the UI and in `npm run db:verify`. */
export const CLASSIFICATION_EXAMPLES: { percentage: number; level: CrowdLevel }[] = [
  { percentage: 48, level: 'low' },
  { percentage: 72, level: 'moderate' },
  { percentage: 91, level: 'high' },
];

export function classifyOccupancyPercentage(percentage: number): CrowdClassification {
  const level = crowdLevelFromRatio(percentage / 100);
  const match = CROWD_CLASSES.find((entry) => entry.level === level);
  // `CROWD_CLASSES` covers every level; the fallback keeps the type total.
  return match ?? CROWD_CLASSES[0];
}

export function classifyOccupancyRatio(ratio: number): CrowdClassification {
  return classifyOccupancyPercentage(ratio * 100);
}

/** Compact form for API consumers and stored rows. */
export function toCrowdClass(percentage: number): CrowdClass {
  const classification = classifyOccupancyPercentage(percentage);
  return {
    level: classification.level,
    label: classification.label,
    description: classification.description,
    range: `${classification.fromPercentage}–${classification.toPercentage ?? '∞'}%`,
  };
}
