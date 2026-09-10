import { useEffect, useMemo, useState } from 'react';
import { Compass, Loader2, LocateFixed, Route as RouteIcon, Sparkles } from 'lucide-react';
import type { CrowdLevel, MapJourneyPayload, MapStopNode, RouteOption } from '@shared/types';
import { useMapsJourney } from '../../hooks/useTransitData';
import { GoogleMapCanvas, useMapApi } from './GoogleMapCanvas';
import { JourneyLayer, boundsOfOption } from './layers';
import { MapFallback } from './MapFallback';
import { MapLegend, MapPanel } from './MapPanel';
import { Badge } from '../ui/Badge';
import { ErrorState, Skeleton } from '../ui/Skeleton';
import { CrowdBadge } from '../crowd/CrowdIndicators';
import { cn, formatClock, formatDuration, formatPercent } from '../../lib/utils';

/**
 * The rider's map: one planned journey drawn on the real Google Maps basemap.
 *
 * The selected itinerary is emphasised, the alternatives stay faint behind it, and
 * every corridor is tinted by the crowd band the model predicts for that boarding
 * window. Stops are clickable, so the numbers in the cards below can be checked
 * against the geography above — same payload, one source of truth.
 */

export interface JourneyMapProps {
  origin: string;
  destination: string;
  departAfter?: string;
  avoidCrowding?: boolean;
  maxTransfers?: number;
  options: RouteOption[];
  selectedOptionId: string | null;
  onSelectOption?: (optionId: string) => void;
  heightClass?: string;
  className?: string;
  title?: string;
  subtitle?: string;
  /** Rendered next to the legend — used by the details screen for leg counts. */
  footer?: React.ReactNode;
}

export function JourneyMap({
  origin,
  destination,
  departAfter,
  avoidCrowding,
  maxTransfers,
  options,
  selectedOptionId,
  onSelectOption,
  heightClass = 'h-[320px] sm:h-[400px] lg:h-[460px]',
  className,
  title = 'Journey map',
  subtitle,
  footer,
}: JourneyMapProps) {
  const journey = useMapsJourney(
    origin && destination ? { origin, destination, departAfter, avoidCrowding, maxTransfers } : null,
  );

  const geometry = journey.data?.routes ?? [];
  const vehicles = journey.data?.vehicles ?? [];

  const selected = useMemo(() => {
    if (!options.length) return null;
    return options.find((option) => option.id === selectedOptionId) ?? options[0];
  }, [options, selectedOptionId]);

  const levelOf = useMemo(() => {
    const map = new Map<string, CrowdLevel>();
    for (const route of geometry) {
      if (route.predictedLevel) map.set(route.routeId, route.predictedLevel);
    }
    return map;
  }, [geometry]);

  const bounds = useMemo(
    () => (geometry.length ? boundsOfOption(selected, geometry) : null),
    [geometry, selected],
  );

  const boardingStop = useMemo(() => {
    const stopId = selected?.legs.find((leg) => leg.kind === 'transit')?.fromStopId;
    const stops = geometry.flatMap((route) => route.stops);
    return stops.find((stop) => stop.id === stopId) ?? stops[0] ?? null;
  }, [geometry, selected]);

  const others = useMemo(
    () => options.filter((option) => option.id !== selected?.id).slice(0, 3),
    [options, selected],
  );

  const subtitleText =
    subtitle ??
    (selected
      ? `${selected.lineCodes.filter(Boolean).join(' → ')} · predicted ${formatPercent(
          selected.crowdRisk,
        )} · ${formatDuration(selected.totalMinutes)}`
      : 'Corridor colour is the predicted crowd band');

  return (
    <MapPanel
      title={title}
      subtitle={subtitleText}
      icon={<RouteIcon className="size-4" />}
      heightClass={heightClass}
      className={className}
      actions={
        selected ? (
          <Badge tone={selected.kind === 'best' ? 'pulse' : 'neutral'} size="xs" icon={<Sparkles className="size-3" />}>
            {selected.badgeLabel}
          </Badge>
        ) : null
      }
      legend={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <MapLegend compact />
          <span className="text-3xs text-mist-500">Corridor colour = predicted crowd band</span>
          {onSelectOption && options.length > 1 ? (
            <span className="text-3xs text-mist-500">Click a corridor or a stop for its numbers</span>
          ) : null}
        </div>
      }
      footer={footer}
    >
      {journey.isError ? (
        <div className="grid h-full place-items-center p-4">
          <ErrorState
            title="Journey map unavailable"
            message={(journey.error as Error).message}
            onRetry={() => void journey.refetch()}
          />
        </div>
      ) : !journey.data || !selected ? (
        <div className="relative h-full w-full">
          <Skeleton className="absolute inset-0 rounded-none" />
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <Loader2 className="size-5 animate-spin text-pulse-400" aria-hidden />
              <p className="text-sm font-medium text-mist-200">Placing your journey…</p>
              <p className="text-2xs text-mist-500">Fetching corridor geometry from the network dataset</p>
            </div>
          </div>
        </div>
      ) : geometry.length === 0 ? (
        <div className="grid h-full place-items-center p-6 text-center">
          <div>
            <Compass className="mx-auto size-5 text-mist-400" aria-hidden />
            <p className="mt-2 text-sm text-mist-200">No map geometry for this journey</p>
            <p className="mt-1 text-2xs text-mist-500">
              The itinerary is still listed below with its measured and predicted numbers.
            </p>
          </div>
        </div>
      ) : (
        <>
          <GoogleMapCanvas
            bounds={bounds}
            padding={56}
            fallback={({ status, error, retry }) => (
              <MapFallback
                status={status}
                error={error}
                retry={retry}
                routes={geometry}
                vehicles={vehicles}
                selectedRouteId={selected.routeId ?? geometry[0]?.routeId ?? null}
                levelOf={(route) => levelOf.get(route.routeId) ?? 'low'}
                onSelect={(routeId) => {
                  const option = options.find((item) => item.legs.some((leg) => leg.lineId === routeId));
                  if (option) onSelectOption?.(option.id);
                }}
              />
            )}
          >
            <JourneyLayer
              option={selected}
              geometry={geometry}
              vehicles={vehicles}
              otherOptions={others}
              onSelectOption={onSelectOption}
            />
            <MyLocationControl origin={boardingStop} />
          </GoogleMapCanvas>

          <JourneyOverlay option={selected} />
        </>
      )}
    </MapPanel>
  );
}

