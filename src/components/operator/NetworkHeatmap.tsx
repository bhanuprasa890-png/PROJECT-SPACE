import { useId, useMemo, useState } from 'react';
import { Layers, MapPin, Radio } from 'lucide-react';
import type { CrowdHeatmap, CrowdLevel, HeatmapSegment, HeatmapStop } from '@shared/types';
import { Segmented } from '../ui/Controls';
import { cn, crowdTone, formatPercent } from '../../lib/utils';

/**
 * Network crowd heatmap.
 *
 * A schematic operations map of the network drawn from `line_stops` + `stops`
 * coordinates, with every segment coloured by measured crowding (`live`), the
 * engine's next-horizon prediction (`predicted`) or each route's busiest hour
 * over the last 24 hours (`peak`). Values come from the command-centre payload —
 * the component only projects coordinates and paints.
 */

export type HeatmapMode = 'live' | 'predicted' | 'peak';

const MODES: { value: HeatmapMode; label: string }[] = [
  { value: 'live', label: 'Live load' },
  { value: 'predicted', label: '+30 min' },
  { value: 'peak', label: '24h peak' },
];

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 420;
const PADDING = 44;

function value(segment: HeatmapSegment, mode: HeatmapMode): { ratio: number; level: CrowdLevel } {
  if (mode === 'predicted') return { ratio: segment.predictedRatio, level: segment.predictedLevel };
  if (mode === 'peak') return { ratio: segment.peakRatio, level: segment.peakLevel };
  return { ratio: segment.ratio, level: segment.level };
}

function stopValue(stop: HeatmapStop, mode: HeatmapMode): { ratio: number; level: CrowdLevel } {
  if (mode === 'predicted') return { ratio: stop.predictedRatio, level: stop.predictedLevel };
  if (mode === 'peak') return { ratio: stop.peakRatio, level: stop.peakLevel };
  return { ratio: stop.ratio, level: stop.level };
}

function projector(bounds: CrowdHeatmap['bounds']) {
  const spanLng = bounds.maxLng - bounds.minLng || 1;
  const spanLat = bounds.maxLat - bounds.minLat || 1;
  const scale = Math.min(
    (VIEW_WIDTH - PADDING * 2) / spanLng,
    (VIEW_HEIGHT - PADDING * 2) / spanLat,
  );
  const offsetX = (VIEW_WIDTH - spanLng * scale) / 2;
  const offsetY = (VIEW_HEIGHT - spanLat * scale) / 2;

  return (lng: number, lat: number) => ({
    x: offsetX + (lng - bounds.minLng) * scale,
    // Latitude grows northwards, SVG y grows downwards.
    y: VIEW_HEIGHT - offsetY - (lat - bounds.minLat) * scale,
  });
}

