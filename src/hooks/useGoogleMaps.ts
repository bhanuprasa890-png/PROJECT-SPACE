import { useCallback, useEffect, useState } from 'react';
import {
  BUILD_BROWSER_KEY,
  loadGoogleMaps,
  mapLoadState,
  markNoKey,
  resetGoogleMapsLoader,
  subscribeMapsLoadState,
  type MapsLoadState,
} from '../lib/maps';
import { useMapsConfig } from './useTransitData';

/**
 * Loads the real Google Maps JavaScript API once per page.
 *
 * The key is the referrer-restricted *browser* key: either the build-time
 * `VITE_GOOGLE_MAPS_API_KEY` or the value the API publishes from
 * `GOOGLE_MAPS_BROWSER_KEY`. When neither exists the loader reports `no-key` and
 * the caller renders the labelled schematic instead — never a fake Google map.
 */
export function useGoogleMaps() {
  const config = useMapsConfig();
  const [state, setState] = useState<MapsLoadState>(mapLoadState);

  useEffect(() => subscribeMapsLoadState(setState), []);

  const serverKey = config.data?.browserKey ?? null;
  const apiKey = BUILD_BROWSER_KEY ?? serverKey;
  const keySource: 'build-env' | 'server-env' | 'none' = BUILD_BROWSER_KEY
    ? 'build-env'
    : serverKey
      ? 'server-env'
      : 'none';

  const resolved = config.isSuccess || config.isError;

  useEffect(() => {
    if (!resolved) return;
    if (!apiKey) {
      markNoKey();
      return;
    }
    void loadGoogleMaps(apiKey).catch(() => {
      /* surfaced through the load state */
    });
  }, [apiKey, resolved]);

  const retry = useCallback(() => {
    resetGoogleMapsLoader();
    if (apiKey) {
      void loadGoogleMaps(apiKey).catch(() => {
        /* surfaced through the load state */
      });
    }
  }, [apiKey]);

  return {
    apiKey,
    keySource,
    /** `loading` until the config is known, then the SDK's own state. */
    status: resolved ? state.status : ('loading' as const),
    error: state.error,
    config: config.data,
    retry,
  };
}
