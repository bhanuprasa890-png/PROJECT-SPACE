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

/** Minutes the zone is ahead of UTC at `date` (IST → 330, UTC → 0). */
export function zoneOffsetMinutes(date: Date, timeZone = 'UTC'): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    date.getUTCSeconds(),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * The absolute instant for a `HH:MM` wall clock time in `timeZone` — today if
 * that time is still ahead, otherwise the same clock time tomorrow.
 *
 * `timeZone` is the agency's timezone, so a saved 08:15 departure means 08:15
 * where the rider actually is, not 08:15 UTC.
 */
export function nextZonedClock(
  reference: Date,
  timeZone: string,
  clock: string | null,
): Date {
  if (!clock) return reference;

  const [hours, minutes] = clock.split(':').map(Number);

  // Wall-clock guess first, then shift the guess by the zone offset (applied
  // twice so the result is correct across a DST boundary as well).
  const parts = zonedParts(reference, timeZone);
  const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hours ?? 0, minutes ?? 0, 0, 0));
  let candidate = new Date(guess.getTime() - zoneOffsetMinutes(guess, timeZone) * 60000);
  candidate = new Date(guess.getTime() - zoneOffsetMinutes(candidate, timeZone) * 60000);

  if (candidate.getTime() <= reference.getTime()) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return candidate;
}

/** `HH:MM` wall clock of an instant, as minutes since local midnight. */
export function zonedMinutes(date: Date, timeZone = 'UTC'): number {
  const { hour, minute } = zonedParts(date, timeZone);
  return hour * 60 + minute;
}

/** Local minute of the day for a `HH:MM` string. */
export function clockToMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
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