/**
 * Opt-in "where am I" marker.
 *
 * Nothing asks for a location until the rider taps the button, and when the
 * device is far outside the demo network the control says so instead of panning
 * the map away from the trip being planned.
 */
function MyLocationControl({ origin }: { origin: MapStopNode | null }) {
  const api = useMapApi();
  const [status, setStatus] = useState<'idle' | 'locating' | 'ready' | 'error'>('idle');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !position) return;
    const marker = new api.google.maps.Marker({
      position,
      map: api.map,
      title: 'Your device location',
      zIndex: 60,
      icon: {
        path: api.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#38bdf8',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2.5,
      },
    });
    return () => {
      api.google.maps.event.clearInstanceListeners(marker);
      marker.setMap(null);
    };
  }, [api, position]);

  const locate = (): void => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('error');
      setMessage('This browser cannot share a location.');
      return;
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition({ lat: result.coords.latitude, lng: result.coords.longitude });
        setStatus('ready');
        const distanceKm =
          origin && api
            ? api.google.maps.geometry.spherical.computeDistanceBetween(
                new api.google.maps.LatLng(result.coords.latitude, result.coords.longitude),
                new api.google.maps.LatLng(origin.lat, origin.lng),
              ) / 1000
            : null;
        setMessage(
          distanceKm === null
            ? 'Your device location is shown on the map.'
            : distanceKm < 25
              ? `You are ${distanceKm.toFixed(1)} km from ${origin?.name ?? 'the boarding stop'} — walk-in is feasible.`
              : `You are ${distanceKm.toFixed(0)} km from the demo network (${origin?.name ?? 'boarding stop'}), so the map stays on the journey.`,
        );
      },
      () => {
        setStatus('error');
        setMessage('Location permission was not granted — the journey stops are shown instead.');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={locate}
        aria-label="Show my device location on the map"
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-ink-950/85 px-2.5 py-1.5 text-3xs text-mist-200 backdrop-blur transition-colors hover:border-sky-glow/50 hover:text-mist-50"
      >
        {status === 'locating' ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <LocateFixed className="size-3" aria-hidden />
        )}
        {position ? 'Location on map' : 'My location'}
      </button>

      {message ? (
        <p
          role="status"
          className="pointer-events-none absolute top-3 left-3 z-10 max-w-[58%] rounded-lg border border-white/10 bg-ink-950/85 px-2.5 py-1.5 text-3xs leading-snug text-mist-300 backdrop-blur"
        >
          {message}
        </p>
      ) : null}
    </>
  );
}

/** Compact readout of the itinerary the map is currently showing. */
function JourneyOverlay({ option }: { option: RouteOption }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-ink-950/85 px-3 py-2 backdrop-blur-sm">
      <span className="inline-flex flex-wrap items-center gap-1.5 figure text-xs font-semibold text-mist-100">
        {option.lineCodes.filter(Boolean).map((code, index) => (
          <span key={`${code}-${index}`} className="flex items-center gap-1">
            {index > 0 ? <span className="text-mist-500">›</span> : null}
            {code}
          </span>
        ))}
      </span>
      <span className="text-2xs text-mist-400">
        <span className="figure text-mist-200">{formatClock(option.departAt)}</span> →{' '}
        <span className="figure text-mist-200">{formatClock(option.arriveAt)}</span>
      </span>
      <CrowdBadge level={option.crowdRiskLevel} label={`Peak ${formatPercent(option.crowdRisk)}`} />
      <span className="hidden text-2xs text-mist-400 sm:inline">
        AI confidence <span className="figure text-mist-200">{Math.round(option.confidencePct)}%</span>
      </span>
      <span className="ml-auto hidden items-center gap-1.5 text-3xs text-mist-500 md:flex">
        <span className={cn('size-1.5 rounded-full', 'bg-pulse-400')} aria-hidden />
        Route score {option.score.toFixed(1)}
      </span>
    </div>
  );
}

/** Re-exported so the operator map can share the same payload type in props. */
export type { MapJourneyPayload };
