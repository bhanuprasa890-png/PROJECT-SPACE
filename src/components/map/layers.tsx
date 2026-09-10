import { useEffect, useRef } from 'react';
import type {
  AlertSeverity,
  CrowdLevel,
  ItineraryLeg,
  MapAlertMarker,
  MapPoint,
  MapRouteGeometry,
  MapStopNode,
  MapVehicleMarker,
  RouteOption,
} from '@shared/types';
import { crowdLevelFromRatio } from '@shared/crowd';
import { useMapApi, type MapApi } from './GoogleMapCanvas';
import { boundsFromPoints, casingOptions, pathOptions, pinIcon } from '../../lib/maps';
import { crowdTone, formatPercent } from '../../lib/utils';

/**
 * TransitPulse intelligence layers drawn on top of Google Maps.
 *
 * Each layer takes payload data (already fetched from `/api/maps/*` plus the
 * planner's own options) and paints it with `google.maps.Polyline` and
 * `google.maps.Marker`. Nothing here invents a value: crowd colours come from the
 * three shared bands, and every popup reads numbers that arrived in a payload.
 */

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

export interface InfoRow {
  label: string;
  value: string;
  tone?: CrowdLevel;
}

export interface InfoSpec {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  rows?: InfoRow[];
  footnote?: string;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Popup card built from DOM nodes — no HTML strings, nothing injected. */
function infoContent(spec: InfoSpec): HTMLElement {
  const wrap = element('div', 'tp-info');
  if (spec.eyebrow) wrap.appendChild(element('p', 'tp-info__eyebrow', spec.eyebrow));
  wrap.appendChild(element('p', 'tp-info__title', spec.title));
  if (spec.subtitle) wrap.appendChild(element('p', 'tp-info__subtitle', spec.subtitle));

  if (spec.rows?.length) {
    const list = element('dl', 'tp-info__rows');
    for (const row of spec.rows) {
      const line = element('div', 'tp-info__row');
      line.appendChild(element('dt', '', row.label));
      line.appendChild(
        element('dd', row.tone ? `tp-info__value tp-info__value--${row.tone}` : 'tp-info__value', row.value),
      );
      list.appendChild(line);
    }
    wrap.appendChild(list);
  }

  if (spec.footnote) wrap.appendChild(element('p', 'tp-info__note', spec.footnote));
  return wrap;
}

/** One reused info window per layer, so popups never stack up. */
function useInfoWindow(api: MapApi | null) {
  const windowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!api) return;
    windowRef.current = new api.google.maps.InfoWindow({ maxWidth: 290 });
    return () => {
      windowRef.current?.close();
      windowRef.current = null;
    };
  }, [api]);

  return (spec: InfoSpec, target: { anchor?: google.maps.MVCObject; position?: google.maps.LatLng | null }) => {
    const popup = windowRef.current;
    if (!popup || !api) return;
    popup.setContent(infoContent(spec));
    // A popup is either anchored to its marker or pinned to a click coordinate;
    // never pass an undefined position to the SDK.
    popup.setOptions(target.position ? { position: target.position } : {});
    popup.open(target.anchor ? { map: api.map, anchor: target.anchor } : { map: api.map });
  };
}

/** Keeps caller callbacks out of the drawing effects' dependency lists. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

const toLatLng = ([lng, lat]: MapPoint): google.maps.LatLngLiteral => ({ lat, lng });

export function trendOf(live: number | null, predicted: number): 'rising' | 'falling' | 'steady' {
  if (live === null) return 'steady';
  const delta = predicted - live;
  if (delta > 0.05) return 'rising';
  if (delta < -0.05) return 'falling';
  return 'steady';
}

export const TREND_LABEL: Record<'rising' | 'falling' | 'steady', string> = {
  rising: 'Rising — load builds ahead',
  falling: 'Falling — load eases off',
  steady: 'Steady — load holds',
};

/* -------------------------------------------------------------------------- */
/* Route corridors + stops                                                    */
/* -------------------------------------------------------------------------- */

