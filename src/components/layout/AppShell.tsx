import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  BrainCircuit,
  Database,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Menu,
  Route,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useHealth } from '../../hooks/useTransitData';
import { LivePill } from '../crowd/CrowdHotspotList';
import { Button } from '../ui/Button';
import { ApiStatusBanner } from '../ui/ApiStatus';
import { Badge, StatusDot } from '../ui/Badge';

interface NavItem {
  to: string;
  label: string;
  /** Compact label for the mobile tab bar. */
  short: string;
  description: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Two clear halves of the product: the rider experience and the operations
 * console. Judges (and riders) should never have to guess where they are.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Rider',
    items: [
      { to: '/', label: 'Dashboard', short: 'Home', description: 'Next journey', icon: LayoutDashboard, end: true },
      { to: '/routes', label: 'Plan a route', short: 'Plan', description: 'Crowd-aware results', icon: Route },
      { to: '/alerts', label: 'Service alerts', short: 'Alerts', description: 'Notices near you', icon: Bell },
      { to: '/settings', label: 'Preferences', short: 'Settings', description: 'Comfort & transfers', icon: SettingsIcon },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/operator', label: 'Command center', short: 'Control', description: 'Live network control', icon: Gauge },
      { to: '/engine', label: 'AI engine', short: 'Engine', description: 'Prediction pipeline', icon: BrainCircuit },
      { to: '/database', label: 'Data explorer', short: 'Data', description: 'Postgres records', icon: Database },
    ],
  },
];

const PRIMARY_NAV: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * Mobile tab bar: the four screens a demo actually moves between. Everything
 * else stays one tap away in the drawer, so the tabs never get cramped on a
 * 360 px phone.
 */
const BOTTOM_NAV_PATHS = ['/', '/routes', '/alerts', '/operator'];
const BOTTOM_NAV: NavItem[] = BOTTOM_NAV_PATHS.map(
  (path) => PRIMARY_NAV.find((item) => item.to === path)!,
).filter(Boolean);

