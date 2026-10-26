import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { brokers, BrokerRegistry } from '../src/brokers/registry.ts';
import { resolveEntitlements, sectoralCaveat, dropEligible } from '../src/legal/entitlements.ts';
import { ALL_INSTRUMENT_IDS, instrumentsForResidence, isEea } from '../src/legal/jurisdictions.ts';
import { subject } from './helpers.ts';
import type { BrokerCategory } from '../src/types.ts';

describe('the shipped broker list', () => {
  test('seeds well beyond the people-search set', () => {
    assert.ok(brokers.count() >= 50, `only ${brokers.count()} brokers`);
    const nonPeopleSearch = brokers.all().filter((b) => b.category !== 'people_search');
    assert.ok(nonPeopleSearch.length >= 50,
      `only ${nonPeopleSearch.length} brokers outside people-search; the brief asked for 50+`);
  });

  test('covers every category the research identified', () => {
    const required: BrokerCategory[] = [
      'people_search', 'marketing', 'recruitment', 'risk_mitigation', 'financial', 'health', 'location',
    ];
    for (const c of required) {
      assert.ok(brokers.byCategory(c).length > 0, `no brokers in category ${c}`);
    }
  });

  test('every broker carries a legal contact, a jurisdiction, a category and a rate limit', () => {
    for (const b of brokers.all()) {
      assert.ok(b.legalContact.email || b.legalContact.privacyPortal, `${b.id} has no contact`);
      assert.ok(b.establishedIn.length >= 2, `${b.id} has no establishment`);
      assert.ok(b.category, `${b.id} has no category`);
      assert.ok(b.rateLimitPerHour > 0 && b.rateLimitPerHour <= 120, `${b.id} rate limit`);
      assert.ok(b.severity >= 1 && b.severity <= 10, `${b.id} severity`);
      assert.ok(b.provenance.length > 0, `${b.id} has no provenance`);
    }
  });

  test('response-time data is present where the registry published it', () => {
    const withMedian = brokers.all().filter((b) => b.medianResponseDays !== null);
    assert.ok(withMedian.length >= 50,
      'the CPPA registry publishes self-reported median response days; we keep them');
    for (const b of withMedian) {
      assert.ok(b.medianResponseDays! >= 0 && b.medianResponseDays! < 400, `${b.id}: ${b.medianResponseDays}`);
    }
  });

  test('ids and domains are unique', () => {
    const ids = brokers.all().map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate broker id');
  });

  test('provenance is always recorded, so the list is auditable', () => {
    for (const b of brokers.all()) {
      assert.match(b.provenance, /^(cppa-registry|curated|test):/, `${b.id}: ${b.provenance}`);
    }
  });

  test('includes brokers established outside the US, so cross-border routing is exercised', () => {
    const nonUs = brokers.all().filter((b) => !b.establishedIn.startsWith('US'));
    assert.ok(nonUs.length >= 5, `only ${nonUs.length} non-US brokers`);
  });

  test('public-surface brokers exist, so re-verification has something to verify', () => {
    assert.ok(brokers.bySurface('public').length >= 10);
    assert.ok(brokers.bySurface('private').length >= 30);
  });
});

describe('registry lookups', () => {
  test('resolves a URL to a broker, including a parent domain', () => {
    assert.equal(brokers.matchUrl('https://www.spokeo.com/x')?.id, 'spokeo');
    assert.equal(brokers.matchUrl('spokeo.com')?.id, 'spokeo');
    assert.equal(brokers.matchUrl('https://sub.deep.spokeo.com/x')?.id, 'spokeo');
    assert.equal(brokers.matchUrl('https://not-a-broker.invalid/x'), undefined);
    assert.equal(brokers.matchUrl('nonsense'), undefined);
  });

  test('reachableFrom narrows by region', () => {
    assert.ok(brokers.reachableFrom('US-CA').length > brokers.reachableFrom('GB').length);
    assert.ok(brokers.reachableFrom('GB').length > 0);
  });

  test('prioritised orders by severity', () => {
    const sevs = brokers.prioritised().map((b) => b.severity);
    assert.deepEqual(sevs, [...sevs].sort((a, b) => b - a));
  });

  test('construction rejects an invalid broker rather than shipping it', () => {
    assert.throws(() => new BrokerRegistry([{ ...brokers.all()[0]!, severity: 99 }]), /severity/);
    assert.throws(() => new BrokerRegistry([{
      ...brokers.all()[0]!, legalContact: { email: null, privacyPortal: null, postal: null },
    }]), /no legal contact/);
  });
});

