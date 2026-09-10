import type { CrowdLevel, MapBounds, MapPoint } from '@shared/types';

/**
 * Google Maps Platform glue
 * =========================
 *
 * The **Maps JavaScript API** is the real thing: a browser-side SDK loaded from
 * `maps.googleapis.com` with an HTTP-referrer restricted key. This module loads
 * it, styles it, and provides the drawing helpers the TransitPulse intelligence
 * layer uses on top of it.
 *
 * Key handling, in order of preference:
 *   1. `VITE_GOOGLE_MAPS_API_KEY` — a build-time browser key (referrer restricted).
 *   2. `browserKey` from `GET /api/maps/config` — the same key served by the API
 *      when it is configured server-side as `GOOGLE_MAPS_BROWSER_KEY`.
 * Nothing else is accepted: the server key used for Directions lives only in the
 * API process, and no key is ever written into this repository.
 */

const CALLBACK = '__transitpulseMapsReady';
const SCRIPT_ID = 'transitpulse-google-maps';

export const BUILD_BROWSER_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || null;

export type MapsStatus = 'no-key' | 'loading' | 'ready' | 'error';

export interface MapsLoadState {
  status: MapsStatus;
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/* Crowd palette — the TransitPulse bands, drawn over Google's geography       */
/* -------------------------------------------------------------------------- */

export interface CrowdPalette {
  stroke: string;
  soft: string;
  label: string;
  short: string;
}

export const CROWD_PALETTE: Record<CrowdLevel, CrowdPalette> = {
  low: { stroke: '#34d399', soft: 'rgba(52,211,153,0.22)', label: 'Low crowd', short: 'LOW' },
  moderate: { stroke: '#fbbf24', soft: 'rgba(251,191,36,0.22)', label: 'Moderate crowd', short: 'MOD' },
  high: { stroke: '#fb7185', soft: 'rgba(251,113,133,0.24)', label: 'High crowd', short: 'HIGH' },
};

export function paletteFor(level: CrowdLevel | null | undefined): CrowdPalette {
  return CROWD_PALETTE[(level ?? 'low') as CrowdLevel] ?? CROWD_PALETTE.low;
}

/**
 * Dark base style. Google's own dark scheme is used deliberately — the base map
 * still reads as Google Maps, with TransitPulse colour reserved for the data
 * layer drawn on top of it.
 */
export const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8fa2c7' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1220' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1c2740' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#a9b8d6' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#101c26' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1b2537' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7d8dae' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#212d43' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2a3855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#141d2e' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#151f33' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#b9c6e0' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#05101d' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4b6b8f' }] },
];

/* -------------------------------------------------------------------------- */
/* Marker + path helpers                                                       */
/* -------------------------------------------------------------------------- */

export type MarkerGlyph = 'stop' | 'vehicle' | 'alert' | 'origin' | 'destination';

/**
 * Crowd-coloured marker symbol. Every path is centred on (0, 0) so the symbol
 * sits exactly on its coordinate.
 */
export function pinIcon(options: {
  level: CrowdLevel;
  emphasized?: boolean;
  glyph?: MarkerGlyph;
  scale?: number;
}): google.maps.Symbol {
  const palette = paletteFor(options.level);
  const glyph = options.glyph ?? 'vehicle';
  const base = glyph === 'stop' ? 7 : glyph === 'alert' ? 12 : 9;
  const scale = base * (options.emphasized ? 1.3 : 1) * (options.scale ?? 1);
  const path =
    glyph === 'stop'
      ? 'M 0,-11 A 11,11 0 1,0 0.01,-11 Z'
      : glyph === 'alert'
        ? 'M 0,-12 12,9 -12,9 Z'
        : glyph === 'origin' || glyph === 'destination'
          ? 'M 0,-12 11,0 0,12 -11,0 Z'
          : 'M 0,-13 9,-5 9,7 -9,7 -9,-5 Z';

  return {
    path,
    fillColor: palette.stroke,
    fillOpacity: glyph === 'stop' ? 0.85 : 1,
    strokeColor: '#04060c',
    strokeWeight: options.emphasized ? 2.2 : 1.5,
    scale,
  };
}

/** TransitPulse colour for a route or leg path. */
export function pathOptions(options: {
  level: CrowdLevel;
  color?: string | null;
  emphasized: boolean;
  colorByCrowd?: boolean;
}): google.maps.PolylineOptions {
  const palette = paletteFor(options.level);
  const stroke = options.colorByCrowd || !options.color ? palette.stroke : options.color;
  return {
    strokeColor: stroke,
    strokeOpacity: options.emphasized ? 1 : 0.55,
    strokeWeight: options.emphasized ? 7 : 3.5,
    zIndex: options.emphasized ? 20 : 5,
    geodesic: true,
  };
}

