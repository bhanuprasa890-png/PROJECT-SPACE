import { useMemo, useState } from 'react';
import {
  Activity,
  Bus,
  Gauge,
  Radio,
  Search,
  Server,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import type { FleetVehicle, LineLoadRow } from '@shared/types';
import { useOperatorOverview, useHealth } from '../hooks/useTransitData';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Controls';
import { StatTile } from '../components/ui/StatTile';
import { Sparkline } from '../components/ui/Sparkline';
import { ErrorState, PanelSkeleton } from '../components/ui/Skeleton';
import { CrowdBadge, CrowdLegend, CrowdMeter } from '../components/crowd/CrowdIndicators';
import { CrowdHotspotList, LivePill } from '../components/crowd/CrowdHotspotList';
import {
  cn,
  crowdTone,
  formatNumber,
  formatPercent,
  formatTimeAgo,
  severityTone,
} from '../lib/utils';

type Panel = 'overview' | 'fleet' | 'lines' | 'demand';

export function OperatorDashboard() {
  const [panel, setPanel] = useState<Panel>('overview');
  const [windowHours, setWindowHours] = useState(24);
  const { data, isLoading, isError, error, refetch } = useOperatorOverview(windowHours);
  const health = useHealth();

  const fleetByStatus = useMemo(() => {
    const fleet = data?.fleet ?? [];
    return {
      inService: fleet.filter((vehicle) => vehicle.status === 'in_service'),
      maintenance: fleet.filter((vehicle) => vehicle.status === 'maintenance'),
      idle: fleet.filter((vehicle) => vehicle.status === 'idle'),
    };
  }, [data?.fleet]);

  const busiestLines = useMemo(
    () => [...(data?.lines ?? [])].sort((a, b) => b.avgRatio - a.avgRatio),
    [data?.lines],
  );

  if (isError) {
    return (
      <ErrorState
        title="Operator data unavailable"
        message={(error as Error)?.message}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Panel>
          value={panel}
          onChange={setPanel}
          options={[
            { value: 'overview', label: 'Overview', icon: <Gauge className="size-3.5" /> },
            { value: 'fleet', label: 'Fleet', icon: <Bus className="size-3.5" /> },
            { value: 'lines', label: 'Line load', icon: <TrendingUp className="size-3.5" /> },
            { value: 'demand', label: 'Demand', icon: <Search className="size-3.5" /> },
          ]}
        />
        <div className="flex items-center gap-2">
          <Segmented<string>
            size="sm"
            value={String(windowHours)}
            onChange={(value) => setWindowHours(Number(value))}
            options={[
              { value: '6', label: '6h' },
              { value: '12', label: '12h' },
              { value: '24', label: '24h' },
              { value: '48', label: '48h' },
            ]}
          />
          <LivePill label="Telemetry" />
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 7 }).map((_, index) => (
              <Card key={index} className="p-4">
                <PanelSkeleton rows={2} />
              </Card>
            ))
          : data?.kpis.map((kpi) => (
              <StatTile
                key={kpi.key}
                label={kpi.label}
                value={kpi.value}
                unit={kpi.unit}
                hint={kpi.hint}
                deltaPct={kpi.deltaPct}
                comparisonLabel={kpi.comparisonLabel}
                series={kpi.series}
                tone={kpi.tone}
                animated
                icon={
                  {
                    fleet_active: Bus,
                    avg_load: Gauge,
                    on_time: Timer,
                    crowd_events: Activity,
                    searches: Search,
                    crowding_avoided: ShieldCheck,
                    alerts: Radio,
                  }[kpi.key] ?? Activity
                }
              />
            ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {panel === 'overview' ? (
            <>
              <Card>
                <CardHeader
                  title="Line load profile"
                  subtitle="Average occupancy by hour of day, learned from crowd_observations"
                  icon={<TrendingUp className="size-4" />}
                />
                <CardBody className="space-y-4">
                  {isLoading ? (
                    <PanelSkeleton rows={4} />
                  ) : (
                    busiestLines.map((line) => <LineLoadRow key={line.lineId} line={line} />)
                  )}
                  <CrowdLegend className="border-t border-white/6 pt-3" />
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Fleet state"
                  subtitle={`${fleetByStatus.inService.length} in service · ${fleetByStatus.maintenance.length} maintenance · ${fleetByStatus.idle.length} idle`}
                  icon={<Bus className="size-4" />}
                />
                <CardBody className="space-y-2">
                  {isLoading ? (
                    <PanelSkeleton rows={4} />
                  ) : (
                    fleetByStatus.inService.slice(0, 8).map((vehicle) => (
                      <FleetRow key={vehicle.id} vehicle={vehicle} />
                    ))
                  )}
                </CardBody>
              </Card>
            </>
          ) : null}

          {panel === 'fleet' ? (
            <Card>
              <CardHeader
                title="All vehicles"
                subtitle="Load is derived from the latest telemetry at each vehicle's next stop"
                icon={<Bus className="size-4" />}
                actions={
                  <Badge tone="neutral" icon={<Wrench className="size-3" />}>
                    {fleetByStatus.maintenance.length} off road
                  </Badge>
                }
              />
              <CardBody>
                {isLoading ? (
                  <PanelSkeleton rows={6} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead>
                        <tr className="text-[0.62rem] tracking-wider text-mist-500 uppercase">
                          <th className="px-3 py-2 font-medium">Vehicle</th>
                          <th className="px-3 py-2 font-medium">Line</th>
                          <th className="px-3 py-2 font-medium">Next stop</th>
                          <th className="px-3 py-2 font-medium">Load</th>
                          <th className="px-3 py-2 font-medium">Adherence</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data?.fleet.map((vehicle) => (
                          <tr key={vehicle.id} className="border-t border-white/6">
                            <td className="px-3 py-2.5 font-mono text-mist-200">{vehicle.code}</td>
                            <td className="px-3 py-2.5">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: vehicle.lineColor }}
                                />
                                <span className="font-mono text-mist-300">{vehicle.lineCode}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-mist-300">{vehicle.nextStopName}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <CrowdMeter
                                  ratio={vehicle.ratio}
                                  level={vehicle.level}
                                  height="sm"
                                  className="w-24"
                                />
                                <span className={cn('font-mono', crowdTone(vehicle.level).text)}>
                                  {formatPercent(vehicle.ratio)}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-mist-300">
                              {vehicle.adherencePct.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge
                                tone={
                                  vehicle.status === 'in_service'
                                    ? 'low'
                                    : vehicle.status === 'idle'
                                      ? 'neutral'
                                      : 'moderate'
                                }
                                size="xs"
                              >
                                {vehicle.status.replace('_', ' ')}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : null}

          {panel === 'lines' ? (
            <Card>
              <CardHeader
                title="Per-line performance"
                subtitle="24-hour load, peak hour and schedule adherence"
                icon={<TrendingUp className="size-4" />}
              />
              <CardBody className="space-y-3">
                {isLoading ? (
                  <PanelSkeleton rows={5} />
                ) : (
                  data?.lines.map((line) => (
                    <div
                      key={line.lineId}
                      className="rounded-xl border border-white/8 bg-white/[0.02] p-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span
                            className="grid size-7 place-items-center rounded-lg text-[0.65rem] font-bold text-ink-950"
                            style={{ backgroundColor: line.color }}
                          >
                            {line.lineCode.slice(0, 3)}
                          </span>
                          <span>
                            <span className="block text-xs font-medium text-mist-100">
                              {line.lineName}
                            </span>
                            <span className="block text-[0.62rem] text-mist-500 uppercase">
                              {line.mode} · {line.vehiclesInService} vehicles
                            </span>
                          </span>
                        </span>
                        <span className="flex items-center gap-3 text-[0.68rem]">
                          <span className="text-mist-400">
                            peak{' '}
                            <span className="font-mono text-mist-200">
                              {String(line.peakHour).padStart(2, '0')}:00
                            </span>
                          </span>
                          <span className="text-mist-400">
                            on time{' '}
                            <span
                              className={cn(
                                'font-mono',
                                line.onTimePct >= 92 ? 'text-crowd-low' : 'text-crowd-moderate',
                              )}
                            >
                              {line.onTimePct}%
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
          <span className="text-[0.65rem] text-mist-500">
            avg <span className="font-mono text-mist-300">{formatPercent(line.avgRatio)}</span>
          </span>
          <CrowdBadge level={line.level} label={`peak ${formatPercent(line.peakRatio)}`} size="xs" />
        </span>
                        </span>
                      </div>
                      <div className="mt-3 flex items-end gap-[3px]">
                        {line.hourlyProfile.map((value, hour) => {
                          const tone = crowdTone(
                            value >= 1 ? 'critical' : value >= 0.8 ? 'high' : value >= 0.55 ? 'moderate' : 'low',
                          );
                          return (
                            <span
                              key={hour}
                              title={`${String(hour).padStart(2, '0')}:00 · ${formatPercent(value)}`}
                              className="flex-1 rounded-sm transition-all duration-500"
                              style={{
                                height: `${Math.max(3, Math.min(value, 1.35) * 46)}px`,
                                backgroundColor: tone.stroke,
                                opacity: value > 0 ? 0.85 : 0.15,
                              }}
                            />
                          );
                        })}
                      </div>
                      <div className="mt-1 flex justify-between font-mono text-[0.55rem] text-mist-600">
                        <span>00</span>
                        <span>06</span>
                        <span>12</span>
                        <span>18</span>
                        <span>23</span>
                      </div>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          ) : null}

          {panel === 'demand' ? (
            <Card>
              <CardHeader
                title="Demand signals"
                subtitle="Aggregated route searches over the last 14 days — real rider intent"
                icon={<Search className="size-4" />}
              />
              <CardBody className="space-y-2">
                {isLoading ? (
                  <PanelSkeleton rows={5} />
                ) : (
                  data?.demandSignals.map((signal) => (
                    <div
                      key={signal.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-mist-100">
                          {signal.originStopName} → {signal.destinationStopName}
                        </p>
                        <p className="mt-0.5 text-[0.65rem] text-mist-500">
                          Last searched {formatTimeAgo(signal.lastSearchedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-[0.68rem]">
                        <span className="text-mist-400">
                          <span className="font-mono text-mist-100">{formatNumber(signal.searches)}</span>{' '}
                          searches
                        </span>
                        <span className="text-mist-400">
                          <span className="font-mono text-crowd-low">
                            {signal.avoidCrowdingPct.toFixed(0)}%
                          </span>{' '}
                          crowd-aware
                        </span>
                        <span className="text-mist-400">
                          <span className="font-mono text-pulse-300">
                            {signal.recommendedShare.toFixed(0)}%
                          </span>{' '}
                          took the quieter pick
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <Card accent="critical">
            <CardHeader
              title="Crowding hotspots"
              subtitle="Worst measured load per line, updated continuously"
              icon={<Activity className="size-4" />}
            />
            <CardBody>
              {isLoading ? (
                <PanelSkeleton rows={4} />
              ) : (
                <CrowdHotspotList hotspots={data?.hotspots ?? []} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Live alerts"
              subtitle="Notices the control room has published"
              icon={<Radio className="size-4" />}
            />
            <CardBody className="space-y-2">
              {isLoading ? (
                <PanelSkeleton rows={3} />
              ) : data?.activeAlerts.length ? (
                data.activeAlerts.slice(0, 6).map((alert) => {
                  const tone = severityTone(alert.severity);
                  return (
                    <div key={alert.id} className={cn('rounded-xl border px-3 py-2.5', tone.border, tone.bg)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('text-[0.65rem] font-semibold uppercase', tone.text)}>
                          {alert.severity}
                        </span>
                        <span className="font-mono text-[0.62rem] text-mist-500">
                          {alert.lineCode ?? 'Network'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-mist-100">{alert.title}</p>
                      <p className="mt-0.5 text-[0.65rem] text-mist-500">
                        Reached {formatNumber(alert.reach)} riders
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-mist-500">No active alerts.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="System health"
              subtitle="Where the numbers on this page come from"
              icon={<Server className="size-4" />}
            />
            <CardBody className="space-y-2.5 text-[0.7rem]">
              {health.isLoading ? (
                <PanelSkeleton rows={4} />
              ) : health.data ? (
                <>
                  <HealthRow label="Database" value={
                    health.data.database.driver === 'supabase-postgres'
                      ? 'Supabase Postgres'
                      : 'Postgres (embedded)'
                  } />
                  <HealthRow label="Schema" value={health.data.database.schemaVersion ?? '—'} />
                  <HealthRow label="Query latency" value={`${health.data.database.latencyMs.toFixed(1)} ms`} />
                  <HealthRow label="Model" value={health.data.modelVersion} />
                  <HealthRow
                    label="Telemetry rows"
                    value={formatNumber(health.data.database.rows.observation_count ?? 0)}
                  />
                  <HealthRow
                    label="Stored forecasts"
                    value={formatNumber(health.data.database.rows.forecast_count ?? 0)}
                  />
                  <HealthRow label="Uptime" value={`${Math.floor(health.data.uptimeSeconds / 60)} min`} />
                </>
              ) : (
                <p className="text-mist-500">Health endpoint unreachable.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Window summary"
              subtitle={`Aggregated over the last ${windowHours} hours of telemetry`}
              icon={<Users className="size-4" />}
              actions={
                <Button size="sm" variant="ghost" onClick={() => void refetch()}>
                  Refresh
                </Button>
              }
            />
            <CardBody className="space-y-3">
              <Sparkline
                data={data?.kpis.find((kpi) => kpi.key === 'avg_load')?.series ?? []}
                color="#38f5c0"
                height={54}
              />
              <p className="text-[0.68rem] leading-relaxed text-mist-500">
                Average network load over the window. Peaks above the 85% service threshold trigger
                the crowding alerts published to riders.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LineLoadRow({ line }: { line: LineLoadRow }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span
            className="grid size-7 place-items-center rounded-lg text-[0.65rem] font-bold text-ink-950"
            style={{ backgroundColor: line.color }}
          >
            {line.lineCode.slice(0, 3)}
          </span>
          <span className="text-xs font-medium text-mist-100">{line.lineName}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[0.65rem] text-mist-500">
            avg <span className="font-mono text-mist-300">{formatPercent(line.avgRatio)}</span>
          </span>
          <CrowdBadge level={line.level} label={`peak ${formatPercent(line.peakRatio)}`} size="xs" />
        </span>
      </div>
      <div className="mt-3 flex items-end gap-[3px]">
        {line.hourlyProfile.map((value, hour) => {
          const tone = crowdTone(
            value >= 1 ? 'critical' : value >= 0.8 ? 'high' : value >= 0.55 ? 'moderate' : 'low',
          );
          return (
            <span
              key={hour}
              title={`${String(hour).padStart(2, '0')}:00 · ${formatPercent(value)}`}
              className="flex-1 rounded-sm"
              style={{
                height: `${Math.max(3, Math.min(value, 1.35) * 40)}px`,
                backgroundColor: tone.stroke,
                opacity: value > 0 ? 0.85 : 0.15,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function FleetRow({ vehicle }: { vehicle: FleetVehicle }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-lg text-[0.62rem] font-bold text-ink-950"
        style={{ backgroundColor: vehicle.lineColor }}
      >
        {vehicle.lineCode.slice(0, 3)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs text-mist-100">
            <span className="font-mono">{vehicle.code}</span>
            <span className="ml-2 text-mist-500">→ {vehicle.nextStopName}</span>
          </p>
          <span className="font-mono text-[0.68rem] text-mist-400">
            {vehicle.headcount}/{vehicle.capacity}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <CrowdMeter ratio={vehicle.ratio} level={vehicle.level} height="sm" className="flex-1" />
          <span className={cn('font-mono text-[0.65rem]', crowdTone(vehicle.level).text)}>
            {formatPercent(vehicle.ratio)}
          </span>
        </div>
      </div>
      <span className="hidden shrink-0 text-[0.65rem] text-mist-500 sm:block">
        {formatTimeAgo(vehicle.lastPing)}
      </span>
    </div>
  );
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 last:border-0">
      <span className="text-mist-500">{label}</span>
      <span className="truncate font-mono text-mist-200">{value}</span>
    </div>
  );
}
