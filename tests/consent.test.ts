import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertConsent, authorisationDocument, ConsentRequiredError, CONSENT_TTL_DAYS,
  grantConsent, revokeConsent, verifyConsentChain,
} from '../src/consent/consent.ts';
import {
  acceptInvite, createAccount, createInvite, InviteError, leaveAccount,
  PLAN_LIMITS, SeatLimitError, seatStatus,
} from '../src/profiles/account.ts';
import { addDays } from '../src/util/clock.ts';
import { sha256 } from '../src/util/ids.ts';
import { ids, memStore, subject, T0 } from './helpers.ts';

const base = {
  subjectId: 'subj_test_1', jurisdictions: ['US-CA'],
  scopes: ['erasure_requests'] as const, signatureName: 'Avery Nakamura',
  method: 'email_link' as const, agentName: 'deletewe test', now: T0, previousHash: null,
};

describe('consent records', () => {
  test('the authorisation text names the agent and the jurisdiction', () => {
    const doc = authorisationDocument('deletewe', ['US-CA']);
    assert.match(doc, /deletewe/);
    assert.match(doc, /US-CA/);
    assert.match(doc, /I am an adult/);
    assert.match(doc, /not submitting this authorisation on behalf of any other person/);
    assert.match(doc, /revoke this authorisation at any time/);
  });

  test('the document hash covers the exact text the subject saw', () => {
    const c = grantConsent({ ...base, scopes: ['erasure_requests'] });
    assert.equal(c.documentHash, sha256(authorisationDocument('deletewe test', ['US-CA'])));
  });

  test('a different jurisdiction produces a different document hash', () => {
    const a = grantConsent({ ...base });
    const b = grantConsent({ ...base, jurisdictions: ['GB'] });
    assert.notEqual(a.documentHash, b.documentHash);
  });

  test('consent expires by default after a year', () => {
    const c = grantConsent(base);
    assert.equal(c.expiresAt, addDays(T0, CONSENT_TTL_DAYS).toISOString());
  });
});

describe('the consent gate', () => {
  const s = subject();

  test('passes for a live, in-scope, in-jurisdiction authorisation', () => {
    const c = grantConsent({ ...base, subjectId: s.id });
    assert.doesNotThrow(() => assertConsent(c, s, 'erasure_requests', T0));
  });

  test('one adult cannot consent for another', () => {
    const c = grantConsent({ ...base, subjectId: 'someone_else' });
    assert.throws(() => assertConsent(c, s, 'erasure_requests', T0),
      /belongs to a different subject/);
  });

  test('rejects a missing, revoked or expired authorisation', () => {
    assert.throws(() => assertConsent(null, s, 'erasure_requests', T0), ConsentRequiredError);
    const c = grantConsent({ ...base, subjectId: s.id });
    assert.throws(() => assertConsent(revokeConsent(c, T0), s, 'erasure_requests', T0), /revoked/);
    assert.throws(() => assertConsent(c, s, 'erasure_requests', addDays(T0, 400)), /expired/);
  });

  test('rejects an out-of-scope action', () => {
    const c = grantConsent({ ...base, subjectId: s.id, scopes: ['erasure_requests'] });
    assert.throws(() => assertConsent(c, s, 'regulator_complaints', T0), /scope/);
  });

  test('rejects an authorisation that does not cover where the subject lives', () => {
    const c = grantConsent({ ...base, subjectId: s.id, jurisdictions: ['GB'] });
    assert.throws(() => assertConsent(c, s, 'erasure_requests', T0), /residence US-CA/);
  });
});

describe('the consent hash chain', () => {
  test('a well-formed chain verifies', () => {
    const a = grantConsent(base);
    const b = grantConsent({ ...base, now: addDays(T0, 1), previousHash: a.entryHash });
    assert.equal(verifyConsentChain([a, b]), true);
  });

  test('a tampered record breaks the chain', () => {
    const a = grantConsent(base);
    const tampered = { ...a, grantedAt: addDays(T0, -30).toISOString() };
    assert.equal(verifyConsentChain([tampered]), false, 'back-dating must be detectable');
  });

  test('an inserted record breaks the chain', () => {
    const a = grantConsent(base);
    const b = grantConsent({ ...base, now: addDays(T0, 1), previousHash: a.entryHash });
    const rogue = grantConsent({ ...base, now: addDays(T0, 2), previousHash: 'forged' });
    assert.equal(verifyConsentChain([a, rogue, b]), false);
  });

  test('revocation appends rather than editing, so the chain stays verifiable', () => {
    const a = grantConsent(base);
    const r = revokeConsent(a, addDays(T0, 5));
    assert.equal(verifyConsentChain([a, r]), true);
    assert.ok(r.revokedAt);
    assert.notEqual(r.id, a.id, 'a new entry, not a rewrite of the old one');
    assert.equal(r.previousHash, a.entryHash);
    assert.equal(a.revokedAt, null, 'the original record is left exactly as signed');
  });

  test('revoking an earlier grant does not invalidate the entries after it', () => {
    // Rewriting a record in place re-hashed it, so the next entry's previousHash
    // no longer matched and the whole chain reported INVALID -- punishing a subject
    // for exercising the right to withdraw.
    const a = grantConsent(base);
    const b = grantConsent({ ...base, now: addDays(T0, 1), previousHash: a.entryHash });
    const r = revokeConsent(b, addDays(T0, 5), b.entryHash);
    assert.equal(verifyConsentChain([a, b, r]), true);
  });
});

