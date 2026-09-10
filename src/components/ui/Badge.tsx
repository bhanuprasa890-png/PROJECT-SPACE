import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'neutral' | 'pulse' | 'low' | 'moderate' | 'high' | 'critical' | 'info' | 'violet';

const TONES: Record<Tone, string> = {
  neutral: 'border-white/12 bg-white/6 text-mist-300',
  pulse: 'border-pulse-400/35 bg-pulse-400/12 text-pulse-300',
  low: 'border-crowd-low/35 bg-crowd-low/12 text-crowd-low',
  moderate: 'border-crowd-moderate/35 bg-crowd-moderate/12 text-crowd-moderate',
  high: 'border-crowd-high/40 bg-crowd-high/14 text-crowd-high',
  critical: 'border-crowd-critical/45 bg-crowd-critical/14 text-crowd-critical',
  info: 'border-sky-400/35 bg-sky-400/12 text-sky-300',
  violet: 'border-violet-400/35 bg-violet-400/12 text-violet-300',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  size?: 'xs' | 'sm';
}

export function Badge({ children, tone = 'neutral', icon, className, size = 'sm' }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium tracking-tight whitespace-nowrap',
        size === 'xs' ? 'px-2 py-0.5 text-[0.65rem]' : 'px-2.5 py-1 text-[0.7rem]',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
