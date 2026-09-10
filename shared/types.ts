/**
 * TransitPulse AI — shared domain contract.
 *
 * These types are imported by BOTH the Express API server (`server/**`) and the
 * React application (`src/**`). Anything the UI renders therefore originates
 * from a database-backed API response, never from a component-local constant.
 */

export type TransitMode = 'metro' | 'bus' | 'tram' | 'brt' | 'ferry';

/** Green / yellow / orange / red bucket shown across the product. */
/** Service-day classification used by the timetable and the prediction model. */
export type DayType = 'weekday' | 'saturday' | 'sunday';

/**
 * Commuter-facing crowd bands (see `shared/crowd.ts`):
 * Low < 60% · Moderate 60–85% · High > 85% occupancy.
 */
export type CrowdLevel = 'low' | 'moderate' | 'high';

/** Fleet state of a vehicle row in `vehicles`. */
export type VehicleStatus = 'in_service' | 'maintenance' | 'idle';

/** Rider-facing read of predicted crowding, shown as the comfort indicator. */
export type ComfortLevel = 'comfortable' | 'standing' | 'packed';

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
  /**
   * Calibration on the *simulated* demo history. This is a prototype gauge, not
   * a production accuracy claim.
   */
  accuracy: number;
  sampleSize: number;
  /** Which predictor produced this series (see `PredictionEngineDescriptor`). */
  engine?: PredictionEngineDescriptor;
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
  /** Route identity — read from the canonical `routes` table. */
  routeId: string | null;
  routeNumber: string;
  routeName: string;
  /** Every line used by the itinerary, in boarding order. */
  lineCodes: string[];
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
  /**
   * Route score in effective minutes — lower is better:
   *   score = travel time + waiting time + crowd penalty
   */
  score: number;
  scoreBreakdown: {
    travelMinutes: number;
    waitingMinutes: number;
    crowdPenaltyMinutes: number;
    totalScore: number;
  };
  /** Worst occupancy ratio encountered across the itinerary. */
  crowdRisk: number;
  crowdRiskLevel: CrowdLevel;
  avgCrowdRatio: number;
  /** Predicted occupancy at the busiest stretch, 0–100. */
  predictedOccupancyPct: number;
  /** Model confidence in that busiest prediction, 0–100. */
  confidencePct: number;
  /** Rider-facing comfort indicator derived from `crowdRisk`. */
  comfort: ComfortLevel;
  /** One-line, data-generated explanation of the score. */
  scoreExplanation: string;
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
  /**
   * Set when the requested departure time is outside the service window and the
   * planner rolled forward to the next available service (times are local to the
   * agency).
   */
  serviceNote?: string;
  /** The instant the returned itineraries actually depart, when rolled forward. */
  serviceResumesAt?: string;
  /** What the rider originally asked for. */
  requestedDepartAfter?: string;
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
  status: VehicleStatus;
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
  model: {
    version: string;
    /** Calibration on simulated history — not a production accuracy claim. */
    accuracy: number;
    horizonMinutes: number;
    engine?: PredictionEngineDescriptor;
  };
}

/* -------------------------------------------------------------------------- */
/* Canonical demo dataset (Data Explorer)                                     */
/* -------------------------------------------------------------------------- */

export interface DatasetTableSummary {
  name: string;
  label: string;
  kind: 'table' | 'view';
  /** Table name in the requested canonical schema (see shared/dataset.ts). */
  requestedAs: string;
  description: string;
  rowCount: number;
  columnCount: number;
  primaryKey: string;
  /** Minimum row count the demo dataset guarantees, when one is defined. */
  minimumRows?: number;
}

export interface DatasetColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  references: string | null;
}

export interface DatasetTablePage {
  table: DatasetTableSummary;
  columns: DatasetColumn[];
  rows: Record<string, string | number | boolean | null>[];
  total: number;
  limit: number;
  offset: number;
  orderBy: string;
  generatedAt: string;
}

