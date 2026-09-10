import { useMemo } from 'react';
import { Activity, Loader2, MapPinned, TriangleAlert } from 'lucide-react';
import type { CrowdLevel, MapRouteGeometry } from '@shared/types';
import { useMapsNetwork } from '../../hooks/useTransitData';
import { GoogleMapCanvas } from './GoogleMapCanvas';
import { AlertLayer, RoutePathLayer, VehicleLayer, boundsOfRoutes, routeMeasuredRatio, routeSpec } from './layers';
import { MapFallback } from './MapFallback';
import { MapLegend, MapPanel } from './MapPanel';
import { Badge } from '../ui/Badge';
import { ErrorState, Skeleton } from '../ui/Skeleton';
import { cn, formatPercent } from '../../lib/utils';

/**
 * Operator control-room map.
 *
 * The whole simulated network on the real Google Maps basemap: every corridor
 * tinted by the crowd band the model predicts for it, every stop, the simulated
 * fleet, and the open service notices. Selecting a corridor focuses the rest of
 * the command centre on it — the AI decision console below reads the same route.
 *
 * DEMO DATA — vehicles and crowding are simulated; the header says so on every
 * screen that shows this map.
 */

export interface OperatorNetworkMapProps {
  selectedRouteNumber?: string | null;
  /** Omit to make the map read-only (the rider home screen only inspects it). */
  onSelectRoute?: (routeNumber: string | null) => void;
  heightClass?: string;
  className?: string;
}

