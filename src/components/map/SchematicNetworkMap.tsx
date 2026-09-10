import { useId, useMemo } from 'react';
import { KeyRound, MapPin } from 'lucide-react';
import type { CrowdLevel, MapRouteGeometry, MapVehicleMarker } from '@shared/types';
import { cn, formatPercent } from '../../lib/utils';

/**
 * Labelled fallback for the map surface when no Google Maps browser key is
 * configured, or when the SDK fails to load.
 *
 * This is deliberately **not** a Google Maps look-alike: it is a schematic of the
 * real Postgres geometry (same coordinates, same crowd colours) drawn as SVG, with
 * a caption that says exactly what it is and how to switch the real base map on.
 */

export interface SchematicNetworkMapProps {
  routes: MapRouteGeometry[];
  vehicles?: MapVehicleMarker[];
  selectedRouteId?: string | null;
  onSelect?: (routeId: string) => void;
  levelOf?: (route: MapRouteGeometry) => CrowdLevel;
  heightClass?: string;
  className?: string;
}

const WIDTH = 720;
const HEIGHT = 420;
const PAD = 34;

export function SchematicNetworkMap({
  routes,
  vehicles = [],
  selectedRouteId,
  onSelect,
  levelOf,
  heightClass = 'h-[320px] sm:h-[380px] lg:h-[460px]',
  className,
}: SchematicNetworkMapProps) {
  const gradientId = useId();

  const projection = useMemo(() => {
    const points = [
      ...routes.flatMap((route) => route.path),
      ...vehicles.map((vehicle) => [vehicle.lng, vehicle.lat] as [number, number]),
    ];
    if (!points.length) return null;

    const lngs = points.map(([lng]) => lng);
    const lats = points.map(([, lat]) => lat);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const spanLng = maxLng - minLng || 1;
    const spanLat = maxLat - minLat || 1;

    return ([lng, lat]: [number, number]): [number, number] => [
      PAD + ((lng - minLng) / spanLng) * (WIDTH - PAD * 2),
      HEIGHT - PAD - ((lat - minLat) / spanLat) * (HEIGHT - PAD * 2),
    ];
  }, [routes, vehicles]);

  if (!projection || !routes.length) {
    return (
      <div className={cn('grid h-full w-full place-items-center bg-ink-950/60', heightClass, className)}>
        <p className="text-xs text-mist-500">No network geometry available yet.</p>
      </div>
    );
  }

  const stops = routes
    .filter((route) => !selectedRouteId || route.routeId === selectedRouteId)
    .flatMap((route) => route.stops.map((stop) => ({ stop, route })));

  return (
    <div className={cn('relative h-full w-full bg-ink-950/70', heightClass, className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-full w-full"
        role="img"
        aria-label={`Schematic of the transit network: ${routes.length} routes, ${stops.length} stops`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="rgba(56,245,192,0.10)" />
            <stop offset="100%" stopColor="rgba(7,10,19,0)" />
          </radialGradient>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill={`url(#${gradientId})`} />

        {/* geographic grid so the schematic still reads as a map */}
        {[0.25, 0.5, 0.75].map((fraction) => (
          <g key={fraction} className="stroke-white/6">
            <line x1={PAD} x2={WIDTH - PAD} y1={PAD + fraction * (HEIGHT - PAD * 2)} y2={PAD + fraction * (HEIGHT - PAD * 2)} strokeDasharray="3 6" />
            <line x1={PAD + fraction * (WIDTH - PAD * 2)} x2={PAD + fraction * (WIDTH - PAD * 2)} y1={PAD} y2={HEIGHT - PAD} strokeDasharray="3 6" />
          </g>
        ))}

        {routes.map((route) => {
          const path = route.path.map((point) => projection(point));
          const d = path.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
          const emphasized = route.routeId === selectedRouteId;
          const dimmed = Boolean(selectedRouteId) && !emphasized;
          const level = levelOf?.(route) ?? 'low';
          const stroke =
            level === 'high'
              ? 'var(--color-crowd-high)'
              : level === 'moderate'
                ? 'var(--color-crowd-moderate)'
                : route.color;

          return (
            <g key={route.routeId}>
              <path d={d} fill="none" stroke="#04060c" strokeOpacity={emphasized ? 0.6 : 0.3} strokeWidth={emphasized ? 9 : 5} strokeLinecap="round" />
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeOpacity={dimmed ? 0.3 : emphasized ? 1 : 0.72}
                strokeWidth={emphasized ? 4 : 2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="cursor-pointer transition-[stroke-width] duration-200"
                onClick={() => onSelect?.(route.routeId)}
              >
                <title>{`${route.routeNumber} · ${route.routeName}`}</title>
              </path>
            </g>
          );
        })}

        {stops.map(({ stop, route }) => {
          const [x, y] = projection([stop.lng, stop.lat]);
          const level = stop.liveLevel ?? levelOf?.(route) ?? 'low';
          const fill =
            level === 'high'
              ? 'var(--color-crowd-high)'
              : level === 'moderate'
                ? 'var(--color-crowd-moderate)'
                : 'var(--color-crowd-low)';
          return (
            <g
              key={`${route.routeId}-${stop.id ?? stop.name}`}
              className="cursor-pointer"
              onClick={() => onSelect?.(route.routeId)}
            >
              <circle cx={x} cy={y} r={stop.interchange ? 5 : 3.4} fill={fill} fillOpacity={0.92} stroke="#04060c" strokeWidth={1.4} />
              {stop.interchange ? <circle cx={x} cy={y} r={9} fill="none" stroke={fill} strokeOpacity={0.35} strokeWidth={1} /> : null}
              <title>{`${stop.name}${stop.liveRatio === null ? '' : ` · ${formatPercent(stop.liveRatio)} onboard`}`}</title>
            </g>
          );
        })}

        {vehicles.map((vehicle) => {
          const [x, y] = projection([vehicle.lng, vehicle.lat]);
          const fill =
            vehicle.level === 'high'
              ? 'var(--color-crowd-high)'
              : vehicle.level === 'moderate'
                ? 'var(--color-crowd-moderate)'
                : 'var(--color-crowd-low)';
          return (
            <g key={vehicle.id}>
              <rect x={x - 4} y={y - 4} width={8} height={8} rx={1.6} fill={fill} transform={`rotate(45 ${x} ${y})`} stroke="#04060c" strokeWidth={1.2} />
              <title>{`${vehicle.vehicleNumber} · route ${vehicle.routeNumber} · ${vehicle.occupancy}/${vehicle.capacity}`}</title>
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 bg-ink-950/80 px-3 py-2 backdrop-blur">
        <span className="inline-flex items-center gap-1.5 text-2xs text-mist-300">
          <MapPin className="size-3 text-mist-400" aria-hidden />
          Schematic view · real dataset geometry, no basemap
        </span>
        <span className="inline-flex items-center gap-1.5 text-3xs text-mist-500">
          <KeyRound className="size-3" aria-hidden />
          Set <code className="figure text-mist-400">GOOGLE_MAPS_BROWSER_KEY</code> to load Google Maps
        </span>
      </div>
    </div>
  );
}

export function SchematicUnavailableNotice({ retry }: { retry: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-start justify-center gap-3 px-6">
      <p className="font-display text-sm font-semibold text-crowd-moderate">
        Google Maps could not load — showing the schematic instead
      </p>
      <p className="max-w-prose text-xs leading-relaxed text-mist-400">
        The map layer reads the same Postgres geometry either way, so crowd bands, stops and vehicle markers below
        stay accurate.
      </p>
      <button
        type="button"
        onClick={retry}
        className="rounded-lg border border-white/15 px-3 py-1.5 text-2xs text-mist-200 transition-colors hover:border-pulse-400/50 hover:text-mist-50"
      >
        Try Google Maps again
      </button>
    </div>
  );
}