/** Translucent casing drawn under a path so it survives a busy basemap. */
export function casingOptions(emphasized: boolean): google.maps.PolylineOptions {
  return {
    strokeColor: '#04060c',
    strokeOpacity: emphasized ? 0.55 : 0.28,
    strokeWeight: emphasized ? 11 : 6,
    zIndex: emphasized ? 19 : 4,
    geodesic: true,
  };
}

export function boundsFromPoints(points: MapPoint[]): google.maps.LatLngBoundsLiteral | null {
  if (!points.length) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const [lng, lat] of points) {
    north = Math.max(north, lat);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    west = Math.min(west, lng);
  }
  return { north, south, east, west };
}

export function boundsFromPayload(bounds: MapBounds | null): google.maps.LatLngBoundsLiteral | null {
  if (!bounds) return null;
  return { north: bounds.north, south: bounds.south, east: bounds.east, west: bounds.west };
}

export function toLatLng(point: MapPoint): google.maps.LatLngLiteral {
  return { lat: point[1], lng: point[0] };
}

export function fitBounds(
  map: google.maps.Map,
  bounds: google.maps.LatLngBoundsLiteral | null,
  padding = 48,
): void {
  if (!bounds) return;
  map.fitBounds(bounds, padding);
}

/* -------------------------------------------------------------------------- */
/* SDK loader                                                                  */
/* -------------------------------------------------------------------------- */

let loadPromise: Promise<typeof google> | null = null;
let currentState: MapsLoadState = { status: 'no-key', error: null };
const listeners = new Set<(state: MapsLoadState) => void>();

function emit(state: MapsLoadState): void {
  currentState = state;
  for (const listener of listeners) listener(state);
}

export function mapLoadState(): MapsLoadState {
  return currentState;
}

export function subscribeMapsLoadState(listener: (state: MapsLoadState) => void): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Google reports a rejected key through `gm_authFailure` rather than a rejected
 * promise, so the loader surfaces that as a real error instead of spinning.
 */
function installAuthFailureHook(): void {
  if (typeof window === 'undefined') return;
  const target = window as unknown as { [CALLBACK]?: () => void; gm_authFailure?: () => void };
  target.gm_authFailure = () =>
    emit({
      status: 'error',
      error:
        'Google Maps rejected the API key. Check that the Maps JavaScript API is enabled and that the key allows this origin.',
    });
}

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (loadPromise) return loadPromise;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser.'));
  }

  // Already on the page — another bundle, a cached script tag or a hot reload
  // beat us to it. Reuse it instead of loading the API twice.
  const preloaded = (window as unknown as { google?: typeof google }).google;
  if (preloaded?.maps) {
    emit({ status: 'ready', error: null });
    loadPromise = Promise.resolve(preloaded);
    return loadPromise;
  }

  emit({ status: 'loading', error: null });
  installAuthFailureHook();

  loadPromise = new Promise<typeof google>((resolve, reject) => {
    const target = window as unknown as { [CALLBACK]?: () => void; google?: typeof google };
    target[CALLBACK] = () => {
      if (!target.google?.maps) {
        emit({ status: 'error', error: 'Google Maps loaded without the maps namespace.' });
        reject(new Error('Google Maps namespace missing.'));
        return;
      }
      emit({ status: 'ready', error: null });
      resolve(target.google);
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=geometry&loading=async&callback=${CALLBACK}`;
    script.addEventListener('error', () => {
      emit({
        status: 'error',
        error:
          'The Google Maps script could not be loaded. Check the network connection and the key restrictions.',
      });
      reject(new Error('Google Maps script failed to load.'));
    });

    if (!existing) document.head.appendChild(script);

    window.setTimeout(() => {
      if (mapLoadState().status === 'loading') {
        emit({
          status: 'error',
          error: 'Google Maps did not finish loading in time. Retry, or check the key restrictions.',
        });
        reject(new Error('Google Maps load timed out.'));
      }
    }, 12_000);
  }).catch((error: Error) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}

/** Reset after a failure so a retry can try again. */
export function resetGoogleMapsLoader(): void {
  const script = typeof document === 'undefined' ? null : document.getElementById(SCRIPT_ID);
  script?.remove();
  loadPromise = null;
  emit({ status: 'loading', error: null });
  installAuthFailureHook();
}

export function markNoKey(): void {
  emit({ status: 'no-key', error: null });
}
