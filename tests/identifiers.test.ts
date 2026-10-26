import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageOn, assertValidIdentifiers, InvalidIdentifiersError, MINIMUM_AGE, validateIdentifiers,
} from '../src/identifiers.ts';
import { composeLetter } from '../src/templates/letter.ts';
import { resolveEntitlements } from '../src/legal/entitlements.ts';
import { grantConsent } from '../src/consent/consent.ts';
import { createAccount, acceptInvite, createInvite } from '../src/profiles/account.ts';
import { broker, ids, memStore, subject, T0 } from './helpers.ts';
import type { SubjectIdentifiers } from '../src/types.ts';

const ok = (over: Partial<SubjectIdentifiers> = {}): SubjectIdentifiers => ({
  fullName: 'Avery Nakamura',
  emails: ['avery@example.org'],
  locality: 'Oakland, California',
  ...over,
});

describe('valid identifiers pass unchanged', () => {
  test('the minimum set is name, one email and a locality', () => {
    assert.deepEqual(validateIdentifiers(ok()), []);
  });

  test('names that are not ASCII are accepted', () => {
    // An ASCII-only "contains a letter" check rejects most of the world's names.
    for (const n of ['Zoë Müller', '山田 太郎', 'Ngozi Adichie-O’Brien', 'José Ñúñez',
                     'Дмитрий Иванов', 'محمد العلي', '김민준']) {
      assert.deepEqual(validateIdentifiers(ok({ fullName: n })), [], n);
    }
  });

  test('a non-Latin locality is accepted too', () => {
    assert.deepEqual(validateIdentifiers(ok({ locality: '東京都' })), []);
  });

  test('a full profile with every optional field is accepted', () => {
    assert.deepEqual(validateIdentifiers(ids(), { now: T0 }), []);
  });

  test('unusual but real email addresses are accepted', () => {
    for (const e of ['a+tag@example.co.uk', "o'brien@example.org", 'x_y.z@sub.example.museum']) {
      assert.deepEqual(validateIdentifiers(ok({ emails: [e] })), [], e);
    }
  });

  test('international phone formats are accepted', () => {
    for (const p of ['+1 510 555 0147', '(0113) 496 0000', '+81-3-1234-5678', '02079460958']) {
      assert.deepEqual(validateIdentifiers(ok({ phones: [p] })), [], p);
    }
  });
});

describe('the placeholders that prompted this', () => {
  // The exact arguments that created a live profile before this check existed.
  test('--name "..." --email ... is rejected, with a reason for each field', () => {
    const problems = validateIdentifiers({ fullName: '...', emails: ['...'], locality: '...' });
    assert.equal(problems.length, 3);
    assert.ok(problems.some((p) => /fullName.*placeholder/.test(p)));
    assert.ok(problems.some((p) => /emails.*not a valid email/.test(p)));
    assert.ok(problems.some((p) => /^locality:/.test(p)));
  });

  test('common filler values are caught', () => {
    for (const v of ['test', 'N/A', 'none', 'TBD', 'asdf', 'John Doe', 'placeholder', '----', 'aaaa']) {
      assert.ok(validateIdentifiers(ok({ fullName: v })).length > 0, `"${v}" should be rejected`);
    }
  });

  test('a short or letterless name is rejected', () => {
    for (const v of ['', ' ', 'A', '123', '!!']) {
      assert.ok(validateIdentifiers(ok({ fullName: v })).length > 0, JSON.stringify(v));
    }
  });

  test('at least one email is required', () => {
    assert.ok(validateIdentifiers(ok({ emails: [] })).some((p) => /at least one email/.test(p)));
  });

  test('malformed emails are rejected', () => {
    for (const e of ['avery', 'avery@', '@example.org', 'avery@localhost', 'a b@example.org']) {
      assert.ok(validateIdentifiers(ok({ emails: [e] })).length > 0, e);
    }
  });

  test('optional fields are only checked when supplied', () => {
    assert.deepEqual(validateIdentifiers(ok()), []);
    assert.ok(validateIdentifiers(ok({ phones: ['12'] })).length > 0);
    assert.ok(validateIdentifiers(ok({ streetAddresses: ['...'] })).length > 0);
    assert.ok(validateIdentifiers(ok({ aliases: ['x'] })).length > 0);
  });

  test('every problem names its field, so the message is actionable', () => {
    const problems = validateIdentifiers({
      fullName: '...', emails: ['nope'], locality: '', phones: ['1'], aliases: ['--'],
    });
    for (const p of problems) assert.match(p, /^(fullName|emails|locality|phones|aliases|streetAddresses|dateOfBirth):/);
  });
});

