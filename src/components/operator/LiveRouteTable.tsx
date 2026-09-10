import { ArrowDownRight, ArrowRight, ArrowUpRight, Bus, MoveRight, Sparkles } from 'lucide-react';
import type { CommandRouteRow } from '@shared/types';
import { Badge } from '../ui/Badge';
import { CrowdBadge, CrowdMeter } from '../crowd/CrowdIndicators';
import { EmptyState } from '../ui/Skeleton';
import { cn, MODE_LABELS } from '../../lib/utils';

/**
 * Live route status — one row per route with the numbers an operator triages on:
 * occupancy, crowd band, forecast, vehicles in service and operating status.
 *
 * Rows are selectable: the route cell carries a real button (keyboard + screen
 * readers) and the whole row responds to a click for mouse users, feeding the AI
 * decision console below.
 */

const STATUS_TONE: Record<
  CommandRouteRow['status'],
  'low' | 'moderate' | 'high' | 'critical' | 'info' | 'neutral'
> = {
  on_time: 'low',
  boarding: 'info',
  crowded: 'high',
  delayed: 'moderate',
  disrupted: 'critical',
};

function TrendIcon({ trend }: { trend: CommandRouteRow['trend'] }) {
  if (trend === 'rising')
    return <ArrowUpRight className="size-3.5 text-crowd-critical" aria-hidden />;
  if (trend === 'falling') return <ArrowDownRight className="size-3.5 text-crowd-low" aria-hidden />;
  return <ArrowRight className="size-3.5 text-mist-500" aria-hidden />;
}

