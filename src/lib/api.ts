import type {
  Alert,
  AlertStatus,
  DatasetOverview,
  DatasetTablePage,
  CommuterDashboard,
  CrowdForecastPoint,
  CrowdHotspot,
  CrowdReading,
  CreateAlertInput,
  ForecastSeries,
  HealthReport,
  LineDetail,
  OperatorOverview,
  PlannerResponse,
  RiderProfile,
  SettingsOptions,
  StationBoard,
  Stop,
  TransitLine,
  TransitMode,
  WatchlistItem,
} from '@shared/types';

/**
 * Single typed entry point for the TransitPulse API.
 *
 * Every screen fetches through these functions — no component talks to a
 * database, and no component invents data.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'REQUEST_FAILED',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (error) {
    throw new ApiError(
      `Cannot reach the TransitPulse API (${(error as Error).message})`,
      0,
      'NETWORK_ERROR',
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body = payload as { error?: { message?: string; code?: string } } | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      body?.error?.code ?? 'REQUEST_FAILED',
    );
  }

  return payload as T;
}

const query = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : '';
};

/* -------------------------------------------------------------------------- */
/* Health + network                                                           */
/* -------------------------------------------------------------------------- */

export interface HealthPayload extends HealthReport {
  uptimeSeconds: number;
  defaults: { profileId: string };
  dataClassification?: 'demo-simulated';
  dataset?: { name: string; requestedAs: string; rows: number }[];
}