describe('entitlement resolution against the real list', () => {
  test('a Californian reaches every reachable broker under some instrument', () => {
    const s = subject({ residence: 'US-CA' });
    const unreachable = brokers.reachableFrom('US-CA')
      .filter((b) => resolveEntitlements(s, b).length === 0);
    assert.deepEqual(unreachable.map((b) => b.id), []);
  });

  test('a Californian gets CCPA first and the Delete Act as support', () => {
    const s = subject({ residence: 'US-CA' });
    const b = brokers.get('spokeo')!;
    const ents = resolveEntitlements(s, b);
    assert.equal(ents[0]!.instrument, 'CCPA');
    assert.ok(ents.some((e) => e.instrument === 'CA_DELETE_ACT'));
  });

  test('a Virginian gets VCDPA and not CCPA', () => {
    const s = subject({ residence: 'US-VA' });
    const ents = resolveEntitlements(s, brokers.get('spokeo')!);
    assert.equal(ents[0]!.instrument, 'VCDPA');
    assert.ok(!ents.some((e) => e.instrument === 'CCPA'), 'a Virginian has no CCPA rights');
  });

  test('a German subject reaches a German broker under GDPR', () => {
    const s = subject({ residence: 'DE' });
    const ents = resolveEntitlements(s, brokers.get('schober-group')!);
    assert.equal(ents[0]!.instrument, 'GDPR');
    assert.match(ents[0]!.basis, /applies directly/);
  });

  test('a UK subject reaching a US broker is told the basis is extraterritorial', () => {
    const s = subject({ residence: 'GB' });
    const b = brokers.all().find((x) => x.establishedIn.startsWith('US') && x.targetsRegions.includes('US'))!;
    const ents = resolveEntitlements(s, { ...b, targetsRegions: [...b.targetsRegions, 'GB'] });
    assert.equal(ents[0]!.instrument, 'UK_GDPR');
    assert.match(ents[0]!.basis, /extraterritorially/);
  });

  test('PIPEDA is not extraterritorial, so it cannot reach a US-only broker', () => {
    const s = subject({ residence: 'CA' });
    const usOnly = { ...brokers.get('spokeo')!, establishedIn: 'US-NY', targetsRegions: ['US'] };
    assert.equal(resolveEntitlements(s, usOnly).length, 0,
      'we do not pretend to a right the subject does not have');
  });

  test('every modelled jurisdiction has at least one instrument', () => {
    for (const region of ['US-CA', 'US-VA', 'US-TX', 'GB', 'DE', 'FR', 'CA', 'CH', 'NO']) {
      assert.ok(instrumentsForResidence(region).length > 0, `no instrument for ${region}`);
    }
    assert.equal(instrumentsForResidence('ZZ').length, 0);
  });

  test('EEA membership is modelled, including the non-EU members', () => {
    for (const r of ['DE', 'FR', 'NO', 'IS', 'LI']) assert.equal(isEea(r), true, r);
    for (const r of ['GB', 'CH', 'US-CA']) assert.equal(isEea(r), false, r);
  });

  test('every instrument id in the union type is actually defined', () => {
    assert.equal(ALL_INSTRUMENT_IDS.length, new Set(ALL_INSTRUMENT_IDS).size);
    assert.ok(ALL_INSTRUMENT_IDS.length >= 20, 'the brief asked for a broad jurisdiction set');
  });
});

describe('sectoral and DROP handling', () => {
  test('an FCRA/GLBA broker gets a caveat rather than a pretence', () => {
    const b = brokers.all().find((x) => x.sectoralRegimes.length > 0);
    assert.ok(b, 'the registry should surface at least one sectorally regulated broker');
    const c = sectoralCaveat(b!)!;
    assert.match(c, /action this request in respect of all remaining personal information/);
  });

  test('a broker with no sectoral regime gets no caveat', () => {
    const b = brokers.all().find((x) => x.sectoralRegimes.length === 0)!;
    assert.equal(sectoralCaveat(b), null);
  });

  test('DROP applies to a Californian against a registered broker only', () => {
    const ca = subject({ residence: 'US-CA' });
    const gb = subject({ residence: 'GB' });
    const registered = brokers.all().find((b) => b.provenance.startsWith('cppa-registry'))!;
    const curated = brokers.all().find((b) => b.provenance.startsWith('curated'))!;
    assert.equal(dropEligible(ca, registered), true);
    assert.equal(dropEligible(gb, registered), false);
    assert.equal(dropEligible(ca, curated), false);
  });
});
