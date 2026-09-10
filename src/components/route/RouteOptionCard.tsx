import { useState } from 'react';
import {
  AlertTriangle,
  Armchair,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  MapPin,
  Users,
} from 'lucide-react';
import type { RouteOption } from '@shared/types';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CrowdBadge, CrowdMeter } from '../crowd/CrowdIndicators';
import { ScoreBreakdown } from './ScoreBreakdown';
import { confidenceTone, comfortTone, formatScore } from '../../lib/scoring';
import { cn, formatClock, formatPercent } from '../../lib/utils';

/**
 * One route option, built for a 60-second demo:
 *
 *   route number + name → the four numbers that decide the trip
 *   (travel, waiting, predicted occupancy, AI confidence) → comfort indicator
 *   → "Why this route?" arithmetic → boarding plan.
 *
 * Every value is read from the planner/API, which reads Postgres: route identity
 * from the canonical `routes` table, timings from the timetable, occupancy and
 * confidence from the crowd model.
 */
export function RouteOptionCard({
  option,
  isRecommended,
  onOpen,
  className,
  style,
  defaultOpen = false,
}: {
  option: RouteOption;
  isRecommended: boolean;
  onOpen: () => void;
  className?: string;
  style?: React.CSSProperties;
  defaultOpen?: boolean;
}) {
  const [showWhy, setShowWhy] = useState(defaultOpen);
  const comfort = comfortTone(option.comfort);
  const confidence = confidenceTone(option.confidencePct);

  return (
    <Card
      interactive={false}
      accent={isRecommended ? 'pulse' : 'none'}
      className={cn(
        'animate-rise relative p-4 transition-colors',
        isRecommended
          ? 'border-pulse-400/45 shadow-[0_24px_70px_-40px_rgba(56,245,192,0.75)] ring-1 ring-pulse-400/30'
          : 'border-white/10',
        className,
      )}
      style={style}
    >
      {isRecommended && (
        <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pulse-300/80 to-transparent" />
      )}

      {/* ------------------------------------------------ route identity + rank */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-mono text-sm font-semibold',
                isRecommended
                  ? 'border-pulse-400/50 bg-pulse-400/15 text-pulse-100'
                  : 'border-white/12 bg-white/6 text-mist-100',
              )}
            >
              {option.lineCodes.map((code, index) => (
                <span key={`${code}-${index}`} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight className="size-3 text-mist-500" />}
                  {code || '—'}
                </span>
              ))}
            </span>
            <Badge
              tone={
                option.kind === 'best'
                  ? 'pulse'
                  : option.kind === 'quietest'
                    ? 'low'
                    : option.kind === 'fastest'
                      ? 'info'
                      : 'neutral'
              }
              icon={option.kind === 'best' ? <Bot className="size-3" /> : undefined}
            >
              {option.badgeLabel}
            </Badge>
          </div>

          <p className="truncate text-sm font-medium text-mist-100" title={option.routeName}>
            {option.routeName}
          </p>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.7rem] text-mist-400">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {formatClock(option.departAt)} → {formatClock(option.arriveAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" />
              {option.transfers === 0 ? 'Direct' : `${option.transfers} change${option.transfers > 1 ? 's' : ''}`}
            </span>
            {option.crowdingAvoidedPct > 5 && (
              <span className="text-crowd-low">
                {Math.round(option.crowdingAvoidedPct)}% less crowded than the busiest option
              </span>
            )}
          </p>
        </div>

        {/* route score */}
        <div className="text-right">
          <p className="font-display text-3xl leading-none font-semibold text-mist-50">
            {option.totalMinutes}
            <span className="ml-1 text-xs font-normal text-mist-400">min</span>
          </p>
          <p className="mt-1 font-mono text-[0.65rem] text-mist-500">
            score {formatScore(option.scoreBreakdown.totalScore)}
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------- the 4 numbers */}
      <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          label="Travel time"
          value={`${option.scoreBreakdown.travelMinutes} min`}
          hint="Door-to-door time between stops"
        />
        <Metric
          label="Waiting time"
          value={`${option.waitMinutes} min`}
          hint="Time waiting to board, including changes"
        />
        <Metric
          label="Predicted occupancy"
          value={formatPercent(option.crowdRisk)}
          hint={`Peak load on the busiest stretch · average ${formatPercent(option.avgCrowdRatio)}`}
          valueClass={cn(option.crowdRiskLevel === 'high' && 'text-crowd-critical')}
          badge={<CrowdBadge level={option.crowdRiskLevel} size="xs" />}
        />
        <Metric
          label="AI confidence"
          value={`${option.confidencePct}%`}
          hint={`Model certainty in the busiest prediction (${confidence.label})`}
          valueClass={confidence.text}
        />
      </div>

      {/* ------------------------------------------------- occupancy + comfort */}
      <div className="mt-3.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[0.7rem] font-medium',
              comfort.border,
              comfort.bg,
              comfort.text,
            )}
            title={comfort.description}
          >
            <ComfortIcon comfort={option.comfort} />
            {comfort.label}
          </span>
          <span className="font-mono text-[0.68rem] text-mist-500">
            peak {formatPercent(option.crowdRisk)} · avg {formatPercent(option.avgCrowdRatio)}
          </span>
        </div>
        <CrowdMeter ratio={option.crowdRisk} level={option.crowdRiskLevel} />
      </div>

      {/* ------------------------------------------------------- why this route */}
      <div className="mt-3.5 rounded-xl border border-white/8 bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setShowWhy((current) => !current)}
          aria-expanded={showWhy}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        >
          <span className="flex items-center gap-2 text-xs font-medium text-mist-200">
            <Bot className="size-3.5 text-pulse-300" />
            Why this route?
          </span>
          <span className="flex items-center gap-2 font-mono text-[0.68rem] text-mist-500">
            {option.scoreBreakdown.travelMinutes} + {option.scoreBreakdown.waitingMinutes} +{' '}
            {option.scoreBreakdown.crowdPenaltyMinutes} = {option.scoreBreakdown.totalScore}
            <ChevronDown className={cn('size-3.5 transition-transform', showWhy && 'rotate-180')} />
          </span>
        </button>
        {showWhy && (
          <div className="border-t border-white/8 px-3 py-3">
            <p className="mb-3 text-[0.72rem] leading-relaxed text-mist-300">{option.scoreExplanation}</p>
            <ScoreBreakdown option={option} />
          </div>
        )}
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <p className="text-[0.68rem] leading-relaxed text-mist-500">{option.headline}</p>
        <Button
          size="sm"
          variant={isRecommended ? 'primary' : 'outline'}
          iconRight={<ChevronRight className="size-3.5" />}
          onClick={onOpen}
          className="shrink-0"
        >
          Route details
        </Button>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
  valueClass,
  badge,
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-2.5 py-2" title={hint}>
      <p className="flex items-center justify-between gap-1 text-[0.6rem] tracking-wider text-mist-500 uppercase">
        {label}
        {badge}
      </p>
      <p className={cn('mt-1 font-mono text-sm text-mist-100', valueClass)}>{value}</p>
    </div>
  );
}

function ComfortIcon({ comfort }: { comfort: RouteOption['comfort'] }) {
  if (comfort === 'comfortable') return <Armchair className="size-3.5" />;
  if (comfort === 'standing') return <Users className="size-3.5" />;
  return <AlertTriangle className="size-3.5" />;
}
