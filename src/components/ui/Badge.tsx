import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Tone =
  | 'neutral'
  | 'pulse'
  | 'low'
  | 'moderate'
  | 'high'
  | 'critical'
  | 'info'
  | 'violet';

const TONES: Record<Tone, string> = {
  neutral: 'border-white/12 bg-white/6 text-mist-300',
  pulse: 'border-pulse-400/35 bg-pulse-400/12 text-pulse-300',
  low: 'border-crowd-low/35 bg-crowd-low/12 text-crowd-low',
  moderate: 'border-crowd-moderate/35 bg-crowd-moderate/12 text-crowd-moderate',
  high: 'border-crowd-high/40 bg-crowd-high/14 text-crowd-high',
  critical: 'border-crowd-critical/45 bg-crowd-critical/14 text-crowd-critical',
  info: 'border-sky-glow/35 bg-sky-glow/12 text-sky-glow',
  violet: 'border-violet-glow/35 bg-violet-glow/12 text-violet-glow',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-mist-400',
  pulse: 'bg-pulse-400',
  low: 'bg-crowd-low',
  moderate: 'bg-crowd-moderate',
  high: 'bg-crowd-high',
  critical: 'bg-crowd-critical',
  info: 'bg-sky-glow',
  violet: 'bg-violet-glow',
};

/** Crowd tones get a soft halo so the indicator reads at a glance. */
const GLOWS: Partial<Record<Tone, string>> = {
  low: 'glow-low',
  moderate: 'glow-moderate',
  high: 'glow-high',
  critical: 'glow-high',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  size?: 'xs' | 'sm';
  /** Leading status dot — pair with `pulse` for live values. */
  dot?: boolean;
  /** Animate the dot with a slow ping (live / streaming states). */
  live?: boolean;
  title?: string;
}

export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
  size = 'sm',
  dot = false,
  live = false,
  title,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium tracking-tight whitespace-nowrap',
        size === 'xs' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span className="relative flex size-1.5 shrink-0" aria-hidden>
          {live ? (
            <span
              className={cn('absolute inline-flex size-full animate-ping-slow rounded-full opacity-60', DOTS[tone])}
            />
          ) : null}
          <span className={cn('relative inline-flex size-1.5 rounded-full', DOTS[tone], GLOWS[tone])} />
        </span>
      ) : null}
      {icon}
      {children}
    </span>
  );
}

/** Standalone glowing status dot (tables, lists, map legends). */
export function StatusDot({
  tone,
  live = false,
  className,
}: {
  tone: Tone;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative flex size-2 shrink-0', className)} aria-hidden>
      {live ? (
        <span
          className={cn('absolute inline-flex size-full animate-ping-slow rounded-full opacity-70', DOTS[tone])}
        />
      ) : null}
      <span className={cn('relative inline-flex size-2 rounded-full', DOTS[tone], GLOWS[tone])} />
    </span>
  );
}
