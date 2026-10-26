/**
 * Dashboard projections.
 *
 * The one rule this module exists to enforce: there is no aggregate "removals
 * completed" number anywhere in deletewe (ADR-0001 D2). `OutcomeBreakdown` has four
 * fields and the renderer prints all four with their evidence rank, because merging
 * "deleted" with "never held it" is the clearest flaw in the competitor's product.
 */
import type { Broker, RemovalRequest, RequestEvent, RequestOutcome } from '../types.ts';
import { EVIDENCE_RANK } from '../types.ts';
import type { Store } from '../store/store.ts';
import type { BrokerRegistry } from '../brokers/registry.ts';
import { daysRemaining, effectiveDue } from '../legal/deadlines.ts';
import { instrument } from '../legal/jurisdictions.ts';

export interface TimelineEntry {
  readonly at: string;
  readonly kind: RequestEvent['kind'];
  readonly detail: string;
}

export interface BrokerTimeline {
  readonly brokerId: string;
  readonly brokerName: string;
  readonly category: Broker['category'];
  readonly severity: number;
  readonly instrument: string;
  readonly status: RemovalRequest['status'];
  readonly outcome: RequestOutcome | null;
  readonly evidenceRank: number | null;
  readonly sentAt: string | null;
  readonly dueAt: string | null;
  /** Negative means overdue. Null when no clock is running. */
  readonly daysRemaining: number | null;
  readonly overdue: boolean;
  readonly followUps: number;
  readonly nextActionAt: string | null;
  readonly events: readonly TimelineEntry[];
}

export interface OutcomeBreakdown {
  readonly verifiedAbsent: number;
  readonly confirmedDeleted: number;
  readonly noDataHeld: number;
  readonly refused: number;
  readonly deadlineMissed: number;
  readonly undeliverable: number;
  readonly open: number;
}

export interface SubjectDashboard {
  readonly subjectId: string;
  readonly totalRequests: number;
  readonly breakdown: OutcomeBreakdown;
  readonly overdue: readonly { brokerName: string; daysOverdue: number; instrument: string }[];
  readonly upcoming: readonly { brokerName: string; daysRemaining: number; dueAt: string }[];
  readonly timelines: readonly BrokerTimeline[];
}

export function buildTimeline(
  req: RemovalRequest, broker: Broker | undefined, events: readonly RequestEvent[], now: Date,
): BrokerTimeline {
  const rem = daysRemaining(req, now);
  return {
    brokerId: req.brokerId,
    brokerName: broker?.name ?? req.brokerId,
    category: broker?.category ?? 'unknown',
    severity: broker?.severity ?? 0,
    instrument: instrument(req.instrument).shortName,
    status: req.status,
    outcome: req.outcome,
    evidenceRank: req.outcome ? EVIDENCE_RANK[req.outcome] : null,
    sentAt: req.sentAt,
    dueAt: effectiveDue(req)?.toISOString() ?? null,
    daysRemaining: req.status === 'closed' ? null : rem,
    overdue: req.status !== 'closed' && rem !== null && rem < 0,
    followUps: req.followUpCount,
    nextActionAt: req.nextActionAt,
    events: events.map((e) => ({ at: e.at, kind: e.kind, detail: e.detail })),
  };
}

export function buildDashboard(
  store: Store, registry: BrokerRegistry, subjectId: string, now: Date,
): SubjectDashboard {
  const requests = store.requestsForSubject(subjectId);
  const timelines = requests
    .map((r) => buildTimeline(r, registry.get(r.brokerId), store.eventsFor(r.id), now))
    .sort((a, b) => b.severity - a.severity || a.brokerName.localeCompare(b.brokerName));

  const breakdown: OutcomeBreakdown = {
    verifiedAbsent: count(requests, 'verified_absent'),
    confirmedDeleted: count(requests, 'confirmed_deleted'),
    noDataHeld: count(requests, 'no_data_held'),
    refused: count(requests, 'refused'),
    deadlineMissed: count(requests, 'deadline_missed'),
    undeliverable: count(requests, 'undeliverable'),
    open: requests.filter((r) => r.outcome === null).length,
  };

  const overdue = timelines
    .filter((t) => t.overdue && t.daysRemaining !== null)
    .map((t) => ({ brokerName: t.brokerName, daysOverdue: Math.abs(t.daysRemaining!), instrument: t.instrument }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const upcoming = timelines
    .filter((t) => !t.overdue && t.daysRemaining !== null && t.daysRemaining >= 0 && t.dueAt)
    .map((t) => ({ brokerName: t.brokerName, daysRemaining: t.daysRemaining!, dueAt: t.dueAt! }))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  return { subjectId, totalRequests: requests.length, breakdown, overdue, upcoming, timelines };
}

function count(rs: readonly RemovalRequest[], o: RequestOutcome): number {
  return rs.filter((r) => r.outcome === o).length;
}

/**
 * Render the breakdown as text. Note what is absent: no total, no percentage, no
 * "success rate". Each outcome is printed with the rank of the evidence behind it.
 */
export function renderBreakdown(b: OutcomeBreakdown): string {
  const rows: [string, number, string][] = [
    ['Verified absent      (rank 1)', b.verifiedAbsent, 'we re-observed the listing and it is gone'],
    ['Confirmed deleted    (rank 2)', b.confirmedDeleted, 'the broker stated in writing that it deleted'],
    ['Broker held no data  (rank 3)', b.noDataHeld, 'proves nothing about deletion — counted separately on purpose'],
    ['Refused              (rank 4)', b.refused, 'actionable; escalation available'],
    ['Deadline missed      (rank 4)', b.deadlineMissed, 'silence is itself a breach'],
    ['Undeliverable        (rank 5)', b.undeliverable, 'the letter never arrived'],
    ['Still open', b.open, 'within the statutory period'],
  ];
  return rows.map(([label, n, note]) => `  ${label.padEnd(32)} ${String(n).padStart(4)}   ${note}`).join('\n');
}
