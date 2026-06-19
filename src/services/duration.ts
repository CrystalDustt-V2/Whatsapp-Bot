export interface ParsedDuration {
  milliseconds: number;
  label: string;
}

const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  second: 1000,
  seconds: 1000,
  m: 60 * 1000,
  min: 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  h: 60 * 60 * 1000,
  hr: 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

const ORDERED_LABELS: Array<[string, number]> = [
  ['d', UNITS.d],
  ['h', UNITS.h],
  ['m', UNITS.m],
  ['s', UNITS.s],
];

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '0s';
  }

  let remaining = Math.ceil(milliseconds / 1000) * 1000;
  const parts: string[] = [];

  for (const [suffix, unitMs] of ORDERED_LABELS) {
    const amount = Math.floor(remaining / unitMs);
    if (amount > 0) {
      parts.push(`${amount}${suffix}`);
      remaining -= amount * unitMs;
    }
  }

  return parts.join(' ') || '0s';
}

export function parseDuration(input: string, options?: { maxMilliseconds?: number }): ParsedDuration | null {
  const source = input.trim().toLowerCase();
  if (!source) return null;

  const matches = [...source.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)];
  if (!matches.length) return null;

  let consumed = '';
  let milliseconds = 0;

  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = UNITS[unit];

    if (!Number.isFinite(amount) || amount <= 0 || !multiplier) {
      return null;
    }

    consumed += match[0];
    milliseconds += amount * multiplier;
  }

  if (source.replace(/\s+/g, '') !== consumed.replace(/\s+/g, '')) {
    return null;
  }

  if (!Number.isFinite(milliseconds) || milliseconds < 1000) {
    return null;
  }

  if (options?.maxMilliseconds && milliseconds > options.maxMilliseconds) {
    return null;
  }

  return {
    milliseconds,
    label: formatDuration(milliseconds),
  };
}
