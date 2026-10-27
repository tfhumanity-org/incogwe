/**
 * Bulk sending.
 *
 * Two gates before anything leaves the process:
 *   1. Consent (inside composeLetter -- it cannot be bypassed).
 *   2. Template review attestation, for any transport that is not dryrun/mock.
 *      The templates in this repo are a developer's drafting from the statutes and
 *      have not been reviewed by a lawyer. Sending them live at real companies in
 *      a real person's name without review would be reckless, so the code refuses.
 */
import type { Broker, RemovalRequest, RequestEvent, Subject } from '../types.ts';
import type { Clock } from '../util/clock.ts';
import type { PlannedRequest } from './planner.ts';
import type { Transport } from './transport.ts';
import { DryRunTransport, MockTransport } from './transport.ts';
import { RateLimiter } from './ratelimit.ts';
import { composeLetter, minimise, NoContactError, NoEntitlementError } from '../templates/letter.ts';
import { ConsentRequiredError } from '../consent/consent.ts';
import { dueDate, extendedDueDate } from '../legal/deadlines.ts';
import { replyAddressFor } from '../mailbox/inbound.ts';
import type { Store } from '../store/store.ts';
import { newId } from '../util/ids.ts';
import { log } from '../util/logging.ts';

export class TemplatesNotReviewedError extends Error {}

/** The transport failed in a way that is worth retrying. No state is written. */
export class TransientSendError extends Error {}

export interface SenderConfig {
  readonly agentName: string;
  readonly replyToBase: string;
  readonly clock: Clock;
  readonly transport: Transport;
  readonly store: Store;
  readonly rateLimiter?: RateLimiter;
  /** Stop after this many sends in one run. Protects against a runaway plan. */
  readonly maxPerRun?: number;
}

export interface SendOutcome {
  readonly sent: number;
  readonly deferred: number;
  readonly failed: number;
  readonly requests: readonly RemovalRequest[];
  readonly errors: readonly { brokerId: string; error: string }[];
}

function assertSendable(transport: Transport, env: NodeJS.ProcessEnv): void {
  if (transport instanceof DryRunTransport || transport instanceof MockTransport) return;
  if (!env.DELETEWE_TEMPLATES_REVIEWED) {
    throw new TemplatesNotReviewedError(
      'Refusing to send with a live transport. The request templates in this repository ' +
      'are DRAFT and have not been reviewed by a qualified lawyer. Once reviewed, set ' +
      'DELETEWE_TEMPLATES_REVIEWED to a note naming the reviewer and date.',
    );
  }
}

export class Sender {
  readonly #cfg: SenderConfig;
  readonly #limiter: RateLimiter;

  constructor(cfg: SenderConfig) {
    this.#cfg = cfg;
    this.#limiter = cfg.rateLimiter ?? new RateLimiter(cfg.clock);
  }