const PAGE_META: Record<string, { title: string; subtitle: string; eyebrow: string }> = {
  '/': {
    eyebrow: 'Rider',
    title: 'Commuter Dashboard',
    subtitle: 'Your next journey, live crowding and the recommendation behind it',
  },
  '/routes': {
    eyebrow: 'Rider',
    title: 'Route Results',
    subtitle: 'Crowd-aware options ranked by time, crowding, changes and walking',
  },
  '/routes/details': {
    eyebrow: 'Rider',
    title: 'Route Details',
    subtitle: 'Boarding plan, live load forecast and the model behind the prediction',
  },
  '/operator': {
    eyebrow: 'Operations',
    title: 'Operator Command Center',
    subtitle: 'Network overview, live route status, crowd heatmap, AI alerts and recommendations',
  },
  '/alerts': {
    eyebrow: 'Rider',
    title: 'Service Alerts',
    subtitle: 'Notices reaching riders, and the tools to publish new ones',
  },
  '/settings': {
    eyebrow: 'Rider',
    title: 'Settings',
    subtitle: 'Routing preferences, crowd tolerance and saved journeys',
  },
  '/engine': {
    eyebrow: 'Operations',
    title: 'Prediction Engine',
    subtitle: 'Input Data → Prediction Engine → Occupancy Prediction → Crowd Classification',
  },
  '/database': {
    eyebrow: 'Operations',
    title: 'Data Explorer',
    subtitle: 'Live records from the Postgres dataset behind every screen',
  },
};

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span className="relative grid size-10 place-items-center rounded-xl border border-pulse-400/30 bg-gradient-to-br from-pulse-400/20 to-sky-glow/10">
        <Activity className="size-5 text-pulse-300" aria-hidden />
        <span className="absolute -inset-px animate-pulse-ring rounded-xl border border-pulse-400/40" aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="font-display text-base font-semibold tracking-tight text-mist-100">
          Transit<span className="text-pulse-300">Pulse</span>
        </p>
        <p className="eyebrow text-mist-500">Crowd intelligence · Chennai</p>
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-5" aria-label="Primary">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="eyebrow px-3 text-mist-600">{group.label}</p>
          <div className="space-y-1">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-[background-color,border-color,color] duration-200',
                    isActive
                      ? 'border-pulse-400/25 bg-gradient-to-r from-pulse-400/12 to-transparent text-mist-100'
                      : 'border-transparent text-mist-400 hover:border-white/10 hover:bg-white/5 hover:text-mist-100',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full transition-opacity',
                        isActive ? 'bg-pulse-400 opacity-100' : 'opacity-0',
                      )}
                    />
                    <item.icon
                      className={cn('size-4 shrink-0', isActive ? 'text-pulse-300' : 'text-mist-500')}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="block text-2xs text-mist-500">{item.description}</span>
                    </span>
                    {isActive ? <StatusDot tone="pulse" /> : null}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function DatabaseBadge() {
  const { data, isLoading, isError } = useHealth();

  let status: React.ReactNode;
  if (isError) {
    status = <p className="mt-1 text-2xs text-crowd-critical">API unreachable</p>;
  } else if (isLoading || !data) {
    status = (
      <p className="mt-1 flex items-center gap-2 text-2xs text-mist-500">
        <span className="size-1.5 animate-pulse-soft rounded-full bg-crowd-moderate" />
        Connecting…
      </p>
    );
  } else {
    status = (
      <>
        <p className="mt-1 figure text-2xs text-mist-200">
          {data.database.driver === 'supabase-postgres' ? 'Supabase Postgres' : 'Postgres (embedded)'}
        </p>
        <p className="text-3xs text-mist-500">
          {data.database.rows.routes ?? 0} routes · {data.database.rows.occupancy_predictions ?? 0}{' '}
          predictions · {data.database.latencyMs.toFixed(0)} ms
        </p>
      </>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-mist-400">Data layer</span>
        <StatusDot
          tone={isError ? 'critical' : isLoading ? 'moderate' : 'low'}
          live={!isError && !isLoading}
        />
      </div>
      {status}
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const meta = PAGE_META[location.pathname] ?? {
    eyebrow: 'TransitPulse AI',
    title: 'TransitPulse AI',
    subtitle: 'Crowd-aware transit intelligence',
  };

  // Escape closes the mobile drawer, and the body never scrolls behind it.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="tp-shell-bg tp-grain relative min-h-screen">
      <div className="panel-grid pointer-events-none absolute inset-0 opacity-[0.3]" aria-hidden />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-pulse-400 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-950"
      >
        Skip to content
      </a>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] gap-0 lg:gap-6 lg:px-6">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between overflow-y-auto py-6 lg:flex">
          <div className="space-y-7">
            <Logo />
            <NavList />
          </div>
          <div className="mt-6 space-y-3">
            <NavLink
              to="/engine"
              className="flex items-center gap-2 rounded-xl border border-violet-glow/25 bg-violet-glow/[0.08] px-3 py-2.5 transition-colors hover:border-violet-glow/40 hover:bg-violet-glow/12"
            >
              <FlaskConical className="size-4 shrink-0 text-violet-glow" aria-hidden />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-mist-100">Simulation Mode</span>
                <span className="block text-3xs text-mist-500">Forecasts use simulated data</span>
              </span>
            </NavLink>
            <DatabaseBadge />
            <p className="px-1 text-3xs leading-relaxed text-mist-600">
              Predict → Avoid → Optimize. Crowd forecasts are generated from{' '}
              <span className="text-mist-400">crowd_observations</span> in Postgres.
            </p>
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <div className="glass-strong absolute inset-y-0 left-0 flex w-72 animate-slide-in flex-col gap-6 overflow-y-auto p-5">
              <div className="flex items-center justify-between">
                <Logo />
                <Button size="icon" variant="ghost" onClick={() => setMobileOpen(false)} aria-label="Close">
                  <X className="size-4" />
                </Button>
              </div>
              <NavList onNavigate={() => setMobileOpen(false)} />
              <div className="mt-auto space-y-3">
                <DatabaseBadge />
              </div>
            </div>
          </div>
        ) : null}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col pb-24 lg:pb-6">
          <header className="sticky top-0 z-30 border-b border-white/6 bg-ink-950/75 px-4 py-3 backdrop-blur-xl lg:rounded-b-2xl lg:border lg:border-white/8 lg:px-5 lg:py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  size="icon"
                  variant="ghost"
                  className="lg:hidden"
                  aria-label="Open navigation"
                  aria-expanded={mobileOpen}
                  onClick={() => setMobileOpen(true)}
                >
                  <Menu className="size-4" />
                </Button>
                <div className="min-w-0">
                  <p className="eyebrow hidden text-mist-600 sm:block">{meta.eyebrow}</p>
                  <h1 className="truncate font-display text-lg font-semibold text-mist-100 sm:text-xl">
                    {meta.title}
                  </h1>
                  <p className="hidden truncate text-2xs text-mist-400 sm:block">{meta.subtitle}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <NavLink
                  to="/engine"
                  className="hidden md:inline-flex"
                  title="All predictions use simulated demo data"
                >
                  <Badge tone="violet" size="xs" icon={<FlaskConical className="size-3" />}>
                    Simulation Mode
                  </Badge>
                </NavLink>
                <LivePill className="hidden sm:inline-flex" label="Live" />
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Sparkles className="size-3.5" />}
                  onClick={() => navigate('/routes')}
                >
                  <span className="hidden sm:inline">Plan a journey</span>
                  <span className="sm:hidden">Plan</span>
                </Button>
              </div>
            </div>
          </header>

          <main id="main" className="flex-1 px-4 py-5 lg:px-1 lg:py-6">
            {/* Global data-source health: appears only while a query is failing. */}
            <ApiStatusBanner className="mb-4" />
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="glass-strong safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-0.5 px-2 pt-1.5 lg:hidden"
        aria-label="Primary"
      >
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-colors',
                isActive ? 'bg-pulse-400/10 text-pulse-300' : 'text-mist-500',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className="size-[1.15rem]" aria-hidden />
                <span
                  className={cn(
                    'text-center text-3xs leading-tight font-medium',
                    isActive ? 'text-pulse-200' : 'text-mist-500',
                  )}
                >
                  {item.short}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'h-[2px] w-4 rounded-full transition-opacity',
                    isActive ? 'bg-pulse-400 opacity-100' : 'opacity-0',
                  )}
                />
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
