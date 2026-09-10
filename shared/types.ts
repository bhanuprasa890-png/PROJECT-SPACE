/**
 * TransitPulse AI — shared domain contract.
 *
 * These types are imported by BOTH the Express API server (`server/**`) and the
 * React application (`src/**`). Anything the UI renders therefore originates
 * from a database-backed API response, never from a component-local constant.
 */

export type TransitMode = 'metro' | 'bus' | 'tram' | 'brt' | 'ferry';

/** Green / yellow / orange / red bucket shown across the product. */
export type CrowdLevel = 'low' | 'moderate' | 'high' | 'critical';

export type AlertSeverity = 'info' | 'minor' | 'major' | 'critical';
export type AlertStatus = 'active' | 'scheduled' | 'resolved';
export type AlertCategory =
  | 'crowding'
  | 'delay'
  | 'disruption'
  | 'service_change'
  | 'weather'
  | 'maintenance';

export type HopSource = 'sensor' | 'tap_reader' | 'crew_report' | 'model';

/* -------------------------------------------------------------------------- */
/* Network                                                                    */
/* -------------------------------------------------------------------------- */

export interface Agency {
  id: string;
  name: string;
  city: string;
  timezone: string;
}

export interface Stop {
  id: string;
  agencyId: string;
  code: string;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  zone: string | null;
  isInterchange: boolean;
  dailyBoardings: number;
}

export interface TransitLine {
  id: string;
  agencyId: string;
  code: string;
  name: string;
  mode: TransitMode;
  color: string;
  capacityPerVehicle: number;
  headwayMinutes: number;
  isActive: boolean;
  /** Derived aggregate, computed by SQL when the line is fetched. */
  stopCount?: number;
}

export interface LineStop {
  lineId: string;
  stopId: string;
  seq: number;
  travelMinutesFromPrev: number;
  stop?: Stop;
}

export interface LineDetail {
  line: TransitLine;
  stops: LineStop[];
  activeAlerts: Alert[];
}

/* -------------------------------------------------------------------------- */
/* Crowding + predictions                                                     */
/* -------------------------------------------------------------------------- */

/** A single measured/predicted occupancy reading. `ratio` is headcount / capacity. */
export interface CrowdReading {
  lineId: string;
  lineCode: string;
  stopId: string;
  stopName: string;
  ratio: number;
  headcount: number;
  capacity: number;
  level: CrowdLevel;
  /** Trend vs. the previous comparable reading (percentage points). */
  trendPct: number;
  source: HopSource;
  observedAt: string;
}

/** One point of a forward-looking forecast series. */
export interface CrowdForecastPoint {
  targetAt: string;
  horizonMinutes: number;
  /** Predicted occupancy ratio: 1.0 == every seat + standing place taken. */
  ratio: number;
  headcount: number;
  capacity: number;
  level: CrowdLevel;
  confidence: number;
  /** Lower/upper bound of the 80% prediction interval. */
  lower: number;
  upper: number;
}

/** Explainability record: why the model predicted what it predicted. */
export interface ForecastFactor {
  key: string;
  label: string;
  /** Signed contribution in occupancy-ratio points. */
  contribution: number;
  detail: string;
}

export interface ForecastSeries {
  lineId: string;
  lineCode: string;
  lineName: string;
  stopId: string;
  stopName: string;
  capacity: number;
  generatedAt: string;
  modelVersion: string;
  /** Model quality gauges surfaced in the UI. */
  accuracy: number;
  sampleSize: number;
  headline: CrowdForecastPoint;
  points: CrowdForecastPoint[];
  factors: ForecastFactor[];
  /** Historical shape for the same weekday/hour, from `crowd_observations`. */
  baseline: CrowdForecastPoint[];
}

