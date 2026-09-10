import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Bookmark,
  Check,
  Gauge,
  Plus,
  Save,
  Trash2,
  User,
} from 'lucide-react';
import type { RiderProfile, TransitMode } from '@shared/types';
import {
  useCreateWatchlistItem,
  useDeleteWatchlistItem,
  useProfile,
  useSettingsOptions,
  useToggleWatchlistItem,
  useUpdateProfile,
  useWatchlist,
} from '../hooks/useTransitData';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Input, Segmented, Select, Slider, Toggle } from '../components/ui/Controls';
import { EmptyState, ErrorState, PanelSkeleton } from '../components/ui/Skeleton';
import { SectionHeading } from '../components/ui/Section';
import { cn, crowdToneForRatio, formatPercent, MODE_LABELS } from '../lib/utils';

const DAYS = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'S' },
];

export function SettingsPage() {
  const profile = useProfile();
  const options = useSettingsOptions();
  const watchlist = useWatchlist();
  const updateProfile = useUpdateProfile();
  const createItem = useCreateWatchlistItem();
  const toggleItem = useToggleWatchlistItem();
  const deleteItem = useDeleteWatchlistItem();

  const [draft, setDraft] = useState<Partial<RiderProfile>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile.data) setDraft({});
  }, [profile.data]);

  const effective = { ...(profile.data as RiderProfile), ...draft };

  const patch = (values: Partial<RiderProfile>): void => {
    setDraft((previous) => ({ ...previous, ...values }));
    setSaved(false);
  };

  const save = async (): Promise<void> => {
    await updateProfile.mutateAsync(draft);
    setDraft({});
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  if (profile.isError) {
    return (
      <ErrorState
        title="Could not load your preferences"
        error={profile.error}
        onRetry={() => void profile.refetch()}
      />
    );
  }

  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="space-y-6 pb-28 lg:pb-10">
      <SectionHeading
        eyebrow="Rider"
        title="Preferences"
        description="Everything on this page is stored in Postgres and read back by the planner on every request — change a value and the next recommendation changes with it."
        icon={Gauge}
        actions={dirty ? <Badge tone="moderate" size="xs">Unsaved changes</Badge> : undefined}
      />
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        {/* Routing preferences */}
        <div className="space-y-5">
          <Card accent="pulse">
            <CardHeader
              title="Routing preferences"
              subtitle="These values drive the planner's crowd weighting and transfer limits"
              icon={<Gauge className="size-4" />}
              actions={
                saved ? (
                  <Badge tone="low" icon={<Check className="size-3" />}>
                    Saved
                  </Badge>
                ) : null
              }
            />
            <CardBody className="space-y-5">
              {profile.isLoading ? (
                <PanelSkeleton rows={5} />
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Home stop" hint="Used for the default morning journey.">
                      <Select
                        value={effective.homeStopId ?? ''}
                        onChange={(event) => patch({ homeStopId: event.target.value || null })}
                        options={[
                          { value: '', label: 'Not set' },
                          ...(options.data?.stops ?? []).map((stop) => ({
                            value: stop.id,
                            label: `${stop.name} (${stop.code})`,
                          })),
                        ]}
                      />
                    </Field>
                    <Field label="Work / study stop">
                      <Select
                        value={effective.workStopId ?? ''}
                        onChange={(event) => patch({ workStopId: event.target.value || null })}
                        options={[
                          { value: '', label: 'Not set' },
                          ...(options.data?.stops ?? []).map((stop) => ({
                            value: stop.id,
                            label: `${stop.name} (${stop.code})`,
                          })),
                        ]}
                      />
                    </Field>
                  </div>

                  <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-4">
                    <Slider
                      label="Crowd tolerance"
                      value={effective.crowdTolerance ?? 0.8}
                      min={0.3}
                      max={1.2}
                      step={0.05}
                      onChange={(value) => patch({ crowdTolerance: value })}
                      format={(value) =>
                        `${Math.round(value * 100)}% — ${describeTolerance(value)}`
                      }
                    />
                    <p
                      className={cn(
                        'mt-3 text-2xs',
                        crowdToneForRatio(effective.crowdTolerance ?? 0.8).text,
                      )}
                    >
                      Options peaking above {formatPercent(effective.crowdTolerance ?? 0.8)} are
                      penalised more heavily in the ranking.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-4">
                      <Slider
                        label="Maximum walking"
                        value={effective.maxWalkMinutes ?? 12}
                        min={0}
                        max={30}
                        step={1}
                        onChange={(value) => patch({ maxWalkMinutes: value })}
                        format={(value) => `${value} min`}
                      />
                    </div>
                    <Field label="Maximum changes">
                      <Select
                        value={String(effective.maxTransfers ?? 1)}
                        onChange={(event) => patch({ maxTransfers: Number(event.target.value) })}
                        options={[
                          { value: '0', label: 'Direct only' },
                          { value: '1', label: '1 change' },
                          { value: '2', label: '2 changes' },
                          { value: '3', label: '3 changes' },
                        ]}
                      />
                    </Field>
                  </div>

                  <div>
                    <p className="mb-2 text-2xs font-medium tracking-wider text-mist-400 uppercase">
                      Preferred modes
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(options.data?.modes ?? (['metro', 'bus', 'tram', 'brt', 'ferry'] as TransitMode[])).map(
                        (mode) => {
                          const active = (effective.preferredModes ?? []).includes(mode);
                          return (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                patch({
                                  preferredModes: active
                                    ? (effective.preferredModes ?? []).filter((entry) => entry !== mode)
                                    : [...(effective.preferredModes ?? []), mode],
                                })
                              }
                              className={cn(
                                'rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors duration-200',
                                active
                                  ? 'border-pulse-400/40 bg-pulse-400/12 text-pulse-300'
                                  : 'border-white/10 bg-white/[0.02] text-mist-400 hover:border-white/20 hover:text-mist-200',
                              )}
                            >
                              {MODE_LABELS[mode] ?? mode}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>

                  <Toggle
                    checked={effective.personalizationEnabled ?? true}
                    onChange={(value) => patch({ personalizationEnabled: value })}
                    label="Personalised predictions"
                    description="Let the model learn from your saved journeys and past searches."
                  />
                </>
              )}
            </CardBody>
          </Card>

          {/* Saved journeys */}
          <Card>
            <CardHeader
              title="Saved journeys"
              subtitle="Each saved journey becomes a live prediction on your dashboard"
              icon={<Bookmark className="size-4" />}
              actions={
                <Badge tone="neutral">{watchlist.data?.items.length ?? 0} saved</Badge>
              }
            />
            <CardBody className="space-y-3">
              {watchlist.isLoading ? (
                <PanelSkeleton rows={3} />
              ) : watchlist.data?.items.length ? (
                <ul className="space-y-2.5">
                  {watchlist.data?.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3 transition-colors hover:border-white/14"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-mist-100">{item.label}</p>
                        <p className="mt-0.5 text-2xs text-mist-400">
                          {item.originStopName} → {item.destinationStopName} ·{' '}
                          {item.departTime ?? 'anytime'} · {item.days.join(', ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={item.avoidCrowded ? 'low' : 'neutral'} size="xs">
                          {item.avoidCrowded ? 'crowd-aware' : 'time only'}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleItem.mutate(item.id)}
                          loading={toggleItem.isPending}
                        >
                          Toggle
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${item.label}`}
                          onClick={() => deleteItem.mutate(item.id)}
                          loading={deleteItem.isPending}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  title="No saved journeys yet"
                  description="Add the trip you take most often and TransitPulse will forecast its crowding on the dashboard."
                  icon={<Bookmark className="size-5" />}
                />
              )}

              <NewJourneyForm
                stops={options.data?.stops ?? []}
                busy={createItem.isPending}
                onCreate={(input) => createItem.mutateAsync(input)}
              />
            </CardBody>
          </Card>
        </div>

        {/* Notifications + account */}
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Notifications"
              subtitle="How and when TransitPulse should reach you"
              icon={<BellRing className="size-4" />}
            />
            <CardBody className="space-y-3">
              {profile.isLoading ? (
                <PanelSkeleton rows={4} />
              ) : (
                <>
                  <Toggle
                    checked={effective.notifyPush ?? true}
                    onChange={(value) => patch({ notifyPush: value })}
                    label="Push notifications"
                    description="Live crowding warnings for your saved journeys."
                  />
                  <Toggle
                    checked={effective.notifyEmail ?? false}
                    onChange={(value) => patch({ notifyEmail: value })}
                    label="Email digest"
                    description="A daily summary of the busiest and quietest windows."
                  />
                  <Toggle
                    checked={effective.notifySms ?? false}
                    onChange={(value) => patch({ notifySms: value })}
                    label="SMS alerts"
                    description="Reserved for major and critical disruptions."
                  />

                  <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-4">
                    <Slider
                      label="Alert me above"
                      value={effective.crowdThresholdAlert ?? 0.85}
                      min={0.5}
                      max={1.2}
                      step={0.05}
                      onChange={(value) => patch({ crowdThresholdAlert: value })}
                      format={(value) => `${formatPercent(value)} occupancy`}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Quiet hours from">
                      <Input
                        type="time"
                        value={effective.quietHoursStart ?? ''}
                        onChange={(event) => patch({ quietHoursStart: event.target.value || null })}
                      />
                    </Field>
                    <Field label="Quiet hours until">
                      <Input
                        type="time"
                        value={effective.quietHoursEnd ?? ''}
                        onChange={(event) => patch({ quietHoursEnd: event.target.value || null })}
                      />
                    </Field>
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Account"
              subtitle="Stored in rider_profiles and linked to Supabase Auth in production"
              icon={<User className="size-4" />}
            />
            <CardBody className="space-y-4">
              {profile.isLoading ? (
                <PanelSkeleton rows={3} />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Display name">
                      <Input
                        value={effective.displayName ?? ''}
                        onChange={(event) => patch({ displayName: event.target.value })}
                      />
                    </Field>
                    <Field label="Email">
                      <Input
                        type="email"
                        value={effective.email ?? ''}
                        onChange={(event) => patch({ email: event.target.value })}
                      />
                    </Field>
                  </div>

                  <Field label="Appearance">
                    <Segmented<'dark' | 'midnight' | 'system'>
                      value={effective.theme ?? 'dark'}
                      onChange={(theme) => patch({ theme })}
                      options={[
                        { value: 'dark', label: 'Dark' },
                        { value: 'midnight', label: 'Midnight' },
                        { value: 'system', label: 'System' },
                      ]}
                    />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Units">
                      <Select
                        value={effective.units ?? 'metric'}
                        onChange={(event) =>
                          patch({ units: event.target.value as RiderProfile['units'] })
                        }
                        options={[
                          { value: 'metric', label: 'Metric' },
                          { value: 'imperial', label: 'Imperial' },
                        ]}
                      />
                    </Field>
                    <Field label="Language">
                      <Select
                        value={effective.language ?? 'en'}
                        onChange={(event) => patch({ language: event.target.value })}
                        options={(options.data?.languages ?? [{ code: 'en', label: 'English' }]).map(
                          (language) => ({ value: language.code, label: language.label }),
                        )}
                      />
                    </Field>
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Data sources"
              subtitle="Where settings are stored and read"
              icon={<AlertTriangle className="size-4" />}
            />
            <CardBody className="space-y-2 text-xs text-mist-400">
              <p>
                Preferences live in <span className="figure text-mist-200">rider_profiles</span>;
                saved journeys in <span className="figure text-mist-200">watchlist</span>. Both are
                protected by row level security and reachable through{' '}
                <span className="figure text-mist-200">/api/profile</span> and{' '}
                <span className="figure text-mist-200">/api/watchlist</span>.
              </p>
              <p className="text-mist-500">
                The planner reads these values on every request — change your crowd tolerance and
                the next recommendation changes with it.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Sticky save bar */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-16 z-40 mx-auto w-[calc(100%-2rem)] max-w-3xl transition-all duration-300 lg:bottom-6',
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
      >
        <div
          role="status"
          className="glass-strong flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
        >
          <p className="text-xs text-mist-300">
            {Object.keys(draft).length} preference{Object.keys(draft).length === 1 ? '' : 's'} changed
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft({})}>
              Discard
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Save className="size-3.5" />}
              loading={updateProfile.isPending}
              onClick={() => void save()}
            >
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function describeTolerance(value: number): string {
  if (value >= 1) return 'will stand';
  if (value >= 0.8) return 'prefers a seat';
  if (value >= 0.6) return 'needs space';
  return 'avoids busy carriages';
}

function NewJourneyForm({
  stops,
  onCreate,
  busy,
}: {
  stops: { id: string; name: string; code: string }[];
  onCreate: (input: {
    label: string;
    originStopId: string;
    destinationStopId: string;
    departTime: string | null;
    days: string[];
    avoidCrowded: boolean;
  }) => Promise<unknown>;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    label: '',
    originStopId: '',
    destinationStopId: '',
    departTime: '08:15',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    avoidCrowded: true,
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!form.label.trim() || !form.originStopId || !form.destinationStopId) {
      setError('Add a name and choose both stops.');
      return;
    }
    if (form.originStopId === form.destinationStopId) {
      setError('Origin and destination must be different.');
      return;
    }
    setError(null);
    try {
      await onCreate({
        label: form.label.trim(),
        originStopId: form.originStopId,
        destinationStopId: form.destinationStopId,
        departTime: form.departTime || null,
        days: form.days,
        avoidCrowded: form.avoidCrowded,
      });
      setForm({ ...form, label: '', originStopId: '', destinationStopId: '' });
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  return (
    <form
      className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="eyebrow mb-3 text-mist-400">Add a journey</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={form.label}
            placeholder="Morning commute"
            onChange={(event) => setForm({ ...form, label: event.target.value })}
          />
        </Field>
        <Field label="Depart at">
          <Input
            type="time"
            value={form.departTime}
            onChange={(event) => setForm({ ...form, departTime: event.target.value })}
          />
        </Field>
        <Field label="From">
          <Select
            value={form.originStopId}
            onChange={(event) => setForm({ ...form, originStopId: event.target.value })}
            options={[
              { value: '', label: 'Choose a stop' },
              ...stops.map((stop) => ({ value: stop.id, label: `${stop.name} (${stop.code})` })),
            ]}
          />
        </Field>
        <Field label="To">
          <Select
            value={form.destinationStopId}
            onChange={(event) => setForm({ ...form, destinationStopId: event.target.value })}
            options={[
              { value: '', label: 'Choose a stop' },
              ...stops.map((stop) => ({ value: stop.id, label: `${stop.name} (${stop.code})` })),
            ]}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="eyebrow text-mist-500">Days</span>
        {DAYS.map((day) => {
          const active = form.days.includes(day.key);
          return (
            <button
              key={day.key}
              type="button"
              aria-label={day.key}
              onClick={() =>
                setForm({
                  ...form,
                  days: active
                    ? form.days.filter((entry) => entry !== day.key)
                    : [...form.days, day.key],
                })
              }
              aria-pressed={active}
              className={cn(
                'figure size-7 rounded-lg border text-2xs transition-colors',
                active
                  ? 'border-pulse-400/40 bg-pulse-400/15 text-pulse-300'
                  : 'border-white/10 bg-white/[0.02] text-mist-500',
              )}
            >
              {day.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        <Toggle
          checked={form.avoidCrowded}
          onChange={(avoidCrowded) => setForm({ ...form, avoidCrowded })}
          label="Optimise for crowding"
          description="Prefer quieter services for this journey."
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-crowd-critical/30 bg-crowd-critical/[0.08] px-3 py-2 text-xs text-crowd-critical"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          type="submit"
          variant="primary"
          icon={<Plus className="size-3.5" />}
          loading={busy}
        >
          Save journey
        </Button>
      </div>
    </form>
  );
}
