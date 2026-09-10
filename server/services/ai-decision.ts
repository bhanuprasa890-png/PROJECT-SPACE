import { crowdLevelFromRatio } from '../../shared/crowd';
import type {
  AiActionKey,
  AiActionPlan,
  AiDecisionApplyResult,
  AiDecisionProposal,
  AiImpactProjection,
  AiInterventionSummary,
  CrowdLevel,
  NetworkSnapshot,
  VehicleStatus,
} from '../../shared/types';
import type { DatabaseClient, Queryable } from '../db/client';
import { getConfig, TARGET_DEFAULTS, type ServiceTargets } from '../repositories/config.repo';
import {
  getCommandNetwork,
  listCommandLines,
} from '../repositories/command.repo';
import {
  assignVehicleToLine,
  countInterventionsSince,
  createStandbyVehicle,
  deleteDecision,
  findAlternativeLine,
  findNextPeakWindow,
  findRecentIntervention,
  getIntervention,
  getLineContext,
  insertDecision,
  insertDecisionActions,
  insertInterventionAlert,
  listReserveVehicles,
  toInterventionSummary,
  type InterventionReadRow,
} from '../repositories/ai-decision.repo';
import { PredictionEngine, SIMULATION_DISCLAIMER } from './prediction';

/**
 * AI Decision console — detect → recommend → apply
 * ================================================
 *
 * The commuter side of TransitPulse answers "which route should I take?". This
 * service answers the operator's version of the same question: *a route is about
 * to crowd — what do we do about it, and what happens if we do?*
 *
 *   1. Detect      the engine scans the route's busiest monitored stop forward
 *                  (+0 … +180 min) and reports the first threshold crossing, or
 *                  the route's next recurring peak window when nothing crosses.
 *   2. Recommend   numbered interventions are composed from real rows: a reserve
 *                  unit from `vehicles`, a quieter corridor that shares a stop,
 *                  and a rider advisory whose reach comes from `stops`.
 *   3. Project     relief compounds sequentially — every action removes a share
 *                  of the *remaining* peak load — so the impact table adds up.
 *   4. Apply       one API call writes the ledger (`ai_decisions`,
 *                  `ai_decision_actions`), moves a vehicle into service and
 *                  raises an `alerts` event, then the console refetches the
 *                  command centre so the dashboard reflects the new reality.
 *
 * DEMO / SIMULATED DATA: every ratio here comes from the simulated prediction
 * engine over the synthetic demo dataset. These are projections for a prototype
 * — not measurements, and no production accuracy is claimed.
 */

/** How far ahead the engine looks for a threshold crossing. */
const SCAN_MINUTES = 180;
const SCAN_STEP_MINUTES = 15;

/** Model coefficients for the intervention plays (documented, not measured). */
const RELIEF_MODEL = {
  /** Rider advisories move this share of the remaining peak load. */
  notify: 0.06,
  /** Rebalancing headway when no reserve unit exists. */
  headway: 0.12,
  /** Share of the alternative corridor's spare capacity that can absorb riders. */
  redirectShareOfSpare: 0.4,
  redirectFloor: 0.05,
  redirectCeil: 0.3,
} as const;

export const PROJECTION_METHOD =
  'Sequential multiplicative relief — each action removes a share of the remaining peak load, so the projected occupancy compounds rather than simply adding up';

/** An applied decision blocks a duplicate press for this long. */
export const INTERVENTION_COOLDOWN_MINUTES = 10;

export const ACTION_KEYS = {
  deploy: 'deploy_vehicle',
  redirect: 'redirect_passengers',
  notify: 'notify_passengers',
  headway: 'tighten_headway',
} as const satisfies Record<string, AiActionKey>;

