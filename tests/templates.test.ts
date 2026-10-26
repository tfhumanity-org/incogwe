import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { render, tidy, TemplateError } from '../src/templates/render.ts';
import { composeLetter, minimise, NoContactError, NoEntitlementError } from '../src/templates/letter.ts';
import { resolveEntitlements } from '../src/legal/entitlements.ts';
import { TEMPLATES, templateFor } from '../src/templates/registry.ts';
import { ALL_INSTRUMENT_IDS, INSTRUMENTS } from '../src/legal/jurisdictions.ts';
import { grantConsent } from '../src/consent/consent.ts';
import { ConsentRequiredError } from '../src/consent/consent.ts';
import { broker, ids, subject, T0 } from './helpers.ts';

const consent = (over: Partial<Parameters<typeof grantConsent>[0]> = {}) => grantConsent({
  subjectId: 'subj_test_1', jurisdictions: ['US-CA'],
  scopes: ['erasure_requests', 'regulator_complaints'],
  signatureName: 'Avery Nakamura', method: 'email_link',
  agentName: 'deletewe test', now: T0, previousHash: null, ...over,
});

describe('render', () => {
  test('interpolates and throws on a missing required variable', () => {
    assert.equal(render('Hello {{ name }}', { name: 'World' }), 'Hello World');
    assert.throws(() => render('Hello {{ name }}', {}), TemplateError);
    assert.equal(render('Hello {{ name? }}!', {}), 'Hello !');
  });

  test('renders a block once for an object and per item for an array', () => {
    assert.equal(render('{{#on}}yes{{/on}}', { on: true }), 'yes');
    assert.equal(render('{{#on}}yes{{/on}}', { on: false }), '');
    assert.equal(render('{{#xs}}[{{ . }}]{{/xs}}', { xs: ['a', 'b'] }), '[a][b]');
    assert.equal(render('{{#xs}}x{{/xs}}', { xs: [] }), '', 'an empty array is falsy');
  });

  test('inverted blocks', () => {
    assert.equal(render('{{^missing}}fallback{{/missing}}', {}), 'fallback');
    assert.equal(render('{{^xs}}none{{/xs}}', { xs: ['a'] }), '');
  });

  test('tidy collapses the blank lines that block removal leaves behind', () => {
    assert.equal(tidy('a\n\n\n\n\nb   \n'), 'a\n\nb\n');
  });
});

describe('template registry', () => {
  test('every modelled instrument has a template', () => {
    for (const id of ALL_INSTRUMENT_IDS) {
      assert.ok(TEMPLATES.get(id), `no template for ${id}`);
      assert.doesNotThrow(() => templateFor(id));
    }
  });

  test('every instrument carries a deadline citation and a regulator', () => {
    for (const id of ALL_INSTRUMENT_IDS) {
      const i = INSTRUMENTS[id];
      assert.ok(i.citations['deadline'], `${id} has no deadline citation`);
      assert.ok(i.regulator.complaintUrl.startsWith('https://'), `${id} regulator URL`);
      assert.ok(i.responseDays > 0, `${id} responseDays`);
    }
  });
});

