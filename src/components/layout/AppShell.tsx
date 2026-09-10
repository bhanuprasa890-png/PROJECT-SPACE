import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  Database,
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
import { Badge } from '../ui/Badge';

interface NavItem {
  to: string;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Commuter', description: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/routes', label: 'Plan', description: 'Route results', icon: Route },
  { to: '/operator', label: 'Operator', description: 'Control room', icon: Gauge },
  { to: '/alerts', label: 'Alerts', description: 'Service notices', icon: Bell },
  { to: '/settings', label: 'Settings', description: 'Preferences', icon: SettingsIcon },
  { to: '/database', label: 'Database', description: 'Data explorer', icon: Database },
];

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Commuter Dashboard',
    subtitle: 'Your next journey, live crowding and the recommendation behind it',
  },
  '/routes': {
    title: 'Route Results',
    subtitle: 'Crowd-aware options ranked by time, crowding, changes and walking',
  },
  '/routes/details': {
    title: 'Route Details',
    subtitle: 'Boarding plan, live load forecast and the model behind the prediction',
  },
  '/operator': {
    title: 'Operator Dashboard',
    subtitle: 'Fleet state, line load profiles and demand signals from real searches',
  },
  '/alerts': {
    title: 'Alerts',
    subtitle: 'Service notices reaching riders, and the tools to publish new ones',
  },
  '/settings': {
    title: 'Settings',
    subtitle: 'Routing preferences, crowd tolerance and saved journeys',
  },
  '/database': {
    title: 'Data Explorer',
    subtitle: 'Live records from the Postgres dataset behind every screen',
  },
};

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span className="relative grid size-10 place-items-center rounded-xl border border-pulse-400/30 bg-gradient-to-br from-pulse-400/20 to-sky-400/10">
        <Activity className="size-5 text-pulse-300" />
        <span className="absolute -inset-px animate-pulse-ring rounded-xl border border-pulse-400/40" />
      </span>
      <div className="leading-tight">
        <p className="font-display text-base font-semibold tracking-tight text-mist-100">
          Transit<span className="text-pulse-300">Pulse</span>
        </p>
        <p className="text-[0.65rem] tracking-[0.18em] text-mist-500 uppercase">AI · Chennai</p>
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1.5">
      {PRIMARY_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-200',
              isActive
                ? 'border-pulse-400/30 bg-pulse-400/10 text-mist-100'
                : 'border-transparent text-mist-400 hover:border-white/10 hover:bg-white/5 hover:text-mist-100',
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon
                className={cn('size-4 shrink-0', isActive ? 'text-pulse-300' : 'text-mist-500')}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-[0.68rem] text-mist-500">{item.description}</span>
              </span>
              {isActive ? <span className="size-1.5 rounded-full bg-pulse-400" /> : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function DatabaseBadge() {
  const { data, isLoading, isError } = useHealth();

  let status: React.ReactNode;
  if (isError) {
    status = <p className="mt-1 text-[0.68rem] text-crowd-critical">API unreachable</p>;
  } else if (isLoading || !data) {
    status = <p className="mt-1 text-[0.68rem] text-mist-500">Connecting…</p>;
  } else {
    status = (
      <>
        <p className="mt-1 font-mono text-[0.68rem] text-mist-200">
          {data.database.driver === 'supabase-postgres'
            ? 'Supabase Postgres'
            : 'Postgres (embedded)'}
        </p>
        <p className="text-[0.62rem] text-mist-500">
          {data.database.rows.routes ?? 0} routes · {data.database.rows.occupancy_predictions ?? 0}{' '}
          predictions · {data.database.latencyMs.toFixed(0)} ms
        </p>
      </>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.65rem] font-medium tracking-wider text-mist-400 uppercase">
          Data layer
        </span>
        <span
          className={cn(
            'size-2 rounded-full',
            isError ? 'bg-crowd-critical' : isLoading ? 'bg-crowd-moderate' : 'bg-crowd-low',
          )}
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
    title: 'TransitPulse AI',
    subtitle: 'Crowd-aware transit intelligence',
  };

  return (
    <div className="tp-shell-bg tp-grain relative min-h-screen">
      <div className="panel-grid pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] gap-0 lg:gap-6 lg:px-6">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between py-6 lg:flex">
          <div className="space-y-6">
            <Logo />
            <NavList />
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Badge tone="neutral" size="sm">
                Demo · simulated data
              </Badge>
            </div>
            <DatabaseBadge />
            <p className="px-1 text-[0.62rem] leading-relaxed text-mist-600">
              Predict → Avoid → Optimize. Crowd forecasts are generated from{' '}
              <span className="text-mist-400">crowd_observations</span> in Postgres.
            </p>
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <div className="glass-strong absolute inset-y-0 left-0 flex w-72 flex-col gap-6 p-5">
              <div className="flex items-center justify-between">
                <Logo />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <NavList onNavigate={() => setMobileOpen(false)} />
              <div className="mt-auto">
                <DatabaseBadge />
              </div>
            </div>
          </div>
        ) : null}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-6">
          <header className="sticky top-0 z-30 -mx-0 border-b border-white/6 bg-ink-950/70 px-4 py-3 backdrop-blur-xl lg:mx-0 lg:rounded-b-2xl lg:border lg:border-white/8 lg:px-5 lg:py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  size="icon"
                  variant="ghost"
                  className="lg:hidden"
                  aria-label="Open navigation"
                  onClick={() => setMobileOpen(true)}
                >
                  <Menu className="size-4" />
                </Button>
                <div className="min-w-0">
                  <h1 className="truncate font-display text-lg font-semibold text-mist-100 sm:text-xl">
                    {meta.title}
                  </h1>
                  <p className="hidden truncate text-xs text-mist-400 sm:block">{meta.subtitle}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <LivePill className="hidden sm:inline-flex" label="Live" />
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Sparkles className="size-3.5" />}
                  className="hidden sm:inline-flex"
                  onClick={() => navigate('/routes')}
                >
                  Plan a journey
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-5 lg:px-1 lg:py-6">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="glass-strong fixed inset-x-0 bottom-0 z-40 flex items-center justify-around px-2 py-2 lg:hidden">
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1.5 transition-colors',
                isActive ? 'text-pulse-300' : 'text-mist-500',
              )
            }
          >
            <item.icon className="size-5" />
            <span className="text-[0.62rem] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