export function NetworkHeatmap({
  heatmap,
  mode,
  onModeChange,
  selectedRoute,
  onSelectRoute,
  className,
}: {
  heatmap: CrowdHeatmap;
  mode: HeatmapMode;
  onModeChange: (mode: HeatmapMode) => void;
  selectedRoute: string | null;
  onSelectRoute: (routeNumber: string | null) => void;
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const gridId = useId();
  const glowId = useId();

  const project = useMemo(() => projector(heatmap.bounds), [heatmap.bounds]);

  const routes = useMemo(
    () => [...new Set(heatmap.segments.map((segment) => segment.routeNumber))].sort(),
    [heatmap.segments],
  );

  const worst = useMemo(() => {
    const ranked = [...heatmap.segments].sort(
      (a, b) => value(b, mode).ratio - value(a, mode).ratio,
    );
    return ranked[0] ?? null;
  }, [heatmap.segments, mode]);

  const hoveredStop = hovered ? heatmap.stops.find((stop) => stop.stopId === hovered) ?? null : null;
  const hoveredSegment = hovered
    ? heatmap.segments.find(
        (segment) => `${segment.lineId}-${segment.fromStopId}-${segment.toStopId}` === hovered,
      ) ?? null
    : null;
  const busiest = worst ? value(worst, mode) : null;

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/6 px-4 py-3">
        <Segmented
          value={mode}
          onChange={onModeChange}
          options={MODES}
          size="sm"
        />
        <span className="ml-auto inline-flex items-center gap-1.5 text-3xs text-mist-500">
          <Radio className="size-3 text-crowd-low" />
          {heatmap.segments.length} segments · {heatmap.stops.length} stops
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full"
          role="img"
          aria-label="Network crowding map"
        >
          {/* schematic ground grid */}
          <defs>
            <pattern id={gridId} width="38" height="38" patternUnits="userSpaceOnUse">
              <path d="M38 0H0V38" fill="none" stroke="rgba(148,163,184,0.09)" strokeWidth="1" />
            </pattern>
            <radialGradient id={glowId} cx="50%" cy="45%" r="65%">
              <stop offset="0%" stopColor="rgba(56,245,192,0.07)" />
              <stop offset="100%" stopColor="rgba(2,6,23,0)" />
            </radialGradient>
          </defs>
          <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#${gridId})`} />
          <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#${glowId})`} />

          {/* route segments */}
          {heatmap.segments.map((segment) => {
            const start = project(segment.fromLng, segment.fromLat);
            const end = project(segment.toLng, segment.toLat);
            const load = value(segment, mode);
            const tone = crowdTone(load.level);
            const dimmed = selectedRoute !== null && segment.routeNumber !== selectedRoute;
            const key = `${segment.lineId}-${segment.fromStopId}-${segment.toStopId}`;
            const isHovered = hovered === key;

            return (
              <g key={key}>
                <title>
                  {`Route ${segment.routeNumber} · ${segment.fromName} → ${segment.toName} · ${formatPercent(load.ratio)} ${crowdTone(load.level).label.toLowerCase()}`}
                </title>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={tone.stroke}
                  strokeOpacity={dimmed ? 0.18 : 0.92}
                  strokeWidth={isHovered ? 7 : 4.5}
                  strokeLinecap="round"
                  style={{ filter: dimmed ? undefined : `drop-shadow(0 0 6px ${tone.stroke}66)` }}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered((current) => (current === key ? null : current))}
                />
                {/* direction arrow */}
                <circle
                  cx={(start.x + end.x) / 2}
                  cy={(start.y + end.y) / 2}
                  r={2.4}
                  fill={dimmed ? 'rgba(148,163,184,0.4)' : tone.stroke}
                />
              </g>
            );
          })}

          {/* stops */}
          {heatmap.stops.map((stop) => {
            const point = project(stop.longitude, stop.latitude);
            const load = stopValue(stop, mode);
            const tone = crowdTone(load.level);
            const dimmed =
              selectedRoute !== null && !stop.routes.includes(selectedRoute);
            const radius = stop.interchange ? 7 : 4.5 + Math.min(2.5, stop.boardings / 9000);
            const isHovered = hovered === stop.stopId;

            return (
              <g
                key={stop.stopId}
                onMouseEnter={() => setHovered(stop.stopId)}
                onMouseLeave={() => setHovered((current) => (current === stop.stopId ? null : current))}
                style={{ cursor: 'pointer' }}
              >
                {stop.interchange ? (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={radius + 5}
                    fill="none"
                    stroke="rgba(148,163,184,0.35)"
                    strokeDasharray="2 3"
                  />
                ) : null}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isHovered ? radius + 2 : radius}
                  className="fill-ink-950"
                  stroke={dimmed ? 'rgba(148,163,184,0.4)' : tone.stroke}
                  strokeWidth={isHovered ? 3.5 : 2.5}
                  style={{ filter: dimmed ? undefined : `drop-shadow(0 0 8px ${tone.stroke}88)` }}
                />
                <circle cx={point.x} cy={point.y} r={2} fill={tone.stroke} fillOpacity={dimmed ? 0.3 : 1} />
                {stop.interchange || isHovered ? (
                  <text
                    x={point.x + radius + 5}
                    y={point.y + 3.5}
                    className="figure fill-mist-300"
                    style={{ fontSize: 10, opacity: dimmed ? 0.35 : 0.95 }}
                  >
                    {stop.name}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        <ol className="sr-only">
          {[...heatmap.segments]
            .sort((a, b) => value(b, mode).ratio - value(a, mode).ratio)
            .slice(0, 6)
            .map((segment) => (
              <li key={`sr-${segment.lineId}-${segment.fromStopId}-${segment.toStopId}`}>
                Route {segment.routeNumber}, {segment.fromName} to {segment.toName}:{' '}
                {formatPercent(value(segment, mode).ratio)}
              </li>
            ))}
        </ol>

        {/* worst segment read-out — swaps to the hovered corridor */}
        {worst && busiest ? (
          <div className="pointer-events-none absolute top-3 left-3 max-w-[16rem] rounded-xl border border-white/10 bg-ink-950/85 px-3 py-2 backdrop-blur">
            <p className="eyebrow flex items-center gap-1.5 text-mist-500">
              <MapPin className="size-3" aria-hidden />
              {hoveredSegment
                ? 'Hovered corridor'
                : mode === 'peak'
                  ? 'Busiest corridor today'
                  : 'Busiest corridor now'}
            </p>
            <p className="mt-1.5 truncate text-xs font-medium text-mist-100">
              {(hoveredSegment ?? worst).routeNumber} · {(hoveredSegment ?? worst).fromName} →{' '}
              {(hoveredSegment ?? worst).toName}
            </p>
            <p
              className={cn(
                'figure mt-0.5 text-2xs',
                crowdTone((hoveredSegment ? value(hoveredSegment, mode) : busiest).level).text,
              )}
            >
              {formatPercent((hoveredSegment ? value(hoveredSegment, mode) : busiest).ratio)} ·{' '}
              {crowdTone((hoveredSegment ? value(hoveredSegment, mode) : busiest).level).label}
            </p>
          </div>
        ) : null}

        {/* hovered stop read-out */}
        {hoveredStop ? (
          <div className="pointer-events-none absolute right-3 bottom-3 max-w-[240px] rounded-xl border border-white/10 bg-ink-950/85 px-3 py-2 backdrop-blur">
            <p className="text-xs font-medium text-mist-100">{hoveredStop.name}</p>
            <p className="mt-0.5 text-3xs text-mist-500">
              {hoveredStop.interchange ? 'Interchange · ' : ''}
              {hoveredStop.routes.join(' · ')} · {hoveredStop.boardings.toLocaleString()} daily boardings
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className={cn('size-2 rounded-full', crowdTone(stopValue(hoveredStop, mode).level).dot)}
              />
              <span className="figure text-2xs text-mist-200">
                {formatPercent(stopValue(hoveredStop, mode).ratio)} now
              </span>
              <span className="figure text-2xs text-mist-400">
                {formatPercent(hoveredStop.peakRatio)} peak
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* legend + route filter */}
      <div className="space-y-2.5 border-t border-white/6 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {heatmap.legend.map((entry) => {
            const tone = crowdTone(entry.level);
            return (
              <span key={entry.level} className="inline-flex items-center gap-1.5 text-3xs text-mist-400">
                <span className={cn('size-2 rounded-full', tone.dot)} />
                <span className={cn('font-medium', tone.text)}>{entry.label}</span>
                <span className="figure text-mist-500">{entry.range}</span>
              </span>
            );
          })}
          <span className="ml-auto inline-flex items-center gap-1.5 text-3xs text-mist-500">
            <Layers className="size-3" />
            coloured by {MODES.find((item) => item.value === mode)?.label.toLowerCase()}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSelectRoute(null)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-3xs font-medium transition-colors',
              selectedRoute === null
                ? 'border-pulse-400/40 bg-pulse-400/12 text-pulse-200'
                : 'border-white/10 text-mist-400 hover:text-mist-200',
            )}
          >
            All routes
          </button>
          {routes.map((route) => {
            const routeSegment = heatmap.segments.find((segment) => segment.routeNumber === route);
            const load = routeSegment ? value(routeSegment, mode) : null;
            const active = selectedRoute === route;
            return (
              <button
                key={route}
                type="button"
                onClick={() => onSelectRoute(active ? null : route)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-3xs transition-colors',
                  active
                    ? 'border-white/25 bg-white/10 text-mist-100'
                    : 'border-white/10 text-mist-400 hover:text-mist-200',
                )}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    backgroundColor: routeSegment?.color ?? 'var(--color-mist-400)',
                    boxShadow: `0 0 6px ${routeSegment?.color ?? '#94a3b8'}`,
                  }}
                />
                {route}
                {load ? (
                  <span className={cn('figure', crowdTone(load.level).text)}>
                    {formatPercent(load.ratio)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
