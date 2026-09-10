import { clamp, round } from '../../../lib/time';
import type { OccupancyPredictor, PredictionCore, PredictionInput, FactorContribution } from '../types';

/**
 * Heuristic ensemble predictor (the shipped model)
 * ================================================
 *
 * A transparent weighted ensemble of the six inputs the platform has:
 *
 *   1. historical occupancy — the 14-day mean for this line/stop/day-type/hour
 *   2. peak history         — the 90th percentile for the same cell
 *   3. time of day          — interpolation across the hour boundary
 *   4. day type             — weekday / saturday / sunday (historical cell)
 *   5. current occupancy    — recency-weighted pull toward the live reading
 *   6. route pressure       — frequency (headway) and active crowding notices
 *   7. weather              — optional multiplier (rain / storm / heatwave)
 *
 * It is a *heuristic*, not a trained model: the weights below are modelling
 * assumptions chosen for explainability, and they are calibrated against the
 * simulated dataset only. Replacing it with a real ML model means implementing
 * `OccupancyPredictor` (see `external-model.ts`) — this file then becomes the
 * fallback.
 */

const WEIGHTS = {
  /** Historical mean vs. peak: how much the busy tail of history counts. */
  historicalMean: 0.68,
  historicalPeak: 0.32,
  /** Reference headway: shorter headways pack more riders per service. */
  referenceHeadwayMinutes: 8,
  headwayCeiling: 0.12,
  /** How far a live reading can pull the prediction, and its half-life. */
  livePull: 0.5,
  liveHalfLifeMinutes: 75,
  /** Carry-over from riders already aboard further up the line. */
  upstreamCarryOver: 0.14,
} as const;

export class HeuristicEnsemblePredictor implements OccupancyPredictor {
  readonly id = 'heuristic-ensemble';
  readonly kind = 'heuristic-ensemble' as const;
  readonly version: string;
  readonly note =
    'Transparent weighted ensemble over historical, live, calendar, route and weather inputs (simulated data).';

  constructor(version = 'transitpulse-heuristic-v1') {
    this.version = version;
  }

  async predict(input: PredictionInput): Promise<PredictionCore> {
    const factors: FactorContribution[] = [];

    /* ---- 1 + 2 + 3: historical occupancy, peak history, time of day ------ */
    const { historical } = input;
    const mean =
      historical.avgRatio + (historical.nextAvgRatio - historical.avgRatio) * input.fractionOfHour;
    const peak =
      historical.p90Ratio + (historical.nextP90Ratio - historical.p90Ratio) * input.fractionOfHour;

    const baseline = mean * WEIGHTS.historicalMean + peak * WEIGHTS.historicalPeak;

    factors.push({
      key: 'historical',
      label: 'Historical occupancy',
      contribution: round(baseline, 4),
      detail:
        historical.scope === 'stop'
          ? `${Math.round(mean * 100)}% average for this stop, hour and day type — ${historical.sampleSize} simulated samples`
          : historical.scope === 'line'
            ? `Line-wide average for this hour (no stop-level history) — ${historical.sampleSize} simulated samples`
            : 'No history for this cell yet — built-in demand curve used',
    });
    factors.push({
      key: 'peak',
      label: 'Busy-hour tail (90th percentile)',
      contribution: round((peak - mean) * WEIGHTS.historicalPeak, 4),
      detail: `Busiest ${Math.round(peak * 100)}% of similar services, weighted at ${WEIGHTS.historicalPeak}`,
    });

    /* ---- 6a: route pressure from service frequency ----------------------- */
    const headwayFactor = clamp(
      WEIGHTS.referenceHeadwayMinutes / Math.max(input.route.headwayMinutes, 1),
      0.88,
      1 + WEIGHTS.headwayCeiling,
    );
    const headwayContribution = baseline * (headwayFactor - 1);
    factors.push({
      key: 'headway',
      label: 'Service frequency',
      contribution: round(headwayContribution, 4),
      detail:
        headwayFactor > 1
          ? `${input.route.headwayMinutes} min headway concentrates demand on fewer services`
          : `${input.route.headwayMinutes} min headway spreads demand across services`,
    });

    /* ---- 7: optional weather factor -------------------------------------- */
    let weatherContribution = 0;
    if (input.weather && input.weather.factor !== 1) {
      weatherContribution = baseline * (input.weather.factor - 1);
      factors.push({
        key: 'weather',
        label: `Weather · ${input.weather.label}`,
        contribution: round(weatherContribution, 4),
        detail: `Simulated multiplier ×${input.weather.factor.toFixed(2)} applied to demand`,
      });
    }

    /* ---- 5: current occupancy (live reading) ----------------------------- */
    let liveContribution = 0;
    if (input.live) {
      const recency = clamp(1 - input.live.ageMinutes / (WEIGHTS.liveHalfLifeMinutes * 2), 0, 1);
      const pull = WEIGHTS.livePull * recency * recency;
      liveContribution = (input.live.ratio - baseline) * pull;
      factors.push({
        key: 'live',
        label: 'Current occupancy',
        contribution: round(liveContribution, 4),
        detail: `Measured ${Math.round(input.live.ratio * 100)}% on board ${Math.round(
          input.live.ageMinutes,
        )} min ago (${input.live.source}) — pulls the forecast ${
          liveContribution >= 0 ? 'up' : 'down'
        }`,
      });
    }

    /* ---- 6b: operational pressure ---------------------------------------- */
    if (input.alertPressure > 0) {
      factors.push({
        key: 'alerts',
        label: 'Active crowding notice',
        contribution: round(input.alertPressure, 4),
        detail: 'An operator notice on this line raises expected demand',
      });
    }
    if (input.upstreamRatio > 0) {
      factors.push({
        key: 'upstream',
        label: 'Upstream carry-over',
        contribution: round(input.upstreamRatio * WEIGHTS.upstreamCarryOver, 4),
        detail: `Vehicle already ${Math.round(input.upstreamRatio * 100)}% full when it reaches this stop`,
      });
    }

    const ratio = clamp(
      baseline +
        headwayContribution +
        weatherContribution +
        liveContribution +
        input.alertPressure +
        input.upstreamRatio * WEIGHTS.upstreamCarryOver,
      0.04,
      1.4,
    );

    /* ---- confidence ------------------------------------------------------ */
    const horizonMinutes = Math.max(
      0,
      (new Date(input.targetAt).getTime() - Date.now()) / 60000,
    );
    const sampleConfidence =
      historical.scope === 'stop'
        ? clamp(0.74 + historical.sampleSize / 45, 0.74, 1)
        : historical.scope === 'line'
          ? 0.72
          : 0.64;
    // Confidence decays with the forecast horizon; bad weather adds uncertainty.
    const weatherPenalty = input.weather && input.weather.severity > 0 ? 0.03 : 0;
    const confidence = clamp(
      (0.97 - horizonMinutes * 0.0018) * sampleConfidence - weatherPenalty,
      0.4,
      0.97,
    );

    const spread = 0.16 + horizonMinutes / 1400;

    return {
      ratio: round(ratio, 3),
      lowerRatio: round(clamp(ratio * (1 - spread), 0, 1.5), 3),
      upperRatio: round(clamp(ratio * (1 + spread * 1.15), 0, 1.6), 3),
      confidence: round(confidence, 3),
      baselineRatio: round(baseline, 3),
      factors,
      note: this.note,
    };
  }
}

export const heuristicPredictor = new HeuristicEnsemblePredictor();