interface ScanSample {
  minutes: number;
  ratio: number;
  percentage: number;
  confidence: number;
  headcount: number;
  level: CrowdLevel;
  at: string;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(ratio: number): number {
  return round(ratio * 100, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/** Local clock label in the agency timezone, used inside evidence copy. */
function zonedClock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(at);
}

export interface BuildProposalArgs {
  lineIdOrCode: string;
  engine?: PredictionEngine;
  now?: Date;
}

/**
 * Detect the next congestion event on a route and compose the intervention plan
 * that would prevent it. Returns null when the route does not exist.
 */
export async function buildDecisionProposal(
  db: Queryable,
  args: BuildProposalArgs,
): Promise<AiDecisionProposal | null> {
  const now = args.now ?? new Date();
  const engine = args.engine ?? (await PredictionEngine.load(db));
  const targets = await getConfig<ServiceTargets>(db, 'service_targets', TARGET_DEFAULTS);
  const thresholdRatio = targets.crowdingThresholdRatio;
  const thresholdPct = pct(thresholdRatio);

  const lines = await listCommandLines(db);
  const key = args.lineIdOrCode.toUpperCase();
  const line =
    lines.find((row) => row.line_id === args.lineIdOrCode) ??
    lines.find((row) => row.code.toUpperCase() === key);
  if (!line) return null;

  const context = await getLineContext(db, line.line_id);
  const timeZone = context?.timezone ?? 'Asia/Kolkata';

  const capacity = Number(line.capacity_per_vehicle);
  const worstStopId = line.worst_stop_id;
  const worstStopName = line.worst_stop_name;

  // --- 1. detect — engine scan over the next three hours --------------------
  const samples: ScanSample[] = [];
  for (let offset = 0; offset <= SCAN_MINUTES; offset += SCAN_STEP_MINUTES) {
    const at = new Date(now.getTime() + offset * 60_000);
    const result = await engine.predict({
      lineIdOrCode: line.line_id,
      stopId: worstStopId,
      at,
      capacity,
      weather: 'auto',
    });
    if (!result) continue;
    samples.push({
      minutes: offset,
      ratio: result.predictedRatio,
      percentage: result.predictedOccupancyPercentage,
      confidence: result.confidencePercentage,
      headcount: result.headcount,
      level: result.crowd.level,
      at: result.targetAt,
    });
  }
  if (!samples.length) return null;

  const liveRatio = Number(line.max_ratio ?? line.avg_ratio ?? samples[0].ratio ?? 0);
  const crossing = samples.find((sample) => sample.ratio >= thresholdRatio);

  let event = crossing ?? samples[samples.length - 1];
  let basis: AiDecisionProposal['basis'] = 'forecast';
  let basisLabel = '';
  let minutesToCongestion: number | null = null;
  let profileTargetAt: string | null = null;
  let profileCrosses = false;

  if (crossing) {
    const alreadyOver = crossing.minutes === 0 || liveRatio >= thresholdRatio;
    basis = alreadyOver ? 'live' : 'forecast';
    minutesToCongestion = alreadyOver && crossing.minutes === 0 ? 0 : crossing.minutes;
    basisLabel = alreadyOver
      ? `Live reading already above the ${thresholdPct}% crowding threshold`
      : `Engine scan: threshold crossing at +${crossing.minutes} min`;
  } else {
    // Nothing crosses inside the scan — report the route's next recurring peak
    // window from the 14-day profile instead of returning an empty panel.
    const profile = await findNextPeakWindow(db, {
      lineId: line.line_id,
      stopId: worstStopId,
      thresholdRatio,
      timeZone,
    });
    if (profile) {
      const targetAt = new Date(profile.target_at);
      const profileResult = await engine.predict({
        lineIdOrCode: line.line_id,
        stopId: worstStopId,
        at: targetAt,
        capacity,
        weather: 'auto',
      });
      const profileRatio =
        profileResult?.predictedRatio ?? Number(profile.avg_ratio ?? profile.p90_ratio);
      event = {
        minutes: minutesBetween(now, targetAt),
        ratio: profileRatio,
        percentage: profileResult?.predictedOccupancyPercentage ?? pct(profileRatio),
        confidence: profileResult?.confidencePercentage ?? 82,
        headcount: profileResult?.headcount ?? Math.round(profileRatio * capacity),
        level: crowdLevelFromRatio(profileRatio),
        at: targetAt.toISOString(),
      };
      minutesToCongestion = minutesBetween(now, targetAt);
      profileTargetAt = targetAt.toISOString();
      basis = 'profile';
      // A recurring window whose forecast still crosses the threshold is a
      // congestion detection; a merely busy window stays a watch item.
      profileCrosses = profileRatio >= thresholdRatio;
      const windowLabel = `${String(Number(profile.hour_of_day)).padStart(2, '0')}:00 (${zonedClock(
        targetAt,
        timeZone,
      )} local)`;
      basisLabel = profileCrosses
        ? `Next recurring congestion window from the 14-day load profile — ${windowLabel}`
        : `Busiest upcoming window on the 14-day load profile — ${windowLabel}, forecast ${pct(
            profileRatio,
          )}% (profile average ${pct(Number(profile.avg_ratio))}%)`;
    } else {
      const peakRatio = Number(line.peak_24h_ratio ?? line.max_ratio ?? samples[0].ratio);
      event = { ...samples[samples.length - 1], ratio: peakRatio, percentage: pct(peakRatio) };
      basis = 'profile';
      basisLabel = "Trailing 24-hour peak load — no threshold crossing in the route's profile";
    }
  }

  const kind: AiDecisionProposal['kind'] = crossing || profileCrosses ? 'congestion' : 'watch';
  const predictedRatio = event.ratio;
  const predictedPct = pct(predictedRatio);
  const eventAt = new Date(event.at);

  // --- 2. recommend — compose the numbered actions from real rows -----------
  const reserve = await listReserveVehicles(db, line.line_id, 5);
  const vehiclesInService = Math.max(Number(line.vehicles_in_service), 1);
  const headway = Number(line.headway_minutes);
  const draft: (Omit<AiActionPlan, 'expectedReliefPct' | 'applied'> & { reliefFraction: number })[] =
    [];

  if (reserve.length) {
    const unit = reserve[0];
    draft.push({
      key: ACTION_KEYS.deploy,
      order: 1,
      title: 'Deploy additional vehicle',
      detail: `Release ${unit.code} to ${line.code}. With ${vehiclesInService} vehicle(s) already running a ${headway}-minute headway, the same demand is spread across ${
        vehiclesInService + 1
      } departures.`,
      reliefFraction: 1 / (vehiclesInService + 1),
      evidence: [
        { label: 'Reserve unit', value: `${unit.code} · ${unit.status.replace('_', ' ')}` },
        { label: 'Vehicles in service', value: String(vehiclesInService) },
        { label: 'Headway', value: `${headway} min` },
        { label: 'Capacity added', value: `${Math.round(capacity)} seats` },
      ],
      targetLabel: unit.code,
    });
  } else {
    draft.push({
      key: ACTION_KEYS.headway,
      order: 1,
      title: 'Tighten headway on the corridor',
      detail: `No reserve unit is free, so the play is to rebalance running times on ${line.code} and pull the next departure forward.`,
      reliefFraction: RELIEF_MODEL.headway,
      evidence: [
        { label: 'Reserve units', value: '0 available' },
        { label: 'Headway', value: `${headway} min` },
        { label: 'Vehicles in service', value: String(vehiclesInService) },
      ],
      targetLabel: `${line.code} timetable`,
    });
  }

  const alternative = await findAlternativeLine(db, line.line_id);
  if (alternative && alternative.id !== line.line_id) {
    const altRatio =
      alternative.alt_ratio === null || alternative.alt_ratio === undefined
        ? 0.2
        : Number(alternative.alt_ratio);
    draft.push({
      key: ACTION_KEYS.redirect,
      order: 2,
      title: `Redirect passengers to Route ${alternative.code}`,
      detail: `Steer boarding riders toward ${alternative.code} at ${
        alternative.shared_stop_name ?? 'the shared stop'
      } — it runs ${Number(alternative.headway_minutes)}-minute headways and is currently at ${pct(
        altRatio,
      )}% load.`,
      reliefFraction: clamp(
        (1 - altRatio) * RELIEF_MODEL.redirectShareOfSpare,
        RELIEF_MODEL.redirectFloor,
        RELIEF_MODEL.redirectCeil,
      ),
      evidence: [
        { label: 'Alt corridor', value: alternative.code },
        { label: 'Shared stop', value: alternative.shared_stop_name ?? '—' },
        { label: 'Alt load now', value: `${pct(altRatio)}%` },
        { label: 'Alt headway', value: `${Number(alternative.headway_minutes)} min` },
      ],
      targetLabel: `${alternative.code} via ${alternative.shared_stop_name ?? 'shared stop'}`,
    });
  }

  const reachEstimate = Math.round(Number(context?.corridor_daily_boardings ?? 0) * 0.08);
  draft.push({
    key: ACTION_KEYS.notify,
    order: draft.length + 1,
    title: 'Notify affected passengers',
    detail: `Push the crowd advisory to riders boarding ${line.code}, so flexible travellers shift to the following departure.`,
    reliefFraction: RELIEF_MODEL.notify,
    evidence: [
      { label: 'Riders reached', value: reachEstimate.toLocaleString('en-IN') },
      { label: 'Channel', value: 'Rider app + station screens' },
      { label: 'Stop', value: worstStopName ?? '—' },
    ],
    targetLabel: `${reachEstimate.toLocaleString('en-IN')} riders`,
  });

  // --- 3. project — compound the relief -------------------------------------
  let remaining = predictedRatio;
  const actions: AiActionPlan[] = draft.map((action) => {
    const relief = remaining * action.reliefFraction;
    remaining -= relief;
    return {
      ...action,
      reliefFraction: round(action.reliefFraction, 4),
      expectedReliefPct: round(relief * 100, 1),
      applied: false,
    };
  });
  const projectedRatio = Math.max(0, remaining);

  const impact: AiImpactProjection = {
    withoutPct: predictedPct,
    withPct: pct(projectedRatio),
    reliefPct: round(predictedPct - pct(projectedRatio), 1),
    withoutLevel: crowdLevelFromRatio(predictedRatio),
    withLevel: crowdLevelFromRatio(projectedRatio),
    passengersEased: Math.max(0, Math.round((predictedRatio - projectedRatio) * capacity)),
    targetAt: event.at,
    stopName: worstStopName,
    method: PROJECTION_METHOD,
    scan: [
      ...samples.map((sample) => ({ minutes: sample.minutes, ratio: round(sample.ratio, 3) })),
      ...(profileTargetAt && (minutesToCongestion ?? 0) > SCAN_MINUTES
        ? [{ minutes: minutesToCongestion as number, ratio: round(event.ratio, 3) }]
        : []),
    ],
  };

  const hoursAway = minutesToCongestion === null ? null : Math.round(minutesToCongestion / 6) / 10;
  const headline =
    kind === 'congestion'
      ? `${line.code} is forecast to reach ${predictedPct}% occupancy${
          minutesToCongestion === 0 ? ' right now' : ` in ${minutesToCongestion ?? event.minutes} minutes`
        }${worstStopName ? ` at ${worstStopName}` : ''} · ${zonedClock(eventAt, timeZone)} local`
      : `${line.code} has no ${thresholdPct}% crossing in the next ${
          SCAN_MINUTES / 60
        } hours — next peak load ${predictedPct}%${
          worstStopName ? ` at ${worstStopName}` : ''
        }${hoursAway === null ? '' : `, about ${hoursAway} h away`}`;

  return {
    id: `AID-P-${line.line_id}-${eventAt.getTime()}`,
    status: 'proposed',
    lineId: line.line_id,
    routeNumber: line.code,
    routeName: line.name,
    color: line.color,
    mode: line.mode,
    detectedAt: now.toISOString(),
    kind,
    headline,
    detectionNote: `Worst monitored stop${
      worstStopName ? `: ${worstStopName}` : ''
    } · engine scan +0 to +${SCAN_MINUTES} min in ${SCAN_STEP_MINUTES}-minute steps · confidence ${round(
      event.confidence,
      1,
    )}%`,
    basis,
    basisLabel,
    minutesToCongestion,
    horizonMinutes: minutesToCongestion ?? event.minutes,
    currentPct: pct(liveRatio),
    currentLevel: crowdLevelFromRatio(liveRatio),
    predictedPct,
    predictedLevel: crowdLevelFromRatio(predictedRatio),
    thresholdPct,
    confidencePct: round(event.confidence, 1),
    headcount: event.headcount,
    capacityPerVehicle: capacity,
    vehiclesInService: Number(line.vehicles_in_service),
    reserveVehicles: reserve.length,
    stop: worstStopId ? { stopId: worstStopId, name: worstStopName ?? worstStopId } : null,
    actions,
    impact,
    engine: `${engine.descriptor.id} ${engine.descriptor.version}`,
    disclaimer: SIMULATION_DISCLAIMER,
    simulated: true,
    generatedAt: now.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                      */
/* -------------------------------------------------------------------------- */

export interface ApplyDecisionArgs {
  lineIdOrCode: string;
  appliedBy?: string;
  force?: boolean;
}

export interface ApplyDecisionOutcome {
  /** A duplicate press inside the cooldown window. */
  conflict?: { intervention: AiInterventionSummary; message: string };
  result?: AiDecisionApplyResult;
}

async function readNetworkSnapshot(db: Queryable): Promise<NetworkSnapshot> {
  const row = await getCommandNetwork(db);
  return {
    activeVehicles: Number(row.active_vehicles),
    maintenanceVehicles: Number(row.maintenance_vehicles),
    idleVehicles: Number(row.idle_vehicles),
    openAlerts: Number(row.active_alerts),
    averageOccupancyPct: round(Number(row.avg_ratio ?? 0) * 100, 1),
  };
}

function describeAge(appliedAt: string | Date | null): string {
  if (!appliedAt) return 'just now';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(appliedAt).getTime()) / 60_000));
  if (minutes < 1) return 'seconds ago';
  if (minutes === 1) return 'a minute ago';
  return `${minutes} minutes ago`;
}

/**
 * Apply the AI recommendation: write the ledger, move a vehicle into service and
 * raise the rider-facing alert. Everything happens inside one transaction, so a
 * failure can never leave a half-applied intervention behind.
 */
export async function applyDecision(
  db: DatabaseClient,
  args: ApplyDecisionArgs,
): Promise<ApplyDecisionOutcome | null> {
  const proposal = await buildDecisionProposal(db, { lineIdOrCode: args.lineIdOrCode });
  if (!proposal) return null;

  if (!args.force) {
    const recent = await findRecentIntervention(db, proposal.lineId, INTERVENTION_COOLDOWN_MINUTES);
    if (recent) {
      return {
        conflict: {
          intervention: toInterventionSummary(recent),
          message: `An AI intervention was applied to ${proposal.routeNumber} ${describeAge(
            recent.applied_at,
          )}. Re-assess the route before applying another one.`,
        },
      };
    }
  }

  const before = await readNetworkSnapshot(db);
  const appliedAt = new Date();
  const decisionId = `AID-${appliedAt.getTime().toString(36).toUpperCase()}`;
  const alertId = `ALT-${(appliedAt.getTime() + 1).toString(36).toUpperCase()}`;
  const appliedBy = args.appliedBy ?? 'TransitPulse AI · Control Room';
  const context = await getLineContext(db, proposal.lineId);
  const reserve = await listReserveVehicles(db, proposal.lineId, 1);
  const reservation = reserve[0] ?? null;

  const alertTitle = `AI intervention applied: ${proposal.routeName}`;
  const alertBody = [
    `TransitPulse AI forecast ${proposal.impact.withoutPct}% occupancy on ${proposal.routeNumber}${
      proposal.stop ? ` at ${proposal.stop.name}` : ''
    }${
      proposal.minutesToCongestion !== null
        ? ` in ${proposal.minutesToCongestion} minutes`
        : ''
    }.`,
    `Actions applied by ${appliedBy}:`,
    proposal.actions.map((action, index) => `${index + 1}. ${action.title} — ${action.detail}`).join('\n'),
    `Projected occupancy after intervention: ${proposal.impact.withPct}% (${proposal.impact.reliefPct} points relieved, about ${proposal.impact.passengersEased} riders eased).`,
    'SIMULATED PROJECTION — the demo dataset is synthetic and no production accuracy is claimed.',
  ].join('\n\n');

  let vehicleId: string | null = null;
  let vehicleCode: string | null = null;
  let vehicleCreated = false;
  let previousStatus: VehicleStatus | null = null;
  let previousLineCode: string | null = null;

  await db.transaction(async (tx) => {
    if (reservation) {
      const previousLine = await tx.one<{ code: string }>(`select code from lines where id = $1`, [
        reservation.line_id,
      ]);
      const moved = await assignVehicleToLine(
        tx,
        reservation.id,
        proposal.lineId,
        proposal.stop?.stopId ?? null,
      );
      vehicleId = moved?.id ?? reservation.id;
      vehicleCode = moved?.code ?? reservation.code;
      previousStatus = reservation.status;
      previousLineCode = previousLine?.code ?? reservation.line_code;
    } else {
      const count = await tx.one<{ count: string }>(
        `select count(*)::text as count from vehicles where code like 'SPR-%'`,
      );
      const sequence = Number(count?.count ?? 0) + 1;
      const created = await createStandbyVehicle(tx, {
        id: `VEH-SPR-${sequence}`,
        code: `SPR-${100 + sequence}`,
        lineId: proposal.lineId,
        nextStopId: proposal.stop?.stopId ?? null,
        capacity: proposal.capacityPerVehicle,
      });
      vehicleId = created?.id ?? `VEH-SPR-${sequence}`;
      vehicleCode = created?.code ?? `SPR-${100 + sequence}`;
      vehicleCreated = true;
      previousStatus = null;
      previousLineCode = null;
    }

    const severity = proposal.impact.withoutPct >= 100 ? 'critical' : 'major';
    await insertInterventionAlert(tx, {
      id: alertId,
      agencyId: context?.agency_id ?? 'AG-MERIDIAN',
      lineId: proposal.lineId,
      stopId: proposal.stop?.stopId ?? null,
      severity,
      category: 'crowding',
      title: alertTitle,
      body: alertBody,
      endsAt: new Date(appliedAt.getTime() + 90 * 60_000),
      issuedBy: appliedBy,
      reach: Math.round(Number(context?.corridor_daily_boardings ?? 0) * 0.08),
    });

    await insertDecision(tx, {
      id: decisionId,
      agencyId: context?.agency_id ?? 'AG-MERIDIAN',
      lineId: proposal.lineId,
      stopId: proposal.stop?.stopId ?? null,
      basis: proposal.basis,
      detectedAt: new Date(proposal.detectedAt),
      appliedAt,
      targetAt: new Date(proposal.impact.targetAt),
      horizonMinutes: proposal.horizonMinutes,
      minutesToCongestion: proposal.minutesToCongestion,
      currentRatio: round(proposal.currentPct / 100, 3),
      predictedRatio: round(proposal.impact.withoutPct / 100, 3),
      projectedRatio: round(proposal.impact.withPct / 100, 3),
      thresholdRatio: round(proposal.thresholdPct / 100, 3),
      confidence: round(proposal.confidencePct / 100, 3),
      headcount: proposal.headcount,
      capacity: Math.round(proposal.capacityPerVehicle),
      vehiclesInService: proposal.vehiclesInService,
      method: PROJECTION_METHOD,
      modelVersion: proposal.engine.split(' ').pop() ?? proposal.engine,
      vehicleId,
      alertId,
      appliedBy,
      note: `Intervention applied from the Operator Command Center${
        vehicleCode ? ` · ${vehicleCode} released to ${proposal.routeNumber}` : ''
      }. ${proposal.impact.reliefPct} points of relief forecast. SIMULATED PROJECTION.`,
    });

    // Persist the per-action relief so the ledger explains the projection.
    let remaining = proposal.impact.withoutPct / 100;
    const actionRows = proposal.actions.map((action, index) => {
      const relief = remaining * action.reliefFraction;
      remaining -= relief;
      return {
        seq: index + 1,
        key: action.key,
        title: action.title,
        detail: action.detail,
        reliefFraction: round(action.reliefFraction, 4),
        expectedReliefPct: round(relief * 100, 2),
        evidence: action.evidence,
        targetLabel: action.targetLabel,
      };
    });
    await insertDecisionActions(tx, decisionId, actionRows, appliedAt);
  });

  const stored = await getIntervention(db, decisionId);
  if (!stored) {
    throw new Error('Intervention was applied but the ledger row could not be read back');
  }

  const after = await readNetworkSnapshot(db);
  const severity = proposal.impact.withoutPct >= 100 ? 'critical' : 'major';

  return {
    result: {
      decision: {
        ...proposal,
        id: decisionId,
        status: 'applied',
        detectedAt: appliedAt.toISOString(),
        actions: proposal.actions.map((action) => ({ ...action, applied: true })),
      },
      intervention: toInterventionSummary(stored),
      effects: {
        vehicle: vehicleId
          ? {
              id: vehicleId,
              code: vehicleCode ?? vehicleId,
              created: vehicleCreated,
              previousStatus,
              previousLineCode,
              lineCode: proposal.routeNumber,
            }
          : null,
        alert: { id: alertId, title: alertTitle, severity, category: 'crowding' },
        decisionId,
        before,
        after,
      },
    },
  };
}

/** Rolling count of interventions applied in the last 24 hours. */
export async function interventionsLast24h(db: Queryable): Promise<number> {
  return countInterventionsSince(db, 24);
}

/** Read the ledger row for a decision (used by the console after applying). */
export async function getInterventionById(
  db: Queryable,
  id: string,
): Promise<AiInterventionSummary | null> {
  const row: InterventionReadRow | null = await getIntervention(db, id);
  return row ? toInterventionSummary(row) : null;
}

/** Remove an intervention and its side effects — keeps repeated demos tidy. */
export async function revertDecision(db: DatabaseClient, id: string): Promise<void> {
  const row = await getIntervention(db, id);
  if (!row) return;
  if (row.alert_id) await db.query(`delete from alerts where id = $1`, [row.alert_id]);
  if (row.vehicle_id) {
    await db.query(
      `update vehicles set status = 'maintenance', last_ping = now() where id = $1`,
      [row.vehicle_id],
    );
  }
  await deleteDecision(db, id);
}
