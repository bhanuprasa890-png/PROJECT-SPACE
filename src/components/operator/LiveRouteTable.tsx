import { ArrowDownRight, ArrowRight, ArrowUpRight, Bus, Inbox, Sparkles } from 'lucide-react';
import type { CommandRouteRow } from '@shared/types';
import { Badge } from '../ui/Badge';
import { CrowdBadge, CrowdMeter } from '../crowd/CrowdIndicators';
import { cn, MODE_LABELS } from '../../lib/utils';

/**
 * Live route status — one row per route with the numbers an operator triages on:
 * occupancy, crowd band, forecast, vehicles in service and operating status.
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
  if (trend === 'rising') return <ArrowUpRight className="size-3.5 text-crowd-critical" />;
  if (trend === 'falling') return <ArrowDownRight className="size-3.5 text-crowd-low" />;
  return <ArrowRight className="size-3.5 text-mist-500" />;
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
      <div className={cn('flex items-center gap-3 px-5 py-8 text-sm text-mist-400', className)}>
        <Inbox className="size-4" />
        No active routes reported.
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/8 text-left text-[0.62rem] tracking-[0.14em] text-mist-500 uppercase">
            <th className="px-4 py-2.5 font-medium">Route</th>
            <th className="px-3 py-2.5 font-medium">Occupancy</th>
            <th className="px-3 py-2.5 font-medium">Crowd level</th>
            <th className="px-3 py-2.5 font-medium">Forecast</th>
            <th className="px-3 py-2.5 font-medium">Vehicles</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Next</th>
            <th className="px-4 py-2.5 font-medium">Busiest stop</th>
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
                  active ? 'bg-white/[0.05]' : 'hover:bg-white/[0.025]',
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-lg border font-mono text-[0.68rem] font-semibold"
                      style={{
                        borderColor: `${route.color}66`,
                        backgroundColor: `${route.color}1f`,
                        color: route.color,
                      }}
                    >
                      {route.routeNumber}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[0.8rem] font-medium text-mist-100">
                        {route.routeName}
                      </p>
                      <p className="flex items-center gap-1.5 text-[0.62rem] text-mist-500">
                        <Bus className="size-3" />
                        {MODE_LABELS[route.mode] ?? route.mode} · {route.headwayMinutes} min headway
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-3 py-3">
                  <div className="w-[110px] space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[0.8rem] text-mist-100">
                        {route.occupancyPct.toFixed(0)}%
                      </span>
                      <span className="font-mono text-[0.6rem] text-mist-500">
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
                        className="inline-flex items-center gap-1 rounded-md border border-crowd-low/40 bg-crowd-low/10 px-1.5 py-0.5 font-mono text-[0.58rem] text-crowd-low"
                        title={`AI intervention ${route.activeIntervention.id} applied — projected ${route.activeIntervention.projectedPct.toFixed(1)}%`}
                      >
                        <Sparkles className="size-2.5" />
                        AI {route.activeIntervention.projectedPct.toFixed(0)}%
                      </span>
                    ) : null}
                  </div>
                </td>

                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <TrendIcon trend={route.trend} />
                    <span className="font-mono text-[0.78rem] text-mist-200">
                      {route.predictedPct.toFixed(0)}%
                    </span>
                    <span
                      className={cn(
                        'font-mono text-[0.62rem]',
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
                  <p className="mt-0.5 text-[0.6rem] text-mist-500">
                    24h peak {route.peak24hPct.toFixed(0)}%
                  </p>
                </td>

                <td className="px-3 py-3">
                  <p className="font-mono text-[0.78rem] text-mist-200">
                    {route.vehiclesInService}
                    <span className="text-mist-500">/{route.vehiclesTotal}</span>
                  </p>
                  <p className="mt-0.5 text-[0.6rem] text-mist-500">adherence {route.onTimePct.toFixed(0)}%</p>
                </td>

                <td className="px-3 py-3">
                  <Badge tone={STATUS_TONE[route.status]} size="xs">
                    {route.statusLabel}
                  </Badge>
                  <p className="mt-1 max-w-[170px] text-[0.6rem] leading-snug text-mist-500">
                    {route.statusDetail}
                  </p>
                </td>

                <td className="px-3 py-3">
                  <p className="font-mono text-[0.78rem] text-mist-200">
                    {clockOrDash(route.nextDepartureAt)}
                  </p>
                  <p className="mt-0.5 text-[0.6rem] text-mist-500">
                    {route.serviceFirst?.slice(0, 5)}–{route.serviceLast?.slice(0, 5)}
                  </p>
                </td>

                <td className="px-4 py-3">
                  <p className="text-[0.75rem] text-mist-200">{route.worstStopName ?? '—'}</p>
                  <p className="mt-0.5 text-[0.6rem] text-mist-500">
                    {route.stopsMonitored} stops monitored ·{' '}
                    {route.peakHour === null ? 'peak n/a' : `peak ${String(route.peakHour).padStart(2, '0')}:00`}
                  </p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