export interface DatasetOverview {
  driver: 'supabase-postgres' | 'embedded-postgres';
  schemaVersion: string | null;
  source: 'supabase-postgres' | 'embedded-postgres';
  dataClassification: 'demo-simulated';
  generatedAt: string;
  tables: DatasetTableSummary[];
  totals: {
    tables: number;
    views: number;
    rows: number;
  };
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

/* -------------------------------------------------------------------------- */
/* Prediction layer (Input Data → Engine → Occupancy → Classification)        */
/* -------------------------------------------------------------------------- */

/**
 * SIMULATED PROTOTYPE — every prediction is computed from synthetic demo data
 * (see `supabase/seed/*`). Nothing here measures or claims real-world accuracy.
 */
export interface PredictionEngineDescriptor {
  /** Predictor id, e.g. `heuristic-ensemble` or `external-model`. */
  id: string;
  kind: 'heuristic-ensemble' | 'external-model';
  version: string;
  /** Always true for this prototype: predictions come from simulated data. */
  simulated: boolean;
  note: string;
  /** The inputs the engine consumes, in pipeline order. */
  inputs: string[];
  weatherSource: 'weather_conditions (simulated)' | 'disabled';
  /** Set when the configured external model was unreachable. */
  fallbackNote?: string | null;
  disclaimer: string;
}

export interface CrowdClass {
  level: CrowdLevel;
  label: string;
  description: string;
  /** Display range, e.g. `60–85%`. */
  range: string;
}

export interface PredictionFactorReport {
  key: string;
  label: string;
  /** Contribution in occupancy percentage points (signed). */
  contributionPct: number;
  contributionRatio: number;
  detail: string;
  direction: 'raises' | 'lowers' | 'neutral';
}

export interface WeatherSnapshot {
  at: string;
  city: string;
  condition: string;
  label: string;
  /** Simulated demand multiplier applied by the engine. */
  factor: number;
  severity: number;
  temperatureC: number | null;
  rainfallMm: number;
  source: 'simulated';
}

export interface PredictionPipelineStage {
  key: string;
  title: string;
  summary: string;
  detail: string;
  /** Where the stage lives in the codebase. */
  code: string;
}

export interface OccupancyPredictionResult {
  route: {
    id: string;
    code: string;
    name: string;
    mode: TransitMode;
    capacity: number;
    headwayMinutes: number;
  };
  stop: { id: string; code: string; name: string } | null;
  targetAt: string;
  timeZone: string;
  dayType: DayType;
  hourOfDay: number;

  /** Stage 3 output. */
  predictedOccupancyPercentage: number;
  predictedRatio: number;
  headcount: number;
  capacity: number;
  baselineOccupancyPercentage: number;
  interval: { lowerPercentage: number; upperPercentage: number };

  /** Stage 4 output. */
  crowd: CrowdClass;

  confidencePercentage: number;

