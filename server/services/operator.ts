import type {
  FleetVehicle,
  OperatorKpi,
  OperatorOverview,
} from '../../shared/types';
import type { Queryable } from '../db/client';
import { listAlerts } from '../repositories/alerts.repo';
import { listHotspots, occupancyStats } from '../repositories/crowd.repo';
import {
  countUpcomingCrowdingEvents,
  listFleet,
  listFleetStats,
  listLineLoad,
} from '../repositories/operator.repo';
import { alertCadence } from '../repositories/alerts.repo';
import { listDemandSignals, searchVolumeStats } from '../repositories/searches.repo';
import { TARGET_DEFAULTS, getConfig, type ServiceTargets } from '../repositories/config.repo';

/**
 * Operator analytics service — assembles the control-room view from the
 * repositories. Every number here is aggregated in SQL from real rows
 * (`crowd_observations`, `vehicles`, `route_searches`, `alerts`).
 */

function deltaPct(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Percentage change only when there is a real baseline to compare against —
 * "up 100% from zero" tells an operator nothing.
 */
function deltaVsBaseline(current: number, previous: number): number | undefined {
  return previous > 0 ? deltaPct(current, previous) : undefined;
}

function toneFor(delta: number, invert = false): OperatorKpi['tone'] {
  if (Math.abs(delta) < 0.5) return 'neutral';
  const positive = invert ? delta < 0 : delta > 0;
  return positive ? 'positive' : 'negative';
}

export async function buildOperatorOverview(
  db: Queryable,
  windowHours = 24,
): Promise<OperatorOverview> {
  const targets = await getConfig<ServiceTargets>(db, 'service_targets', TARGET_DEFAULTS);

  const [
    occupancy,
    fleet,
    fleetStats,
    lines,
    hotspots,
    demandSignals,
    alerts,
    searchStats,
    crowdingEvents,
    alertStats,
  ] = await Promise.all([
    occupancyStats(db, windowHours),
    listFleet(db),
    listFleetStats(db),
    listLineLoad(db, 'weekday'),
    listHotspots(db, 6),
    listDemandSignals(db, { windowDays: 14, limit: 8 }),
    listAlerts(db, { limit: 40 }),
    searchVolumeStats(db, windowHours),
    countUpcomingCrowdingEvents(db, 2, targets.crowdingThresholdRatio),
    alertCadence(db, windowHours),
  ]);

  const activeAlerts = alerts.filter((alert) => alert.status === 'active');
  const criticalAlerts = activeAlerts.filter(
    (alert) => alert.severity === 'critical' || alert.severity === 'major',
  );

  const onTimeVehicles = fleet.filter(
    (vehicle) => vehicle.status === 'in_service' && vehicle.adherencePct >= 95,
  ).length;
  const onTimePct = fleetStats.inService
    ? Math.round((onTimeVehicles / fleetStats.inService) * 1000) / 10
    : 0;

  const kpis: OperatorKpi[] = [
    {
      key: 'fleet_active',
      label: 'Vehicles in service',
      value: fleetStats.inService,
      unit: `of ${fleetStats.total}`,
      series: fleet
        .filter((vehicle) => vehicle.status === 'in_service')
        .slice(0, 24)
        .map((vehicle) => vehicle.ratio),
      tone: 'neutral',
      hint: `${fleetStats.total - fleetStats.inService} off road (${fleetStats.maintenance} maintenance, ${
        fleetStats.total - fleetStats.inService - fleetStats.maintenance
      } idle) · average adherence ${fleetStats.avgAdherence}%`,
    },
    {
      key: 'avg_load',
      label: 'Average load factor',
      value: Math.round(occupancy.avgRatio * 1000) / 10,
      unit: '%',
      deltaPct: deltaPct(occupancy.avgRatio, occupancy.previousAvgRatio),
      comparisonLabel: `vs previous ${windowHours}h`,
      series: occupancy.hourlySeries,
      tone: toneFor(occupancy.avgRatio - occupancy.previousAvgRatio),
      hint: `Peak reading ${Math.round(occupancy.peakRatio * 100)}% · threshold ${
        Math.round(targets.crowdingThresholdRatio * 100)
      }%`,
    },
    {
      key: 'on_time',
      label: 'On-time performance',
      value: onTimePct,
      unit: '%',
      deltaPct: Math.round((onTimePct - targets.onTimeTargetPct) * 10) / 10,
      comparisonLabel: `vs ${targets.onTimeTargetPct}% target`,
      series: lines.map((line) => line.onTimePct),
      tone: onTimePct >= targets.onTimeTargetPct ? 'positive' : 'negative',
      hint: `${onTimeVehicles} of ${fleetStats.inService} in-service vehicles above 95% adherence`,
    },
    {
      key: 'crowd_events',
      label: 'Crowding events forecast',
      value: crowdingEvents.current,
      unit: 'next 2h',
      deltaPct: deltaVsBaseline(crowdingEvents.current, crowdingEvents.previous),
      comparisonLabel:
        crowdingEvents.previous > 0 ? 'vs previous 2h' : 'first forecast window today',
      series: occupancy.hourlySeries.slice(-12).map((value) => Math.round(value * 100)),
      tone: toneFor(crowdingEvents.current - crowdingEvents.previous, true),
      hint: `Services forecast above ${Math.round(
        targets.crowdingThresholdRatio * 100,
      )}% occupancy within the next 2 hours`,
    },
    {
      key: 'searches',
      label: 'Journey plans served',
      value: searchStats.searches,
      unit: `last ${windowHours}h`,
      deltaPct: deltaPct(searchStats.searches, searchStats.previousSearches),
      comparisonLabel: `vs previous ${windowHours}h`,
      series: demandSignals.map((signal) => signal.searches),
      tone: 'neutral',
      hint: `${demandSignals[0]?.originStopName ?? 'Network'} → ${
        demandSignals[0]?.destinationStopName ?? 'network'
      } is the busiest corridor`,
    },
    {
      key: 'crowding_avoided',
      label: 'Crowding avoided by routing',
      value: searchStats.crowdingAvoidedPct,
      unit: '%',
      deltaPct: deltaPct(searchStats.crowdingAvoidedPct, searchStats.previousCrowdingAvoidedPct),
      comparisonLabel: `vs previous ${windowHours}h`,
      series: lines.map((line) => Math.round(line.avgRatio * 100)),
      tone: 'positive',
      hint: 'Average peak-load reduction of the recommended option',
    },
    {
      key: 'alerts',
      label: 'Active service alerts',
      value: activeAlerts.length,
      unit: 'live',
      deltaPct: deltaVsBaseline(alertStats.current, alertStats.previous),
      comparisonLabel:
        alertStats.previous > 0 ? 'published vs previous 24h' : 'none published yesterday',
      series: [],
      tone: criticalAlerts.length ? 'negative' : 'neutral',
      hint: `${criticalAlerts.length} major or critical · ${alertStats.current} published in the last ${windowHours}h`,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    windowHours,
    kpis,
    fleet: sortFleet(fleet),
    lines,
    hotspots,
    demandSignals,
    activeAlerts,
  };
}

function sortFleet(fleet: FleetVehicle[]): FleetVehicle[] {
  const statusRank: Record<FleetVehicle['status'], number> = {
    in_service: 0,
    idle: 1,
    maintenance: 2,
  };
  return [...fleet].sort(
    (a, b) => statusRank[a.status] - statusRank[b.status] || b.ratio - a.ratio,
  );
}