describe('family accounts: every adult signs their own authorisation', () => {
  test('a family plan has five seats, an individual plan one', () => {
    assert.equal(PLAN_LIMITS.family, 5);
    assert.equal(PLAN_LIMITS.individual, 1);
  });

  test('an invitee creates their own subject and their own consent in one step', () => {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'family', T0);
    store.putAccount(account); store.putSubject(owner);

    const invite = createInvite(store, account.id, T0);
    const member = acceptInvite(store, {
      presentedToken: invite.token,
      identifiers: ids({ fullName: 'Jordan Ellis', emails: ['jordan@example.org'] }),
      residence: 'GB', signatureName: 'Jordan Ellis',
      scopes: ['erasure_requests'], agentName: 'deletewe test', now: T0,
    });

    const c = store.getConsent(member.id);
    assert.ok(c, 'the member has their own consent record');
    assert.equal(c!.subjectId, member.id);
    assert.equal(c!.signatureName, 'Jordan Ellis');
    assert.deepEqual(c!.jurisdictions, ['GB'], "under the member's own jurisdiction, not the owner's");
    assert.equal(c!.method, 'email_link');
    store.close();
  });

  test("the owner's consent cannot be used for another adult", () => {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'family', T0);
    store.putAccount(account); store.putSubject(owner);
    store.putConsent(grantConsent({ ...base, subjectId: owner.id }));

    const other = subject({ id: 'subj_other', accountId: account.id, residence: 'US-CA' });
    store.putSubject(other);
    assert.throws(() => assertConsent(store.getConsent(owner.id), other, 'erasure_requests', T0),
      /different subject/);
    store.close();
  });

  test('an unsigned profile is reported as blocked and can produce nothing', () => {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'family', T0);
    store.putAccount(account); store.putSubject(owner);
    const seats = seatStatus(store, account.id, T0);
    assert.equal(seats.length, 1);
    assert.equal(seats[0]!.consented, false);
    assert.match(seats[0]!.reason, /no authorisation signed/);
    store.close();
  });

  test('an expired or forged invitation is refused', () => {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'family', T0);
    store.putAccount(account); store.putSubject(owner);
    const invite = createInvite(store, account.id, T0);

    assert.throws(() => acceptInvite(store, {
      presentedToken: 'wrong-token', identifiers: ids(), residence: 'US-CA',
      signatureName: 'X', scopes: ['erasure_requests'], agentName: 'a', now: T0,
    }), InviteError);

    assert.throws(() => acceptInvite(store, {
      presentedToken: invite.token, identifiers: ids(), residence: 'US-CA',
      signatureName: 'X', scopes: ['erasure_requests'], agentName: 'a', now: addDays(T0, 2),
    }), /expired/);
    store.close();
  });

  test('seats are capped', () => {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'individual', T0);
    store.putAccount(account); store.putSubject(owner);
    assert.throws(() => createInvite(store, account.id, T0), SeatLimitError);
    store.close();
  });

  test('a member can leave on their own, and leaving really deletes', () => {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'family', T0);
    store.putAccount(account); store.putSubject(owner);
    const invite = createInvite(store, account.id, T0);
    const member = acceptInvite(store, {
      presentedToken: invite.token, identifiers: ids({ fullName: 'Jordan Ellis' }),
      residence: 'US-CA', signatureName: 'Jordan Ellis', scopes: ['erasure_requests'],
      agentName: 'a', now: T0,
    });
    assert.ok(store.getSubject(member.id));

    const r = leaveAccount(store, member.id, addDays(T0, 1));
    assert.equal(r.deleted['subjects'], 1);
    assert.equal(store.getSubject(member.id), null);
    assert.equal(store.getConsent(member.id), null);
    assert.equal(store.subjectsForAccount(account.id).length, 1, 'only the owner remains');
    store.close();
  });
});
