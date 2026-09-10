import { ChevronRight, Clock, Coins, Leaf, MoveRight, ShieldCheck, Users } from 'lucide-react';
import type { RouteOption } from '@shared/types';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CrowdBadge, CrowdMeter } from '../crowd/CrowdIndicators';
import { cn, formatClock, formatDuration, formatPercent } from '../../lib/utils';

/**
 * One recommended itinerary. The card leads with the trade-off (time vs.
 * crowding) because that is the decision the rider is actually making.
 */
export function RouteOptionCard({
  option,
  isRecommended,
  onOpen,
  className,
  style,
}: {
  option: RouteOption;
  isRecommended: boolean;
  onOpen: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const transitLegs = option.legs.filter((leg) => leg.kind === 'transit');
  const lineCodes = transitLegs.map((leg) => leg.lineCode ?? '');

  return (
    <Card
      interactive
      accent={isRecommended ? 'pulse' : option.crowdRiskLevel === 'critical' ? 'critical' : 'none'}
      className={cn(
        'animate-rise p-4 transition',
        isRecommended && 'ring-1 ring-pulse-400/25',
        className,
      )}
      style={style}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
            >
              {option.badgeLabel}
            </Badge>
            <CrowdBadge level={option.crowdRiskLevel} label={`Peak ${formatPercent(option.crowdRisk)}`} />
            {option.crowdingAvoidedPct > 5 ? (
              <Badge tone="low" icon={<ShieldCheck className="size-3" />}>
                {Math.round(option.crowdingAvoidedPct)}% less crowded
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-snug text-mist-200">{option.headline}</p>
        </div>

        <div className="text-right">
          <p className="font-display text-2xl leading-none font-semibold text-mist-100">
            {option.totalMinutes}
            <span className="ml-1 text-xs font-normal text-mist-400">min</span>
          </p>
          <p className="mt-1 font-mono text-[0.7rem] text-mist-400">
            {formatClock(option.departAt)} → {formatClock(option.arriveAt)}
          </p>
        </div>
      </div>

      {/* leg chain */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {option.legs.map((leg, index) =>
          leg.kind === 'walk' ? (
            <span key={`walk-${index}`} className="flex items-center gap-1 text-[0.7rem] text-mist-400">
              <MoveRight className="size-3.5" />
              {leg.durationMinutes}m walk
            </span>
          ) : (
            <span
              key={`${leg.lineId}-${index}`}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: leg.lineColor ?? '#38bdf8' }}
              />
              <span className="font-mono text-[0.7rem] text-mist-200">{leg.lineCode}</span>
              {leg.crowd ? (
                <span className={cn('font-mono text-[0.65rem]', crowdTextTone(leg.crowd.ratio))}>
                  {formatPercent(leg.crowd.ratio)}
                </span>
              ) : null}
            </span>
          ),
        )}
      </div>

      <div className="mt-3.5">
        <div className="mb-1.5 flex items-center justify-between text-[0.68rem] text-mist-400">
          <span>Worst predicted load on this itinerary</span>
          <span className="font-mono">
            {formatPercent(option.crowdRisk)} peak · {formatPercent(option.avgCrowdRatio)} average
          </span>
        </div>
        <CrowdMeter ratio={option.crowdRisk} level={option.crowdRiskLevel} />
      </div>

      <dl className="mt-3.5 grid grid-cols-2 gap-2 text-[0.7rem] sm:grid-cols-4">
        <Fact icon={<Clock className="size-3.5" />} label="Travel" value={formatDuration(option.totalMinutes)} />
        <Fact
          icon={<Users className="size-3.5" />}
          label="Changes"
          value={option.transfers === 0 ? 'Direct' : `${option.transfers}`}
        />
        <Fact icon={<Coins className="size-3.5" />} label="Fare" value={`${option.fare.toFixed(2)}`} />
        <Fact
          icon={<Leaf className="size-3.5" />}
          label="CO₂ saved"
          value={`${option.co2SavedKg.toFixed(2)} kg`}
        />
      </dl>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {option.rationale.slice(0, 1).map((reason) => (
            <span key={reason} className="text-[0.68rem] leading-relaxed text-mist-500">
              {reason}
            </span>
          ))}
        </div>
        <Button
          size="sm"
          variant={isRecommended ? 'primary' : 'outline'}
          iconRight={<ChevronRight className="size-3.5" />}
          onClick={onOpen}
        >
          Boarding plan
        </Button>
      </div>

      <p className="sr-only">{lineCodes.join(', ')}</p>
    </Card>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2">
      <dt className="flex items-center gap-1.5 text-[0.62rem] tracking-wider text-mist-500 uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-xs text-mist-200">{value}</dd>
    </div>
  );
}

function crowdTextTone(ratio: number): string {
  if (ratio >= 1) return 'text-crowd-critical';
  if (ratio >= 0.8) return 'text-crowd-high';
  if (ratio >= 0.55) return 'text-crowd-moderate';
  return 'text-crowd-low';
}
