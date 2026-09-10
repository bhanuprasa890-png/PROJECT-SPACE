import type { OccupancyPredictor, PredictionCore, PredictionInput } from '../types';
import { heuristicPredictor } from './heuristic-ensemble';

/**
 * External machine-learning predictor (adapter)
 * =============================================
 *
 * This is the "real model can replace the heuristic later" seam. When
 * `PREDICTION_MODEL_URL` is configured, the engine sends the same
 * `PredictionInput` to that service and expects:
 *
 *   POST { url }
 *   → { "ratio": 0.91, "confidence": 0.88,
 *       "lowerRatio": 0.79, "upperRatio": 1.02,
 *       "factors": [{ "key": "gradient_boost", "label": "…",
 *                     "contribution": 0.07, "detail": "…" }] }
 *
 * Anything missing (interval, baseline, factors) is filled in from the
 * heuristic so the API contract stays stable. If the call fails or times out,
 * the engine silently falls back to the heuristic and records that in the
 * engine descriptor — a demo must never break because a model endpoint is
 * offline.
 *
 * No model is bundled and no production accuracy is claimed. This adapter
 * exists so the swap is a configuration change, not a rewrite.
 */

export interface ExternalModelOptions {
  url: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Predictor used for fallback and for filling gaps in the response. */
  fallback?: OccupancyPredictor;
}

interface ExternalResponse {
  ratio?: number;
  confidence?: number;
  lowerRatio?: number;
  upperRatio?: number;
  baselineRatio?: number;
  factors?: { key?: string; label?: string; contribution?: number; detail?: string }[];
  note?: string;
}

export class ExternalModelPredictor implements OccupancyPredictor {
  readonly id = 'external-model';
  readonly kind = 'external-model' as const;
  readonly version: string;
  readonly note: string;

  private readonly fallback: OccupancyPredictor;
  private readonly timeoutMs: number;
  /** Set when the last call failed, so the engine can report degraded mode. */
  lastError: string | null = null;

  constructor(private readonly options: ExternalModelOptions) {
    this.fallback = options.fallback ?? heuristicPredictor;
    this.timeoutMs = options.timeoutMs ?? 1200;
    this.version = 'external-model-adapter-v1';
    this.note = `Forwards predictions to ${options.url}; falls back to the heuristic ensemble when unavailable.`;
  }

  async predict(input: PredictionInput): Promise<PredictionCore> {
    const heuristic = await this.fallback.predict(input);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let payload: ExternalResponse;
      try {
        const response = await fetch(this.options.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
          },
          body: JSON.stringify({ input }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`model responded ${response.status}`);
        payload = (await response.json()) as ExternalResponse;
      } finally {
        clearTimeout(timer);
      }

      const ratio = Number.isFinite(payload.ratio) ? (payload.ratio as number) : heuristic.ratio;
      const factors = (payload.factors ?? [])
        .filter((factor) => Number.isFinite(factor.contribution))
        .map((factor, index) => ({
          key: factor.key ?? `external_${index}`,
          label: factor.label ?? 'Model contribution',
          contribution: Number(factor.contribution),
          detail: factor.detail ?? 'Reported by the external model',
        }));

      this.lastError = null;
      return {
        ratio,
        lowerRatio: Number.isFinite(payload.lowerRatio)
          ? (payload.lowerRatio as number)
          : heuristic.lowerRatio,
        upperRatio: Number.isFinite(payload.upperRatio)
          ? (payload.upperRatio as number)
          : heuristic.upperRatio,
        confidence: Number.isFinite(payload.confidence)
          ? (payload.confidence as number)
          : heuristic.confidence,
        baselineRatio: Number.isFinite(payload.baselineRatio)
          ? (payload.baselineRatio as number)
          : heuristic.baselineRatio,
        factors: factors.length ? factors : heuristic.factors,
        note: payload.note ?? 'Predicted by the configured external model.',
      };
    } catch (error) {
      this.lastError = (error as Error).message;
      return {
        ...heuristic,
        note: `External model unavailable (${this.lastError}) — heuristic ensemble used instead.`,
      };
    }
  }
}
