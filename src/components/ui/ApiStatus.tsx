import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Database, PlugZap, RefreshCw, WifiOff } from 'lucide-react';
import { useIsMutating } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { queryClient, retryFailedQueries } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

/**
 * One place that turns an API/database failure into something a human can act on,
 * plus the global banner that appears when the API has gone away.
 *
 * The dashboards used to end at "Dashboard data unavailable", which told the reader
 * nothing about whether the database was down, the API was restarting or the query
 * itself was wrong. `describeApiError` keeps the technical detail (status + code)
 * and adds the likely cause and the next step.
 */

export interface ApiErrorDescription {
  /** Short, non-technical headline. */
  message: string;
  /** What to check next. */
  hint: string;
  /** `CODE · HTTP 502` — shown in a monospace strip for debugging. */
  details: string;
  kind: 'offline' | 'server' | 'database' | 'request' | 'unknown';
}

export function describeApiError(error: unknown): ApiErrorDescription {
  if (error instanceof ApiError) {
    const details = `${error.code} · HTTP ${error.status || 'n/a'}`;

    if (error.code === 'NETWORK_ERROR' || error.status === 0) {
      return {
        kind: 'offline',
        message: 'Unable to load transportation data. The TransitPulse API is not reachable.',
        hint: 'The API process may be restarting. It reconnects automatically — press Retry if this stays up.',
        details,
      };
    }
    if (error.status >= 500) {
      return {
        kind: 'database',
        message: 'Unable to load transportation data. Please check the database connection.',
        hint: 'The API is up but could not read Postgres. Confirm the database is running, then retry.',
        details,
      };
    }
    if (error.status === 404) {
      return {
        kind: 'request',
        message: error.message,
        hint: 'The requested record is not in the demo dataset. Pick another route or stop.',
        details,
      };
    }
    return {
      kind: 'request',
      message: error.message,
      hint: 'The API rejected this request — the code below identifies exactly which parameter it was.',
      details,
    };
  }

  const fallback = error instanceof Error ? error.message : 'Unknown error';
  return {
    kind: 'unknown',
    message: 'Unable to load transportation data.',
    hint: 'Press Retry. If it persists, check that the API and database are running.',
    details: fallback,
  };
}

/**
 * True once a failure has lasted longer than `thresholdMs`.
 *
 * The query client keeps retrying a failing query, which would otherwise leave a
 * dashboard on "Loading…" forever when the API is down for minutes. After the
 * grace period the screen switches to the error panel — which names the cause and
 * offers a retry — while the background recovery keeps running, so the panel
 * disappears by itself the moment data arrives.
 */
export function useOutageDuration(isWaitingWithoutData: boolean, thresholdMs = 12_000): boolean {
  const [breached, setBreached] = useState(false);
  const waitingSince = useRef<number | null>(null);

  useEffect(() => {
    if (!isWaitingWithoutData) {
      waitingSince.current = null;
      setBreached(false);
      return;
    }
    waitingSince.current ??= Date.now();
    const remaining = Math.max(0, thresholdMs - (Date.now() - waitingSince.current));
    const timer = window.setTimeout(() => setBreached(true), remaining);
    return () => window.clearTimeout(timer);
  }, [isWaitingWithoutData, thresholdMs]);

  return breached;
}

/**
 * The most recent error seen, remembered across refetches.
 *
 * A retry resets the query's own `error` while it is in flight, which would blank
 * the explanation on the error panel; this keeps the last real cause on screen.
 */
export function useLastError(error: unknown): unknown {
  const last = useRef<unknown>(null);
  if (error) last.current = error;
  return error ?? last.current;
}

/* -------------------------------------------------------------------------- */
/* Global connection banner                                                    */
/* -------------------------------------------------------------------------- */

interface FailingState {
  count: number;
  lastError: unknown;
  retrying: boolean;
}

function readFailures(): FailingState {
  const queries = queryClient.getQueryCache().getAll();
  const failing = queries.filter((query) => query.state.status === 'error');
  return {
    count: failing.length,
    lastError: failing[0]?.state.error ?? null,
    retrying: failing.some((query) => query.state.fetchStatus === 'fetching'),
  };
}

/**
 * Cache the snapshot.
 *
 * `useSyncExternalStore` requires `getSnapshot` to return the *same* reference
 * while the store is unchanged, otherwise React re-renders forever. Reading the
 * cache builds a fresh object every time, so compare field by field and only hand
 * back a new object when something actually moved.
 */
let snapshot: FailingState = { count: 0, lastError: null, retrying: false };
function getFailureSnapshot(): FailingState {
  const next = readFailures();
  if (
    snapshot.count === next.count &&
    snapshot.lastError === next.lastError &&
    snapshot.retrying === next.retrying
  ) {
    return snapshot;
  }
  snapshot = next;
  return snapshot;
}