describe('composeLetter', () => {
  const s = subject();
  const b = broker();

  test('renders a CCPA letter naming the instrument, the deadline and the regulator', () => {
    const l = composeLetter({
      subject: s, broker: b, entitlements: resolveEntitlements(s, b), consent: consent(),
      requestRef: 'req_1', replyTo: 'deletions+thr_1@deletewe.invalid',
      agentName: 'deletewe test', sentAt: T0,
    });

    assert.equal(l.instrument, 'CCPA');
    assert.match(l.subject, /CCPA\/CPRA/);
    assert.match(l.body, /Cal\. Civ\. Code § 1798\.105/);
    assert.match(l.body, /1798\.120/, 'asserts opt-out of sale as well as deletion');
    assert.match(l.body, /SUPPRESSION/, 'asserts suppression as well as deletion');
    assert.match(l.body, /2026-04-15/, '45 days from 2026-03-01');
    assert.match(l.body, /California Privacy Protection Agency/);
    assert.match(l.body, /Avery Nakamura/);
    assert.equal(l.dueAt.slice(0, 10), '2026-04-15');
    assert.match(l.body, /must not be added to, or used to enrich, any record/);
  });

  test('renders a GDPR letter for an EEA subject against an EEA broker', () => {
    const eu = subject({ residence: 'DE' });
    const euBroker = broker({ id: 'de-broker', establishedIn: 'DE', targetsRegions: ['DE'] });
    const l = composeLetter({
      subject: eu, broker: euBroker, entitlements: resolveEntitlements(eu, euBroker),
      consent: consent({ jurisdictions: ['DE'] }),
      requestRef: 'req_2', replyTo: 'r@x.invalid', agentName: 'a', sentAt: T0,
    });
    assert.equal(l.instrument, 'GDPR');
    assert.match(l.body, /Article 17 GDPR/);
    assert.match(l.body, /Article 21\(2\) GDPR/);
    assert.match(l.body, /Article 12\(3\) GDPR/);
    assert.equal(l.dueAt.slice(0, 10), '2026-03-31', '30 days from 2026-03-01');
  });

  test('picks the instrument for the (residence, establishment) pair, not residence alone', () => {
    const ca = subject({ residence: 'US-CA' });
    const euBroker = broker({ id: 'ie-broker', establishedIn: 'IE', targetsRegions: ['IE', 'US'] });
    const ents = resolveEntitlements(ca, euBroker);
    assert.equal(ents[0]!.instrument, 'CCPA', 'a Californian still writes under CCPA');
    assert.match(ents[0]!.basis, /extraterritorially/);
  });

  test('a UK subject gets UK GDPR with a one-month clock', () => {
    const uk = subject({ residence: 'GB' });
    const ukBroker = broker({ id: 'uk-broker', establishedIn: 'GB', targetsRegions: ['GB'] });
    const l = composeLetter({
      subject: uk, broker: ukBroker, entitlements: resolveEntitlements(uk, ukBroker),
      consent: consent({ jurisdictions: ['GB'] }),
      requestRef: 'req_3', replyTo: 'r@x.invalid', agentName: 'a', sentAt: T0,
    });
    assert.equal(l.instrument, 'UK_GDPR');
    assert.match(l.body, /Information Commissioner/);
  });

  test('a Canadian subject gets PIPEDA framed as withdrawal of consent', () => {
    const ca = subject({ residence: 'CA' });
    const cab = broker({ id: 'ca-broker', establishedIn: 'CA', targetsRegions: ['CA'] });
    const l = composeLetter({
      subject: ca, broker: cab, entitlements: resolveEntitlements(ca, cab),
      consent: consent({ jurisdictions: ['CA'] }),
      requestRef: 'req_4', replyTo: 'r@x.invalid', agentName: 'a', sentAt: T0,
    });
    assert.equal(l.instrument, 'PIPEDA');
    assert.match(l.body, /WITHDRAWAL OF CONSENT/);
    assert.match(l.body, /Privacy Commissioner of Canada/);
  });

  test('includes a sectoral caveat when the broker declared FCRA/GLBA activity', () => {
    const fcra = broker({ id: 'fcra-broker', sectoralRegimes: ['FCRA', 'GLBA'] });
    const l = composeLetter({
      subject: s, broker: fcra, entitlements: resolveEntitlements(s, fcra), consent: consent(),
      requestRef: 'req_5', replyTo: 'r@x.invalid', agentName: 'a', sentAt: T0,
    });
    assert.match(l.body, /Fair Credit Reporting Act/);
    assert.match(l.body, /identify the record and the exemption relied upon/);
  });

  test('adds the DROP notice for a Californian against a registered broker', () => {
    const reg = broker({ id: 'cppa-broker', provenance: 'cppa-registry:2026-10-27' });
    const l = composeLetter({
      subject: s, broker: reg, entitlements: resolveEntitlements(s, reg), consent: consent(),
      requestRef: 'req_6', replyTo: 'r@x.invalid', agentName: 'a', sentAt: T0,
    });
    assert.match(l.body, /CALIFORNIA DELETE ACT/);
    assert.match(l.body, /every 45 days/);
  });

  test('includes an observed listing when discovery supplied one', () => {
    const l = composeLetter({
      subject: s, broker: b, entitlements: resolveEntitlements(s, b), consent: consent(),
      requestRef: 'req_7', replyTo: 'r@x.invalid', agentName: 'a', sentAt: T0,
      observation: {
        id: 'obs_1', subjectId: s.id, brokerId: b.id, url: 'https://testbroker.example/p/avery',
        observedAt: '2026-02-20T00:00:00.000Z', matchedIdentifiers: ['full_name'],
        present: true, snapshotHash: null,
      },
    });
    assert.match(l.body, /RECORD OBSERVED/);
    assert.match(l.body, /testbroker\.example\/p\/avery/);
  });

  test('the same inputs render byte-identically and hash stably', () => {
    // The consent record is held constant: its id and document digest are quoted in
    // the letter, so a fresh authorisation legitimately produces a different letter.
    const c = consent();
    const mk = () => composeLetter({
      subject: s, broker: b, entitlements: resolveEntitlements(s, b), consent: c,
      requestRef: 'req_8', replyTo: 'r@x.invalid', agentName: 'a', sentAt: T0,
    });
    assert.equal(mk().body, mk().body);
    assert.equal(mk().bodyHash, mk().bodyHash);
  });

  test('a different authorisation yields a different letter, so the hash tracks evidence', () => {
    const mk = (c: ReturnType<typeof consent>) => composeLetter({
      subject: s, broker: b, entitlements: resolveEntitlements(s, b), consent: c,
      requestRef: 'req_9', replyTo: 'r@x.invalid', agentName: 'a', sentAt: T0,
    }).bodyHash;
    assert.notEqual(mk(consent()), mk(consent()));
  });

  test('refuses to render without consent, and refuses another adult\'s consent', () => {
    assert.throws(() => composeLetter({
      subject: s, broker: b, entitlements: resolveEntitlements(s, b),
      consent: null as never, requestRef: 'r', replyTo: 'x@y.invalid', agentName: 'a', sentAt: T0,
    }), ConsentRequiredError);

    assert.throws(() => composeLetter({
      subject: s, broker: b, entitlements: resolveEntitlements(s, b),
      consent: consent({ subjectId: 'someone_else' }),
      requestRef: 'r', replyTo: 'x@y.invalid', agentName: 'a', sentAt: T0,
    }), /different subject/);
  });

  test('refuses when there is no statutory route or no contact', () => {
    const unreachable = subject({ residence: 'ZZ' });
    assert.throws(() => composeLetter({
      subject: unreachable, broker: b, entitlements: resolveEntitlements(unreachable, b),
      consent: consent({ jurisdictions: ['ZZ'] }), requestRef: 'r',
      replyTo: 'x@y.invalid', agentName: 'a', sentAt: T0,
    }), NoEntitlementError);

    const noContact = broker({ id: 'nc', legalContact: { email: null, privacyPortal: null, postal: 'somewhere' } });
    assert.throws(() => composeLetter({
      subject: s, broker: noContact, entitlements: resolveEntitlements(s, noContact),
      consent: consent(), requestRef: 'r', replyTo: 'x@y.invalid', agentName: 'a', sentAt: T0,
    }), NoContactError);
  });
});