export const api = {
  health: () => request<HealthPayload>('/health'),

  /* ------------------------------------------------- canonical demo dataset */

  /**
   * The published route-level dataset (routes, stops, vehicles, predictions,
   * options, alerts, users). Read straight from Postgres through the API — the
   * browser never holds database credentials.
   */
  datasetTables: () => request<DatasetOverview>('/dataset/tables'),

  datasetRows: (
    table: string,
    params: { limit?: number; offset?: number; orderBy?: string; direction?: 'asc' | 'desc' } = {},
  ) =>
    request<DatasetTablePage>(
      `/dataset/tables/${encodeURIComponent(table)}${query({
        limit: params.limit,
        offset: params.offset,
        orderBy: params.orderBy,
        direction: params.direction,
      })}`,
    ),

  datasetRefresh: () =>
    request<{ refreshedAt: string; counts: Record<string, number> }>('/dataset/refresh', {
      method: 'POST',
    }),

  network: () =>
    request<{
      agency: { id: string; name: string; city: string; timezone: string } | null;
      stops: Stop[];
      lines: TransitLine[];
      model: { version: string; accuracy: number };
    }>('/network'),

  stops: (params: { q?: string; limit?: number; interchange?: boolean } = {}) =>
    request<{ stops: Stop[]; count: number }>(
      `/stops${query({ q: params.q, limit: params.limit, interchange: params.interchange })}`,
    ),

  stopBoard: (stopId: string, horizonMinutes = 60) =>
    request<{
      stop: Stop;
      departures: (StationBoard['departures'][number] & { lineId: string })[];
    }>(`/stops/${stopId}${query({ horizon: horizonMinutes })}`),

  lines: () => request<{ lines: TransitLine[] }>('/lines'),

  line: (lineId: string) => request<LineDetail>(`/lines/${lineId}`),

  /* ---------------------------------------------------------------- planning */

  plan: (params: {
    origin: string;
    destination: string;
    departAfter?: string;
    profileId?: string;
    avoidCrowding?: boolean;
    maxTransfers?: number;
    crowdTolerance?: number;
    persist?: boolean;
  }) =>
    request<PlannerResponse>(
      `/plan${query({
        origin: params.origin,
        destination: params.destination,
        departAfter: params.departAfter,
        profileId: params.profileId,
        avoidCrowding: params.avoidCrowding,
        maxTransfers: params.maxTransfers,
        crowdTolerance: params.crowdTolerance,
        persist: params.persist,
      })}`,
    ),

  journeyContext: (lineId: string, stopId: string, horizonMinutes = 90) =>
    request<{
      line: TransitLine;
      stop: Stop;
      forecast: ForecastSeries | null;
      alerts: Alert[];
    }>(`/journey-context${query({ lineId, stopId, horizon: horizonMinutes })}`),

  recentSearches: (profileId?: string, limit = 6) =>
    request<{
      searches: {
        id: string;
        originStopId: string;
        originStopName: string;
        destinationStopId: string;
        destinationStopName: string;
        departAfter: string;
        avoidCrowding: boolean;
        optionsReturned: number;
        createdAt: string;
      }[];
    }>(`/searches/recent${query({ profileId, limit })}`),

  /* ------------------------------------------------------------------ crowd */

  liveCrowding: (limit = 120) =>
    request<{
      generatedAt: string;
      readings: CrowdReading[];
      hotspots: CrowdHotspot[];
      lines: { id: string; code: string; color: string }[];
      stops: { id: string; name: string; code: string }[];
    }>(`/crowd/live${query({ limit })}`),

  forecast: (lineId: string, stopId: string, horizonMinutes = 120) =>
    request<ForecastSeries>(`/crowd/forecast${query({ lineId, stopId, horizon: horizonMinutes })}`),

  crowdHistory: (lineId: string, stopId: string, hours = 24) =>
    request<{ lineId: string; stopId: string; hours: number; observations: CrowdReading[] }>(
      `/crowd/history${query({ lineId, stopId, hours })}`,
    ),

  /* ----------------------------------------------------------------- alerts */

  alerts: (params: { status?: AlertStatus | 'all'; severity?: string; lineId?: string; limit?: number } = {}) =>
    request<{
      alerts: Alert[];
      count: number;
      severityBreakdown: Record<'info' | 'minor' | 'major' | 'critical', number>;
    }>(
      `/alerts${query({
        status: params.status,
        severity: params.severity,
        lineId: params.lineId,
        limit: params.limit,
      })}`,
    ),

  createAlert: (input: CreateAlertInput) =>
    request<Alert>('/alerts', { method: 'POST', body: JSON.stringify(input) }),

  updateAlertStatus: (alertId: string, status: AlertStatus) =>
    request<Alert>(`/alerts/${alertId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  deleteAlert: (alertId: string) => request<void>(`/alerts/${alertId}`, { method: 'DELETE' }),

  /* --------------------------------------------------------------- operator */

  operatorOverview: (windowHours = 24) =>
    request<OperatorOverview>(`/operator/overview${query({ window: windowHours })}`),

  operatorLineLoad: (dayType = 'weekday') =>
    request<{ dayType: string; lines: OperatorOverview['lines'] }>(
      `/operator/line-load${query({ dayType })}`,
    ),

  operatorConfig: () => request<{ config: Record<string, unknown> }>('/operator/config'),

  /* ------------------------------------------------------------------ rider */

  dashboard: (profileId?: string) =>
    request<CommuterDashboard>(`/dashboard${query({ profileId })}`),

  profile: (profileId?: string) => request<RiderProfile>(`/profile${query({ profileId })}`),

  updateProfile: (patch: Partial<RiderProfile>, profileId?: string) =>
    request<RiderProfile>(`/profile${query({ profileId })}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  settingsOptions: () => request<SettingsOptions>('/settings/options'),

  watchlist: (profileId?: string) =>
    request<{ items: WatchlistItem[] }>(`/watchlist${query({ profileId })}`),

  createWatchlistItem: (
    input: {
      label: string;
      originStopId: string;
      destinationStopId: string;
      departTime?: string | null;
      days?: string[];
      avoidCrowded?: boolean;
      notify?: boolean;
    },
    profileId?: string,
  ) =>
    request<WatchlistItem>(`/watchlist${query({ profileId })}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  toggleWatchlistItem: (itemId: string, profileId?: string) =>
    request<WatchlistItem>(`/watchlist/${itemId}/toggle${query({ profileId })}`, { method: 'POST' }),

  deleteWatchlistItem: (itemId: string, profileId?: string) =>
    request<void>(`/watchlist/${itemId}${query({ profileId })}`, { method: 'DELETE' }),
};

export type { CrowdForecastPoint, TransitMode };
