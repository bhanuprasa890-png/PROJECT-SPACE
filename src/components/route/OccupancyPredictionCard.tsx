import { Armchair, AlertTriangle, TrendingDown, TrendingUp, Minus, Gauge, Brain, Sparkles } from 'lucide-react';
import type { RouteOption } from '@shared/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Metric } from '../ui/Section';
import { CrowdBadge, CrowdMeter } from '../crowd/CrowdIndicators';
import { confidenceTone, comfortTone, formatScore, SCORE_FORMULA } from '../../lib/scoring';
import { cn, formatPercent } from '../../lib/utils';

/**
 * The headline prediction for an itinerary: how full the worst stretch will be,
 * what that feels like, how sure the model is, and which way the load is moving.
 *
 * All four values come from the API (crowd model output stored in Postgres); the
 * card only presents them.
 */
export function OccupancyPredictionCard({
  option,
  className,
}: {
  option: RouteOption;
  className?: string;
}) {
  const comfort = comfortTone(option.comfort);
  const confidence = confidenceTone(option.confidencePct);
  const trend = crowdTrend(option);

  const peakTone =
    option.crowdRiskLevel === 'high'
      ? 'text-crowd-critical'
      : option.crowdRiskLevel === 'moderate'
        ? 'text-crowd-moderate'
        : 'text-crowd-low';

  return (
    <Card accent={option.crowdRiskLevel === 'high' ? 'critical' : 'sky'} className={className}>
      <CardHeader
        title="Occupancy prediction"
        subtitle={`Worst stretch of this itinerary · average load ${formatPercent(option.avgCrowdRatio)}`}
        icon={<Gauge className="size-4" />}
        actions={
          <CrowdBadge
            level={option.crowdRiskLevel}
            label={`Peak ${formatPercent(option.crowdRisk)}`}
          />
        }
      />

      <CardBody className="space-y-4">
        {/* headline figure — the number decides whether the rider boards */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="eyebrow text-mist-400">Predicted occupancy</p>
            <p className={cn('mt-1.5 flex items-baseline gap-1', peakTone)} data-figures>
              <span className="font-display text-[2.5rem] leading-none font-semibold">
                {Math.round(option.crowdRisk * 100)}
              </span>
              <span className="text-lg font-normal text-mist-400">%</span>
            </p>
            <p className="mt-1.5 text-2xs leading-relaxed text-mist-400">
              Peak on <span className="text-mist-200">{trend.peakStopName}</span> ·{' '}
              {formatPercent(option.crowdRisk)} of seated + standing capacity
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-2xs font-medium',
                comfort.border,
                comfort.bg,
                comfort.text,
              )}
              title={comfort.description}
            >
              {option.comfort === 'comfortable' ? (
                <Armchair className="size-3.5" aria-hidden />
              ) : option.comfort === 'standing' ? (
                <TrendingUp className="size-3.5" aria-hidden />
              ) : (
                <AlertTriangle className="size-3.5" aria-hidden />
              )}
              {comfort.label} · {comfort.description}
            </span>

            <span className="inline-flex items-center gap-2 text-2xs">
              <Brain className={cn('size-3.5', confidence.text)} aria-hidden />
              <span className="text-mist-400">AI confidence</span>
              <span className={cn('figure font-medium', confidence.text)}>
                {option.confidencePct}%
              </span>
            </span>
          </div>
        </div>

        <CrowdMeter ratio={option.crowdRisk} level={option.crowdRiskLevel} />

        {/* crowd trend + score summary, both generated from database values */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Metric
            label="Crowd trend"
            value={trend.label}
            tone={trend.direction === 'rising' ? 'high' : trend.direction === 'easing' ? 'low' : 'default'}
          >
            <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-mist-400">
              <TrendIcon direction={trend.direction} />
              <span className="figure">
                boards {formatPercent(trend.boardRatio)} → peaks {formatPercent(option.crowdRisk)}
              </span>
            </p>
          </Metric>

          <Metric
            label="Route score"
            value={formatScore(option.scoreBreakdown.totalScore)}
            hint={SCORE_FORMULA}
            tone="pulse"
          >
            <p className="figure mt-1.5 text-2xs text-mist-300">
              {option.scoreBreakdown.travelMinutes} + {option.scoreBreakdown.waitingMinutes} +{' '}
              {option.scoreBreakdown.crowdPenaltyMinutes}
            </p>
          </Metric>
        </div>

        {trend.direction === 'rising' && option.crowdRiskLevel !== 'low' ? (
          <p className="flex items-start gap-2 rounded-xl border border-crowd-moderate/25 bg-crowd-moderate/[0.07] px-3.5 py-2.5 text-2xs leading-relaxed text-crowd-moderate">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Load builds after you board — boarding earlier in the journey gives you a better chance of
            a seat.
          </p>
        ) : null}

        <p className="flex items-start gap-1.5 text-3xs leading-relaxed text-mist-500">
          <Sparkles className="mt-0.5 size-3 shrink-0 text-violet-300" aria-hidden />
          Simulated prediction from the TransitPulse crowd model — not a measurement of a live network.
        </p>
      </CardBody>
    </Card>
  );
}

type Trend = {
  direction: 'rising' | 'easing' | 'steady';
  label: string;
  boardRatio: number;
  peakStopName: string;
};

/** Derives the direction of load along the itinerary from per-leg predictions. */
export function crowdTrend(option: RouteOption): Trend {
  const legs = option.legs.filter((leg) => leg.kind === 'transit' && leg.crowd);
  const busiest = legs.reduce<typeof legs[number] | null>(
    (worst, leg) => (!worst || (leg.crowd?.peakRatio ?? 0) > (worst.crowd?.peakRatio ?? 0) ? leg : worst),
    null,
  );
  const boardRatio = legs[0]?.crowd?.ratio ?? option.crowdRisk;
  const peak = busiest?.crowd?.peakRatio ?? option.crowdRisk;
  const delta = peak - boardRatio;

  if (delta >= 0.08) {
    return {
      direction: 'rising',
      label: `Rising through the journey — busiest on ${busiest?.lineCode ?? 'this line'}`,
      boardRatio,
      peakStopName: busiest?.crowd?.peakStopName ?? 'the busiest stop',
    };
  }
  if (delta <= -0.08) {
    return {
      direction: 'easing',
      label: 'Easing after the first stops — emptier as you go',
      boardRatio,
      peakStopName: busiest?.crowd?.peakStopName ?? 'the busiest stop',
    };
  }
  return {
    direction: 'steady',
    label: 'Steady load across the journey',
    boardRatio,
    peakStopName: busiest?.crowd?.peakStopName ?? 'the busiest stop',
  };
}

function TrendIcon({ direction }: { direction: Trend['direction'] }) {
  if (direction === 'rising') return <TrendingUp className="size-3.5 text-crowd-high" />;
  if (direction === 'easing') return <TrendingDown className="size-3.5 text-crowd-low" />;
  return <Minus className="size-3.5 text-mist-400" />;
}

/** Small badge used in lists to show how a route compares on crowding. */
export function ComfortBadge({ option }: { option: RouteOption }) {
  const comfort = comfortTone(option.comfort);
  return (
    <Badge
      tone={
        option.comfort === 'comfortable' ? 'low' : option.comfort === 'standing' ? 'moderate' : 'critical'
      }
      size="xs"
    >
      {comfort.label}
    </Badge>
  );
}