  factors: PredictionFactorReport[];
  inputsUsed: {
    historicalSamples: number;
    historicalScope: 'stop' | 'line' | 'prior';
    currentOccupancyPercentage: number | null;
    currentOccupancyAgeMinutes: number | null;
    upstreamOccupancyPercentage: number;
    alertPressurePct: number;
    weather: WeatherSnapshot | null;
  };
  engine: PredictionEngineDescriptor;
  disclaimer: string;
  generatedAt: string;
}

export interface PredictionEngineReport {
  engine: PredictionEngineDescriptor;
  /** The classification table, with an example value per band. */
  classes: (CrowdClass & { examplePercentage: number; rule: string })[];
  inputs: { key: string; label: string; source: string; detail: string }[];
  stages: PredictionPipelineStage[];
  weather: {
    source: 'weather_conditions (simulated)' | 'disabled';
    current: WeatherSnapshot | null;
    slots: WeatherSnapshot[];
  };
  routeOptimization: {
    consumer: string;
    detail: string;
    scoreFormula: string;
  };
  generatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Operator Command Center                                                    */
/* -------------------------------------------------------------------------- */

/** Operating state of a route, the way a control room would triage it. */
export type RouteOperatingStatus = 'on_time' | 'boarding' | 'crowded' | 'delayed' | 'disrupted';
export type TrendDirection = 'rising' | 'falling' | 'stable';

export interface CommandKpis {
  activeRoutes: number;
  totalRoutes: number;
  activeVehicles: number;
  totalVehicles: number;
  maintenanceVehicles: number;
  idleVehicles: number;
  /** Routes whose worst monitored stop is above the crowding threshold. */
  highCrowdRoutes: number;
  /** Routes approaching the threshold (70–85%) — the watch list. */
  watchRoutes: number;
  averageOccupancyPct: number;
  predictedOccupancyPct: number;
  passengersOnboard: number;
  networkCapacity: number;
  /** AI interventions applied from the console in the last 24 hours. */
  interventions24h: number;
  status: 'nominal' | 'elevated' | 'critical';
  statusDetail: string;
}

export interface CommandRouteRow {
  lineId: string;
  routeNumber: string;
  routeName: string;
  color: string;
  mode: TransitMode;
  /** Worst monitored stop right now. */
  occupancyPct: number;
  /** Engine prediction for the worst stop, 30 minutes ahead. */
  predictedPct: number;
  /** Busiest reading for this route over the trailing 24 hours. */
  peak24hPct: number;
  level: CrowdLevel;
  predictedLevel: CrowdLevel;
  trend: TrendDirection;
  trendDeltaPct: number;
  vehiclesTotal: number;
  vehiclesInService: number;
  capacityPerVehicle: number;
  headcount: number;
  capacity: number;
  onTimePct: number;
  headwayMinutes: number;
  nextDepartureAt: string | null;
  serviceFirst: string | null;
  serviceLast: string | null;
  peakHour: number | null;
  worstStopName: string | null;
  stopsMonitored: number;
  status: RouteOperatingStatus;
  statusLabel: string;
  statusDetail: string;
  activeAlerts: number;
  majorAlerts: number;
  alertsLastHour: number;
  /** Set when an AI intervention has already been applied to this route today. */
  activeIntervention: RouteIntervention | null;
}

export interface HeatmapStop {
  stopId: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  interchange: boolean;
  boardings: number;
  ratio: number;
  level: CrowdLevel;
  predictedRatio: number;
  predictedLevel: CrowdLevel;
  /** Busiest reading over the trailing 24 hours (the "peak profile" view). */
  peakRatio: number;
  peakLevel: CrowdLevel;
  routes: string[];
}

export interface HeatmapSegment {
  lineId: string;
  routeNumber: string;
  color: string;
  mode: TransitMode;
  fromStopId: string;
  fromName: string;
  toStopId: string;
  toName: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  ratio: number;
  level: CrowdLevel;
  predictedRatio: number;
  predictedLevel: CrowdLevel;
  peakRatio: number;
  peakLevel: CrowdLevel;
}

export interface CrowdHeatmap {
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  stops: HeatmapStop[];
  segments: HeatmapSegment[];
  legend: { level: CrowdLevel; label: string; range: string }[];
}

export interface AiAlert {
  id: string;
  kind: 'crowding' | 'disruption' | 'spread';
  severity: 'critical' | 'major' | 'minor' | 'info';
  lineId: string | null;
  routeNumber: string;
  routeName: string;
  color: string;
  stopName: string | null;
  /** Headline in the operator's language, built from the stored values. */
  message: string;
  predictedOccupancyPct: number;
  inMinutes: number;
  estimatedAt: string;
  confidencePct: number;
  thresholdPct: number;
  recommendedAction: string;
  state: 'open' | 'watch';
}

export interface AiRecommendation {
  id: string;
  kind: 'add_vehicle' | 'redirect_passengers' | 'rebalance_headway' | 'fleet_readiness';
  urgency: 'now' | 'next_30' | 'monitor';
  lineId: string;
  routeNumber: string;
  routeName: string;
  color: string;
  /** Set for redirect advice — the quieter route to steer riders toward. */
  targetRouteNumber: string | null;
  title: string;
  detail: string;
  impactLabel: string;
  confidencePct: number;
  evidence: { label: string; value: string }[];
}

export interface RouteAnalyticsPoint {
  at: string;
  ratio: number;
  kind: 'history' | 'forecast';
}

export interface RouteAnalytics {
  lineId: string;
  routeNumber: string;
  routeName: string;
  color: string;
  mode: TransitMode;
  currentPct: number;
  predictedPct: number;
  deltaPct: number;
  trend: TrendDirection;
  peakPct: number;
  peakLabel: string;
  series: RouteAnalyticsPoint[];
}

export interface CommandCenter {
  generatedAt: string;
  timeZone: string;
  simulated: true;
  disclaimer: string;
  engine: PredictionEngineDescriptor;
  kpis: CommandKpis;
  routes: CommandRouteRow[];
  heatmap: CrowdHeatmap;
  alerts: AiAlert[];
  recommendations: AiRecommendation[];
  analytics: { network: RouteAnalyticsPoint[]; routes: RouteAnalytics[] };
  /** Interventions applied from the console, newest first. */
  decisions: AiInterventionSummary[];
  crowdingThresholdPct: number;
  refreshSeconds: number;
}

/* -------------------------------------------------------------------------- */
/* AI Decision console — detect → recommend → apply                           */
/* -------------------------------------------------------------------------- */

/** The numbered interventions the engine can propose and the console can apply. */
export type AiActionKey =
  | 'deploy_vehicle'
  | 'redirect_passengers'
  | 'notify_passengers'
  | 'tighten_headway';

export interface AiActionPlan {
  key: AiActionKey;
  /** 1-based position in the "AI RECOMMENDED ACTION" list. */
  order: number;
  title: string;
  detail: string;
  /** Share of the *remaining* peak load this action removes (0–1). */
  reliefFraction: number;
  /** Ratio points it removes at the forecast peak, so the impact table adds up. */
  expectedReliefPct: number;
  evidence: { label: string; value: string }[];
  /** The row this action touches when applied (vehicle, corridor, advisory). */
  targetLabel: string | null;
  /** True once the action has been written to the database. */
  applied: boolean;
}

export interface AiImpactProjection {
  /** Forecast peak at the congestion instant, no action taken. */
  withoutPct: number;
  /** The same instant once the recommended actions compound. */
  withPct: number;
  reliefPct: number;
  withoutLevel: CrowdLevel;
  withLevel: CrowdLevel;
  /** Riders no longer forecast to travel above the crowding threshold. */
  passengersEased: number;
  targetAt: string;
  stopName: string | null;
  /** The documented combination rule, rendered next to the projection. */
  method: string;
  /** Engine scan behind the projection: minutes from now → predicted load. */
  scan: { minutes: number; ratio: number }[];
}

export interface AiDecisionProposal {
  /** Stable id of the proposal — the route plus the congestion instant. */
  id: string;
  status: 'proposed' | 'applied';
  lineId: string;
  routeNumber: string;
  routeName: string;
  color: string;
  mode: TransitMode;
  detectedAt: string;
  /** `congestion` when the route crosses the threshold, `watch` when it only peaks. */
  kind: 'congestion' | 'watch';
  headline: string;
  detectionNote: string;
  /** How the congestion instant was found. */
  basis: 'live' | 'forecast' | 'profile';
  basisLabel: string;
  /** Minutes until the forecast crosses the threshold (null = no crossing in the scan). */
  minutesToCongestion: number | null;
  horizonMinutes: number;
  currentPct: number;
  currentLevel: CrowdLevel;
  predictedPct: number;
  predictedLevel: CrowdLevel;
  thresholdPct: number;
  confidencePct: number;
  headcount: number;
  capacityPerVehicle: number;
  vehiclesInService: number;
  /** Reserve units the engine could deploy (idle first, then maintenance). */
  reserveVehicles: number;
  stop: { stopId: string; name: string } | null;
  actions: AiActionPlan[];
  impact: AiImpactProjection;
  engine: string;
  disclaimer: string;
  simulated: true;
  generatedAt: string;
}

/** What applying a decision changed — read back from the database afterwards. */
export interface AiDecisionEffects {
  vehicle: {
    id: string;
    code: string;
    created: boolean;
    previousStatus: VehicleStatus | null;
    previousLineCode: string | null;
    lineCode: string;
  } | null;
  alert: { id: string; title: string; severity: AlertSeverity; category: AlertCategory };
  decisionId: string;
  before: NetworkSnapshot;
  after: NetworkSnapshot;
}

export interface NetworkSnapshot {
  activeVehicles: number;
  maintenanceVehicles: number;
  idleVehicles: number;
  openAlerts: number;
  averageOccupancyPct: number;
}

export interface AiInterventionSummary {
  id: string;
  lineId: string;
  routeNumber: string;
  routeName: string;
  color: string;
  status: 'applied' | 'reverted';
  detectedAt: string;
  appliedAt: string | null;
  targetAt: string;
  minutesToCongestion: number | null;
  currentPct: number;
  predictedPct: number;
  projectedPct: number;
  reliefPct: number;
  confidencePct: number;
  actionKeys: AiActionKey[];
  actionCount: number;
  vehicleId: string | null;
  vehicleCode: string | null;
  alertId: string | null;
  alertTitle: string | null;
  appliedBy: string | null;
  note: string | null;
  simulated: true;
}

/** One row per route: the intervention already applied to that route today. */
export interface RouteIntervention {
  id: string;
  appliedAt: string;
  withoutPct: number;
  projectedPct: number;
  reliefPct: number;
  actionCount: number;
  vehicleCode: string | null;
  alertId: string | null;
}

export interface AiDecisionApplyResult {
  decision: AiDecisionProposal;
  intervention: AiInterventionSummary;
  effects: AiDecisionEffects;
}