export interface RoutePathLayerProps {
  routes: MapRouteGeometry[];
  selectedRouteId?: string | null;
  onSelect?: (routeId: string) => void;
  /** Colour corridors by predicted load instead of route colour. */
  tint?: 'route' | 'crowd';
  levelOf?: (route: MapRouteGeometry) => CrowdLevel;
  detailOf?: (route: MapRouteGeometry) => InfoSpec;
  onlyRouteIds?: string[];
  showStops?: boolean;
}

export function RoutePathLayer({
  routes,
  selectedRouteId,
  onSelect,
  tint = 'route',
  levelOf,
  detailOf,
  onlyRouteIds,
  showStops = true,
}: RoutePathLayerProps) {
  const api = useMapApi();
  const openInfo = useInfoWindow(api);
  const selectRef = useLatest(onSelect);
  const levelRef = useLatest(levelOf);
  const detailRef = useLatest(detailOf);

  useEffect(() => {
    if (!api) return;
    const { map, google } = api;
    const drawn: google.maps.Polyline[] = [];
    const markers: google.maps.Marker[] = [];

    for (const route of routes) {
      if (onlyRouteIds?.length && !onlyRouteIds.includes(route.routeId)) continue;
      if (route.path.length < 2) continue;

      const level = levelRef.current?.(route) ?? route.predictedLevel ?? 'low';
      const emphasized = route.routeId === selectedRouteId;
      const dimmed = Boolean(selectedRouteId) && !emphasized;
      const crowdTinted = tint === 'crowd';
      const path = route.path.map(toLatLng);

      drawn.push(new google.maps.Polyline({ ...casingOptions(emphasized), path, map }));

      const line = new google.maps.Polyline({
        ...pathOptions({
          level,
          color: crowdTinted ? null : route.color,
          emphasized,
          colorByCrowd: crowdTinted,
        }),
        strokeOpacity: dimmed ? 0.22 : crowdTinted ? (emphasized ? 1 : 0.72) : emphasized ? 1 : 0.62,
        path,
        map,
      });
      drawn.push(line);

      line.addListener('click', (event: google.maps.MapMouseEvent) => {
        selectRef.current?.(route.routeId);
        const spec = detailRef.current?.(route);
        if (spec) openInfo(spec, { position: event.latLng ?? null });
      });

      if (!showStops) continue;

      for (const stop of route.stops) {
        const marker = new google.maps.Marker({
          position: { lat: stop.lat, lng: stop.lng },
          map,
          icon: pinIcon({
            level: stop.liveLevel ?? level,
            glyph: 'stop',
            emphasized: emphasized && stop.interchange,
            scale: stop.interchange ? 1.15 : 0.85,
          }),
          opacity: dimmed ? 0.4 : 1,
          title: `${stop.name} · ${
            stop.liveRatio === null ? 'no live reading' : `${formatPercent(stop.liveRatio)} onboard`
          }`,
          zIndex: emphasized ? 30 : 12,
        });
        markers.push(marker);

        marker.addListener('click', () => {
          openInfo(stopSpec(route, stop), { anchor: marker });
        });
      }
    }

    return () => {
      for (const item of [...drawn, ...markers]) {
        google.maps.event.clearInstanceListeners(item);
        item.setMap(null);
      }
    };
  }, [api, routes, selectedRouteId, tint, onlyRouteIds, showStops, openInfo, levelRef, selectRef, detailRef]);

  return null;
}