describe('minimise', () => {
  test('a broker that needs nothing extra gets no street address, phone or DOB', () => {
    const m = minimise(subject(), broker({ requiredIdentifiers: [] }));
    assert.equal(m.identifiers.streetAddresses, undefined);
    assert.equal(m.identifiers.phones, undefined);
    assert.equal(m.identifiers.dateOfBirth, undefined);
    assert.equal(m.identifiers.fullName, 'Avery Nakamura');
    assert.deepEqual(m.identifiers.emails, ['avery@example.org']);
  });

  test('a broker that needs an address gets it, and nothing more', () => {
    const m = minimise(subject(), broker({ requiredIdentifiers: ['street_address'] }));
    assert.ok(m.identifiers.streetAddresses);
    assert.equal(m.identifiers.dateOfBirth, undefined);
  });

  test('the minimised letter does not contain withheld identifiers', () => {
    const b2 = broker({ requiredIdentifiers: [] });
    const l = composeLetter({
      subject: minimise(subject(), b2), broker: b2,
      entitlements: resolveEntitlements(subject(), b2), consent: consent(),
      requestRef: 'r', replyTo: 'x@y.invalid', agentName: 'a', sentAt: T0,
    });
    assert.ok(!l.body.includes('1986-04-12'), 'date of birth must not leak');
    assert.ok(!l.body.includes('555 0147'), 'phone must not leak');
    assert.ok(!l.body.includes('Rowan Street'), 'street address must not leak');
    assert.match(l.body, /Oakland, California/, 'but locality is always needed');
  });

  test('aliases survive minimisation, since brokers index under former names', () => {
    const m = minimise(subject({ identifiers: ids({ aliases: ['Avery Smith'] }) }), broker());
    assert.deepEqual(m.identifiers.aliases, ['Avery Smith']);
  });
});
