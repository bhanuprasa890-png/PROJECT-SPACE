import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryClient';
import type {
  AlertStatus,
  CreateAlertInput,
  RiderProfile,
  WatchlistItem,
} from '@shared/types';

/**
 * Data-access hooks. Screens consume these; only this file knows about the API
 * client, and only the API server knows about Postgres.
 */

const DEMO_PROFILE_KEY = 'transitpulse.profileId';

export function getActiveProfileId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem(DEMO_PROFILE_KEY) ?? undefined;
}

export function setActiveProfileId(profileId: string): void {
  window.localStorage.setItem(DEMO_PROFILE_KEY, profileId);
}

/* -------------------------------------------------------------------------- */
/* Canonical demo dataset (Data Explorer)                                     */
/* -------------------------------------------------------------------------- */

export function useDatasetTables() {
  return useQuery({
    queryKey: queryKeys.datasetTables,
    queryFn: api.datasetTables,
    staleTime: 30_000,
  });
}

export function useDatasetRows(
  table: string,
  params: { limit?: number; offset?: number; orderBy?: string; direction?: 'asc' | 'desc' } = {},
) {
  return useQuery({
    queryKey: queryKeys.datasetRows(table, params),
    queryFn: () => api.datasetRows(table, params),
    enabled: Boolean(table),
    placeholderData: (previous) => previous,
  });
}

export function useRefreshDataset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.datasetRefresh(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['dataset'] });
      void client.invalidateQueries({ queryKey: queryKeys.health });
    },
  });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    staleTime: 60_000,
  });
}

export function useNetwork() {
  return useQuery({
    queryKey: queryKeys.network,
    queryFn: api.network,
    staleTime: 5 * 60_000,
  });
}

export function useDashboard(profileId?: string) {
  const activeProfile = profileId ?? getActiveProfileId();
  return useQuery({
    queryKey: queryKeys.dashboard(activeProfile),
    queryFn: () => api.dashboard(activeProfile),
    refetchInterval: 45_000,
  });
}

export function useLiveCrowding(limit = 120) {
  return useQuery({
    queryKey: queryKeys.live(limit),
    queryFn: () => api.liveCrowding(limit),
    refetchInterval: 30_000,
  });
}

export function usePlan(params: {
  origin?: string;
  destination?: string;
  departAfter?: string;
  avoidCrowding?: boolean;
  maxTransfers?: number;
  enabled?: boolean;
}) {
  const profileId = getActiveProfileId();
  const key = {
    origin: params.origin,
    destination: params.destination,
    departAfter: params.departAfter,
    avoidCrowding: params.avoidCrowding,
    maxTransfers: params.maxTransfers,
    profileId,
  };

  return useQuery({
    queryKey: queryKeys.plan(key),
    queryFn: () =>
      api.plan({
        origin: params.origin as string,
        destination: params.destination as string,
        departAfter: params.departAfter,
        avoidCrowding: params.avoidCrowding,
        maxTransfers: params.maxTransfers,
        profileId,
      }),
    enabled:
      (params.enabled ?? true) && Boolean(params.origin && params.destination) &&
      params.origin !== params.destination,
    staleTime: 20_000,
  });
}

export function useLine(lineId?: string) {
  return useQuery({
    queryKey: ['line', lineId ?? ''] as const,
    queryFn: () => api.line(lineId as string),
    enabled: Boolean(lineId),
    staleTime: 5 * 60_000,
  });
}

export function useForecast(lineId?: string, stopId?: string, horizonMinutes = 120) {
  return useQuery({
    queryKey: queryKeys.forecast(lineId ?? '', stopId ?? '', horizonMinutes),
    queryFn: () => api.forecast(lineId as string, stopId as string, horizonMinutes),
    enabled: Boolean(lineId && stopId),
    staleTime: 30_000,
  });
}

export function useJourneyContext(lineId?: string, stopId?: string, horizonMinutes = 90) {
  return useQuery({
    queryKey: queryKeys.journeyContext(lineId ?? '', stopId ?? ''),
    queryFn: () => api.journeyContext(lineId as string, stopId as string, horizonMinutes),
    enabled: Boolean(lineId && stopId),
    staleTime: 30_000,
  });
}

export function useRecentSearches(limit = 5) {
  const profileId = getActiveProfileId();
  return useQuery({
    queryKey: ['searches', 'recent', profileId ?? 'default', limit],
    queryFn: () => api.recentSearches(profileId, limit),
    staleTime: 20_000,
  });
}

export function useAlerts(filters: { status?: AlertStatus | 'all'; severity?: string; lineId?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.alerts(filters),
    queryFn: () => api.alerts(filters),
    refetchInterval: 60_000,
  });
}

export function useOperatorOverview(windowHours = 24) {
  return useQuery({
    queryKey: queryKeys.operator(windowHours),
    queryFn: () => api.operatorOverview(windowHours),
    refetchInterval: 45_000,
  });
}

export function useOperatorLineLoad(dayType = 'weekday') {
  return useQuery({
    queryKey: queryKeys.lineLoad(dayType),
    queryFn: () => api.operatorLineLoad(dayType),
    staleTime: 60_000,
  });
}

export function useProfile() {
  const profileId = getActiveProfileId();
  return useQuery({
    queryKey: queryKeys.profile(profileId),
    queryFn: () => api.profile(profileId),
    staleTime: 60_000,
  });
}

export function useSettingsOptions() {
  return useQuery({
    queryKey: queryKeys.settingsOptions,
    queryFn: api.settingsOptions,
    staleTime: 10 * 60_000,
  });
}

export function useWatchlist() {
  const profileId = getActiveProfileId();
  return useQuery({
    queryKey: queryKeys.watchlist(profileId),
    queryFn: () => api.watchlist(profileId),
    staleTime: 30_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                  */
/* -------------------------------------------------------------------------- */

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<RiderProfile>) => api.updateProfile(patch, getActiveProfileId()),
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.profile(getActiveProfileId()), profile);
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

export function useCreateWatchlistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createWatchlistItem>[0]) =>
      api.createWatchlistItem(input, getActiveProfileId()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useToggleWatchlistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.toggleWatchlistItem(itemId, getActiveProfileId()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteWatchlistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.deleteWatchlistItem(itemId, getActiveProfileId()),
    onSuccess: (_data, itemId) => {
      queryClient.setQueryData<{ items: WatchlistItem[] } | undefined>(
        queryKeys.watchlist(getActiveProfileId()),
        (previous) =>
          previous ? { items: previous.items.filter((item) => item.id !== itemId) } : previous,
      );
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCreateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAlertInput) => api.createAlert(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['operator'] });
    },
  });
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => api.deleteAlert(alertId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['operator'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateAlertStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ alertId, status }: { alertId: string; status: AlertStatus }) =>
      api.updateAlertStatus(alertId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['operator'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