describe('date of birth and the adult requirement', () => {
  test('a malformed or impossible date is rejected', () => {
    for (const d of ['12/04/1986', '1986-4-12', '1986-02-30', 'yesterday']) {
      assert.ok(validateIdentifiers(ok({ dateOfBirth: d }), { now: T0 }).length > 0, d);
    }
  });

  test('a future date of birth is rejected', () => {
    assert.ok(validateIdentifiers(ok({ dateOfBirth: '2030-01-01' }), { now: T0 })
      .some((p) => /in the future/.test(p)));
  });

  test('deletewe refuses to act for a minor, and says why', () => {
    const problems = validateIdentifiers(ok({ dateOfBirth: '2015-06-01' }), { now: T0 });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /acts only for adults/);
    assert.match(problems[0]!, /authorisation .* must be given by the data subject themselves/);
  });

  test('the boundary is exact on the birthday', () => {
    // T0 is 2026-03-01. Someone born 2008-03-01 turns 18 that day.
    assert.deepEqual(validateIdentifiers(ok({ dateOfBirth: '2008-03-01' }), { now: T0 }), []);
    assert.ok(validateIdentifiers(ok({ dateOfBirth: '2008-03-02' }), { now: T0 }).length > 0,
      'one day short of 18 is still a minor');
  });

  test('ageOn handles the pre-birthday case', () => {
    assert.equal(ageOn(new Date('1986-04-12T00:00:00Z'), new Date('2026-03-01T00:00:00Z')), 39);
    assert.equal(ageOn(new Date('1986-04-12T00:00:00Z'), new Date('2026-04-12T00:00:00Z')), 40);
    assert.equal(MINIMUM_AGE, 18);
  });

  test('the age check is skipped when no clock is supplied, but the format is not', () => {
    assert.deepEqual(validateIdentifiers(ok({ dateOfBirth: '2015-06-01' })), []);
    assert.ok(validateIdentifiers(ok({ dateOfBirth: 'nonsense' })).length > 0);
  });
});

describe('the gates', () => {
  test('composeLetter refuses a placeholder profile, however it was created', () => {
    const s = subject({ identifiers: { fullName: '...', emails: ['...'], locality: '...' } });
    const b = broker();
    const consent = grantConsent({
      subjectId: s.id, jurisdictions: ['US-CA'], scopes: ['erasure_requests'],
      signatureName: '...', method: 'in_person', agentName: 'a', now: T0, previousHash: null,
    });
    assert.throws(
      () => composeLetter({
        subject: s, broker: b, entitlements: resolveEntitlements(s, b), consent,
        requestRef: 'r', replyTo: 'x@y.invalid', agentName: 'a', sentAt: T0,
      }),
      InvalidIdentifiersError,
      'a letter saying "Full name: ..." must never reach a broker',
    );
  });

  test('createAccount refuses a placeholder owner', () => {
    assert.throws(
      () => createAccount({ fullName: '...', emails: ['...'], locality: '...' }, 'US-CA', 'individual', T0),
      InvalidIdentifiersError,
    );
  });

  test('acceptInvite refuses a placeholder member before creating anything', () => {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'family', T0);
    store.putAccount(account); store.putSubject(owner);
    const invite = createInvite(store, account.id, T0);

    assert.throws(() => acceptInvite(store, {
      invite, presentedToken: invite.token,
      identifiers: { fullName: 'test', emails: ['x'], locality: '' },
      residence: 'US-CA', signatureName: 'test', scopes: ['erasure_requests'],
      agentName: 'a', now: T0,
    }), InvalidIdentifiersError);

    assert.equal(store.subjectsForAccount(account.id).length, 1,
      'no half-created member is left behind');
    store.close();
  });

  test('acceptInvite refuses a minor', () => {
    const store = memStore();
    const { account, owner } = createAccount(ids(), 'US-CA', 'family', T0);
    store.putAccount(account); store.putSubject(owner);
    const invite = createInvite(store, account.id, T0);

    assert.throws(() => acceptInvite(store, {
      invite, presentedToken: invite.token,
      identifiers: ids({ fullName: 'Sam Nakamura', dateOfBirth: '2015-06-01' }),
      residence: 'US-CA', signatureName: 'Sam Nakamura', scopes: ['erasure_requests'],
      agentName: 'a', now: T0,
    }), /acts only for adults/);
    assert.equal(store.subjectsForAccount(account.id).length, 1);
    store.close();
  });

  test('the error lists every problem at once, not one per attempt', () => {
    try {
      assertValidIdentifiers({ fullName: '...', emails: [], locality: '' });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof InvalidIdentifiersError);
      assert.equal(e.problems.length, 3);
      assert.match(e.message, /invalid subject identifiers/);
    }
  });
});