export interface CrowdHotspot {
  lineId: string;
  lineCode: string;
  lineName: string;
  lineColor: string;
  mode: TransitMode;
  stopId: string;
  stopName: string;
  ratio: number;
  level: CrowdLevel;
  headcount: number;
  capacity: number;
  observedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Route planning                                                             */
/* -------------------------------------------------------------------------- */

export interface PlannerRequest {
  originStopId: string;
  destinationStopId: string;
  /** ISO timestamp; defaults to "now" on the server. */
  departAfter?: string;
  profileId?: string;
  avoidCrowding?: boolean;
  /** 0..1 — the rider's personal tolerance for a busy carriage. */
  crowdTolerance?: number;
  maxTransfers?: number;
  maxWalkMinutes?: number;
  /** Persist the search into `route_searches` (default true). */
  persist?: boolean;
}

export interface ItineraryLeg {
  kind: 'transit' | 'walk';
  lineId?: string;
  lineCode?: string;
  lineName?: string;
  lineColor?: string;
  mode?: TransitMode;
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  stopCount: number;
  /** Intermediate stops travelled through (already ordered). */
  stops: { stopId: string; name: string; etaMinutes: number }[];
  /** Predicted load of this leg, evaluated at the boarding stop + departure time. */
  crowd?: {
    ratio: number;
    level: CrowdLevel;
    headcount: number;
    capacity: number;
    confidence: number;
    /** Peak load observed anywhere along the leg. */
    peakRatio: number;
    peakStopName: string;
  };
}

export type RecommendationKind = 'best' | 'fastest' | 'quietest' | 'fewest_transfers';

export interface RouteOption {
  id: string;
  kind: RecommendationKind;
  badgeLabel: string;
  /** Human explanation generated by the planner ("leave 6 min later…"). */
  headline: string;
  rationale: string[];
  departAt: string;
  arriveAt: string;
  totalMinutes: number;
  walkMinutes: number;
  waitMinutes: number;
  transfers: number;
  fare: number;
  co2SavedKg: number;
  /** Weighted objective value — lower is better. */
  score: number;
  scoreBreakdown: { time: number; crowd: number; transfer: number; walk: number };
  /** Worst occupancy ratio encountered across the itinerary. */
  crowdRisk: number;
  crowdRiskLevel: CrowdLevel;
  avgCrowdRatio: number;
  legs: ItineraryLeg[];
  /** Headroom vs. the busiest alternative in this result set. */
  crowdingAvoidedPct: number;
}

export interface PlannerResponse {
  origin: Stop;
  destination: Stop;
  departAfter: string;
  generatedAt: string;
  modelVersion: string;
  options: RouteOption[];
  /** The option TransitPulse recommends boarding. */
  recommendedOptionId: string;
  /** Busiest itinerary the rider could accidentally have picked. */
  worstOptionId: string;
  searchId: number | null;
  insights: string[];
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

export interface Alert {
  id: string;
  agencyId: string;
  lineId: string | null;
  lineCode: string | null;
  lineColor: string | null;
  stopId: string | null;
  stopName: string | null;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string | null;
  status: AlertStatus;
  issuedBy: string | null;
  createdAt: string;
  /** How many rider devices have been reached. */
  reach: number;
}

export interface CreateAlertInput {
  lineId?: string | null;
  stopId?: string | null;
  /** Display name of the team publishing the notice. */
  issuedBy?: string | null;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  body: string;
  startsAt?: string;
  endsAt?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Operator dashboard                                                         */
/* -------------------------------------------------------------------------- */

export interface OperatorKpi {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** Change against the comparison baseline (see `comparisonLabel`). */
  deltaPct?: number;
  /** What `deltaPct` is measured against, e.g. "vs previous 24h" or "vs target". */
  comparisonLabel?: string;
  /** Sparkline series (may be empty when not applicable). */
  series: number[];
  tone: 'positive' | 'negative' | 'neutral';
  hint: string;
}

export interface FleetVehicle {
  id: string;
  code: string;
  lineId: string;
  lineCode: string;
  lineColor: string;
  mode: TransitMode;
  status: 'in_service' | 'maintenance' | 'idle';
  capacity: number;
  headcount: number;
  ratio: number;
  level: CrowdLevel;
  nextStopName: string;
  adherencePct: number;
  lastPing: string;
}

export interface LineLoadRow {
  lineId: string;
  lineCode: string;
  lineName: string;
  color: string;
  mode: TransitMode;
  avgRatio: number;
  peakRatio: number;
  peakHour: number;
  level: CrowdLevel;
  vehiclesInService: number;
  onTimePct: number;
  /** 24 hourly averages (0..23) from `crowd_observations`. */
  hourlyProfile: number[];
}

export interface DemandSignal {
  id: string;
  originStopName: string;
  destinationStopName: string;
  searches: number;
  avoidCrowdingPct: number;
  recommendedShare: number;
  lastSearchedAt: string;
}

export interface OperatorOverview {
  generatedAt: string;
  windowHours: number;
  kpis: OperatorKpi[];
  fleet: FleetVehicle[];
  lines: LineLoadRow[];
  hotspots: CrowdHotspot[];
  demandSignals: DemandSignal[];
  activeAlerts: Alert[];
}

/* -------------------------------------------------------------------------- */
/* Rider preferences                                                          */
/* -------------------------------------------------------------------------- */

export interface RiderProfile {
  id: string;
  displayName: string;
  email: string;
  homeStopId: string | null;
  workStopId: string | null;
  homeStopName: string | null;
  workStopName: string | null;
  crowdTolerance: number;
  maxWalkMinutes: number;
  maxTransfers: number;
  preferredModes: TransitMode[];
  notifyPush: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
  crowdThresholdAlert: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  theme: 'dark' | 'midnight' | 'system';
  units: 'metric' | 'imperial';
  language: string;
  personalizationEnabled: boolean;
}

export interface WatchlistItem {
  id: string;
  profileId: string;
  label: string;
  originStopId: string;
  destinationStopId: string;
  originStopName: string;
  destinationStopName: string;
  departTime: string | null;
  days: string[];
  avoidCrowded: boolean;
  notify: boolean;
  /** Live snapshot attached by the API for dashboard cards. */
  prediction?: {
    ratio: number;
    level: CrowdLevel;
    confidence: number;
    departAt: string;
    lineCode: string;
    lineColor: string;
    status: string;
  };
}

export interface SettingsOptions {
  stops: Pick<Stop, 'id' | 'name' | 'code' | 'isInterchange'>[];
  modes: TransitMode[];
  languages: { code: string; label: string }[];
}

/* -------------------------------------------------------------------------- */
/* Commuter dashboard                                                         */
/* -------------------------------------------------------------------------- */

export interface DashboardStat {
  key: string;
  label: string;
  value: string;
  hint: string;
  tone: 'positive' | 'warning' | 'negative' | 'neutral';
  /** Optional icon key resolved by the UI icon map. */
  icon: string;
}

export interface UpcomingDeparture {
  lineId: string;
  lineCode: string;
  lineName: string;
  lineColor: string;
  mode: TransitMode;
  direction: number;
  departureAt: string;
  minutesAway: number;
  headwayMinutes: number;
  vehicleCode: string | null;
  prediction: {
    ratio: number;
    level: CrowdLevel;
    headcount: number;
    capacity: number;
    confidence: number;
  };
  isRecommended: boolean;
}

export interface StationBoard {
  stop: Stop;
  departures: UpcomingDeparture[];
}

export interface CommuterDashboard {
  generatedAt: string;
  profile: RiderProfile;
  stats: DashboardStat[];
  /** Live recommendation for the rider's next saved journey. */
  nextJourney: {
    watchlistItemId: string;
    label: string;
    origin: Stop;
    destination: Stop;
    planned: PlannerResponse;
  } | null;
  watchlist: WatchlistItem[];
  crowdingNow: CrowdHotspot[];
  activeAlerts: Alert[];
  networkTotals: {
    stopCount: number;
    lineCount: number;
    interchangeCount: number;
    vehiclesInService: number;
    activeAlerts: number;
  };
  stationBoards: StationBoard[];
  model: { version: string; accuracy: number; horizonMinutes: number };
}

/* -------------------------------------------------------------------------- */
/* Transport envelope                                                         */
/* -------------------------------------------------------------------------- */

export interface ApiErrorBody {
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
}

export interface HealthReport {
  status: 'ok';
  service: string;
  version: string;
  database: {
    driver: 'supabase-postgres' | 'embedded-postgres';
    connected: boolean;
    latencyMs: number;
    schemaVersion: string | null;
    rows: Record<string, number>;
  };
  modelVersion: string;
  serverTime: string;
}
