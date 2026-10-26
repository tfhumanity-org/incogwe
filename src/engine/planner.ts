/**
 * Plan which requests to send for a subject.
 *
 * ADR-0001 D1: entitlement gates the request, observation only enriches it. A broker
 * is skipped only when there is no modelled statutory route to it, no contact, or
 * an identical live request already exists -- never because nothing was observed.
 */
import type {
  Broker, Entitlement, Observation, RemovalRequest, Subject,
} from '../types.ts';
import { resolveEntitlements } from '../legal/entitlements.ts';
import { BrokerRegistry } from '../brokers/registry.ts';
import { newId } from '../util/ids.ts';

export interface PlannedRequest {
  readonly broker: Broker;
  readonly entitlements: readonly Entitlement[];
  readonly observation: Observation | null;
  readonly threadKey: string;
  /** Lower sorts first. Drives send order under a rate limit. */
  readonly priority: number;
}

export interface SkippedBroker {
  readonly brokerId: string;
  readonly reason: 'no_entitlement' | 'no_contact' | 'already_open' | 'out_of_region';
}

export interface Plan {
  readonly subjectId: string;
  readonly requests: readonly PlannedRequest[];
  readonly skipped: readonly SkippedBroker[];
}

export interface PlanOptions {
  readonly registry?: BrokerRegistry;
  readonly observations?: readonly Observation[];
  /** Requests already open for this subject, so we do not duplicate. */
  readonly existing?: readonly Pick<RemovalRequest, 'brokerId' | 'status'>[];
  /** Restrict to these broker ids. */
  readonly only?: readonly string[];
}

const OPEN_STATUSES = new Set(['planned', 'sent', 'acknowledged', 'awaiting_verification', 'extended', 'escalated']);

/**
 * Priority policy, lowest first:
 *   - severity dominates: the most sensitive holdings go first. This matches the
 *     only published industry practice we could source, and it is also what a user
 *     would choose if asked.
 *   - an observed listing beats an unobserved one at equal severity, because the
 *     evidence is stronger and the outcome is re-verifiable.
 *   - a public surface beats a private one, because the result is checkable.
 */
function priority(broker: Broker, observed: boolean): number {
  return (10 - broker.severity) * 100 + (observed ? 0 : 20) + (broker.surface === 'public' ? 0 : 10);
}

export function planRequests(subject: Subject, opts: PlanOptions = {}): Plan {
  const registry = opts.registry ?? new BrokerRegistry();
  const obsByBroker = new Map((opts.observations ?? []).map((o) => [o.brokerId, o]));
  const openByBroker = new Set(
    (opts.existing ?? []).filter((r) => OPEN_STATUSES.has(r.status)).map((r) => r.brokerId),
  );

  const candidates = opts.only
    ? opts.only.map((id) => registry.get(id)).filter((b): b is Broker => Boolean(b))
    : registry.reachableFrom(subject.residence);

  const requests: PlannedRequest[] = [];
  const skipped: SkippedBroker[] = [];

  for (const broker of candidates) {
    if (openByBroker.has(broker.id)) {
      skipped.push({ brokerId: broker.id, reason: 'already_open' });
      continue;
    }
    if (!broker.legalContact.email && !broker.legalContact.privacyPortal) {
      skipped.push({ brokerId: broker.id, reason: 'no_contact' });
      continue;
    }
    const entitlements = resolveEntitlements(subject, broker);
    if (entitlements.length === 0) {
      skipped.push({ brokerId: broker.id, reason: 'no_entitlement' });
      continue;
    }
    const observation = obsByBroker.get(broker.id) ?? null;
    requests.push({
      broker,
      entitlements,
      observation,
      threadKey: newId('thr'),
      priority: priority(broker, Boolean(observation?.present)),
    });
  }

  requests.sort((a, b) => a.priority - b.priority || a.broker.id.localeCompare(b.broker.id));
  return { subjectId: subject.id, requests, skipped };
}
