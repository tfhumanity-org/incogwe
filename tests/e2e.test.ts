/**
 * End-to-end, against in-process mock brokers. No network is used and no live
 * broker traffic is possible: MockTransport has no socket of any kind, and the
 * sender refuses any other transport unless templates have been attested as
 * reviewed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planRequests } from '../src/engine/planner.ts';
import { Sender, TemplatesNotReviewedError } from '../src/engine/sender.ts';
import { Scheduler } from '../src/engine/scheduler.ts';
import { MockTransport, DryRunTransport, transportFromEnv } from '../src/engine/transport.ts';
import { RateLimiter } from '../src/engine/ratelimit.ts';
import { processReply } from '../src/mailbox/process.ts';
import { ingest } from '../src/mailbox/inbound.ts';
import { buildDashboard } from '../src/dashboard/timeline.ts';
import { buildEvidencePack, renderEvidencePack } from '../src/dashboard/evidence.ts';
import { addDays, fixedClock } from '../src/util/clock.ts';
import { broker, memStore, registryOf, seedSubject, subject, T0 } from './helpers.ts';
import type { Store } from '../src/store/store.ts';
import type { RemovalRequest } from '../src/types.ts';

const MOCKS = [
  broker({ id: 'mock-compliant', name: 'Compliant Marketing Co', severity: 6, surface: 'private' }),
  broker({ id: 'mock-nodata', name: 'Empty Database Ltd', severity: 4, surface: 'private' }),
  broker({ id: 'mock-silent', name: 'Silent Risk Corp', severity: 9, surface: 'private' }),
  broker({ id: 'mock-verify', name: 'Verifier Financial', severity: 8, surface: 'private' }),
  broker({ id: 'mock-refuse', name: 'Refuser Reports', severity: 7, surface: 'private', sectoralRegimes: ['FCRA'] }),
  broker({ id: 'mock-people', name: 'Public Finder', severity: 5, surface: 'public' }),
  broker({ id: 'mock-bounce', name: 'Defunct Broker', severity: 3, surface: 'private' }),
];

const BEHAVIOURS = {
  'mock-compliant': { reply: 'confirm' as const },
  'mock-nodata': { reply: 'no_data' as const },
  'mock-silent': { reply: null },
  'mock-verify': { reply: 'verify' as const },
  'mock-refuse': { reply: 'refuse' as const },
  'mock-people': { reply: 'confirm' as const },
  'mock-bounce': { reply: 'bounce' as const },
};

const REPLY_BODIES: Record<string, string> = {
  confirm: 'We have deleted all personal information associated with this individual from our systems.',
  no_data: 'We searched our systems and we do not hold any personal data about this individual. No matching records were found.',
  verify: "Before we proceed we require you to verify the consumer's identity. Please provide a copy of a government-issued photo ID.",
  refuse: 'We are unable to action this request. The data is held in a consumer reporting database regulated by the Fair Credit Reporting Act, which precludes deletion.',
};

function harness(now = T0) {
  const store = memStore();
  const registry = registryOf(...MOCKS);
  const clock = fixedClock(now.toISOString());
  const transport = new MockTransport(BEHAVIOURS);
  const s = seedSubject(store, subject());
  return { store, registry, clock, transport, subject: s };
}

function replyTo(store: Store, req: RemovalRequest, kind: keyof typeof REPLY_BODIES, at: Date) {
  return ingest({
    from: `privacy@${req.brokerId}.example`,
    to: `deletions+${req.threadKey}@deletewe.invalid`,
    subject: `Re: request ref ${req.id}`,
    body: REPLY_BODIES[kind]!,
    receivedAt: at,
  });
}

describe('planning', () => {
  test('plans a request for every reachable broker, scanned or not', () => {
    const { registry, subject: s } = harness();
    const plan = planRequests(s, { registry });
    assert.equal(plan.requests.length, MOCKS.length,
      'entitlement gates the request; absence of an observation never does');
    assert.equal(plan.skipped.length, 0);
  });

  test('orders by severity, highest first', () => {
    const { registry, subject: s } = harness();
    const plan = planRequests(s, { registry });
    assert.equal(plan.requests[0]!.broker.id, 'mock-silent', 'severity 9 goes first');
    const sevs = plan.requests.map((p) => p.broker.severity);
    assert.deepEqual(sevs, [...sevs].sort((a, b) => b - a));
  });

  test('an observed listing outranks an unobserved one at equal severity', () => {
    const a = broker({ id: 'obs-a', severity: 5, surface: 'public' });
    const b = broker({ id: 'obs-b', severity: 5, surface: 'public' });
    const s = subject();
    const plan = planRequests(s, {
      registry: registryOf(a, b),
      observations: [{
        id: 'o1', subjectId: s.id, brokerId: 'obs-b', url: 'https://x.invalid/p',
        observedAt: T0.toISOString(), matchedIdentifiers: ['full_name'], present: true, snapshotHash: null,
      }],
    });
    assert.equal(plan.requests[0]!.broker.id, 'obs-b');
  });

  test('does not duplicate an already-open request', () => {
    const { registry, subject: s } = harness();
    const plan = planRequests(s, {
      registry, existing: [{ brokerId: 'mock-silent', status: 'sent', nextActionAt: null }],
    });
    assert.equal(plan.requests.length, MOCKS.length - 1);
    assert.deepEqual(plan.skipped, [{ brokerId: 'mock-silent', reason: 'already_open' }]);
  });

  test('a broker that does not reach the subject\'s region is not a candidate at all', () => {
    const s = subject({ residence: 'ZZ' });
    const plan = planRequests(s, { registry: registryOf(broker({ id: 'x' })) });
    assert.equal(plan.requests.length, 0);
    assert.equal(plan.skipped.length, 0, 'region filtering happens before candidacy');
  });

  test('a candidate with no statutory route is skipped with a reason', () => {
    const s = subject({ residence: 'ZZ' });
    // `only` forces candidacy, so the entitlement check is what rejects it.
    const plan = planRequests(s, { registry: registryOf(broker({ id: 'x' })), only: ['x'] });
    assert.deepEqual(plan.skipped, [{ brokerId: 'x', reason: 'no_entitlement' }]);
  });

  test('a contactless broker cannot enter a registry, and the planner guards it anyway', () => {
    const noContact = broker({ id: 'nc', legalContact: { email: null, privacyPortal: null, postal: 'somewhere' } });
    // First line of defence: the registry refuses to hold it at all.
    assert.throws(() => registryOf(noContact), /no legal contact/);

    // Second line: if one is injected past the registry (a stale cache, a mutated
    // object), the planner still skips it with a reason rather than throwing mid-run.
    const reg = registryOf(broker({ id: 'nc' }));
    (reg.all() as unknown as { legalContact: unknown }[])[0]!.legalContact =
      { email: null, privacyPortal: null, postal: 'somewhere' };
    const plan = planRequests(subject(), { registry: reg, only: ['nc'] });
    assert.deepEqual(plan.skipped, [{ brokerId: 'nc', reason: 'no_contact' }]);
  });
});

describe('sending', () => {
  test('sends the plan, records a request, a sealed letter and an event per broker', async () => {
    const h = harness();
    const plan = planRequests(h.subject, { registry: h.registry });
    const sender = new Sender({
      agentName: 'deletewe test', replyToBase: 'deletions@deletewe.invalid',
      clock: h.clock, transport: h.transport, store: h.store,
    });
    const out = await sender.sendPlan(h.subject, plan.requests);

    assert.equal(out.sent, MOCKS.length - 1, 'all but the bouncing broker');
    assert.equal(out.failed, 1);
    assert.equal(h.transport.sent.length, MOCKS.length - 1);

    const stored = h.store.requestsForSubject(h.subject.id);
    assert.equal(stored.length, MOCKS.length);
    for (const r of stored.filter((x) => x.brokerId !== 'mock-bounce')) {
      assert.equal(r.status, 'sent');
      assert.ok(r.dueAt, 'a clock starts on send');
      assert.equal(r.dueAt!.slice(0, 10), '2026-04-15', '45 days under CCPA');
      assert.ok(h.store.getLetter(r.id), 'the letter is retained as evidence');
      assert.ok(h.store.eventsFor(r.id).some((e) => e.kind === 'sent'));
    }

    const bounced = stored.find((r) => r.brokerId === 'mock-bounce')!;
    assert.equal(bounced.outcome, 'undeliverable');
    assert.equal(bounced.status, 'closed');
    h.store.close();
  });

  test('the per-broker rate limit defers rather than dropping', async () => {
    const h = harness();
    const slow = broker({ id: 'slow', rateLimitPerHour: 1 });
    const registry = registryOf(slow);
    const sender = new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: h.clock,
      transport: new MockTransport(), store: h.store,
      rateLimiter: new RateLimiter(h.clock),
    });
    const plan = planRequests(h.subject, { registry });
    const first = await sender.sendPlan(h.subject, plan.requests);
    assert.equal(first.sent, 1);

    // Same broker again inside the hour: the bucket is empty.
    const plan2 = planRequests(h.subject, { registry });
    const second = await sender.sendPlan(h.subject, plan2.requests);
    assert.equal(second.sent, 0);
    assert.equal(second.deferred, 1, 'deferred, not failed; it will go out next run');
    h.store.close();
  });

  test('refuses to send with a non-mock transport unless templates are attested', async () => {
    const h = harness();
    // A transport that is neither DryRunTransport nor MockTransport: the sender must
    // treat it as capable of reaching a real company and refuse without an attestation.
    const live = { id: 'live', send: async () => ({ accepted: true, messageId: 'x', error: null, undeliverable: false }) };
    const sender = new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: h.clock, transport: live, store: h.store,
    });
    await assert.rejects(
      () => sender.sendPlan(h.subject, planRequests(h.subject, { registry: h.registry }).requests, {} as NodeJS.ProcessEnv),
      TemplatesNotReviewedError,
    );
    h.store.close();
  });

  test('transportFromEnv never yields a live sender', () => {
    assert.ok(transportFromEnv({ DELETEWE_TRANSPORT: 'dryrun' } as NodeJS.ProcessEnv) instanceof DryRunTransport);
    assert.ok(transportFromEnv({ DELETEWE_TRANSPORT: 'mock' } as NodeJS.ProcessEnv) instanceof MockTransport);
    assert.throws(() => transportFromEnv({ DELETEWE_TRANSPORT: 'smtp' } as NodeJS.ProcessEnv));
  });

  test('a subject without consent gets nothing sent', async () => {
    const store = memStore();
    const s = subject({ id: 'subj_nc' });
    store.putSubject(s);   // deliberately no consent record
    const sender = new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: fixedClock(T0.toISOString()),
      transport: new MockTransport(), store,
    });
    const out = await sender.sendPlan(s, planRequests(s, { registry: registryOf(...MOCKS) }).requests);
    assert.equal(out.sent, 0);
    assert.equal(out.failed, 1, 'it stops at the first consent failure rather than grinding on');
    assert.match(out.errors[0]!.error, /consent/);
    store.close();
  });
});

describe('the full lifecycle', () => {
  test('sent -> replies -> four distinct outcomes, never merged', async () => {
    const h = harness();
    const sender = new Sender({
      agentName: 'deletewe test', replyToBase: 'deletions@deletewe.invalid',
      clock: h.clock, transport: h.transport, store: h.store,
    });
    await sender.sendPlan(h.subject, planRequests(h.subject, { registry: h.registry }).requests);

    const day3 = addDays(T0, 3);
    for (const r of h.store.requestsForSubject(h.subject.id)) {
      const b = BEHAVIOURS[r.brokerId as keyof typeof BEHAVIOURS];
      if (!b?.reply || b.reply === 'bounce') continue;
      const res = processReply(replyTo(h.store, r, b.reply, day3), {
        store: h.store, registry: h.registry, now: day3,
      });
      assert.equal(res.applied, true, `${r.brokerId}: ${res.reason}`);
    }

    const byBroker = new Map(h.store.requestsForSubject(h.subject.id).map((r) => [r.brokerId, r]));
    assert.equal(byBroker.get('mock-compliant')!.outcome, 'confirmed_deleted');
    assert.equal(byBroker.get('mock-nodata')!.outcome, 'no_data_held');
    assert.equal(byBroker.get('mock-refuse')!.outcome, 'refused');
    assert.equal(byBroker.get('mock-bounce')!.outcome, 'undeliverable');
    assert.equal(byBroker.get('mock-silent')!.outcome, null, 'silence is not an outcome yet');
    assert.equal(byBroker.get('mock-verify')!.status, 'awaiting_verification');
    assert.equal(byBroker.get('mock-verify')!.outcome, null, 'a verification demand must not close the request');

    const d = buildDashboard(h.store, h.registry, h.subject.id, day3);
    assert.equal(d.breakdown.confirmedDeleted, 2, 'mock-compliant and mock-people');
    assert.equal(d.breakdown.noDataHeld, 1);
    assert.equal(d.breakdown.refused, 1);
    assert.equal(d.breakdown.undeliverable, 1);
    assert.equal(d.breakdown.open, 2, 'silent and verify are still live');
    assert.ok(!('total' in d.breakdown), 'there is deliberately no aggregate success number');
    h.store.close();
  });

  test('a silent broker is chased, then escalated with a complaint draft', async () => {
    const h = harness();
    const sender = new Sender({
      agentName: 'deletewe test', replyToBase: 'deletions@deletewe.invalid',
      clock: h.clock, transport: h.transport, store: h.store,
    });
    await sender.sendPlan(h.subject, planRequests(h.subject, { registry: h.registry, only: ['mock-silent'] }).requests);
    const reqId = h.store.requestsForSubject(h.subject.id)[0]!.id;

    const run = async (day: number) => {
      const clock = fixedClock(addDays(T0, day).toISOString());
      const sched = new Scheduler({
        clock, store: h.store, registry: h.registry,
        transport: h.transport, agentName: 'deletewe test',
      });
      return { r: await sched.tick(), drafts: sched.drafts };
    };

    // Day 40: a pre-deadline nudge (45-day CCPA clock, 7-day lead).
    assert.equal((await run(40)).r.followUps, 1);
    // Day 50: overdue, second follow-up.
    assert.equal((await run(50)).r.followUps, 1);
    // Day 60: follow-ups exhausted -> escalate with a draft complaint.
    const esc = await run(60);
    assert.equal(esc.r.escalations, 1);
    assert.equal(esc.r.complaints.length, 1);

    const req = h.store.getRequest(reqId)!;
    assert.equal(req.status, 'escalated');
    assert.equal(req.outcome, 'deadline_missed', 'silence is recorded as a breach, not as nothing');
    assert.equal(req.followUpCount, 2);

    const draft = esc.drafts[0]!;
    assert.match(draft.body, /COMPLAINT TO CALIFORNIA PRIVACY PROTECTION AGENCY/);
    assert.match(draft.body, /Silent Risk Corp/);
    assert.match(draft.body, /Cal\. Civ\. Code § 1798\.130\(a\)\(2\)/);
    assert.match(draft.body, new RegExp(req.bodyHash), 'the complaint cites the letter digest');
    assert.match(draft.body, /follow_up_sent/, 'the correspondence history is reproduced');
    assert.match(draft.body, /Avery Nakamura/);

    const events = h.store.eventsFor(reqId);
    assert.ok(events.some((e) => e.kind === 'complaint_drafted' && /NOT filed/.test(e.detail)),
      'drafts are never filed automatically');
    h.store.close();
  });

  test('no complaint is drafted when the subject did not authorise complaints', async () => {
    const store = memStore();
    const registry = registryOf(broker({ id: 'mock-silent', severity: 9 }));
    const s = seedSubject(store, subject(), T0, ['erasure_requests']);
    const transport = new MockTransport({ 'mock-silent': { reply: null } });
    await new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: fixedClock(T0.toISOString()),
      transport, store,
    }).sendPlan(s, planRequests(s, { registry }).requests);

    for (const day of [40, 50, 60]) {
      await new Scheduler({
        clock: fixedClock(addDays(T0, day).toISOString()), store, registry, transport, agentName: 'a',
      }).tick();
    }
    const reqId = store.requestsForSubject(s.id)[0]!.id;
    assert.equal(store.getRequest(reqId)!.status, 'escalated');
    assert.ok(store.eventsFor(reqId).some((e) => /has not authorised regulator complaints/.test(e.detail)));
    store.close();
  });

  test('a closed request comes back round on its cadence', async () => {
    const h = harness();
    const registry = registryOf(
      broker({ id: 'pub', surface: 'public', severity: 5 }),
      broker({ id: 'priv', surface: 'private', severity: 5 }),
    );
    const transport = new MockTransport({ pub: { reply: 'confirm' }, priv: { reply: 'confirm' } });
    await new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: h.clock, transport, store: h.store,
    }).sendPlan(h.subject, planRequests(h.subject, { registry }).requests);

    const day2 = addDays(T0, 2);
    for (const r of h.store.requestsForSubject(h.subject.id)) {
      processReply(replyTo(h.store, r, 'confirm', day2), { store: h.store, registry, now: day2 });
    }

    const pub = h.store.requestsForSubject(h.subject.id).find((r) => r.brokerId === 'pub')!;
    const priv = h.store.requestsForSubject(h.subject.id).find((r) => r.brokerId === 'priv')!;
    // Both clocks run from the date the request closed (2026-03-03), not from send.
    assert.equal(pub.nextActionAt!.slice(0, 10), '2026-03-13', 'public: 10-day re-verification');
    assert.equal(priv.nextActionAt!.slice(0, 10), '2026-06-01', 'private: 90-day re-assertion');

    const sched = new Scheduler({
      clock: fixedClock(addDays(T0, 95).toISOString()), store: h.store, registry,
      transport, agentName: 'a',
    });
    const r = await sched.tick();
    assert.equal(r.reverifications, 1);
    assert.equal(r.recurrences, 1);

    // The recurred request stays closed with its outcome intact and its due date
    // cleared, which is what tells the planner it may send afresh.
    const recurred = h.store.getRequest(priv.id)!;
    assert.equal(recurred.status, 'closed');
    assert.equal(recurred.outcome, 'confirmed_deleted', 'the history is not rewritten');
    assert.equal(recurred.nextActionAt, null, 'cleared means due now');

    const day95 = addDays(T0, 95);
    const replanned = planRequests(h.subject, {
      registry, existing: h.store.requestsForSubject(h.subject.id), now: day95,
    });
    assert.ok(replanned.requests.some((p) => p.broker.id === 'priv'),
      'the recurred broker must actually be re-planned, not parked forever');
    h.store.close();
  });

  test('an extension moves the deadline and suppresses the follow-up', async () => {
    const h = harness();
    const registry = registryOf(broker({ id: 'ext', severity: 5 }));
    const transport = new MockTransport({ ext: { reply: 'extension' } });
    await new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: h.clock, transport, store: h.store,
    }).sendPlan(h.subject, planRequests(h.subject, { registry }).requests);

    const req = h.store.requestsForSubject(h.subject.id)[0]!;
    const day5 = addDays(T0, 5);
    processReply(ingest({
      from: 'privacy@ext.example', to: `deletions+${req.threadKey}@deletewe.invalid`,
      subject: 'Re: extension of time',
      body: 'Given the complexity of the request we are extending our response deadline by an additional 45 days.',
      receivedAt: day5,
    }), { store: h.store, registry, now: day5 });

    const after = h.store.getRequest(req.id)!;
    assert.equal(after.status, 'extended');
    assert.equal(after.extendedDueAt!.slice(0, 10), '2026-05-30', '45 + 45 from send');

    const sched = new Scheduler({
      clock: fixedClock(addDays(T0, 50).toISOString()), store: h.store, registry, transport, agentName: 'a',
    });
    assert.equal((await sched.tick()).followUps, 0, 'inside the notified extension');
    h.store.close();
  });

  test('a low-confidence reply changes nothing and lands in the review queue', async () => {
    const h = harness();
    const registry = registryOf(broker({ id: 'odd', severity: 5 }));
    await new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: h.clock,
      transport: new MockTransport({ odd: { reply: null } }), store: h.store,
    }).sendPlan(h.subject, planRequests(h.subject, { registry }).requests);

    const req = h.store.requestsForSubject(h.subject.id)[0]!;
    const res = processReply(ingest({
      from: 'privacy@odd.example', to: `deletions+${req.threadKey}@deletewe.invalid`,
      subject: 'Re: your letter', body: 'Please see attached.', receivedAt: addDays(T0, 2),
    }), { store: h.store, registry, now: addDays(T0, 2) });

    assert.equal(res.applied, false);
    assert.equal(h.store.getRequest(req.id)!.status, 'sent', 'state is untouched');
    assert.equal(h.store.repliesNeedingReview().length, 1);
    h.store.close();
  });

  test('an unattributable reply is stored for a human and touches no request', () => {
    const h = harness();
    const res = processReply(ingest({
      from: 'someone@elsewhere.example', to: 'deletions@deletewe.invalid',
      subject: 'Hello', body: 'We have deleted everything.', receivedAt: T0,
    }), { store: h.store, registry: h.registry, now: T0 });
    assert.equal(res.requestId, null);
    assert.equal(res.applied, false);
    assert.match(res.reason, /no thread key/);
    h.store.close();
  });
});

describe('evidence pack', () => {
  test('reproduces each letter with a verifiable digest and separates the outcomes', async () => {
    const h = harness();
    await new Sender({
      agentName: 'deletewe test', replyToBase: 'deletions@deletewe.invalid',
      clock: h.clock, transport: h.transport, store: h.store,
    }).sendPlan(h.subject, planRequests(h.subject, { registry: h.registry }).requests);

    const day3 = addDays(T0, 3);
    for (const r of h.store.requestsForSubject(h.subject.id)) {
      const b = BEHAVIOURS[r.brokerId as keyof typeof BEHAVIOURS];
      if (!b?.reply || b.reply === 'bounce') continue;
      processReply(replyTo(h.store, r, b.reply, day3), { store: h.store, registry: h.registry, now: day3 });
    }

    const pack = buildEvidencePack(h.store, h.registry, h.subject, day3);
    assert.equal(pack.consent.chainValid, true);
    assert.equal(pack.items.length, MOCKS.length);
    for (const item of pack.items.filter((i) => i.letter)) {
      assert.equal(item.letter!.verified, true, `${item.broker.id}: stored letter must hash to its recorded digest`);
    }
    assert.equal(pack.summary['confirmed_deleted'], 2);
    assert.equal(pack.summary['no_data_held'], 1);
    assert.ok(pack.manifestSha256.length === 64);

    const text = renderEvidencePack(pack);
    assert.match(text, /Rank 3 \(broker held no data\) is NOT a deletion/);
    assert.match(text, /DRAFT and have not been reviewed by a qualified lawyer/);
    assert.match(text, /evidence rank 2/);

    // Tampering with a stored letter is detectable.
    const victim = pack.items.find((i) => i.letter)!;
    h.store.putLetter(victim.requestId, victim.letter!.sha256, 'edited after the fact', day3.toISOString());
    const after = buildEvidencePack(h.store, h.registry, h.subject, day3);
    assert.equal(after.items.find((i) => i.requestId === victim.requestId)!.letter!.verified, false);
    h.store.close();
  });

  test('the manifest digest changes when anything in the pack changes', async () => {
    const h = harness();
    await new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: h.clock,
      transport: h.transport, store: h.store,
    }).sendPlan(h.subject, planRequests(h.subject, { registry: h.registry, only: ['mock-compliant'] }).requests);

    const a = buildEvidencePack(h.store, h.registry, h.subject, T0);
    const req = h.store.requestsForSubject(h.subject.id)[0]!;
    processReply(replyTo(h.store, req, 'confirm', addDays(T0, 1)), {
      store: h.store, registry: h.registry, now: addDays(T0, 1),
    });
    const b = buildEvidencePack(h.store, h.registry, h.subject, T0);
    assert.notEqual(a.manifestSha256, b.manifestSha256);
    h.store.close();
  });
});