  async sendPlan(
    subject: Subject,
    planned: readonly PlannedRequest[],
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<SendOutcome> {
    assertSendable(this.#cfg.transport, env);

    const store = this.#cfg.store;
    const consent = store.getConsent(subject.id);
    const now = this.#cfg.clock.now();
    const max = this.#cfg.maxPerRun ?? planned.length;

    const requests: RemovalRequest[] = [];
    const errors: { brokerId: string; error: string }[] = [];
    let sent = 0, deferred = 0, failed = 0;

    for (const p of planned) {
      if (sent >= max) { deferred += 1; continue; }

      if (!this.#limiter.tryAcquire(p.broker.id, p.broker.rateLimitPerHour)) {
        deferred += 1;
        log.debug('send deferred by rate limit', {
          brokerId: p.broker.id,
          retryAfterMs: this.#limiter.retryAfterMs(p.broker.id, p.broker.rateLimitPerHour),
        });
        continue;
      }

      try {
        const result = await this.#sendOne(subject, consent, p, now);
        requests.push(result.request);
        if (result.ok) sent += 1; else failed += 1;
      } catch (e) {
        failed += 1;
        const msg = describe(e);
        errors.push({ brokerId: p.broker.id, error: msg });
        log.warn('send failed', { brokerId: p.broker.id, error: msg });
        if (e instanceof ConsentRequiredError) break; // nothing else will succeed either
      }
    }

    log.info('plan sent', { subjectId: subject.id, sent, deferred, failed });
    return { sent, deferred, failed, requests, errors };
  }

  async #sendOne(
    subject: Subject,
    consent: ReturnType<Store['getConsent']>,
    p: PlannedRequest,
    now: Date,
  ): Promise<{ ok: boolean; request: RemovalRequest }> {
    const store = this.#cfg.store;
    const requestId = newId('req');
    const primary = p.entitlements[0]!;

    const letter = composeLetter({
      // Minimum-PII projection: this broker gets only what it needs (ADR-0001 D7).
      subject: minimise(subject, p.broker),
      broker: p.broker,
      entitlements: p.entitlements,
      consent: consent!,            // assertConsent inside composeLetter does the check
      requestRef: requestId,
      replyTo: replyAddressFor(this.#cfg.replyToBase, p.threadKey),
      agentName: this.#cfg.agentName,
      sentAt: now,
      observation: p.observation,
    });

    const res = await this.#cfg.transport.send(letter, p.broker, p.threadKey);

    // A soft rejection -- the transport could not deliver now, but the address is
    // fine -- must leave nothing behind. Writing a `closed` row with no outcome
    // created a request that `openRequests()` excluded (so the scheduler never
    // retried it) while the dashboard still counted it as open. Returning without
    // persisting means the next plan simply picks the broker up again.
    if (!res.accepted && !res.undeliverable) {
      throw new TransientSendError(
        `transport could not deliver to ${p.broker.id}: ${res.error ?? 'unspecified'}`,
      );
    }

    const base: RemovalRequest = {
      id: requestId,
      subjectId: subject.id,
      brokerId: p.broker.id,
      instrument: letter.instrument,
      supportingInstruments: letter.supporting,
      rights: primary.rights,
      status: res.accepted ? 'sent' : 'closed',
      outcome: res.undeliverable ? 'undeliverable' : null,
      createdAt: now.toISOString(),
      sentAt: res.accepted ? now.toISOString() : null,
      dueAt: res.accepted ? dueDate(now, primary.responseDays).toISOString() : null,
      extendedDueAt: null,
      closedAt: res.accepted ? null : now.toISOString(),
      nextActionAt: null,
      followUpCount: 0,
      bodyHash: letter.bodyHash,
      observationId: p.observation?.id ?? null,
      threadKey: p.threadKey,
    };

    store.putRequest(base);
    store.putLetter(requestId, letter.bodyHash, letter.body, now.toISOString());
    store.putEvent(event(requestId, now, res.accepted ? 'sent' : 'outcome_recorded',
      res.accepted
        ? `Sent under ${letter.instrument}; response due ${letter.dueAt.slice(0, 10)}.`
        : `Undeliverable: ${res.error ?? 'rejected by transport'}.`,
      letter.bodyHash));

    return { ok: res.accepted, request: base };
  }

  /** Expose for the scheduler, which sends follow-ups through the same limiter. */
  get limiter(): RateLimiter { return this.#limiter; }

  /** The extension deadline a broker would get, used when one is notified. */
  static extensionFor(sentAt: Date, responseDays: number, extensionDays: number): string | null {
    const d = extendedDueDate(sentAt, responseDays, extensionDays);
    return d ? d.toISOString() : null;
  }
}

export function event(
  requestId: string, at: Date, kind: RequestEvent['kind'], detail: string, evidenceHash: string | null = null,
): RequestEvent {
  return { id: newId('ev'), requestId, at: at.toISOString(), kind, detail, evidenceHash };
}

function describe(e: unknown): string {
  if (e instanceof TransientSendError) return `transient: ${e.message}`;
  if (e instanceof ConsentRequiredError) return `consent: ${e.reason}`;
  if (e instanceof NoEntitlementError) return `no entitlement: ${e.message}`;
  if (e instanceof NoContactError) return `no contact: ${e.message}`;
  if (e instanceof TemplatesNotReviewedError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Broker identity only -- never the subject. Used by the sender's log lines. */
export type { Broker };
