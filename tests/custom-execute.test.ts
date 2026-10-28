/**
 * "the user submits a URL, it's classified, and the matching flow runs".
 * Classification was covered; this covers the part that runs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeCustomRemoval } from '../src/custom/execute.ts';
import { submitCustomRemoval } from '../src/custom/classify.ts';
import { renderDelistingRequest, targetFor } from '../src/custom/delisting.ts';
import { Sender } from '../src/engine/sender.ts';
import { MockTransport } from '../src/engine/transport.ts';
import { fixedClock } from '../src/util/clock.ts';
import { broker, memStore, registryOf, seedSubject, subject, T0 } from './helpers.ts';
import type { Store } from '../src/store/store.ts';
import type { BrokerRegistry } from '../src/brokers/registry.ts';

const SPOKEO = broker({
  id: 'spokeo', name: 'Spokeo, Inc.', domains: ['spokeo.com'],
  category: 'people_search', surface: 'public', severity: 7,
});

function harness(registry: BrokerRegistry = registryOf(SPOKEO)) {
  const store = memStore();
  const clock = fixedClock(T0.toISOString());
  const s = seedSubject(store, subject());
  const transport = new MockTransport();
  const sender = new Sender({
    agentName: 'deletewe test', replyToBase: 'deletions@deletewe.invalid',
    clock, transport, store,
  });
  return { store, registry, clock, sender, transport, subject: s,
    deps: { store, registry, sender, clock, agentName: 'deletewe test' } };
}

const run = async (h: ReturnType<typeof harness>, url: string) => {
  const c = submitCustomRemoval(url, h.subject, h.registry, T0);
  h.store.putCustomRemoval(c);
  return executeCustomRemoval(c, h.subject, h.deps);
};

describe('a URL at a known broker becomes a real statutory request', () => {
  test('it sends, and links the request back to the submission', async () => {
    const h = harness();
    const r = await run(h, 'https://www.spokeo.com/Avery-Nakamura/California');

    assert.equal(r.custom.status, 'request_sent');
    assert.ok(r.custom.requestId, 'the submission must point at the request it produced');
    assert.match(r.custom.outcomeNote!, /Statutory request sent to Spokeo/);

    const req = h.store.getRequest(r.custom.requestId!)!;
    assert.equal(req.brokerId, 'spokeo');
    assert.equal(req.status, 'sent');
    assert.equal(h.transport.sent.length, 1);
    h.store.close();
  });

  test('the submitted URL is attached as an observation and cited in the letter', async () => {
    // ADR-0001 D1: observation enriches. A user telling us where they saw
    // themselves is the strongest observation we ever get for free, and citing it
    // defeats "we cannot locate your record".
    const h = harness();
    const r = await run(h, 'https://www.spokeo.com/Avery-Nakamura/California');

    const obs = h.store.observationsFor(h.subject.id);
    assert.equal(obs.length, 1);
    assert.equal(obs[0]!.present, true);
    assert.deepEqual(obs[0]!.matchedIdentifiers, ['full_name']);

    const letter = h.store.getLetter(r.custom.requestId!)!;
    assert.match(letter, /RECORD OBSERVED/);
    assert.match(letter, /spokeo\.com\/Avery-Nakamura/);
    h.store.close();
  });

  test('a second submission for an open request attaches rather than duplicating', async () => {
    const h = harness();
    await run(h, 'https://www.spokeo.com/Avery-Nakamura/California');
    const second = await run(h, 'https://www.spokeo.com/Avery-Nakamura/CA-2');

    assert.equal(second.custom.status, 'submitted');
    assert.match(second.custom.outcomeNote!, /already open/);
    assert.equal(h.store.requestsForSubject(h.subject.id).length, 1, 'no duplicate letter');
    h.store.close();
  });

  test('without consent nothing is sent and the user is told', async () => {
    const store = memStore();
    const s = subject({ id: 'subj_nc' });
    store.putSubject(s);                      // no consent record
    const clock = fixedClock(T0.toISOString());
    const registry = registryOf(SPOKEO);
    const sender = new Sender({
      agentName: 'a', replyToBase: 'd@x.invalid', clock, transport: new MockTransport(), store,
    });
    const c = submitCustomRemoval('https://www.spokeo.com/Avery-Nakamura', s, registry, T0);
    const r = await executeCustomRemoval(c, s, { store, registry, sender, clock, agentName: 'a' });

    assert.equal(r.custom.status, 'queued_for_review');
    assert.match(r.custom.outcomeNote!, /consent/);
    assert.equal(store.requestsForSubject(s.id).length, 0);
    store.close();
  });
});

describe('an unknown host is never written to on a guess', () => {
  test('a people-search lookalike with no registry entry waits for a contact', async () => {
    const h = harness();
    const r = await run(h, 'https://newpeoplesearch.example/profile/avery-nakamura');

    assert.equal(r.custom.status, 'awaiting_broker_contact');
    assert.match(r.custom.outcomeNote!, /will not guess an address/);
    assert.equal(h.transport.sent.length, 0,
      'guessing privacy@<host> would post a real name and address to an unverified mailbox');
    h.store.close();
  });

  test('an unrecognised host is queued with the classifier\'s reason', async () => {
    const h = harness();
    const r = await run(h, 'https://some-random-blog.example/post/1');
    assert.equal(r.custom.status, 'queued_for_review');
    assert.match(r.custom.outcomeNote!, /not a recognised data broker/);
    h.store.close();
  });
});

describe('search results are delisted, not deleted', () => {
  test('Google produces submittable text and an explicit scope warning', async () => {
    const h = harness();
    const r = await run(h, 'https://www.google.com/search?q=avery+nakamura');

    assert.equal(r.custom.status, 'awaiting_manual_submission');
    assert.ok(r.delistingText);
    assert.match(r.delistingText!, /reportcontent\.google\.com/);
    assert.match(r.delistingText!, /Avery Nakamura/);
    assert.match(r.delistingText!, /does NOT delete the\nunderlying page/);
    assert.match(r.custom.outcomeNote!, /not by email, so deletewe does not submit it for you/);
    assert.equal(h.transport.sent.length, 0);
    h.store.close();
  });

  test('each supported engine resolves to its own form', () => {
    assert.equal(targetFor('www.google.co.uk')?.engine, 'Google Search');
    assert.equal(targetFor('bing.com')?.engine, 'Microsoft Bing');
    assert.equal(targetFor('duckduckgo.com')?.engine, 'DuckDuckGo');
    assert.equal(targetFor('example.com'), null);
  });

  test('an unsupported engine is queued rather than silently dropped', async () => {
    const h = harness();
    const c = { ...submitCustomRemoval('https://search.brave.com/search?q=x', h.subject, h.registry, T0),
      routedTo: 'search_delisting' as const };
    const r = await executeCustomRemoval(c, h.subject, h.deps);
    assert.equal(r.custom.status, 'queued_for_review');
    assert.match(r.custom.outcomeNote!, /not one deletewe has a delisting route for/);
    h.store.close();
  });

  test('the delisting text names the subject but not identifiers it does not need', () => {
    const { text } = renderDelistingRequest(
      'https://www.google.com/search?q=x', subject(), 'deletewe test');
    assert.match(text, /Avery Nakamura/);
    assert.match(text, /Oakland, California/);
    assert.ok(!text.includes('1986-04-12'), 'a delisting form does not need a date of birth');
    assert.ok(!text.includes('555 0147'));
  });
});

describe('refused categories execute to nothing', () => {
  for (const [url, label] of [
    ['https://www.bbc.co.uk/news/article', 'press'],
    ['https://www.courtlistener.com/docket/1/', 'court record'],
    ['https://www.facebook.com/someone', 'social media'],
  ] as const) {
    test(`${label} is rejected and sends nothing`, async () => {
      const h = harness();
      const r = await run(h, url);
      assert.equal(r.custom.status, 'rejected');
      assert.ok(r.custom.outcomeNote);
      assert.equal(h.transport.sent.length, 0);
      h.store.close();
    });
  }
});

describe('submissions are listable with where they got to', () => {
  test('status and note survive a round trip through the store', async () => {
    const h = harness();
    await run(h, 'https://www.spokeo.com/Avery-Nakamura/California');
    await run(h, 'https://www.bbc.co.uk/news/x');

    const rows: ReturnType<Store['customRemovalsFor']> = h.store.customRemovalsFor(h.subject.id);
    const statuses = rows.map((r) => r.status).sort();
    assert.deepEqual(statuses, ['rejected', 'request_sent']);
    assert.ok(rows.every((r) => r.outcomeNote), 'the user is always told what happened');
    h.store.close();
  });
});
