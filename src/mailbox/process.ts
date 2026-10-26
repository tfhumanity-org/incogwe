/**
 * Apply a classified reply to the request it belongs to.
 *
 * This is where the four-outcome rule (ADR-0001 D2) is actually enforced: a
 * `no_data_held` reply closes the request with its own outcome and never with
 * `confirmed_deleted`, no matter how much the broker's prose sounds like success.
 */
import type { Broker, Classification, InboundReply, RemovalRequest } from '../types.ts';
import type { Store } from '../store/store.ts';
import type { BrokerRegistry } from '../brokers/registry.ts';
import { classifyReply, outcomeFor, statusFor } from './classifier.ts';
import { instrument } from '../legal/jurisdictions.ts';
import { nextRecurrence, nextReverification } from '../legal/deadlines.ts';
import { event } from '../engine/sender.ts';
import { sha256 } from '../util/ids.ts';
import { log } from '../util/logging.ts';

export interface ProcessResult {
  readonly replyId: string;
  readonly classification: Classification;
  readonly requestId: string | null;
  readonly applied: boolean;
  readonly reason: string;
}

export interface ProcessConfig {
  readonly store: Store;
  readonly registry: BrokerRegistry;
  readonly now: Date;
}

export function processReply(reply: InboundReply, cfg: ProcessConfig): ProcessResult {
  const { store, registry, now } = cfg;
  const classification = classifyReply(reply);
  store.putReply(reply, classification);

  log.info('reply classified', {
    replyId: reply.id,
    class: classification.class,
    confidence: classification.confidence,
    rules: classification.matchedRules,
    needsReview: classification.needsReview,
  });

  if (!reply.threadKey) {
    return { replyId: reply.id, classification, requestId: null, applied: false,
      reason: 'no thread key; queued for human attribution' };
  }

  const req = store.getRequestByThread(reply.threadKey);
  if (!req) {
    return { replyId: reply.id, classification, requestId: null, applied: false,
      reason: `thread ${reply.threadKey} matches no request; queued` };
  }

  store.putEvent(event(req.id, now, 'reply_received',
    `Reply from ${reply.fromAddress.split('@')[1] ?? 'unknown'}.`, sha256(reply.body)));
  store.putEvent(event(req.id, now, 'classified',
    `Classified ${classification.class} (confidence ${classification.confidence}; rules: ${classification.matchedRules.join(', ') || 'none'}).`));

  // Low-confidence classifications never change state. Queue, do not guess.
  if (classification.needsReview) {
    return { replyId: reply.id, classification, requestId: req.id, applied: false,
      reason: `confidence ${classification.confidence} below threshold; queued for review` };
  }

  const broker = registry.get(req.brokerId);
  const updated = applyClassification(req, classification, broker, now);
  store.putRequest(updated);

  if (updated.outcome && updated.outcome !== req.outcome) {
    store.putEvent(event(req.id, now, 'outcome_recorded',
      `Outcome ${updated.outcome}${updated.outcome === 'no_data_held'
        ? ' — the broker stated it holds no data. This is NOT a confirmed deletion.'
        : ''}`));
  }

  return { replyId: reply.id, classification, requestId: req.id, applied: true,
    reason: `applied ${classification.class}` };
}

export function applyClassification(
  req: RemovalRequest,
  cls: Classification,
  broker: Broker | undefined,
  now: Date,
): RemovalRequest {
  const outcome = outcomeFor(cls.class);
  const status = statusFor(cls.class);

  if (outcome) {
    const nextAction = broker
      ? (nextReverification(now, broker) ?? nextRecurrence(now, broker))
      : null;
    return {
      ...req,
      status: 'closed',
      outcome,
      closedAt: now.toISOString(),
      // A refused or undeliverable request still recurs: the right does not expire,
      // and a broker that refuses today may comply after an escalation.
      nextActionAt: nextAction ? nextAction.toISOString() : null,
    };
  }

  if (cls.class === 'extension') {
    const inst = instrument(req.instrument);
    const sentAt = req.sentAt ? new Date(req.sentAt) : now;
    const extended = new Date(sentAt);
    extended.setUTCDate(extended.getUTCDate() + inst.responseDays + inst.extensionDays);
    return { ...req, status: 'extended', extendedDueAt: extended.toISOString() };
  }

  if (status) return { ...req, status };
  return req;
}
