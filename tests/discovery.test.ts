/**
 * Discovery, and the only rank-1 outcome in the system.
 *
 * `verified_absent` was unreachable: the scheduler's re-verification branch wrote an
 * event saying a check was due and nothing ever checked. The strongest claim in
 * ADR-0001 was therefore theory. These tests make it real -- and pin the boundary
 * that "not checked" must never be recorded as "absent".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureDiscoveryAdapter, NullDiscoveryAdapter } from '../src/discovery/adapters.ts';
import { Scheduler } from '../src/engine/scheduler.ts';
import { Sender } from '../src/engine/sender.ts';
import { MockTransport } from '../src/engine/transport.ts';
import { planRequests } from '../src/engine/planner.ts';
import { processReply } from '../src/mailbox/process.ts';
import { ingest } from '../src/mailbox/inbound.ts';
import { buildDashboard } from '../src/dashboard/timeline.ts';
import { addDays, fixedClock } from '../src/util/clock.ts';
import { broker, memStore, registryOf, seedSubject, subject, T0 } from './helpers.ts';

const PUB = broker({ id: 'pub', name: 'Public Finder', surface: 'public', severity: 6 });
const PRIV = broker({ id: 'priv', name: 'Private Risk Co', surface: 'private', severity: 6 });

/** Send, get a confirmation, so the request is closed and awaiting re-verification. */
async function settled(registry = registryOf(PUB)) {
  const store = memStore();
  const s = seedSubject(store, subject());
  const transport = new MockTransport();
  await new Sender({
    agentName: 'a', replyToBase: 'd@x.invalid', clock: fixedClock(T0.toISOString()),
    transport, store,
  }).sendPlan(s, planRequests(s, { registry, now: T0 }).requests);

  const day2 = addDays(T0, 2);
  for (const r of store.requestsForSubject(s.id)) {
    processReply(ingest({
      from: `privacy@${r.brokerId}.example`, to: `deletions+${r.threadKey}@deletewe.invalid`,
      subject: 'Re', body: 'We have deleted all personal information about this individual.',
      receivedAt: day2,
    }), { store, registry, now: day2 });
  }
  return { store, s, registry, transport };
}

const tickWith = (h: Awaited<ReturnType<typeof settled>>, discovery: unknown, day: number) =>
  new Scheduler({
    clock: fixedClock(addDays(T0, day).toISOString()),
    store: h.store, registry: h.registry, transport: h.transport, agentName: 'a',
    ...(discovery ? { discovery: discovery as never } : {}),
  }).tick();

describe('the rank-1 outcome is reachable', () => {
  test('a listing re-observed as gone upgrades the outcome to verified_absent', async () => {
    const h = await settled();
    const before = h.store.requestsForSubject(h.s.id)[0]!;
    assert.equal(before.outcome, 'confirmed_deleted', 'rank 2: the broker said so');

    const r = await tickWith(h, new FixtureDiscoveryAdapter(
      [{ brokerId: 'pub', url: 'https://pub.example/p/avery', present: false }],
      () => addDays(T0, 13),
    ), 13);

    assert.equal(r.reverifications, 1);
    assert.equal(r.verifiedAbsent, 1);

    const after = h.store.getRequest(before.id)!;
    assert.equal(after.outcome, 'verified_absent', 'rank 1: we looked, and it is gone');
    assert.ok(after.observationId, 'the outcome points at the observation that proves it');
    assert.ok(h.store.eventsFor(before.id).some((e) =>
      e.kind === 'reverification' && /ABSENT/.test(e.detail)));
    h.store.close();
  });

  test('the dashboard reports it separately from what the broker merely asserted', async () => {
    const h = await settled();
    await tickWith(h, new FixtureDiscoveryAdapter(
      [{ brokerId: 'pub', url: 'https://pub.example/p', present: false }], () => addDays(T0, 13),
    ), 13);

    const d = buildDashboard(h.store, h.registry, h.s.id, addDays(T0, 13));
    assert.equal(d.breakdown.verifiedAbsent, 1);
    assert.equal(d.breakdown.confirmedDeleted, 0, 'it was upgraded, not double-counted');
    h.store.close();
  });
});