/** Popup for one stop: measured load, fleet reading and the AI forecast. */
export function stopSpec(route: MapRouteGeometry, stop: MapStopNode): InfoSpec {
  const trend = trendOf(stop.liveRatio, (route.predictedPct ?? 0) / 100);
  return {
    eyebrow: `Route ${route.routeNumber} · stop ${stop.sequence}/${route.stops.length}`,
    title: stop.name,
    subtitle: stop.interchange ? 'Interchange stop' : undefined,
    rows: [
      { label: 'Measured load', value: stop.liveRatio === null ? 'No reading yet' : `${formatPercent(stop.liveRatio)} · ${crowdTone(stop.liveLevel ?? 'low').label}`, tone: stop.liveLevel ?? undefined },
      ...(stop.onboardCount !== null ? [{ label: 'Onboard now', value: `${stop.onboardCount} riders` }] : []),
      ...(route.predictedPct !== null
        ? [
            { label: 'AI forecast', value: `${route.predictedPct.toFixed(0)}% · ${crowdTone(route.predictedLevel ?? 'low').label}`, tone: route.predictedLevel ?? undefined },
            { label: 'Confidence', value: route.confidencePct === null ? '—' : `${route.confidencePct.toFixed(0)}%` },
            { label: 'Trend', value: TREND_LABEL[trend] },
          ]
        : []),
      { label: 'Boardings / day', value: stop.dailyBoardings.toLocaleString() },
    ],
    footnote: 'Simulated demo readings and model predictions — not real-world measurements.',
  };
}

/** Busiest measured load anywhere on a corridor — the number ops reacts to. */
export function routeMeasuredRatio(route: MapRouteGeometry): number | null {
  const readings = route.stops
    .map((stop) => stop.liveRatio)
    .filter((ratio): ratio is number => ratio !== null);
  return readings.length ? Math.max(...readings) : null;
}

/** Popup for a corridor: measured load, AI forecast, confidence and trend. */
export function routeSpec(route: MapRouteGeometry, vehiclesInService: number): InfoSpec {
  const measured = routeMeasuredRatio(route);
  const predicted = (route.predictedPct ?? 0) / 100;
  return {
    eyebrow: `Route ${route.routeNumber} · ${route.stops.length} stops`,
    title: route.routeName,
    subtitle: route.mode === 'metro' ? 'Metro corridor' : 'Bus corridor',
    rows: [
      {
        label: 'Measured load',
        value: measured === null ? 'No live reading yet' : `${formatPercent(measured)} at the busiest stop`,
        tone: measured === null ? undefined : crowdLevelFromRatio(measured),
      },
      ...(route.worstStopName ? [{ label: 'Busiest stop', value: route.worstStopName }] : []),
      ...(route.predictedPct !== null
        ? [
            {
              label: 'Predicted occupancy',
              value: `${route.predictedPct.toFixed(0)}% · ${crowdTone(route.predictedLevel ?? 'low').label}`,
              tone: route.predictedLevel ?? undefined,
            },
            {
              label: 'AI confidence',
              value: route.confidencePct === null ? '—' : `${route.confidencePct.toFixed(0)}%`,
            },
            { label: 'Expected trend', value: TREND_LABEL[trendOf(measured, predicted)] },
          ]
        : []),
      { label: 'Demo vehicles', value: `${vehiclesInService} on this corridor` },
    ],
    footnote: 'Measured load and forecasts are simulated demo data from the TransitPulse dataset.',
  };
}

/* -------------------------------------------------------------------------- */
/* Vehicles                                                                   */
/* -------------------------------------------------------------------------- */