export function OperatorNetworkMap({
  selectedRouteNumber = null,
  onSelectRoute,
  heightClass = 'h-[360px] sm:h-[440px] xl:h-[620px]',
  className,
}: OperatorNetworkMapProps) {
  const network = useMapsNetwork(30_000);
  const geometry = network.data?.routes ?? [];
  const vehicles = network.data?.vehicles ?? [];
  const alerts = network.data?.alerts ?? [];

  const byNumber = useMemo(() => {
    const map = new Map<string, MapRouteGeometry>();
    for (const route of geometry) map.set(route.routeNumber, route);
    return map;
  }, [geometry]);

  const selected = selectedRouteNumber ? byNumber.get(selectedRouteNumber) ?? null : null;

  const vehiclesByRoute = useMemo(() => {
    const map = new Map<string, number>();
    for (const vehicle of vehicles) {
      map.set(vehicle.routeId, (map.get(vehicle.routeId) ?? 0) + 1);
    }
    return map;
  }, [vehicles]);

  const levels = useMemo(() => {
    const map = new Map<string, CrowdLevel>();
    for (const route of geometry) map.set(route.routeId, route.predictedLevel ?? 'low');
    return map;
  }, [geometry]);

  const highCrowd = geometry.filter((route) => (route.predictedLevel ?? 'low') === 'high');

  const bounds = useMemo(
    () => (selected ? boundsOfRoutes([selected]) : geometry.length ? boundsOfRoutes(geometry) : null),
    [geometry, selected],
  );

  return (
    <MapPanel
      title="Network map"
      subtitle={
        selected
          ? `Focused on Route ${selected.routeNumber} · ${selected.stops.length} stops · ${
              vehiclesByRoute.get(selected.routeId) ?? 0
            } demo vehicles`
          : `${geometry.length} corridors · ${network.data?.totals.stops ?? 0} stops · ${
              vehicles.length
            } simulated vehicles · corridor colour is predicted crowding`
      }
      icon={<MapPinned className="size-4" />}
      heightClass={heightClass}
      className={className}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={highCrowd.length ? 'critical' : 'low'} size="xs" dot>
            {highCrowd.length ? `${highCrowd.length} high crowd` : 'no high crowd'}
          </Badge>
          <Badge tone="neutral" size="xs" icon={<Activity className="size-3" />}>
            live · 30s
          </Badge>
        </div>
      }
      legend={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <MapLegend compact />
          <span className="text-3xs text-mist-500">Corridor tint = predicted crowding band</span>
          {onSelectRoute ? (
            <span className="text-3xs text-mist-500">Click a corridor or marker to focus it</span>
          ) : null}
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-3xs text-mist-500">
          <span className="figure">
            {network.data?.totals.routes ?? 0} routes · {network.data?.totals.stops ?? 0} stops ·{' '}
            {network.data?.totals.vehicles ?? 0} vehicles · {network.data?.totals.alerts ?? 0} notices
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TriangleAlert className="size-3" aria-hidden />
            {network.data?.disclaimer ?? 'Simulated demo network — no live transport feed'}
          </span>
        </div>
      }
    >
      {network.isError ? (
        <div className="grid h-full place-items-center p-4">
          <ErrorState
            title="Map payload unavailable"
            error={network.error}
            onRetry={() => void network.refetch()}
          />
        </div>
      ) : !network.data ? (
        <div className="relative h-full w-full">
          <Skeleton className="absolute inset-0 rounded-none" />
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <Loader2 className="size-5 animate-spin text-pulse-400" aria-hidden />
              <p className="text-sm font-medium text-mist-200">Loading network map…</p>
              <p className="text-2xs text-mist-500">Corridors, fleet and notices from the dataset</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <GoogleMapCanvas
            bounds={bounds}
            padding={64}
            fallback={({ status, error, retry }) => (
              <MapFallback
                status={status}
                error={error}
                retry={retry}
                routes={geometry}
                vehicles={vehicles}
                selectedRouteId={selected?.routeId ?? null}
                levelOf={(route) => levels.get(route.routeId) ?? 'low'}
                onSelect={(routeId) => {
                  const route = geometry.find((item) => item.routeId === routeId);
                  if (route) onSelectRoute?.(route.routeNumber);
                }}
              />
            )}
          >
            <RoutePathLayer
              routes={geometry}
              tint="crowd"
              selectedRouteId={selected?.routeId ?? null}
              onSelect={(routeId) => {
                const route = geometry.find((item) => item.routeId === routeId);
                if (route) onSelectRoute?.(route.routeNumber);
              }}
              detailOf={(route) => routeSpec(route, vehiclesByRoute.get(route.routeId) ?? 0)}
            />
            <VehicleLayer
              vehicles={vehicles}
              selectedRouteId={selected?.routeId ?? null}
              onSelect={(vehicle) => onSelectRoute?.(vehicle.routeNumber)}
            />
            <AlertLayer alerts={alerts} />
          </GoogleMapCanvas>

          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-ink-950/85 px-3 py-2 backdrop-blur-sm">
            {selected ? (
              <>
                <span className="figure text-xs font-semibold text-mist-100">
                  Route {selected.routeNumber}
                </span>
                <span className="text-2xs text-mist-400">
                  measured{' '}
                  <span className="figure text-mist-200">
                    {formatPercent(routeMeasuredRatio(selected) ?? 0)}
                  </span>
                </span>
                <span className="text-2xs text-mist-400">
                  forecast{' '}
                  <span className="figure text-mist-200">
                    {selected.predictedPct === null ? '—' : `${selected.predictedPct.toFixed(0)}%`}
                  </span>
                </span>
                <span className="text-2xs text-mist-400">
                  confidence{' '}
                  <span className="figure text-mist-200">
                    {selected.confidencePct === null ? '—' : `${selected.confidencePct.toFixed(0)}%`}
                  </span>
                </span>
                <span className="text-2xs text-mist-400">
                  fleet <span className="figure text-mist-200">{vehiclesByRoute.get(selected.routeId) ?? 0}</span>
                </span>
                {onSelectRoute ? (
                <button
                  type="button"
                  onClick={() => onSelectRoute(null)}
                  className="pointer-events-auto ml-auto rounded-lg border border-white/15 px-2 py-1 text-3xs text-mist-300 transition-colors hover:border-pulse-400/50 hover:text-mist-50"
                >
                  Full network
                </button>
                ) : null}
              </>
            ) : (
              <>
                <span className={cn('inline-flex items-center gap-1.5 text-2xs text-mist-300')}>
                  <span className="size-1.5 animate-pulse rounded-full bg-pulse-400" aria-hidden />
                  Whole network in view
                </span>
                <span className="text-2xs text-mist-500">
                  {highCrowd.length
                    ? `${highCrowd.length} corridor(s) in the high band`
                    : 'No corridor in the high band right now'}
                </span>
                {onSelectRoute ? (
                  <span className="ml-auto text-3xs text-mist-500">Select a corridor to open its AI decision</span>
                ) : (
                  <span className="ml-auto text-3xs text-mist-500">Click a corridor or stop for its numbers</span>
                )}
              </>
            )}
          </div>
        </>
      )}
    </MapPanel>
  );
}