function subscribeToFailures(onChange: () => void): () => void {
  return queryClient.getQueryCache().subscribe(() => onChange());
}

/**
 * Sticky banner shown whenever any query is failing.
 *
 * It states the cause ("database connection", "API not reachable") instead of a
 * dead screen, and offers a retry that re-runs every failing query at once.
 */
export function ApiStatusBanner({ className }: { className?: string }) {
  const isMutating = useIsMutating();
  /*
   * `useSyncExternalStore` (not a subscribe + setState effect): the query cache
   * notifies listeners while another component is rendering, and a synchronous
   * setState from there throws "Cannot update a component while rendering a
   * different component". This subscribes in React's own safe phase instead.
   */
  const state = useSyncExternalStore(subscribeToFailures, getFailureSnapshot, getFailureSnapshot);

  /*
   * Recovery poller.
   *
   * A query's own interval is the only thing that retries it after the retry
   * budget is spent — that is 45–60 s of staring at an error for the dashboards,
   * and never for queries without an interval. While anything is failing, re-run
   * the failing queries on a short escalating schedule (3 s → 30 s) so the screen
   * heals by itself within seconds of the API coming back.
   */
  const attempt = useRef(0);
  useEffect(() => {
    if (state.count === 0) {
      attempt.current = 0;
      return;
    }
    const delay = Math.min(3_000 * 2 ** attempt.current, 30_000);
    const timer = window.setTimeout(() => {
      attempt.current += 1;
      void retryFailedQueries();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.count, state.retrying]);

  if (state.count === 0 || isMutating > 0) return null;

  const described = describeApiError(state.lastError);
  const Icon = described.kind === 'offline' ? WifiOff : described.kind === 'database' ? Database : PlugZap;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'animate-rise flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2.5',
        described.kind === 'request'
          ? 'border-crowd-moderate/30 bg-crowd-moderate/[0.08]'
          : 'border-crowd-critical/30 bg-crowd-critical/[0.08]',
        className,
      )}
    >
      <span className="inline-flex items-center gap-2 text-2xs font-medium text-mist-100">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {described.kind === 'offline'
          ? state.retrying
            ? 'Reconnecting to the TransitPulse API…'
            : 'TransitPulse API unreachable'
          : described.kind === 'database'
            ? 'Database read failed — retrying'
            : 'Some panels could not load'}
      </span>
      <span className="min-w-0 flex-1 text-2xs leading-relaxed text-mist-300">{described.hint}</span>
      <span className="figure rounded-md border border-white/10 bg-ink-950/60 px-2 py-0.5 text-3xs text-mist-400">
        {described.details}
      </span>
      <button
        type="button"
        onClick={() => void retryFailedQueries()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-3xs text-mist-100 transition-colors hover:border-pulse-400/60 hover:text-white"
      >
        <RefreshCw className={cn('size-3', state.retrying && 'animate-spin')} aria-hidden />
        Retry now
      </button>
    </div>
  );
}

/** Compact inline variant for cards whose own query failed. */
export function InlineQueryError({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const described = describeApiError(error);
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-crowd-critical/25 bg-crowd-critical/[0.07] px-3 py-2.5',
        className,
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0 text-crowd-critical" aria-hidden />
      <span className="min-w-0 flex-1 text-2xs leading-relaxed text-mist-200">{described.message}</span>
      <span className="figure text-3xs text-mist-500">{described.details}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2 py-1 text-3xs text-mist-200 transition-colors hover:border-pulse-400/50 hover:text-mist-50"
        >
          <RefreshCw className="size-3" aria-hidden />
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * Full-page error panel for a screen whose primary query failed.
 *
 * Deliberately richer than `ErrorState`: it names the failure, explains what to
 * check, shows the API code for support and offers both a local retry and a
 * "retry everything" action.
 */
export function ErrorPanel({
  title,
  message,
  hint,
  details,
  onRetry,
  className,
}: {
  title: string;
  message: string;
  hint?: string;
  details?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'animate-rise flex flex-col gap-3 rounded-2xl border border-crowd-critical/30 bg-crowd-critical/[0.07] px-5 py-4',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-crowd-critical">
        <AlertTriangle className="size-4" aria-hidden />
        <p className="font-display text-sm font-semibold">{title}</p>
      </div>

      <p className="text-xs leading-relaxed text-mist-200">{message}</p>
      {hint ? <p className="text-2xs leading-relaxed text-mist-400">{hint}</p> : null}
      {details ? (
        <p className="figure w-fit rounded-lg border border-white/8 bg-ink-950/60 px-2.5 py-1.5 text-3xs text-mist-400">
          {details}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-2xs text-mist-100 transition-colors hover:border-pulse-400/60 hover:text-white"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Retry
          </button>
        ) : null}
        <span className="text-3xs text-mist-500">
          Data comes from the TransitPulse API over the demo Postgres dataset.
        </span>
      </div>
    </div>
  );
}