function clockOrDash(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function LiveRouteTable({
  routes,
  selectedRoute,
  onSelectRoute,
  className,
}: {
  routes: CommandRouteRow[];
  selectedRoute: string | null;
  onSelectRoute: (routeNumber: string | null) => void;
  className?: string;
}) {
  if (!routes.length) {
    return (
      <div className={cn('px-5', className)}>
        <EmptyState
          compact
          title="No active routes reported"
          description="The command-centre payload returned no routes for this filter."
          icon={<Bus className="size-5" />}
        />
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <p className="flex items-center gap-1.5 px-5 text-3xs text-mist-500 lg:hidden">
        <MoveRight className="size-3" aria-hidden />
        Swipe the table sideways for fleet, status and stop columns
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="text-left">
              {[
                { label: 'Route', width: 'w-[220px]' },
                { label: 'Occupancy', width: 'w-[130px]' },
                { label: 'Crowd level', width: 'w-[120px]' },
                { label: 'Forecast', width: 'w-[130px]' },
                { label: 'Vehicles', width: 'w-[100px]' },
                { label: 'Status', width: 'w-[190px]' },
                { label: 'Next', width: 'w-[100px]' },
                { label: 'Busiest stop', width: 'w-[180px]' },
              ].map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={cn(
                    'sticky top-0 z-10 border-b border-white/8 bg-ink-950/85 px-3 py-2.5 backdrop-blur first:pl-5 last:pr-5',
                    'eyebrow font-medium text-mist-500',
                    column.width,
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => {
              const active = selectedRoute === route.routeNumber;
              return (
                <tr
                  key={route.lineId}
                  onClick={() => onSelectRoute(active ? null : route.routeNumber)}
                  className={cn(
                    'cursor-pointer border-b border-white/5 transition-colors last:border-0',
                    active ? 'bg-pulse-400/[0.055]' : 'hover:bg-white/[0.025]',
                  )}
                >
                  <td className="relative px-3 py-3 pl-5">
                    {active ? (
                      <span
                        className="absolute top-2 bottom-2 left-0 w-[2px] rounded-full bg-pulse-400"
                        aria-hidden
                      />
                    ) : null}
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectRoute(active ? null : route.routeNumber);
                      }}
                      title={`Focus ${route.routeNumber} in the AI decision console`}
                      className="flex w-full items-center gap-2.5 rounded-lg text-left transition-colors focus-visible:bg-white/[0.04]"
                    >
                      <span
                        className="figure grid size-8 shrink-0 place-items-center rounded-lg border text-2xs font-semibold"
                        style={{
                          borderColor: `${route.color}66`,
                          backgroundColor: `${route.color}1f`,
                          color: route.color,
                        }}
                        aria-hidden
                      >
                        {route.routeNumber}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-mist-100">
                          {route.routeName}
                        </span>
                        <span className="flex items-center gap-1.5 text-3xs text-mist-500">
                          <Bus className="size-3" aria-hidden />
                          {MODE_LABELS[route.mode] ?? route.mode} · {route.headwayMinutes} min headway
                        </span>
                      </span>
                    </button>
                  </td>

                  <td className="px-3 py-3">
                    <div className="w-[110px] space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="figure text-sm text-mist-100">
                          {route.occupancyPct.toFixed(0)}%
                        </span>
                        <span className="figure text-3xs text-mist-500">
                          {route.headcount}/{route.capacity}
                        </span>
                      </div>
                      <CrowdMeter ratio={route.occupancyPct / 100} level={route.level} height="sm" />
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <CrowdBadge level={route.level} size="xs" />
                      {route.activeIntervention ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-crowd-low/40 bg-crowd-low/10 px-1.5 py-0.5 text-3xs text-crowd-low"
                          title={`AI intervention ${route.activeIntervention.id} applied — projected ${route.activeIntervention.projectedPct.toFixed(1)}%`}
                        >
                          <Sparkles className="size-2.5" aria-hidden />
                          <span className="figure">
                            AI {route.activeIntervention.projectedPct.toFixed(0)}%
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <TrendIcon trend={route.trend} />
                      <span className="figure text-2xs text-mist-200">
                        {route.predictedPct.toFixed(0)}%
                      </span>
                      <span
                        className={cn(
                          'figure text-3xs',
                          route.trendDeltaPct > 0
                            ? 'text-crowd-critical'
                            : route.trendDeltaPct < 0
                              ? 'text-crowd-low'
                              : 'text-mist-500',
                        )}
                      >
                        {route.trendDeltaPct > 0 ? '+' : ''}
                        {route.trendDeltaPct.toFixed(0)}
                      </span>
                    </div>
                    <p className="figure mt-0.5 text-3xs text-mist-500">
                      24h peak {route.peak24hPct.toFixed(0)}%
                    </p>
                  </td>

                  <td className="px-3 py-3">
                    <p className="figure text-2xs text-mist-200">
                      {route.vehiclesInService}
                      <span className="text-mist-500">/{route.vehiclesTotal}</span>
                    </p>
                    <p className="figure mt-0.5 text-3xs text-mist-500">
                      adherence {route.onTimePct.toFixed(0)}%
                    </p>
                  </td>

                  <td className="px-3 py-3">
                    <Badge tone={STATUS_TONE[route.status]} size="xs">
                      {route.statusLabel}
                    </Badge>
                    <p className="mt-1 max-w-[170px] text-3xs leading-snug text-mist-500">
                      {route.statusDetail}
                    </p>
                  </td>

                  <td className="px-3 py-3">
                    <p className="figure text-2xs text-mist-200">
                      {clockOrDash(route.nextDepartureAt)}
                    </p>
                    <p className="figure mt-0.5 text-3xs text-mist-500">
                      {route.serviceFirst?.slice(0, 5)}–{route.serviceLast?.slice(0, 5)}
                    </p>
                  </td>

                  <td className="px-3 py-3 pr-5">
                    <p className="text-xs text-mist-200">{route.worstStopName ?? '—'}</p>
                    <p className="mt-0.5 text-3xs text-mist-500">
                      {route.stopsMonitored} stops monitored ·{' '}
                      {route.peakHour === null
                        ? 'peak n/a'
                        : `peak ${String(route.peakHour).padStart(2, '0')}:00`}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
