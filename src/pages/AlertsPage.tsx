import { useMemo, useState } from 'react';
import { BellRing, Filter, Megaphone, Plus, Radio, Send, Trash2, TriangleAlert } from 'lucide-react';
import type { AlertCategory, AlertSeverity, AlertStatus } from '@shared/types';
import {
  useAlerts,
  useCreateAlert,
  useDeleteAlert,
  useNetwork,
  useUpdateAlertStatus,
} from '../hooks/useTransitData';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, Input, Segmented, Select } from '../components/ui/Controls';
import { EmptyState, ErrorState, PanelSkeleton } from '../components/ui/Skeleton';
import { LivePill } from '../components/crowd/CrowdHotspotList';
import { cn, formatDateTime, formatNumber, formatRelative, severityTone } from '../lib/utils';

type StatusFilter = AlertStatus | 'all';

const CATEGORY_LABELS: Record<AlertCategory, string> = {
  crowding: 'Crowding',
  delay: 'Delay',
  disruption: 'Disruption',
  service_change: 'Service change',
  weather: 'Weather',
  maintenance: 'Maintenance',
};

export function AlertsPage() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [severity, setSeverity] = useState<AlertSeverity | 'all'>('all');
  const [composerOpen, setComposerOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useAlerts({
    status,
    severity: severity === 'all' ? undefined : severity,
    limit: 60,
  });
  const updateStatus = useUpdateAlertStatus();
  const deleteAlert = useDeleteAlert();

  const grouped = useMemo(() => {
    const alerts = data?.alerts ?? [];
    return {
      active: alerts.filter((alert) => alert.status === 'active'),
      scheduled: alerts.filter((alert) => alert.status === 'scheduled'),
      resolved: alerts.filter((alert) => alert.status === 'resolved'),
    };
  }, [data?.alerts]);

  const reach = useMemo(
    () => (data?.alerts ?? []).reduce((sum, alert) => sum + alert.reach, 0),
    [data?.alerts],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Active" value={grouped.active.length} tone="critical" icon={<Radio className="size-4" />} />
        <SummaryTile label="Scheduled" value={grouped.scheduled.length} tone="moderate" icon={<BellRing className="size-4" />} />
        <SummaryTile label="Resolved" value={grouped.resolved.length} tone="low" icon={<Filter className="size-4" />} />
        <SummaryTile
          label="Riders reached"
          value={formatNumber(reach)}
          tone="pulse"
          icon={<Megaphone className="size-4" />}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Service notices"
            subtitle={`${data?.count ?? 0} notices · severity ${severity} · status ${status}`}
            icon={<TriangleAlert className="size-4" />}
            actions={<LivePill label="Live" />}
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Segmented<StatusFilter>
                size="sm"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'active', label: 'Active' },
                  { value: 'scheduled', label: 'Scheduled' },
                  { value: 'resolved', label: 'Resolved' },
                ]}
              />
              <Select
                className="w-auto"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as AlertSeverity | 'all')}
                options={[
                  { value: 'all', label: 'Any severity' },
                  { value: 'critical', label: 'Critical' },
                  { value: 'major', label: 'Major' },
                  { value: 'minor', label: 'Minor' },
                  { value: 'info', label: 'Info' },
                ]}
              />
              <Button
                size="sm"
                variant={composerOpen ? 'secondary' : 'primary'}
                icon={<Plus className="size-3.5" />}
                className="ml-auto"
                onClick={() => setComposerOpen((previous) => !previous)}
              >
                {composerOpen ? 'Close composer' : 'Publish alert'}
              </Button>
            </div>

            {isError ? (
              <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
            ) : isLoading ? (
              <PanelSkeleton rows={5} />
            ) : data?.alerts.length ? (
              <ul className="space-y-2.5">
                {data.alerts.map((alert) => {
                  const tone = severityTone(alert.severity);
                  return (
                    <li
                      key={alert.id}
                      className={cn(
                        'animate-rise rounded-xl border px-4 py-3.5 transition-colors',
                        alert.status === 'resolved'
                          ? 'border-white/8 bg-white/[0.015] opacity-70'
                          : cn(tone.border, tone.bg),
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={alert.severity === 'info' ? 'info' : alert.severity === 'minor' ? 'moderate' : alert.severity === 'major' ? 'high' : 'critical'} size="xs">
                            {alert.severity}
                          </Badge>
                          <Badge tone="neutral" size="xs">
                            {CATEGORY_LABELS[alert.category]}
                          </Badge>
                          {alert.lineCode ? (
                            <span className="inline-flex items-center gap-1.5 text-[0.65rem] text-mist-300">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: alert.lineColor ?? '#38bdf8' }}
                              />
                              {alert.lineCode}
                            </span>
                          ) : (
                            <span className="text-[0.65rem] text-mist-500">Network-wide</span>
                          )}
                          {alert.stopName ? (
                            <span className="text-[0.65rem] text-mist-500">· {alert.stopName}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[0.62rem] text-mist-500">
                            {alert.status === 'resolved'
                              ? `resolved ${formatRelative(alert.endsAt)}`
                              : `started ${formatRelative(alert.startsAt)}`}
                          </span>
                          {alert.status !== 'resolved' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={updateStatus.isPending && updateStatus.variables?.alertId === alert.id}
                              onClick={() =>
                                updateStatus.mutate({ alertId: alert.id, status: 'resolved' })
                              }
                            >
                              Resolve
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                updateStatus.mutate({ alertId: alert.id, status: 'active' })
                              }
                            >
                              Reopen
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Retract ${alert.title}`}
                            loading={deleteAlert.isPending && deleteAlert.variables === alert.id}
                            onClick={() => deleteAlert.mutate(alert.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm font-medium text-mist-100">{alert.title}</p>
                      <p className="mt-1 text-[0.72rem] leading-relaxed text-mist-300">{alert.body}</p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.65rem] text-mist-500">
                        <span>
                          {alert.status === 'scheduled'
                            ? `Goes live ${formatDateTime(alert.startsAt)}`
                            : `Started ${formatDateTime(alert.startsAt)}`}
                        </span>
                        {alert.endsAt ? <span>Ends {formatDateTime(alert.endsAt)}</span> : null}
                        <span>Reached {formatNumber(alert.reach)} riders</span>
                        {alert.issuedBy ? <span>Issued by {alert.issuedBy}</span> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                title="No alerts match those filters"
                description="Try a different status or severity, or publish a new service notice."
              />
            )}
          </CardBody>
        </Card>

        <div className="space-y-5">
          {composerOpen ? <AlertComposer onDone={() => setComposerOpen(false)} /> : null}

          <Card>
            <CardHeader
              title="Severity mix"
              subtitle="Open notices by severity, from the database"
              icon={<Filter className="size-4" />}
            />
            <CardBody className="space-y-2">
              {(['critical', 'major', 'minor', 'info'] as AlertSeverity[]).map((level) => {
                const tone = severityTone(level);
                const count = data?.severityBreakdown?.[level] ?? 0;
                const total = Math.max(
                  1,
                  Object.values(data?.severityBreakdown ?? {}).reduce((sum, value) => sum + value, 0),
                );
                return (
                  <div key={level} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[0.7rem]">
                      <span className={tone.text}>{tone.label}</span>
                      <span className="font-mono text-mist-400">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full transition-[width] duration-700"
                        style={{ width: `${(count / total) * 100}%`, backgroundColor: tone.stroke }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Alert pipeline"
              subtitle="How a notice reaches riders"
              icon={<Send className="size-4" />}
            />
            <CardBody className="space-y-2.5 text-[0.7rem] text-mist-400">
              <PipelineStep
                step="1"
                title="Detection"
                detail="The crowd model flags load above the service threshold (85% by default)."
              />
              <PipelineStep
                step="2"
                title="Publishing"
                detail="Control room publishes through POST /api/alerts, stored in the alerts table."
              />
              <PipelineStep
                step="3"
                title="Delivery"
                detail="Riders see it on the dashboard, alerts screen and affected journey plans."
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  tone: 'critical' | 'moderate' | 'low' | 'pulse';
  icon: React.ReactNode;
}) {
  const toneClass = {
    critical: 'text-crowd-critical border-crowd-critical/30 bg-crowd-critical/10',
    moderate: 'text-crowd-moderate border-crowd-moderate/30 bg-crowd-moderate/10',
    low: 'text-crowd-low border-crowd-low/30 bg-crowd-low/10',
    pulse: 'text-pulse-300 border-pulse-400/30 bg-pulse-400/10',
  }[tone];

  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn('grid size-9 place-items-center rounded-xl border', toneClass)}>{icon}</span>
      <div>
        <p className="text-[0.62rem] tracking-wider text-mist-500 uppercase">{label}</p>
        <p className="font-display text-xl font-semibold text-mist-100">{value}</p>
      </div>
    </Card>
  );
}

function PipelineStep({ step, title, detail }: { step: string; title: string; detail: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
      <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 font-mono text-[0.65rem] text-pulse-300">
        {step}
      </span>
      <div>
        <p className="text-xs font-medium text-mist-200">{title}</p>
        <p className="mt-0.5 leading-relaxed text-mist-500">{detail}</p>
      </div>
    </div>
  );
}

function AlertComposer({ onDone }: { onDone: () => void }) {
  const { data: network } = useNetwork();
  const createAlert = useCreateAlert();
  const [form, setForm] = useState({
    title: '',
    body: '',
    severity: 'minor' as AlertSeverity,
    category: 'delay' as AlertCategory,
    lineId: '',
    stopId: '',
    startsAt: '',
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (form.title.trim().length < 4 || form.body.trim().length < 8) {
      setError('Give the notice a clear title (4+ characters) and a body (8+ characters).');
      return;
    }
    setError(null);
    try {
      await createAlert.mutateAsync({
        title: form.title.trim(),
        body: form.body.trim(),
        severity: form.severity,
        category: form.category,
        lineId: form.lineId || null,
        stopId: form.stopId || null,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
        issuedBy: 'Control Room',
      });
      setForm({
        title: '',
        body: '',
        severity: 'minor',
        category: 'delay',
        lineId: '',
        stopId: '',
        startsAt: '',
      });
      onDone();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  return (
    <Card accent="pulse">
      <CardHeader
        title="Publish a service notice"
        subtitle="Written to the alerts table and picked up by every rider screen"
        icon={<Plus className="size-4" />}
      />
      <CardBody className="space-y-3">
        <Field label="Title">
          <Input
            value={form.title}
            placeholder="e.g. Platform change at Central Exchange"
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="Details">
          <textarea
            value={form.body}
            rows={3}
            placeholder="What riders should know and do."
            onChange={(event) => setForm({ ...form, body: event.target.value })}
            className="w-full rounded-xl border border-white/10 bg-ink-900/70 px-3 py-2.5 text-sm text-mist-100 placeholder:text-mist-500 focus:border-pulse-400/60 focus:outline-none"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Severity">
            <Select
              value={form.severity}
              onChange={(event) => setForm({ ...form, severity: event.target.value as AlertSeverity })}
              options={[
                { value: 'info', label: 'Info' },
                { value: 'minor', label: 'Minor' },
                { value: 'major', label: 'Major' },
                { value: 'critical', label: 'Critical' },
              ]}
            />
          </Field>
          <Field label="Category">
            <Select
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value as AlertCategory })}
              options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Line (optional)">
            <Select
              value={form.lineId}
              onChange={(event) => setForm({ ...form, lineId: event.target.value })}
              options={[
                { value: '', label: 'Network-wide' },
                ...(network?.lines ?? []).map((line) => ({
                  value: line.id,
                  label: `${line.code} · ${line.name}`,
                })),
              ]}
            />
          </Field>
          <Field label="Stop (optional)">
            <Select
              value={form.stopId}
              onChange={(event) => setForm({ ...form, stopId: event.target.value })}
              options={[
                { value: '', label: 'All stops' },
                ...(network?.stops ?? []).map((stop) => ({ value: stop.id, label: stop.name })),
              ]}
            />
          </Field>
        </div>
        <Field label="Go live at (optional)" hint="Leave empty to publish immediately.">
          <Input
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
          />
        </Field>

        {error ? <p className="text-xs text-crowd-critical">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={createAlert.isPending}
            icon={<Send className="size-3.5" />}
            onClick={() => void submit()}
          >
            Publish notice
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
