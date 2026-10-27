/**
 * Statutory deadline tracking.
 *
 * Three clocks, all computed from `sentAt`:
 *   - due:          the base statutory response period
 *   - extendedDue:  set only when the broker actually notified an extension
 *   - nextAction:   recurrence (60d public / 90d private) or re-verification (10d)
 *
 * Deliberately calendar-day arithmetic in UTC. None of the modelled instruments
 * uses business days, and inventing a business-day rule would create a deadline
 * that is wrong in the subject's favour -- the dangerous direction.
 */
import type { Broker, RemovalRequest } from '../types.ts';
import { addDays, daysBetween } from '../util/clock.ts';

export const RECURRENCE_DAYS = { public: 60, private: 90 } as const;
export const REVERIFICATION_DAYS = 10;
/** Send a reminder this many days before the statutory deadline expires. */
export const FOLLOW_UP_LEAD_DAYS = 7;
/** Stop re-sending after this many follow-ups and escalate instead. */
export const MAX_FOLLOW_UPS = 2;

export function dueDate(sentAt: Date, responseDays: number): Date {
  return addDays(sentAt, responseDays);
}

export function extendedDueDate(sentAt: Date, responseDays: number, extensionDays: number): Date | null {
  if (extensionDays <= 0) return null;
  return addDays(sentAt, responseDays + extensionDays);
}

/** The deadline currently in force: the extension if one was granted, else the base. */
export function effectiveDue(req: Pick<RemovalRequest, 'dueAt' | 'extendedDueAt'>): Date | null {
  const d = req.extendedDueAt ?? req.dueAt;
  return d ? new Date(d) : null;
}

export function isOverdue(req: Pick<RemovalRequest, 'dueAt' | 'extendedDueAt'>, now: Date): boolean {
  const due = effectiveDue(req);
  return due !== null && now.getTime() > due.getTime();
}

/** Negative means overdue by that many days. */
export function daysRemaining(req: Pick<RemovalRequest, 'dueAt' | 'extendedDueAt'>, now: Date): number | null {
  const due = effectiveDue(req);
  return due === null ? null : daysBetween(now, due);
}

export function recurrenceInterval(broker: Pick<Broker, 'surface'>): number {
  return RECURRENCE_DAYS[broker.surface];
}

export function nextRecurrence(from: Date, broker: Pick<Broker, 'surface'>): Date {
  return addDays(from, recurrenceInterval(broker));
}

export function nextReverification(from: Date, broker: Pick<Broker, 'surface'>): Date | null {
  // Only a public surface can be re-observed. Private brokers get recurrence instead.
  return broker.surface === 'public' ? addDays(from, REVERIFICATION_DAYS) : null;
}

export type DueAction = 'follow_up' | 'escalate' | 'recur' | 'reverify' | 'none';

/**
 * The single place that decides what the scheduler does to a request today.
 *
 * Order matters and encodes policy:
 *   1. An overdue, unanswered request escalates once follow-ups are exhausted.
 *   2. Otherwise an overdue request gets a follow-up.
 *   3. A request approaching its deadline gets a nudge, once.
 *   4. A closed request recurs or re-verifies on its own clock.
 */
export function decideAction(
  req: Pick<RemovalRequest, 'status' | 'outcome' | 'dueAt' | 'extendedDueAt' | 'followUpCount' | 'nextActionAt'>,
  broker: Pick<Broker, 'surface'>,
  now: Date,
): DueAction {
  if (req.status === 'closed') {
    if (!req.nextActionAt) return 'none';
    if (now.getTime() < new Date(req.nextActionAt).getTime()) return 'none';
    // Re-verify where we can see; otherwise re-assert on the statutory clock.
    if (broker.surface === 'public' && req.outcome !== 'refused') return 'reverify';
    return 'recur';
  }

  if (req.status === 'escalated') {
    // An escalated request is not abandoned. A broker that ignored us today may
    // comply after a regulator complaint lands, so the right is re-asserted on the
    // normal cycle. This branch used to return 'none' unconditionally, which made
    // the nextActionAt that #escalate carefully set completely dead.
    if (req.nextActionAt && now.getTime() >= new Date(req.nextActionAt).getTime()) return 'recur';
    return 'none';
  }
  if (req.status === 'planned') return 'none';

  const due = effectiveDue(req);
  if (!due) return 'none';

  const remaining = daysBetween(now, due);

  if (remaining < 0) {
    return req.followUpCount >= MAX_FOLLOW_UPS ? 'escalate' : 'follow_up';
  }
  if (remaining <= FOLLOW_UP_LEAD_DAYS && req.followUpCount === 0 && req.status === 'sent') {
    return 'follow_up';
  }
  return 'none';
}