export function VehicleLayer({
  vehicles,
  selectedRouteId,
  onSelect,
  onlyRouteIds,
}: {
  vehicles: MapVehicleMarker[];
  selectedRouteId?: string | null;
  onSelect?: (vehicle: MapVehicleMarker) => void;
  onlyRouteIds?: string[];
}) {
  const api = useMapApi();
  const openInfo = useInfoWindow(api);
  const selectRef = useLatest(onSelect);

  useEffect(() => {
    if (!api) return;
    const { map, google } = api;
    const markers: google.maps.Marker[] = [];

    for (const vehicle of vehicles) {
      if (onlyRouteIds?.length && !onlyRouteIds.includes(vehicle.routeId)) continue;
      const emphasized = vehicle.routeId === selectedRouteId;

      const marker = new google.maps.Marker({
        position: { lat: vehicle.lat, lng: vehicle.lng },
        map,
        icon: pinIcon({ level: vehicle.level, glyph: 'vehicle', emphasized, scale: emphasized ? 1.2 : 1 }),
        title: `${vehicle.vehicleNumber} · route ${vehicle.routeNumber} · ${formatPercent(vehicle.ratio)} loaded`,
        zIndex: emphasized ? 40 : 25,
      });
      markers.push(marker);

      marker.addListener('click', () => {
        selectRef.current?.(vehicle);
        openInfo(
          {
            eyebrow: `Vehicle ${vehicle.vehicleNumber} · SIMULATED`,
            title: `Route ${vehicle.routeNumber}`,
            subtitle: vehicle.routeName,
            rows: [
              { label: 'Occupancy', value: `${vehicle.occupancy} / ${vehicle.capacity}`, tone: vehicle.level },
              { label: 'Crowd level', value: crowdTone(vehicle.level).label, tone: vehicle.level },
              { label: 'Status', value: vehicle.status.replace('_', ' ') },
              ...(vehicle.nextStopName ? [{ label: 'Next stop', value: vehicle.nextStopName }] : []),
              ...(vehicle.predictedPct !== null
                ? [
                    { label: 'Route forecast', value: `${vehicle.predictedPct.toFixed(0)}%` },
                    { label: 'Confidence', value: vehicle.confidencePct === null ? '—' : `${vehicle.confidencePct.toFixed(0)}%` },
                  ]
                : []),
              { label: 'Snapshot', value: new Date(vehicle.updatedAt).toLocaleTimeString() },
            ],
            footnote: 'Demo fleet: the position comes from the simulated vehicle_snapshots table — no live vehicle is tracked.',
          },
          { anchor: marker },
        );
      });
    }

    return () => {
      for (const marker of markers) {
        google.maps.event.clearInstanceListeners(marker);
        marker.setMap(null);
      }
    };
  }, [api, vehicles, selectedRouteId, onlyRouteIds, openInfo, selectRef]);

  return null;
}

/* -------------------------------------------------------------------------- */
/* Service notices                                                            */
/* -------------------------------------------------------------------------- */

const SEVERITY_LEVEL: Record<AlertSeverity, CrowdLevel> = {
  critical: 'high',
  major: 'high',
  minor: 'moderate',
  info: 'low',
};

export function AlertLayer({ alerts }: { alerts: MapAlertMarker[] }) {
  const api = useMapApi();
  const openInfo = useInfoWindow(api);

  useEffect(() => {
    if (!api) return;
    const { map, google } = api;
    const markers: google.maps.Marker[] = [];

    for (const alert of alerts) {
      const marker = new google.maps.Marker({
        position: { lat: alert.lat, lng: alert.lng },
        map,
        icon: pinIcon({ level: SEVERITY_LEVEL[alert.severity] ?? 'moderate', glyph: 'alert', scale: 0.8 }),
        title: `${alert.severity.toUpperCase()} · ${alert.title}`,
        zIndex: 35,
      });
      markers.push(marker);

      marker.addListener('click', () => {
        openInfo(
          {
            eyebrow: `${alert.severity} · ${alert.status}`,
            title: alert.title,
            subtitle: alert.stopName ?? alert.routeNumber ?? undefined,
            rows: [
              { label: 'Category', value: alert.category },
              ...(alert.routeNumber ? [{ label: 'Route', value: alert.routeNumber }] : []),
              { label: 'Raised', value: new Date(alert.startsAt).toLocaleString() },
            ],
            footnote: 'Service notice stored in the TransitPulse dataset.',
          },
          { anchor: marker },
        );
      });
    }

    return () => {
      for (const marker of markers) {
        google.maps.event.clearInstanceListeners(marker);
        marker.setMap(null);
      }
    };
  }, [api, alerts, openInfo]);

  return null;
}

