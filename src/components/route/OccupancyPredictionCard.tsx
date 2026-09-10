import { Armchair, AlertTriangle, TrendingDown, TrendingUp, Minus, Gauge, Brain } from 'lucide-react';
import type { RouteOption } from '@shared/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
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

  return (
    <Card
      accent={option.crowdRiskLevel === 'high' ? 'critical' : 'sky'}
      className={cn('', className)}
    >
      <CardHeader
        title="Occupancy prediction"
        subtitle={`Worst stretch of this itinerary · average load ${formatPercent(option.avgCrowdRatio)}`}
        icon={<Gauge className="size-4" />}
        actions={<CrowdBadge level={option.crowdRiskLevel} label={`Peak ${formatPercent(option.crowdRisk)}`} />}
      />

      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[0.68rem] tracking-wider text-mist-400 uppercase">
              Predicted occupancy
            </p>
            <p
              className={cn(
                'font-display text-4xl leading-none font-semibold',
                option.crowdRiskLevel === 'high'
                  ? 'text-crowd-critical'
                  : option.crowdRiskLevel === 'moderate'
                    ? 'text-crowd-moderate'
                    : 'text-crowd-low',
              )}
            >
              {Math.round(option.crowdRisk * 100)}
              <span className="ml-1 text-lg font-normal text-mist-400">%</span>
            </p>
            <p className="mt-1 text-[0.7rem] text-mist-400">
              Peak on {trend.peakStopName} · {formatPercent(option.crowdRisk)} of capacity
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.72rem] font-medium',
                comfort.border,
                comfort.bg,
                comfort.text,
              )}
              title={comfort.description}
            >
              {option.comfort === 'comfortable' ? (
                <Armchair className="size-3.5" />
              ) : option.comfort === 'standing' ? (
                <TrendingUp className="size-3.5" />
              ) : (
                <AlertTriangle className="size-3.5" />
              )}
              {comfort.label} · {comfort.description}
            </span>

            <span className="inline-flex items-center gap-2 text-[0.72rem]">
              <Brain className={cn('size-3.5', confidence.text)} />
              <span className="text-mist-400">AI confidence</span>
              <span className={cn('font-mono font-medium', confidence.text)}>
                {option.confidencePct}%
              </span>
            </span>
          </div>
        </div>

        <CrowdMeter ratio={option.crowdRisk} level={option.crowdRiskLevel} />

        {/* crowd trend + score summary, both generated from database values */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
            <p className="text-[0.65rem] tracking-wider text-mist-500 uppercase">Crowd trend</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-mist-100">
              <TrendIcon direction={trend.direction} />
              {trend.label}
            </p>
            <p className="mt-1 font-mono text-[0.65rem] text-mist-500">
              boards {formatPercent(trend.boardRatio)} → peaks {formatPercent(option.crowdRisk)}
            </p>
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
            <p className="text-[0.65rem] tracking-wider text-mist-500 uppercase">Route score</p>
            <p className="mt-1 font-mono text-xs text-mist-100">
              {option.scoreBreakdown.travelMinutes} + {option.scoreBreakdown.waitingMinutes} +{' '}
              {option.scoreBreakdown.crowdPenaltyMinutes} ={' '}
              <span className="font-semibold">{formatScore(option.scoreBreakdown.totalScore)}</span>
            </p>
            <p className="mt-1 text-[0.62rem] text-mist-500">{SCORE_FORMULA}</p>
          </div>
        </div>

        {trend.direction === 'rising' && option.crowdRiskLevel !== 'low' ? (
          <p className="flex items-start gap-2 rounded-xl border border-crowd-moderate/30 bg-crowd-moderate/8 px-3.5 py-2.5 text-[0.72rem] leading-relaxed text-crowd-moderate">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Load builds after you board — boarding earlier in the journey gives you a better chance of
            a seat.
          </p>
        ) : null}
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
