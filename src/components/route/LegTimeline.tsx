import { Footprints, MapPin, Users } from 'lucide-react';
import type { ItineraryLeg } from '@shared/types';
import { cn, crowdTone, formatClock, formatPercent } from '../../lib/utils';
import { CrowdMeter, ConfidencePill } from '../crowd/CrowdIndicators';

/** Vertical journey timeline: walk stubs, transit legs and per-leg crowd. */
export function LegTimeline({
  legs,
  className,
  expanded = false,
}: {
  legs: ItineraryLeg[];
  className?: string;
  expanded?: boolean;
}) {
  if (!legs.length) {
    return <p className="text-xs text-mist-500">No legs to display.</p>;
  }

  return (
    <ol className={cn('relative space-y-3', className)}>
      {legs.map((leg, index) => {
        const isWalk = leg.kind === 'walk';
        const tone = leg.crowd ? crowdTone(leg.crowd.level) : null;
        const departClock = formatClock(leg.departAt);
        const arriveClock = formatClock(leg.arriveAt);

        return (
          <li
            key={`${leg.lineId ?? 'walk'}-${leg.departAt}-${index}`}
            className="animate-rise"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div className="flex gap-3">
              {/* rail */}
              <div className="flex flex-col items-center pt-1.5">
                <span
                  className={cn(
                    'grid size-7 place-items-center rounded-lg border text-3xs font-bold',
                    isWalk
                      ? 'border-white/10 bg-white/5 text-mist-400'
                      : 'border-transparent text-ink-950',
                  )}
                  style={leg.lineColor ? { backgroundColor: leg.lineColor } : undefined}
                >
                  {isWalk ? <Footprints className="size-3.5" /> : leg.lineCode}
                </span>
                {index < legs.length - 1 ? (
                  <span
                    className="my-1 w-px flex-1"
                    style={{
                      background: `linear-gradient(to bottom, ${leg.lineColor ?? 'rgba(255,255,255,0.2)'}, rgba(255,255,255,0.08))`,
                    }}
                  />
                ) : null}
              </div>

              {/* content */}
              <div className="min-w-0 flex-1 pb-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium text-mist-100">
                    {isWalk ? (
                      <>
                        Walk to{' '}
                        <span className="text-mist-200">{leg.toStopName}</span>
                      </>
                    ) : (
                      <>
                        {leg.lineName}
                        <span className="ml-2 figure text-2xs text-mist-500">
                          {leg.lineCode}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="figure text-2xs text-mist-400">
                    {departClock} → {arriveClock} · {leg.durationMinutes} min
                  </p>
                </div>

                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-mist-400">
                  <MapPin className="size-3" />
                  {leg.fromStopName}
                  <span className="text-mist-600">→</span>
                  {leg.toStopName}
                  {!isWalk && leg.stopCount > 0 ? (
                    <span className="text-mist-500">· {leg.stopCount} stops</span>
                  ) : null}
                </p>

                {leg.crowd ? (
                  <div className="mt-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-2xs text-mist-300">
                        <Users className="size-3.5" />
                        On board at boarding
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={cn('figure text-xs font-medium', tone?.text)}>
                          {formatPercent(leg.crowd.ratio)}
                        </span>
                        <span className="figure text-2xs text-mist-500">
                          {leg.crowd.headcount}/{leg.crowd.capacity}
                        </span>
                      </span>
                    </div>
                    <CrowdMeter
                      ratio={leg.crowd.ratio}
                      level={leg.crowd.level}
                      height="sm"
                      className="mt-2"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-2xs text-mist-400">
                        Peak {formatPercent(leg.crowd.peakRatio)} near {leg.crowd.peakStopName}
                      </span>
                      <ConfidencePill value={leg.crowd.confidence} />
                    </div>

                    {expanded && leg.stops.length ? (
                      <ol className="mt-3 space-y-1.5 border-t border-white/6 pt-2">
                        {leg.stops.map((stop) => (
                          <li key={stop.stopId} className="flex items-center justify-between text-2xs">
                            <span className="flex items-center gap-1.5 text-mist-300">
                              <span className="size-1 rounded-full bg-mist-500" />
                              {stop.name}
                            </span>
                            <span className="figure text-mist-500">+{stop.etaMinutes} min</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
