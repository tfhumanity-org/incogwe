import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysRemaining, decideAction, dueDate, effectiveDue, extendedDueDate, isOverdue,
  nextRecurrence, nextReverification, recurrenceInterval, MAX_FOLLOW_UPS, FOLLOW_UP_LEAD_DAYS,
} from '../src/legal/deadlines.ts';
import { INSTRUMENTS } from '../src/legal/jurisdictions.ts';
import { addDays } from '../src/util/clock.ts';
import { broker, T0 } from './helpers.ts';

const iso = (d: Date) => d.toISOString();

function req(over: Record<string, unknown> = {}) {
  return {
    status: 'sent' as const,
    outcome: null,
    dueAt: iso(addDays(T0, 45)),
    extendedDueAt: null as string | null,
    followUpCount: 0,
    nextActionAt: null as string | null,
    ...over,
  };
}

describe('deadline arithmetic', () => {
  test('due date is the statutory period from the send date, in UTC calendar days', () => {
    assert.equal(dueDate(T0, 45).toISOString().slice(0, 10), '2026-04-15');
    assert.equal(dueDate(T0, 30).toISOString().slice(0, 10), '2026-03-31');
    assert.equal(dueDate(T0, 90).toISOString().slice(0, 10), '2026-05-30');
  });

  test('crosses a month boundary and a leap-year February correctly', () => {
    const feb = new Date('2028-02-10T00:00:00.000Z');  // 2028 is a leap year
    assert.equal(dueDate(feb, 30).toISOString().slice(0, 10), '2028-03-11');
  });

  test('extension is the base period plus the extension, both from sentAt', () => {
    assert.equal(extendedDueDate(T0, 45, 45)!.toISOString().slice(0, 10), '2026-05-30');
    assert.equal(extendedDueDate(T0, 30, 60)!.toISOString().slice(0, 10), '2026-05-30');
    assert.equal(extendedDueDate(T0, 30, 0), null, 'no extension available means null');
  });

  test('the effective deadline is the extension when one was granted', () => {
    assert.equal(effectiveDue(req())!.toISOString().slice(0, 10), '2026-04-15');
    assert.equal(
      effectiveDue(req({ extendedDueAt: iso(addDays(T0, 90)) }))!.toISOString().slice(0, 10),
      '2026-05-30',
    );
  });

  test('overdue and days remaining are computed against the effective deadline', () => {
    assert.equal(isOverdue(req(), addDays(T0, 44)), false);
    assert.equal(isOverdue(req(), addDays(T0, 46)), true);
    assert.equal(daysRemaining(req(), T0), 45);
    assert.equal(daysRemaining(req(), addDays(T0, 50)), -5, 'negative means overdue');
    assert.equal(daysRemaining(req({ dueAt: null }), T0), null);
  });

  test('every modelled instrument produces a deadline between 1 and 180 days', () => {
    for (const i of Object.values(INSTRUMENTS)) {
      const d = dueDate(T0, i.responseDays);
      const days = Math.round((d.getTime() - T0.getTime()) / 86_400_000);
      assert.ok(days >= 1 && days <= 180, `${i.id}: ${days} days`);
    }
  });

  test('Iowa has the outlier 90-day period and Florida the 15-day extension', () => {
    assert.equal(INSTRUMENTS.ICDPA.responseDays, 90);
    assert.equal(INSTRUMENTS.FDBR.extensionDays, 15);
  });
});

describe('recurrence cadence', () => {
  test('public brokers recur at 60 days, private at 90', () => {
    assert.equal(recurrenceInterval(broker({ surface: 'public' })), 60);
    assert.equal(recurrenceInterval(broker({ surface: 'private' })), 90);
    assert.equal(nextRecurrence(T0, broker({ surface: 'public' })).toISOString().slice(0, 10), '2026-04-30');
  });

  test('only a public surface can be re-verified', () => {
    assert.ok(nextReverification(T0, broker({ surface: 'public' })));
    assert.equal(nextReverification(T0, broker({ surface: 'private' })), null,
      'a private database cannot be observed, so there is nothing to re-verify');
    assert.equal(nextReverification(T0, broker({ surface: 'public' }))!.toISOString().slice(0, 10), '2026-03-11');
  });
});

describe('decideAction', () => {
  const pub = broker({ surface: 'public' });
  const priv = broker({ surface: 'private' });

  test('does nothing while the request is comfortably inside its deadline', () => {
    assert.equal(decideAction(req(), priv, addDays(T0, 10)), 'none');
  });

  test('nudges once as the deadline approaches', () => {
    assert.equal(decideAction(req(), priv, addDays(T0, 45 - FOLLOW_UP_LEAD_DAYS + 1)), 'follow_up');
    assert.equal(
      decideAction(req({ followUpCount: 1 }), priv, addDays(T0, 42)), 'none',
      'the pre-deadline nudge is sent at most once',
    );
  });

  test('follows up once overdue, then escalates when follow-ups are exhausted', () => {
    assert.equal(decideAction(req({ followUpCount: 0 }), priv, addDays(T0, 50)), 'follow_up');
    assert.equal(decideAction(req({ followUpCount: MAX_FOLLOW_UPS - 1 }), priv, addDays(T0, 50)), 'follow_up');
    assert.equal(decideAction(req({ followUpCount: MAX_FOLLOW_UPS }), priv, addDays(T0, 50)), 'escalate');
  });

  test('an extension genuinely buys the broker time', () => {
    const extended = req({ extendedDueAt: iso(addDays(T0, 90)), status: 'extended' });
    assert.equal(decideAction(extended, priv, addDays(T0, 50)), 'none',
      'past the base deadline but inside the notified extension');
    assert.equal(decideAction(extended, priv, addDays(T0, 95)), 'follow_up');
  });

  test('an escalated request is left alone; a human owns it', () => {
    assert.equal(decideAction(req({ status: 'escalated' }), priv, addDays(T0, 200)), 'none');
  });

  test('a planned request is not chased; it has not been sent yet', () => {
    assert.equal(decideAction(req({ status: 'planned' }), priv, addDays(T0, 200)), 'none');
  });

  test('a closed request re-verifies if public, re-asserts if private', () => {
    const closed = req({
      status: 'closed', outcome: 'confirmed_deleted',
      nextActionAt: iso(addDays(T0, 10)),
    });
    assert.equal(decideAction(closed, pub, addDays(T0, 5)), 'none', 'not due yet');
    assert.equal(decideAction(closed, pub, addDays(T0, 11)), 'reverify');
    assert.equal(decideAction(closed, priv, addDays(T0, 11)), 'recur');
  });

  test('a refused request re-asserts rather than re-verifying, even on a public broker', () => {
    const refused = req({ status: 'closed', outcome: 'refused', nextActionAt: iso(addDays(T0, 10)) });
    assert.equal(decideAction(refused, pub, addDays(T0, 11)), 'recur',
      'there is nothing to verify as absent; the right has to be asserted again');
  });

  test('a closed request with no next action is finished', () => {
    assert.equal(decideAction(req({ status: 'closed', nextActionAt: null }), pub, addDays(T0, 999)), 'none');
  });

  test('a request with no deadline is never chased', () => {
    assert.equal(decideAction(req({ dueAt: null }), priv, addDays(T0, 999)), 'none');
  });
});
