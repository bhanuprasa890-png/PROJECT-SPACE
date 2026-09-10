import { useId, useState } from 'react';
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
import { Card, CardFooter } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Metric } from '../ui/Section';
import { CrowdBadge, CrowdMeter } from '../crowd/CrowdIndicators';
import { ScoreBreakdown } from './ScoreBreakdown';
import { confidenceTone, comfortTone, formatScore } from '../../lib/scoring';
import { cn, formatClock, formatPercent } from '../../lib/utils';

/**
 * One route option, built for a 60-second demo.
 *
 * Hierarchy: which route it is → how long it takes → the four numbers that
 * decide the trip → crowding → why the AI scored it that way → details.
 *
 * Every value is read from the planner/API, which reads Postgres: route identity
 * from the canonical `routes` table, timings from the timetable, occupancy and
 * confidence from the crowd model.
 */

/** Confidence dot colours — literal classes so Tailwind can see them. */
const CONFIDENCE_DOT: Record<string, string> = {
  'high confidence': 'bg-crowd-low',
  'fair confidence': 'bg-crowd-moderate',
  'wide uncertainty': 'bg-mist-400',
};

const KIND_TONE = {
  best: 'pulse',
  quietest: 'low',
  fastest: 'info',
  fewest_changes: 'neutral',
} as const;

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
  const panelId = useId();
  const titleId = useId();

  const kindTone = KIND_TONE[option.kind as keyof typeof KIND_TONE] ?? 'neutral';

  return (
    <Card
      as="article"
      accent={isRecommended ? 'pulse' : 'none'}
      interactive
      className={cn(
        'animate-rise group flex flex-col',
        isRecommended
          ? 'border-pulse-400/40 shadow-lift ring-1 ring-pulse-400/25'
          : 'border-white/10',
        className,
      )}
      style={style}
    >
      {/* --------------------------------------------------- identity + timing */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4 pb-0 sm:p-5 sm:pb-0">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-ink-950/60 px-2 py-1 figure text-sm font-semibold text-mist-100">
              {option.lineCodes.map((code, index) => (
                <span key={`${code}-${index}`} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight className="size-3 text-mist-500" aria-hidden />}
                  {code || '—'}
                </span>
              ))}
            </span>
            <Badge
              tone={kindTone}
              size="xs"
              icon={isRecommended ? <Bot className="size-3" /> : undefined}
              dot={!isRecommended}
            >
              {option.badgeLabel}
            </Badge>
          </div>

          <h3 id={titleId} className="truncate text-md font-semibold text-mist-100" title={option.routeName}>
            {option.routeName}
          </h3>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-mist-400">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3" aria-hidden />
              <span className="figure">
                {formatClock(option.departAt)} → {formatClock(option.arriveAt)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3" aria-hidden />
              {option.transfers === 0 ? 'Direct' : `${option.transfers} change${option.transfers > 1 ? 's' : ''}`}
            </span>
            {option.walkMinutes > 0 ? (
              <span className="figure">{option.walkMinutes} min walk</span>
            ) : null}
            {option.crowdingAvoidedPct > 5 ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-crowd-low">
                <span className="size-1.5 rounded-full bg-crowd-low" aria-hidden />
                {Math.round(option.crowdingAvoidedPct)}% less crowded than the busiest option
              </span>
            ) : null}
          </p>
        </div>

        {/* headline figure — the number the rider actually compares */}
        <div className="shrink-0 text-right">
          <p className="flex items-baseline justify-end gap-1" data-figures>
            <span className="font-display text-display-md leading-none font-semibold text-mist-100">
              {option.totalMinutes}
            </span>
            <span className="text-xs text-mist-400">min</span>
          </p>
          <p className="mt-1.5 figure text-3xs text-mist-500">score {formatScore(option.scoreBreakdown.totalScore)}</p>
        </div>
      </div>

      {/* ------------------------------------------------------- the 4 numbers */}
      <div className="mt-4 grid grid-cols-2 gap-2 px-4 sm:px-5 xl:grid-cols-4">
        <Metric
          label="Travel time"
          value={option.scoreBreakdown.travelMinutes}
          unit="min"
          hint="Moving between stops"
        />
        <Metric label="Waiting time" value={option.waitMinutes} unit="min" hint="Waiting to board" />
        <Metric
          label="Predicted occupancy"
          value={formatPercent(option.crowdRisk)}
          tone={option.crowdRiskLevel === 'high' ? 'high' : option.crowdRiskLevel === 'moderate' ? 'moderate' : 'low'}
          hint={`Average ${formatPercent(option.avgCrowdRatio)} across the trip`}
        >
          <div className="mt-2">
            <CrowdBadge level={option.crowdRiskLevel} size="xs" />
          </div>
        </Metric>
        <Metric
          label="AI confidence"
          value={`${option.confidencePct}%`}
          hint={`${confidence.label} certainty in the busiest prediction`}
        >
          <div className="mt-2 flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', CONFIDENCE_DOT[confidence.label])} aria-hidden />
            <span className={cn('text-2xs font-medium', confidence.text)}>{confidence.label}</span>
          </div>
        </Metric>
      </div>

      {/* ----------------------------------------------------- crowd + comfort */}
      <div className="mt-4 space-y-2 px-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-2xs font-medium',
              comfort.border,
              comfort.bg,
              comfort.text,
            )}
            title={comfort.description}
          >
            <ComfortIcon comfort={option.comfort} />
            {comfort.label}
          </span>
          <span className="figure text-3xs text-mist-500">
            peak {formatPercent(option.crowdRisk)} · avg {formatPercent(option.avgCrowdRatio)}
          </span>
        </div>
        <CrowdMeter ratio={option.crowdRisk} level={option.crowdRiskLevel} />
      </div>

      {/* ------------------------------------------------------ why this route */}
      <div className="mx-4 mt-4 overflow-hidden rounded-xl border border-white/8 bg-white/[0.02] sm:mx-5">
        <button
          type="button"
          onClick={() => setShowWhy((current) => !current)}
          aria-expanded={showWhy}
          aria-controls={panelId}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.04]"
        >
          <span className="flex items-center gap-2 text-xs font-medium text-mist-200">
            <Bot className="size-3.5 text-pulse-300" aria-hidden />
            Why this route?
          </span>
          <span className="flex items-center gap-2 figure text-3xs text-mist-500">
            {option.scoreBreakdown.travelMinutes} + {option.scoreBreakdown.waitingMinutes} +{' '}
            {option.scoreBreakdown.crowdPenaltyMinutes} = {option.scoreBreakdown.totalScore}
            <ChevronDown
              className={cn('size-3.5 transition-transform duration-200', showWhy && 'rotate-180')}
              aria-hidden
            />
          </span>
        </button>
        {showWhy ? (
          <div id={panelId} className="animate-fade border-t border-white/8 px-3 py-3">
            <p className="mb-3 text-2xs leading-relaxed text-mist-300">{option.scoreExplanation}</p>
            <ScoreBreakdown option={option} />
          </div>
        ) : null}
      </div>

      <CardFooter className="mt-4">
        <p className="min-w-0 flex-1 text-2xs leading-relaxed text-mist-500">{option.headline}</p>
        <Button
          size="sm"
          variant={isRecommended ? 'primary' : 'outline'}
          iconRight={<ChevronRight className="size-3.5" aria-hidden />}
          onClick={onOpen}
          aria-label={`View details for ${option.lineCodes.join(' then ') || option.routeName}`}
          className="shrink-0"
        >
          Route details
        </Button>
      </CardFooter>
    </Card>
  );
}

function ComfortIcon({ comfort }: { comfort: RouteOption['comfort'] }) {
  if (comfort === 'comfortable') return <Armchair className="size-3.5" aria-hidden />;
  if (comfort === 'standing') return <Users className="size-3.5" aria-hidden />;
  return <AlertTriangle className="size-3.5" aria-hidden />;
}
