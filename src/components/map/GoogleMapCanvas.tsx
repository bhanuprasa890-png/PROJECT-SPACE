import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Loader2, MapPin, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/Button';
import { MAP_STYLE, fitBounds } from '../../lib/maps';
import { useGoogleMaps } from '../../hooks/useGoogleMaps';
import { cn } from '../../lib/utils';

/**
 * Thin, honest wrapper around the real `google.maps.Map`.
 *
 * It owns the canvas, the dark base style, bounds fitting and lifecycle; every
 * data overlay is a sibling component that reads the map through `useMapApi()`.
 * When no browser key is configured it renders the caller's fallback (a labelled
 * schematic), never a look-alike of Google's tiles.
 */

export interface MapApi {
  map: google.maps.Map;
  google: typeof google;
}

const MapContext = createContext<MapApi | null>(null);

export function useMapApi(): MapApi | null {
  return useContext(MapContext);
}

export interface GoogleMapCanvasProps {
  children?: ReactNode;
  className?: string;
  /** Bounds to fit when set (payload bounds or the selected route's extent). */
  bounds?: google.maps.LatLngBoundsLiteral | null;
  center?: google.maps.LatLngLiteral;
  zoom?: number;
  padding?: number;
  /** Rendered instead of the map when no key is configured or loading failed. */
  fallback: (state: { status: 'no-key' | 'error'; error: string | null; retry: () => void }) => ReactNode;
  /** Interactive controls are on by default; the mini dashboards turn them off. */
  interactive?: boolean;
}

export function GoogleMapCanvas({
  children,
  className,
  bounds,
  center = { lat: 13.0827, lng: 80.2707 },
  zoom = 11,
  padding = 48,
  fallback,
  interactive = true,
}: GoogleMapCanvasProps) {
  const { status, error, retry } = useGoogleMaps();
  const container = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<MapApi | null>(null);

  useEffect(() => {
    if (status !== 'ready' || !container.current) return;
    const googleApi = window.google;
    if (!googleApi?.maps) return;

    const map = new googleApi.maps.Map(container.current, {
      center,
      zoom,
      styles: MAP_STYLE,
      disableDefaultUI: !interactive,
      zoomControl: interactive,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: interactive,
      clickableIcons: false,
      gestureHandling: 'greedy',
      backgroundColor: '#070a13',
      // TransitPulse keeps Google's own transit layer off: the intelligence
      // layer below draws our (simulated) network instead.
      scaleControl: false,
      keyboardShortcuts: interactive,
    });

    setApi({ map, google: googleApi });

    const observer = new ResizeObserver(() => googleApi.maps.event.trigger(map, 'resize'));
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      googleApi.maps.event.clearInstanceListeners(map);
      setApi(null);
    };
    // Recreating on status change is what makes the retry path work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, interactive]);

  // Fit whenever the caller's bounds change (new route option, new selection).
  useLayoutEffect(() => {
    if (!api || !bounds) return;
    fitBounds(api.map, bounds, padding);
  }, [api, bounds, padding]);

  if (status === 'no-key' || status === 'error') {
    return (
      <div className={cn('relative h-full w-full', className)}>
        {fallback({ status: status === 'error' ? 'error' : 'no-key', error, retry })}
      </div>
    );
  }

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      <div ref={container} className="absolute inset-0" role="application" aria-label="Transit network map" />

      {status === 'loading' || !api ? (
        <div className="absolute inset-0 grid place-items-center bg-ink-950/80">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="size-5 animate-spin text-pulse-400" aria-hidden />
            <div>
              <p className="text-sm font-medium text-mist-200">Loading Google Maps…</p>
              <p className="mt-0.5 text-2xs text-mist-500">
                Base map from Google, crowd layer from the TransitPulse model
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {api ? <MapContext.Provider value={api}>{children}</MapContext.Provider> : null}
    </div>
  );
}

/** Shared empty/again state for the map panel when the SDK is unavailable. */
export function MapUnavailable({ error, retry }: { error: string | null; retry: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-start justify-center gap-3 px-5 py-6">
      <div className="flex items-center gap-2 text-crowd-moderate">
        <ShieldAlert className="size-4" aria-hidden />
        <p className="font-display text-sm font-semibold">Google Maps could not load</p>
      </div>
      <p className="max-w-prose text-xs leading-relaxed text-mist-300">{error}</p>
      <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={retry}>
        Try again
      </Button>
      <p className="flex items-center gap-1.5 text-2xs text-mist-500">
        <MapPin className="size-3" aria-hidden /> The TransitPulse schematic below still shows the live network.
      </p>
    </div>
  );
}