/* -------------------------------------------------------------------------- */
/* Journey (rider planner options)                                            */
/* -------------------------------------------------------------------------- */

interface StopIndex {
  byId: Map<string, { lat: number; lng: number; node?: MapStopNode }>;
  byName: Map<string, { lat: number; lng: number; node?: MapStopNode }>;
}

function buildStopIndex(geometry: MapRouteGeometry[]): StopIndex {
  const byId = new Map<string, { lat: number; lng: number; node?: MapStopNode }>();
  const byName = new Map<string, { lat: number; lng: number; node?: MapStopNode }>();
  for (const route of geometry) {
    for (const stop of route.stops) {
      if (stop.id) byId.set(stop.id, { lat: stop.lat, lng: stop.lng, node: stop });
      if (!byName.has(stop.name)) byName.set(stop.name, { lat: stop.lat, lng: stop.lng, node: stop });
    }
  }
  return { byId, byName };
}

function resolveStop(
  index: StopIndex,
  stopId: string | undefined,
  stopName: string | undefined,
): { lat: number; lng: number; node?: MapStopNode } | null {
  if (stopId) {
    const found = index.byId.get(stopId);
    if (found) return found;
  }
  if (stopName) return index.byName.get(stopName) ?? null;
  return null;
}

/** Ordered path of a transit leg, sliced out of the route's own geometry. */
function legPath(
  leg: ItineraryLeg,
  geometry: MapRouteGeometry[],
  index: StopIndex,
): MapPoint[] {
  const route = leg.lineId ? geometry.find((item) => item.routeId === leg.lineId) : undefined;
  if (route) {
    const fromIndex = route.stops.findIndex((stop) => stop.name === leg.fromStopName);
    const toIndex = route.stops.findIndex((stop) => stop.name === leg.toStopName);
    if (fromIndex >= 0 && toIndex >= 0) {
      const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const points = route.stops.slice(start, end + 1).map((stop) => [stop.lng, stop.lat] as MapPoint);
      return fromIndex <= toIndex ? points : points.reverse();
    }
  }

  // Walk legs (and any leg whose geometry is missing) fall back to a straight
  // line between the two stops, which the payload always knows.
  const from = resolveStop(index, leg.fromStopId, leg.fromStopName);
  const to = resolveStop(index, leg.toStopId, leg.toStopName);
  if (from && to) return [
    [from.lng, from.lat],
    [to.lng, to.lat],
  ];
  return [];
}

export interface JourneyLayerProps {
  option: RouteOption;
  geometry: MapRouteGeometry[];
  vehicles?: MapVehicleMarker[];
  /** Other options drawn faintly so the selected itinerary stands out. */
  otherOptions?: RouteOption[];
  onSelectOption?: (optionId: string) => void;
}

