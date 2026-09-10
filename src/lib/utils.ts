import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CROWD_LEVEL_META, crowdLevelFromRatio } from '@shared/crowd';
import type { CrowdLevel } from '@shared/types';

/** Tailwind-aware class merge used by every UI primitive. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* -------------------------------------------------------------------------- */
/* Crowd presentation tokens                                                  */
/* -------------------------------------------------------------------------- */

export interface CrowdTone {
  text: string;
  bg: string;
  border: string;
  dot: string;
  stroke: string;
  fill: string;
  label: string;
  description: string;
}

const CROWD_TONES: Record<CrowdLevel, CrowdTone> = {
  low: {
    text: 'text-crowd-low',
    bg: 'bg-crowd-low/12',
    border: 'border-crowd-low/35',
    dot: 'bg-crowd-low',
    stroke: '#34d399',
    fill: 'rgba(52, 211, 153, 0.16)',
    label: CROWD_LEVEL_META.low.label,
    description: CROWD_LEVEL_META.low.description,
  },
  moderate: {
    text: 'text-crowd-moderate',
    bg: 'bg-crowd-moderate/12',
    border: 'border-crowd-moderate/35',
    dot: 'bg-crowd-moderate',
    stroke: '#fbbf24',
    fill: 'rgba(251, 191, 36, 0.16)',
    label: CROWD_LEVEL_META.moderate.label,
    description: CROWD_LEVEL_META.moderate.description,
  },
  high: {
    text: 'text-crowd-high',
    bg: 'bg-crowd-high/14',
    border: 'border-crowd-high/40',
    dot: 'bg-crowd-high',
    stroke: '#fb923c',
    fill: 'rgba(251, 146, 60, 0.18)',
    label: CROWD_LEVEL_META.high.label,
    description: CROWD_LEVEL_META.high.description,
  },
  critical: {
    text: 'text-crowd-critical',
    bg: 'bg-crowd-critical/14',
    border: 'border-crowd-critical/45',
    dot: 'bg-crowd-critical',
    stroke: '#f43f5e',
    fill: 'rgba(244, 63, 94, 0.2)',
    label: CROWD_LEVEL_META.critical.label,
    description: CROWD_LEVEL_META.critical.description,
  },
};

export function crowdTone(level: CrowdLevel): CrowdTone {
  return CROWD_TONES[level];
}

export function crowdToneForRatio(ratio: number): CrowdTone {
  return CROWD_TONES[crowdLevelFromRatio(ratio)];
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatClock(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return clockFormatter.format(new Date(value));
}

export function formatRelative(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const diffMinutes = Math.round((new Date(value).getTime() - now.getTime()) / 60000);
  if (Math.abs(diffMinutes) < 1) return 'now';
  if (diffMinutes > 0) return `in ${formatDuration(diffMinutes)}`;
  return `${formatDuration(-diffMinutes)} ago`;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function formatTimeAgo(value: string | Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** `2026-09-10T08:15:00.000Z` → `08:15` in a datetime-local friendly shape. */
export function toTimeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export const MODE_LABELS: Record<string, string> = {
  metro: 'Metro',
  bus: 'Bus',
  tram: 'Tram',
  brt: 'BRT',
  ferry: 'Ferry',
};

export const SEVERITY_TONES: Record<string, CrowdTone> = {
  info: {
    text: 'text-sky-300',
    bg: 'bg-sky-400/12',
    border: 'border-sky-400/35',
    dot: 'bg-sky-400',
    stroke: '#60a5fa',
    fill: 'rgba(96,165,250,0.16)',
    label: 'Info',
    description: 'Information only',
  },
  minor: {
    text: 'text-crowd-moderate',
    bg: 'bg-crowd-moderate/12',
    border: 'border-crowd-moderate/35',
    dot: 'bg-crowd-moderate',
    stroke: '#fbbf24',
    fill: 'rgba(251,191,36,0.16)',
    label: 'Minor',
    description: 'Minor impact',
  },
  major: {
    text: 'text-crowd-high',
    bg: 'bg-crowd-high/14',
    border: 'border-crowd-high/40',
    dot: 'bg-crowd-high',
    stroke: '#fb923c',
    fill: 'rgba(251,146,60,0.18)',
    label: 'Major',
    description: 'Significant impact',
  },
  critical: {
    text: 'text-crowd-critical',
    bg: 'bg-crowd-critical/14',
    border: 'border-crowd-critical/45',
    dot: 'bg-crowd-critical',
    stroke: '#f43f5e',
    fill: 'rgba(244,63,94,0.2)',
    label: 'Critical',
    description: 'Severe disruption',
  },
};

export function severityTone(severity: string): CrowdTone {
  return SEVERITY_TONES[severity] ?? SEVERITY_TONES.info;
}

/** Deterministic short id used for optimistic keys and DOM ids. */
export function shortId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
