import { QueryClient } from '@tanstack/react-query';

/**
 * Shared React Query client. Live crowding data is refreshed on an interval so
 * the dashboards feel alive during a demo, while reference data stays cached.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
  config: ['operator', 'config'] as const,
  datasetTables: ['dataset', 'tables'] as const,
  datasetRows: (table: string, params: Record<string, unknown>) =>
    ['dataset', 'rows', table, params] as const,
};
