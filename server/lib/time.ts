export type DayType = 'weekday' | 'saturday' | 'sunday';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 1 = Monday … 7 = Sunday (matches Postgres `isodow`). */
  isoWeekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Calendar fields for an instant, evaluated in the agency's timezone. */
export function zonedParts(date: Date, timeZone = 'UTC'): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '0';

  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    // `en-GB` with hour12:false renders midnight as "24"; normalise it.
    hour: Number(pick('hour')) % 24,
    minute: Number(pick('minute')),
    isoWeekday: WEEKDAY_INDEX[pick('weekday')] ?? 1,
  };
}

export function dayTypeFor(date: Date, timeZone = 'UTC'): DayType {
  const { isoWeekday } = zonedParts(date, timeZone);
  if (isoWeekday === 6) return 'saturday';
  if (isoWeekday === 7) return 'sunday';
  return 'weekday';
}

export function hourOfDay(date: Date, timeZone = 'UTC'): number {
  return zonedParts(date, timeZone).hour;
}

/** Fractional hour (e.g. 08:30 → 8.5) used for smooth interpolation. */
export function fractionalHour(date: Date, timeZone = 'UTC'): number {
  const { hour, minute } = zonedParts(date, timeZone);
  return hour + minute / 60;
}

export function minutesBetween(from: Date | string, to: Date | string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
}

export function addMinutes(date: Date | string, minutes: number): Date {
  return new Date(new Date(date).getTime() + minutes * 60000);
}

export function addDays(date: Date | string, days: number): Date {
  return new Date(new Date(date).getTime() + days * 86400000);
}

export function startOfDay(date: Date | string): Date {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

/** `HH:MM` at a 24-hour clock, rendered in the agency timezone. */
export function formatClock(date: Date | string, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(date));
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
