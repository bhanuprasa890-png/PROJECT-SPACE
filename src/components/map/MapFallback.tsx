import { KeyRound, RefreshCw, TriangleAlert } from 'lucide-react';
import type { CrowdLevel, MapRouteGeometry, MapVehicleMarker } from '@shared/types';
import { SchematicNetworkMap } from './SchematicNetworkMap';

/**
 * What the map surface shows when the Google Maps SDK is unavailable.
 *
 * Two cases, both stated plainly on screen:
 *   `no-key` — no browser key configured. The TransitPulse layer still renders on
 *              the schematic built from the dataset geometry.
 *   `error`  — the SDK failed or the key was rejected; the same schematic keeps the
 *              demo running while offering a retry.
 */
export function MapFallback({
  status,
  error,
  retry,
  routes,
  vehicles = [],
  selectedRouteId,
  levelOf,
  onSelect,
}: {
  status: 'no-key' | 'error';
  error: string | null;
  retry: () => void;
  routes: MapRouteGeometry[];
  vehicles?: MapVehicleMarker[];
  selectedRouteId?: string | null;
  levelOf?: (route: MapRouteGeometry) => CrowdLevel;
  onSelect?: (routeId: string) => void;
}) {
  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-white/8 bg-ink-950/85 px-3 py-2 backdrop-blur">
        <span className="inline-flex items-center gap-2 text-2xs text-mist-200">
          {status === 'error' ? (
            <TriangleAlert className="size-3.5 text-crowd-moderate" aria-hidden />
          ) : (
            <KeyRound className="size-3.5 text-mist-400" aria-hidden />
          )}
          {status === 'error' ? 'Google Maps unavailable — schematic view' : 'Schematic view — no Google Maps key configured'}
        </span>
        {status === 'error' ? (
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2 py-1 text-3xs text-mist-200 transition-colors hover:border-pulse-400/50 hover:text-mist-50"
          >
            <RefreshCw className="size-3" aria-hidden />
            Retry Google Maps
          </button>
        ) : (
          <span className="text-3xs text-mist-500">
            {error ?? 'Set GOOGLE_MAPS_BROWSER_KEY to draw this on Google Maps'}
          </span>
        )}
      </div>
      <div className="h-full w-full pt-8">
        <SchematicNetworkMap
          routes={routes}
          vehicles={vehicles}
          selectedRouteId={selectedRouteId}
          levelOf={levelOf}
          onSelect={onSelect}
          heightClass="h-full"
        />
      </div>
    </div>
  );
}
