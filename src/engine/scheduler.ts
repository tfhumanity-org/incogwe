/**
 * The clock-driven half of the engine.
 *
 * Run it on a timer. For every request it asks `decideAction` what today requires,
 * then does exactly that: a follow-up, an escalation with a complaint draft, a
 * recurrence, or a re-verification. All state changes go through the store and
 * every one of them writes an event, because the event log is the evidence pack.
 */
import type { Broker, RemovalRequest, Subject } from '../types.ts';
import type { Clock } from '../util/clock.ts';
import type { Store } from '../store/store.ts';
import type { Transport } from './transport.ts';
import type { BrokerRegistry } from '../brokers/registry.ts';
import { decideAction, type DueAction, nextRecurrence, nextReverification } from '../legal/deadlines.ts';
import { renderComplaint, renderFollowUp } from './escalation.ts';
import { event } from './sender.ts';
import { instrument } from '../legal/jurisdictions.ts';
import { log } from '../util/logging.ts';
import { sha256 } from '../util/ids.ts';

export interface SchedulerConfig {
  readonly clock: Clock;
  readonly store: Store;
  readonly registry: BrokerRegistry;
  readonly transport: Transport;
  readonly agentName: string;
  /** Where complaint drafts are written. Drafts, never filed automatically. */
  readonly complaintSink?: (filename: string, body: string) => void;
}

export interface TickResult {
  readonly followUps: number;
  readonly escalations: number;
  readonly recurrences: number;
  readonly reverifications: number;
  readonly complaints: readonly string[];
  readonly actions: readonly { requestId: string; action: DueAction }[];
}

export class Scheduler {
  readonly #cfg: SchedulerConfig;
  readonly #complaints: { filename: string; body: string }[] = [];

  constructor(cfg: SchedulerConfig) { this.#cfg = cfg; }

  /** Complaint drafts produced in this process, for the CLI and tests. */
  get drafts(): readonly { filename: string; body: string }[] { return this.#complaints; }

  async tick(): Promise<TickResult> {
    const now = this.#cfg.clock.now();
    const store = this.#cfg.store;
    const actions: { requestId: string; action: DueAction }[] = [];
    let followUps = 0, escalations = 0, recurrences = 0, reverifications = 0;
    const complaints: string[] = [];

    for (const req of store.openRequests()) {
      const broker = this.#cfg.registry.get(req.brokerId);
      if (!broker) { log.warn('request references unknown broker', { brokerId: req.brokerId }); continue; }

      const action = decideAction(req, broker, now);
      if (action === 'none') continue;
      actions.push({ requestId: req.id, action });

      switch (action) {
        case 'follow_up': { await this.#followUp(req, broker, now); followUps += 1; break; }
        case 'escalate': {
          const file = this.#escalate(req, broker, now);
          escalations += 1;
          if (file) complaints.push(file);
          break;
        }
        case 'recur': { this.#recur(req, broker, now); recurrences += 1; break; }
        case 'reverify': { this.#reverify(req, broker, now); reverifications += 1; break; }
      }
    }

    log.info('scheduler tick', { followUps, escalations, recurrences, reverifications });
    return { followUps, escalations, recurrences, reverifications, complaints, actions };
  }

  async #followUp(req: RemovalRequest, broker: Broker, now: Date): Promise<void> {
    const store = this.#cfg.store;
    const original = store.getLetter(req.id) ?? '(original letter unavailable)';
    const n = req.followUpCount + 1;
    const { subject, body } = renderFollowUp({
      request: req, broker, originalBody: original, agentName: this.#cfg.agentName, now, followUpNumber: n,
    });

    await this.#cfg.transport.send(
      { to: broker.legalContact.email ?? broker.legalContact.privacyPortal ?? '', subject, body,
        bodyHash: sha256(body), instrument: req.instrument, supporting: req.supportingInstruments,
        dueAt: req.dueAt ?? now.toISOString() },
      broker, req.threadKey,
    );

    store.putRequest({ ...req, followUpCount: n });
    store.putEvent(event(req.id, now, 'follow_up_sent', `Follow-up ${n} sent to ${broker.name}.`, sha256(body)));
  }

  #escalate(req: RemovalRequest, broker: Broker, now: Date): string | null {
    const store = this.#cfg.store;
    const subject = store.getSubject(req.subjectId);
    if (!subject) return null;
    const consent = store.getConsent(req.subjectId);

    // Record the breach as an outcome in its own right. Silence is evidence.
    store.putRequest({
      ...req,
      status: 'escalated',
      outcome: req.outcome ?? 'deadline_missed',
      nextActionAt: nextRecurrence(now, broker).toISOString(),
    });
    store.putEvent(event(req.id, now, 'escalated',
      `No substantive response by the ${instrument(req.instrument).shortName} deadline; escalating.`));

    if (!consent?.scopes.includes('regulator_complaints')) {
      store.putEvent(event(req.id, now, 'escalated',
        'Complaint not drafted: the subject has not authorised regulator complaints.'));
      return null;
    }

    const draft = renderComplaint({
      request: req, broker, subject,
      events: store.eventsFor(req.id),
      consentDate: consent.grantedAt,
      agentName: this.#cfg.agentName,
      now,
      reason: req.outcome === 'refused' ? 'refused' : 'no_response',
    });
    this.#complaints.push(draft);
    this.#cfg.complaintSink?.(draft.filename, draft.body);
    store.putEvent(event(req.id, now, 'complaint_drafted',
      `Complaint draft prepared for ${instrument(req.instrument).regulator.name}. NOT filed — requires human review.`,
      sha256(draft.body)));
    return draft.filename;
  }

  #recur(req: RemovalRequest, broker: Broker, now: Date): void {
    const store = this.#cfg.store;
    store.putRequest({
      ...req,
      status: 'planned',           // the planner will pick it up and send afresh
      nextActionAt: nextRecurrence(now, broker).toISOString(),
      followUpCount: 0,
    });
    store.putEvent(event(req.id, now, 'recurrence_scheduled',
      `Re-assertion due: ${broker.surface} broker on a ${broker.surface === 'public' ? 60 : 90}-day cycle.`));
  }

  #reverify(req: RemovalRequest, broker: Broker, now: Date): void {
    const store = this.#cfg.store;
    const next = nextReverification(now, broker) ?? nextRecurrence(now, broker);
    store.putRequest({ ...req, nextActionAt: next.toISOString() });
    // Discovery is pluggable and may be absent; the event records the intent either way,
    // so an operator can see that verification was due and whether an adapter ran.
    store.putEvent(event(req.id, now, 'reverification',
      `Re-verification due for public listing at ${broker.name}. ` +
      `Requires a discovery adapter; none is bundled with deletewe.`));
  }
}

export type { Subject };