export function JourneyLayer({ option, geometry, vehicles = [], otherOptions = [], onSelectOption }: JourneyLayerProps) {
  const api = useMapApi();
  const openInfo = useInfoWindow(api);
  const selectRef = useLatest(onSelectOption);

  useEffect(() => {
    if (!api) return;
    const { map, google } = api;
    const drawn: google.maps.Polyline[] = [];
    const markers: google.maps.Marker[] = [];
    const index = buildStopIndex(geometry);

    // Alternatives first, so the selected itinerary paints over them.
    for (const other of otherOptions) {
      if (other.id === option.id) continue;
      for (const leg of other.legs) {
        const points = legPath(leg, geometry, index);
        if (points.length < 2) continue;
        const line = new google.maps.Polyline({
          path: points.map(toLatLng),
          map,
          strokeColor: leg.lineColor ?? '#8fa2c7',
          strokeOpacity: 0.25,
          strokeWeight: 3,
          zIndex: 3,
          geodesic: true,
        });
        line.addListener('click', () => selectRef.current?.(other.id));
        drawn.push(line);
      }
    }

    for (const leg of option.legs) {
      const points = legPath(leg, geometry, index);
      if (points.length < 2) continue;

      const isWalk = leg.kind === 'walk';
      const level = leg.crowd?.level ?? 'low';

      drawn.push(
        new google.maps.Polyline({
          ...casingOptions(true),
          path: points.map(toLatLng),
          map,
        }),
      );

      const line = new google.maps.Polyline({
        ...pathOptions({ level, color: leg.lineColor, emphasized: true, colorByCrowd: !isWalk }),
        strokeOpacity: isWalk ? 0.5 : 1,
        path: points.map(toLatLng),
        map,
      });
      drawn.push(line);

      const from = resolveStop(index, leg.fromStopId, leg.fromStopName);
      const live = from?.node?.liveRatio ?? null;
      const predicted = leg.crowd?.ratio ?? 0;
      const trend = trendOf(live, predicted);

      const spec: InfoSpec = {
        eyebrow: isWalk ? 'Walk connection' : `Route ${leg.lineCode ?? ''} · AI forecast`,
        title: `${leg.fromStopName} → ${leg.toStopName}`,
        subtitle: isWalk ? 'On foot' : leg.lineName ?? undefined,
        rows: isWalk
          ? [
              { label: 'Walk time', value: `${Math.round(leg.durationMinutes)} min` },
              { label: 'Arrive', value: new Date(leg.arriveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
            ]
          : [
              { label: 'Current occupancy', value: live === null ? 'No live reading' : formatPercent(live), tone: live === null ? undefined : crowdLevelFromRatio(live) },
              { label: 'Predicted occupancy', value: `${formatPercent(predicted)} · ${crowdTone(level).label}`, tone: level },
              { label: 'AI confidence', value: `${Math.round((leg.crowd?.confidence ?? 0) * 100)}%` },
              { label: 'Expected trend', value: TREND_LABEL[trend] },
              { label: 'Leg time', value: `${Math.round(leg.durationMinutes)} min · ${leg.stopCount} stops` },
              ...(leg.crowd?.peakStopName
                ? [{ label: 'Busiest stop', value: `${leg.crowd.peakStopName} · ${formatPercent(leg.crowd.peakRatio)}` }]
                : []),
            ],
        footnote: isWalk
          ? undefined
          : 'Crowd band from the TransitPulse crowd model over simulated data.',
      };

      line.addListener('click', (event: google.maps.MapMouseEvent) => {
        openInfo(spec, event.latLng ? { position: event.latLng } : { anchor: line });
      });

      if (isWalk) continue;

      for (const stopName of [leg.fromStopName, ...leg.stops.map((stop) => stop.name), leg.toStopName]) {
        const stop = index.byName.get(stopName);
        if (!stop) continue;
        const marker = new google.maps.Marker({
          position: { lat: stop.lat, lng: stop.lng },
          map,
          icon: pinIcon({ level: stop.node?.liveLevel ?? level, glyph: 'stop', scale: 0.8 }),
          title: `${stopName} · ${formatPercent(predicted)} predicted`,
          zIndex: 18,
        });
        markers.push(marker);

        marker.addListener('click', () => {
          openInfo(
            {
              eyebrow: `Route ${leg.lineCode ?? ''} · predicted boarding load`,
              title: stopName,
              rows: [
                { label: 'Predicted occupancy', value: `${formatPercent(predicted)} · ${crowdTone(level).label}`, tone: level },
                { label: 'Current occupancy', value: live === null ? 'No live reading' : formatPercent(live) },
                { label: 'AI confidence', value: `${Math.round((leg.crowd?.confidence ?? 0) * 100)}%` },
              ],
              footnote: 'Stops and loads come from the TransitPulse dataset.',
            },
            { anchor: marker },
          );
        });
      }
    }

    // Board / alight markers for the itinerary.
    const transitLegs = option.legs.filter((leg) => leg.kind === 'transit');
    const first = transitLegs[0];
    const last = transitLegs[transitLegs.length - 1];
    const anchors: { point: { lat: number; lng: number } | null; glyph: 'origin' | 'destination'; label: string }[] = [
      { point: resolveStop(index, first?.fromStopId, first?.fromStopName), glyph: 'origin', label: 'Board here' },
      { point: resolveStop(index, last?.toStopId, last?.toStopName), glyph: 'destination', label: 'Alight here' },
    ];

    for (const anchor of anchors) {
      if (!anchor.point) continue;
      const marker = new google.maps.Marker({
        position: { lat: anchor.point.lat, lng: anchor.point.lng },
        map,
        icon: pinIcon({ level: option.crowdRiskLevel, glyph: anchor.glyph, emphasized: true }),
        title: anchor.label,
        zIndex: 45,
      });
      markers.push(marker);

      marker.addListener('click', () => {
        openInfo(
          {
            eyebrow: anchor.label,
            title: anchor.glyph === 'origin' ? first?.fromStopName ?? '' : last?.toStopName ?? '',
            rows: [
              { label: 'Route', value: option.routeNumber },
              { label: 'Depart', value: new Date(option.departAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
              { label: 'Arrive', value: new Date(option.arriveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
              { label: 'Predicted crowd', value: `${formatPercent(option.crowdRisk)} · ${crowdTone(option.crowdRiskLevel).label}`, tone: option.crowdRiskLevel },
              { label: 'Route score', value: option.score.toFixed(1) },
            ],
            footnote: 'Simulated prediction from the TransitPulse crowd model.',
          },
          { anchor: marker },
        );
      });
    }

    // Demo vehicles on the corridors this itinerary uses.
    const usedRoutes = new Set(option.legs.map((leg) => leg.lineId).filter(Boolean) as string[]);
    for (const vehicle of vehicles) {
      if (!usedRoutes.has(vehicle.routeId)) continue;
      markers.push(
        new google.maps.Marker({
          position: { lat: vehicle.lat, lng: vehicle.lng },
          map,
          icon: pinIcon({ level: vehicle.level, glyph: 'vehicle', scale: 0.9 }),
          title: `${vehicle.vehicleNumber} · route ${vehicle.routeNumber} · ${formatPercent(vehicle.ratio)} loaded`,
          zIndex: 22,
        }),
      );
    }

    return () => {
      for (const item of [...drawn, ...markers]) {
        google.maps.event.clearInstanceListeners(item);
        item.setMap(null);
      }
    };
  }, [api, option, geometry, vehicles, otherOptions, openInfo, selectRef]);

  return null;
}

/* -------------------------------------------------------------------------- */
/* Bounds helpers                                                             */
/* -------------------------------------------------------------------------- */

export function boundsOfRoutes(routes: MapRouteGeometry[]): google.maps.LatLngBoundsLiteral | null {
  const points = routes.flatMap((route) => route.path);
  return points.length ? boundsFromPoints(points) : null;
}

/** Bounds covering one itinerary, resolved from the available geometry. */
export function boundsOfOption(
  option: RouteOption | null,
  geometry: MapRouteGeometry[],
): google.maps.LatLngBoundsLiteral | null {
  if (!option) return boundsOfRoutes(geometry);
  const index = buildStopIndex(geometry);
  const points = option.legs.flatMap((leg) => legPath(leg, geometry, index));
  if (!points.length) return boundsOfRoutes(geometry);
  return boundsFromPoints(points);
}

/** Small helper for the panels: a readable crowd label for a route. */
export function routeLevel(route: MapRouteGeometry): CrowdLevel {
  return route.predictedLevel ?? crowdLevelFromRatio((route.predictedPct ?? 0) / 100);
}
