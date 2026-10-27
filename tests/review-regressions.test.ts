/**
 * Regression tests for defects found in code review of the build/incogni branch.
 * Each one failed before its fix; the comment says what the failure cost.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReply } from '../src/mailbox/classifier.ts';
import { ingest } from '../src/mailbox/inbound.ts';
import { BrokerRegistry, brokers } from '../src/brokers/registry.ts';
import { classifyUrl } from '../src/custom/classify.ts';
import { resolveEntitlements } from '../src/legal/entitlements.ts';
import { planRequests } from '../src/engine/planner.ts';
import { Sender, TransientSendError } from '../src/engine/sender.ts';
import { Scheduler } from '../src/engine/scheduler.ts';
import { MockTransport, type SendResult } from '../src/engine/transport.ts';
import { decideAction } from '../src/legal/deadlines.ts';
import { grantConsent, revokeConsent, verifyConsentChain } from '../src/consent/consent.ts';
import { acceptInvite, createAccount, createInvite, InviteError } from '../src/profiles/account.ts';
import { addDays, fixedClock } from '../src/util/clock.ts';
import { broker, ids, memStore, registryOf, seedSubject, subject, T0 } from './helpers.ts';

describe('F1: an autoresponder is not a bounce', () => {
  const ooo = (headers: Record<string, string>) => ingest({
    from: 'privacy@buxton.example', to: 'deletions+thr_ooo1@deletewe.invalid',
    subject: 'Automatic reply: Consumer request to delete',
    body: 'I am currently out of the office until 3 November and will reply on my return.',
    receivedAt: T0, headers,
  });

  test('RFC 3834 Auto-Submitted: auto-replied is an auto_reply, not undeliverable', () => {
    // `bounce` overrides every other class, and maps to outcome `undeliverable`,
    // which closes the request. A broker on holiday had the subject's request
    // abandoned as "the letter never arrived".
    assert.equal(classifyReply(ooo({ 'auto-submitted': 'auto-replied' })).class, 'auto_reply');
    assert.equal(classifyReply(ooo({ 'auto-submitted': 'auto-generated' })).class, 'auto_reply');
  });

  test('a real DSN is still a bounce', () => {
    const dsn = ingest({
      from: 'MAILER-DAEMON@mx.example.net', to: 'deletions+thr_b1@deletewe.invalid',
      subject: 'Undeliverable: Consumer request to delete',
      body: '550 5.1.1 Recipient address rejected: user unknown',
      receivedAt: T0,
      headers: { 'x-failed-recipients': 'privacy@defunct.example', 'auto-submitted': 'auto-replied' },
    });
    assert.equal(classifyReply(dsn).class, 'bounce');
  });

  test('a multipart/report DSN is detected from its content type alone', () => {
    const dsn = ingest({
      from: 'bounces@mx.example.net', to: 'deletions+thr_b2@deletewe.invalid',
      subject: 'Delivery Status Notification', body: 'See attached.',
      receivedAt: T0,
      headers: { 'content-type': 'multipart/report; report-type=delivery-status; boundary=x' },
    });
    assert.equal(classifyReply(dsn).class, 'bounce');
  });

  test('the DSN header rule actually fires against joined headers', () => {
    // It was `^`-anchored without the `m` flag against all headers joined by \n,
    // so it could only match if the FIRST header line began "failed"/"5.x.x".
    const dsn = ingest({
      from: 'noreply@mx.example.net', to: 'deletions+thr_b3@deletewe.invalid',
      subject: 'Mail delivery report', body: 'The message could not be delivered.',
      receivedAt: T0,
      headers: { 'return-path': '<>', 'status': '5.1.1', 'action': 'failed' },
    });
    const c = classifyReply(dsn);
    assert.equal(c.class, 'bounce');
    assert.ok(c.matchedRules.includes('bounce.header.failed'));
  });
});

describe('F4: a registry answers only for the brokers it holds', () => {
  test('an operator-corrected contact is returned, not the shipped one', () => {
    const real = brokers.get('acxiom')!;
    const corrected = {
      ...real, legalContact: { ...real.legalContact, email: 'operator@example.org' },
    };
    const mine = new BrokerRegistry([corrected]);
    assert.equal(mine.get('acxiom')!.legalContact.email, 'operator@example.org',
      'a stale shipped address here sends every letter to the wrong inbox');
  });

  test('a broker the registry does not hold is not resolvable through it', () => {
    const mine = new BrokerRegistry([brokers.get('acxiom')!]);
    assert.equal(mine.get('spokeo'), undefined);
    assert.equal(mine.matchUrl('https://spokeo.com/x'), undefined);
  });
});

describe('F5/F6: recurrence and escalation do not deadlock', () => {
  test('a recurred request is re-plannable rather than parked', async () => {
    const store = memStore();
    const registry = registryOf(broker({ id: 'priv', surface: 'private', severity: 5 }));
    const s = seedSubject(store, subject());
    const transport = new MockTransport({ priv: { reply: 'confirm' } });

    await new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: fixedClock(T0.toISOString()),
      transport, store,
    }).sendPlan(s, planRequests(s, { registry, now: T0 }).requests);

    const req = store.requestsForSubject(s.id)[0]!;
    store.putRequest({
      ...req, status: 'closed', outcome: 'confirmed_deleted',
      closedAt: T0.toISOString(), nextActionAt: addDays(T0, 90).toISOString(),
    });

    const day95 = addDays(T0, 95);
    await new Scheduler({
      clock: fixedClock(day95.toISOString()), store, registry, transport, agentName: 'a',
    }).tick();

    const after = store.getRequest(req.id)!;
    assert.equal(after.status, 'closed', 'status "planned" deadlocked: unschedulable AND unplannable');
    assert.equal(after.nextActionAt, null);
    assert.ok(planRequests(s, { registry, existing: store.requestsForSubject(s.id), now: day95 })
      .requests.some((p) => p.broker.id === 'priv'));
    store.close();
  });

  test('the planner does not re-send to a broker still inside its cycle', () => {
    const s = subject();
    const registry = registryOf(broker({ id: 'priv' }));
    const plan = planRequests(s, {
      registry, now: addDays(T0, 10),
      existing: [{ brokerId: 'priv', status: 'closed', nextActionAt: addDays(T0, 90).toISOString() }],
    });
    assert.equal(plan.requests.length, 0);
    assert.deepEqual(plan.skipped, [{ brokerId: 'priv', reason: 'not_due' }]);
  });

  test('an escalated request re-asserts once its cycle comes round', () => {
    const base = {
      status: 'escalated' as const, outcome: 'deadline_missed' as const,
      dueAt: addDays(T0, 45).toISOString(), extendedDueAt: null, followUpCount: 2,
      nextActionAt: addDays(T0, 90).toISOString(),
    };
    assert.equal(decideAction(base, broker({ surface: 'private' }), addDays(T0, 60)), 'none');
    assert.equal(decideAction(base, broker({ surface: 'private' }), addDays(T0, 95)), 'recur',
      'escalation is not abandonment; the right is re-asserted');
  });
});

describe('F8: a transient transport failure leaves no ghost request', () => {
  test('nothing is persisted, and the error is reported', async () => {
    const store = memStore();
    const s = seedSubject(store, subject());
    const registry = registryOf(broker({ id: 'flaky' }));
    const flaky = {
      id: 'mock',
      async send(): Promise<SendResult> {
        return { accepted: false, messageId: null, error: 'temporary failure', undeliverable: false };
      },
    };
    const out = await new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock: fixedClock(T0.toISOString()),
      transport: Object.assign(new MockTransport(), flaky), store,
    }).sendPlan(s, planRequests(s, { registry, now: T0 }).requests);

    assert.equal(out.sent, 0);
    assert.equal(out.failed, 1);
    assert.match(out.errors[0]!.error, /transient/);
    assert.equal(store.requestsForSubject(s.id).length, 0,
      'a closed-with-no-outcome row was invisible to the scheduler yet counted as open');
    assert.ok(TransientSendError);
    store.close();
  });
});

describe('F3: an invitation is verified against stored state', () => {
  function family() {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'family', T0);
    store.putAccount(account); store.putSubject(owner);
    return { store, account };
  }
  const join = (store: ReturnType<typeof memStore>, token: string, now = T0) => acceptInvite(store, {
    presentedToken: token, identifiers: ids({ fullName: 'Jordan Ellis', emails: ['j@example.org'] }),
    residence: 'US-CA', signatureName: 'Jordan Ellis', scopes: ['erasure_requests'],
    agentName: 'a', now,
  });

  test('only a token minted by createInvite is accepted', () => {
    // The CLI used to build the expected invitation out of the presented token, so
    // the hash check and the expiry check both compared a value against itself:
    // anyone who knew an account id could join it with an arbitrary string.
    const { store, account } = family();
    createInvite(store, account.id, T0);
    assert.throws(() => join(store, 'inv_i-made-this-up'), InviteError);
    assert.equal(store.subjectsForAccount(account.id).length, 1, 'owner only');
    store.close();
  });

  test('no invitation at all means no join', () => {
    const { store } = family();
    assert.throws(() => join(store, 'inv_anything'), InviteError);
    store.close();
  });

  test('an invitation is single use', () => {
    const { store, account } = family();
    const inv = createInvite(store, account.id, T0);
    join(store, inv.token);
    assert.throws(() => join(store, inv.token), /already used/);
    store.close();
  });

  test('expiry is read from the stored invitation, not from the caller', () => {
    const { store, account } = family();
    const inv = createInvite(store, account.id, T0);
    assert.throws(() => join(store, inv.token, addDays(T0, 2)), /expired/);
    store.close();
  });

  test('the token determines the account; the caller cannot nominate one', () => {
    const { store, account } = family();
    const inv = createInvite(store, account.id, T0);
    const member = join(store, inv.token);
    assert.equal(member.accountId, account.id);
    store.close();
  });
});

describe('F11: the consent chain survives a revocation', () => {
  test('re-saving an earlier record keeps its position', () => {
    const store = memStore();
    const mk = (n: number, prev: string | null) => grantConsent({
      subjectId: 'subj_1', jurisdictions: ['US-CA'], scopes: ['erasure_requests'],
      signatureName: 'A', method: 'in_person', agentName: 'x',
      now: addDays(T0, n), previousHash: prev,
    });
    const a = mk(0, null);
    const b = mk(1, a.entryHash);
    store.putConsent(a); store.putConsent(b);
    assert.equal(verifyConsentChain(store.consentChain('subj_1')), true);

    // Revoking appends a third entry chained onto the current head.
    store.putConsent(revokeConsent(b, addDays(T0, 2), store.consentChainHead('subj_1')));
    const chain = store.consentChain('subj_1');
    assert.equal(chain.length, 3, 'append-only: nothing was rewritten');
    assert.deepEqual(chain.map((c) => c.grantedAt.slice(0, 10)),
      ['2026-03-01', '2026-03-02', '2026-03-02']);
    assert.equal(verifyConsentChain(chain), true,
      'an out-of-order or rewritten chain reports the evidence pack authorisation as INVALID');
    assert.equal(store.getConsent('subj_1'), null,
      'the latest entry is a revocation, so there is no live authorisation');
    store.close();
  });
});

describe('F10: unattributed replies are governed by a retention period', () => {
  test('they are purged once past retention, since erasure cannot reach them', () => {
    const store = memStore();
    const put = (id: string, at: Date) => store.putReply({
      id, threadKey: null, fromAddress: 'p@broker.example', toAddress: 'deletions@deletewe.invalid',
      subject: 'hi', receivedAt: at.toISOString(), body: 'some personal data', headers: {},
    }, null);
    put('reply_old', T0);
    put('reply_new', addDays(T0, 85));

    const purged = store.purgeUnattributedReplies(addDays(T0, 100), 90);
    assert.equal(purged, 1);
    assert.equal(store.getReply('reply_old'), null);
    assert.ok(store.getReply('reply_new'), 'still inside the window, still attributable by a human');
    store.close();
  });

  test('an attributed reply is never touched by the sweep', () => {
    const store = memStore();
    store.putReply({
      id: 'reply_attributed', threadKey: 'thr_abc12345', fromAddress: 'p@b.example',
      toAddress: 'deletions+thr_abc12345@deletewe.invalid', subject: 'x',
      receivedAt: T0.toISOString(), body: 'y', headers: {},
    }, null);
    assert.equal(store.purgeUnattributedReplies(addDays(T0, 1000), 90), 0);
    store.close();
  });
});

describe('F7: a malformed URL does not crash custom removals', () => {
  const s = subject();
  test('a broken percent-escape is classified, not thrown on', () => {
    for (const url of [
      'https://whitepages-clone.example/name/%E0%A4%A',
      'https://people-search.example/%',
      'https://x.example/%ZZ',
    ]) {
      const c = classifyUrl(url, s, brokers);
      assert.ok(c.routedTo, `${url} should classify`);
    }
  });

  test('an unrecognised host is not reported as both ineligible and eligible', () => {
    const c = classifyUrl('https://some-random-blog.example/post/1', s, brokers);
    assert.equal(c.kind, 'unrecognised_host');
    assert.equal(c.eligible, true);
    assert.equal(c.routedTo, 'manual_review');
  });
});

describe('F13: no entitlement is asserted where the instrument does not reach', () => {
  test('an instrument that neither governs nor targets is dropped, not scored', () => {
    const s = subject({ residence: 'US-CA' });
    const elsewhere = broker({ establishedIn: 'JP', targetsRegions: ['JP', 'KR'] });
    assert.deepEqual(resolveEntitlements(s, elsewhere), [],
      'the basis text would otherwise claim the broker targets California, in a letter');
  });

  test('country-level targeting still reaches a state resident', () => {
    const s = subject({ residence: 'US-CA' });
    const usWide = broker({ establishedIn: 'JP', targetsRegions: ['US'] });
    assert.equal(resolveEntitlements(s, usWide)[0]?.instrument, 'CCPA');
  });
});

describe('F12: the broker seed has unique ids and reachable contacts', () => {
  test('no two shipped brokers share an id', () => {
    const all = brokers.all().map((b) => b.id);
    assert.equal(new Set(all).size, all.length);
  });

  test('every shipped broker is contactable, so module import cannot throw', () => {
    for (const b of brokers.all()) {
      assert.ok(b.legalContact.email || b.legalContact.privacyPortal, b.id);
    }
  });
});
