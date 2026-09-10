import { ArrowRightLeft, BusFront, CalendarClock, Gauge, Wrench } from 'lucide-react';
import type { AiRecommendation } from '@shared/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

/**
 * AI recommendations — the plays the console proposes, with the evidence behind
 * each one. Titles, impact estimates and evidence chips all come from the API
 * (rules in `server/services/command-center.ts` over stored values).
 */

const KIND_META: Record<
  AiRecommendation['kind'],
  { icon: typeof BusFront; label: string }
> = {
  add_vehicle: { icon: BusFront, label: 'Capacity' },
  redirect_passengers: { icon: ArrowRightLeft, label: 'Demand' },
  rebalance_headway: { icon: Gauge, label: 'Frequency' },
  fleet_readiness: { icon: Wrench, label: 'Fleet' },
};

const URGENCY_META: Record<AiRecommendation['urgency'], { label: string; tone: 'critical' | 'moderate' | 'neutral' }> = {
  now: { label: 'Act now', tone: 'critical' },
  next_30: { label: 'Next 30 min', tone: 'moderate' },
  monitor: { label: 'Monitor', tone: 'neutral' },
};

export function AiRecommendations({
  recommendations,
  onDispatch,
  dispatchingId,
  className,
}: {
  recommendations: AiRecommendation[];
  onDispatch: (recommendation: AiRecommendation) => void;
  dispatchingId: string | null;
  className?: string;
}) {
  if (!recommendations.length) {
    return (
      <p className={cn('px-5 py-6 text-sm text-mist-400', className)}>
        No interventions required — the network is inside its targets.
      </p>
    );
  }

  return (
    <ul className={cn('grid gap-3 lg:grid-cols-2', className)}>
      {recommendations.map((recommendation) => {
        const meta = KIND_META[recommendation.kind] ?? KIND_META.add_vehicle;
        const Icon = meta.icon;
        const urgency = URGENCY_META[recommendation.urgency];

        return (
          <li
            key={recommendation.id}
            className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span
                  className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/6"
                  style={{ color: recommendation.color }}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[0.62rem] tracking-wider text-mist-500 uppercase">
                    {meta.label}
                    <span className="text-mist-600">·</span>
                    <span className="font-mono text-mist-400">{recommendation.routeNumber}</span>
                  </p>
                  <p className="mt-1 text-sm leading-snug font-semibold text-mist-100">
                    {recommendation.title}
                  </p>
                </div>
              </div>
              <Badge tone={urgency.tone} size="xs" className="shrink-0">
                {urgency.label}
              </Badge>
            </div>

            <p className="text-[0.72rem] leading-relaxed text-mist-400">{recommendation.detail}</p>

            <div className="flex flex-wrap gap-1.5">
              {recommendation.evidence.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-ink-950/50 px-2 py-0.5 text-[0.62rem] text-mist-400"
                >
                  {item.label}
                  <span className="font-mono text-mist-200">{item.value}</span>
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/6 pt-3">
              <p className="inline-flex items-center gap-1.5 text-[0.7rem] text-pulse-200">
                <CalendarClock className="size-3" />
                {recommendation.impactLabel}
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.65rem] text-mist-500">
                  confidence {recommendation.confidencePct.toFixed(0)}%
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  loading={dispatchingId === recommendation.id}
                  onClick={() => onDispatch(recommendation)}
                >
                  Dispatch
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