describe('"not checked" is never recorded as "absent"', () => {
  test('with no adapter the outcome is untouched and the event says so', async () => {
    const h = await settled();
    const before = h.store.requestsForSubject(h.s.id)[0]!;
    const r = await tickWith(h, null, 13);

    assert.equal(r.reverifications, 1);
    assert.equal(r.verifiedAbsent, 0);
    assert.equal(h.store.getRequest(before.id)!.outcome, 'confirmed_deleted');
    assert.ok(h.store.eventsFor(before.id).some((e) => /nothing was checked/.test(e.detail)));
    h.store.close();
  });

  test('an adapter that returns nothing for the broker changes nothing', async () => {
    const h = await settled();
    const before = h.store.requestsForSubject(h.s.id)[0]!;
    const r = await tickWith(h, new FixtureDiscoveryAdapter([], () => addDays(T0, 13)), 13);

    assert.equal(r.verifiedAbsent, 0);
    assert.equal(h.store.getRequest(before.id)!.outcome, 'confirmed_deleted');
    assert.ok(h.store.eventsFor(before.id).some((e) => /not checked/.test(e.detail)));
    h.store.close();
  });

  test('the null adapter observes nothing, by construction', async () => {
    assert.deepEqual(await new NullDiscoveryAdapter().observe(), []);
  });

  test('a private broker is never observed, so absence cannot be manufactured', async () => {
    const adapter = new FixtureDiscoveryAdapter(
      [{ brokerId: 'priv', url: 'https://priv.example/x', present: false }]);
    const observed = await adapter.observe(subject(), [PRIV]);
    assert.deepEqual(observed, [],
      'a private database has no public surface; reporting absence would be a fabrication');
  });
});

describe('re-listing is detected and acted on', () => {
  test('a listing that reappears queues immediate re-assertion', async () => {
    const h = await settled();
    const before = h.store.requestsForSubject(h.s.id)[0]!;

    const r = await tickWith(h, new FixtureDiscoveryAdapter(
      [{ brokerId: 'pub', url: 'https://pub.example/p/avery', present: true }],
      () => addDays(T0, 13),
    ), 13);

    assert.equal(r.verifiedAbsent, 0);
    const after = h.store.getRequest(before.id)!;
    assert.equal(after.nextActionAt, null, 'cleared means the planner may send now');
    assert.ok(h.store.eventsFor(before.id).some((e) => /PRESENT again/.test(e.detail)));

    const replan = planRequests(h.s, {
      registry: h.registry, existing: h.store.requestsForSubject(h.s.id), now: addDays(T0, 13),
    });
    assert.ok(replan.requests.some((p) => p.broker.id === 'pub'),
      'a re-listed broker must be written to again without waiting out the cycle');
    h.store.close();
  });
});

describe('observations can be supplied as a file', () => {
  test('fromFile loads an operator\'s own crawl output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deletewe-'));
    const f = join(dir, 'obs.json');
    writeFileSync(f, JSON.stringify([
      { brokerId: 'pub', url: 'https://pub.example/p/avery', present: false,
        matchedIdentifiers: ['full_name'], snapshotHash: 'abc123' },
    ]));

    const adapter = FixtureDiscoveryAdapter.fromFile(f, () => T0);
    const out = await adapter.observe(subject(), [PUB]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.present, false);
    assert.equal(out[0]!.snapshotHash, 'abc123');
    assert.match(adapter.id, /^file:/);
  });

  test('a malformed file fails loudly rather than observing nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deletewe-'));
    const f = join(dir, 'bad.json');
    writeFileSync(f, '{"not":"an array"}');
    assert.throws(() => FixtureDiscoveryAdapter.fromFile(f), /expected an array/);
  });
});
