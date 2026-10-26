/** Injectable clock. Tests must never depend on wall time. */
export interface Clock { now(): Date }

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  const d = new Date(iso);
  return { now: () => new Date(d) };
}

export function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function iso(d: Date): string { return d.toISOString(); }
