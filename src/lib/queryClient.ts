import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Shared React Query client.
 *
 * Live crowding data is refreshed on an interval so the dashboards feel alive
 * during a demo, while reference data stays cached.
 *
 * Recovery policy (important — this is what keeps a dashboard from dying when the
 * API restarts, which happens on every `tsx watch` reload and whenever the
 * embedded database is busy):
 *
 *   · `retry` rides out a short outage — four attempts with backoff (0.4s, 0.8s,
 *     1.6s, 3.2s) cover a six-second API restart without ever showing an error.
 *   · Only transient failures are retried. A 4xx means the request itself is
 *     wrong, so retrying it would just hide the bug.
 *   · `refetchOnWindowFocus` and `refetchOnReconnect` re-fetch stale queries the
 *     moment the rider or operator comes back to the tab. React Query pauses
 *     interval polling in background tabs, so without this a page that failed
 *     while it was hidden would stay failed until a manual reload.
 */

/** Transient = worth another attempt: network drop, timeout, 5xx, 429. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK_ERROR' || error.status === 0) return true;
    if (error.status >= 500) return true;
    if (error.status === 429) return true;
    return false;
  }
  // Unknown errors (a thrown fetch failure, a timeout) are treated as transient.
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => isTransientError(error) && failureCount < 4,
      retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 4_000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Keep polling while the tab is hidden for the queries that ask for it:
      // an operator watching the wall display should not come back to stale data.
      refetchIntervalInBackground: true,
    },
  },
});

/**
 * Retry everything that is currently failing, plus the shared reference data.
 * Used by the "Retry" affordances and by the reconnect banner.
 */
export async function retryFailedQueries(): Promise<void> {
  // Invalidating marks every stale query dirty; React Query then refetches the
  // active ones immediately, which includes everything the current screen shows.
  await queryClient.invalidateQueries({
    predicate: (query) => query.state.status === 'error' || query.isStale(),
    refetchType: 'all',
  });
}

export const queryKeys = {
  health: ['health'] as const,
  network: ['network'] as const,
  dashboard: (profileId?: string) => ['dashboard', profileId ?? 'default'] as const,
  live: (limit?: number) => ['crowd', 'live', limit ?? 'default'] as const,
  plan: (params: Record<string, unknown>) => ['plan', params] as const,
  forecast: (lineId: string, stopId: string, horizon: number) =>
    ['forecast', lineId, stopId, horizon] as const,
  journeyContext: (lineId: string, stopId: string) => ['journey-context', lineId, stopId] as const,
  alerts: (filters: Record<string, unknown>) => ['alerts', filters] as const,
  operator: (windowHours: number) => ['operator', windowHours] as const,
  profile: (profileId?: string) => ['profile', profileId ?? 'default'] as const,
  settingsOptions: ['settings', 'options'] as const,
  watchlist: (profileId?: string) => ['watchlist', profileId ?? 'default'] as const,
  lineLoad: (dayType: string) => ['operator', 'line-load', dayType] as const,
  commandCenter: ['operator', 'command-center'] as const,
  aiDecision: (lineIdOrCode: string) => ['operator', 'ai-decision', lineIdOrCode] as const,
  config: ['operator', 'config'] as const,
  predictionEngine: ['prediction', 'engine'] as const,
  predictionRoutes: ['prediction', 'routes'] as const,
  prediction: (params: Record<string, unknown>) => ['prediction', params] as const,
  predictionWeather: ['prediction', 'weather'] as const,
  mapsConfig: ['maps', 'config'] as const,
  mapsNetwork: ['maps', 'network'] as const,
  mapsJourney: (params: Record<string, unknown>) => ['maps', 'journey', params] as const,
  directions: (params: Record<string, unknown>) => ['maps', 'directions', params] as const,
  datasetTables: ['dataset', 'tables'] as const,
  datasetRows: (table: string, params: Record<string, unknown>) =>
    ['dataset', 'rows', table, params] as const,
};
