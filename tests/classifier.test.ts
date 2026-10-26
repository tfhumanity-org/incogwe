import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { classifyReply, outcomeFor, statusFor, stripQuoted } from '../src/mailbox/classifier.ts';
import { ingest, parseEml, replyAddressFor, resolveThreadKey } from '../src/mailbox/inbound.ts';
import { RULES } from '../src/mailbox/rules.ts';
import { T0 } from './helpers.ts';

const DIR = new URL('./fixtures/emails/', import.meta.url).pathname;

function load(name: string) {
  return ingest(parseEml(readFileSync(join(DIR, name), 'utf8'), T0));
}

/** Fixture -> the class a human would assign. */
const EXPECTED: Record<string, string> = {
  'confirmed-deleted.eml': 'confirmed_deleted',
  'suppression.eml': 'suppression_confirmed',
  'no-data.eml': 'no_data_held',
  'needs-verification.eml': 'needs_verification',
  'refused-exempt.eml': 'refused',
  'extension.eml': 'extension',
  'acknowledgement.eml': 'acknowledgement',
  'bounce.eml': 'bounce',
  'out-of-office.eml': 'auto_reply',
  'partial.eml': 'partial',
};

describe('eml parsing and thread attribution', () => {
  test('parses headers, folded headers and body', () => {
    const raw = parseEml(readFileSync(join(DIR, 'bounce.eml'), 'utf8'), T0);
    assert.equal(raw.from, 'MAILER-DAEMON@mx.example.net');
    assert.equal(raw.to, 'deletions+thr_bnc00001@deletewe.invalid');
    assert.match(raw.subject, /Undeliverable/);
    assert.match(raw.body, /550 5\.1\.1/);
  });

  test('recovers the thread key from a plus address', () => {
    assert.equal(replyAddressFor('deletions@deletewe.invalid', 'thr_abc123'),
      'deletions+thr_abc123@deletewe.invalid');
    assert.equal(load('confirmed-deleted.eml').threadKey, 'thr_abc12345');
  });

  test('falls back to headers then the subject line', () => {
    assert.equal(resolveThreadKey({
      toAddress: 'deletions@deletewe.invalid', subject: 'no ref',
      headers: { 'in-reply-to': '<thr_hdr12345@x>' },
    }), 'thr_hdr12345');
    assert.equal(resolveThreadKey({
      toAddress: 'deletions@deletewe.invalid', subject: 'Re: ref thr_sub12345 something',
      headers: {},
    }), 'thr_sub12345');
  });

  test('returns null rather than guessing when nothing attributes the reply', () => {
    assert.equal(load('unattributed.eml').threadKey, null);
  });
});

describe('stripQuoted', () => {
  test('drops > quoted lines and everything after an Original Message marker', () => {
    const out = stripQuoted(readFileSync(join(DIR, 'quoted-only.eml'), 'utf8').split('\n\n').slice(1).join('\n\n'));
    assert.ok(!out.includes('permanently erased'), 'quoted claim must be removed');
    assert.ok(!out.includes('erase without undue delay'), 'our own letter must be removed');
    assert.match(out, /Please see below/);
  });

  test('drops an "On ... wrote:" attribution block', () => {
    const out = stripQuoted('Real reply.\nOn 1 March 2026 at 09:00, someone wrote:\nWe have deleted everything.');
    assert.equal(out, 'Real reply.');
  });
});

describe('classifier against fixtures', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    test(`${file} -> ${expected}`, () => {
      const c = classifyReply(load(file));
      assert.equal(c.class, expected, `matched rules: ${c.matchedRules.join(', ')}`);
      assert.ok(c.confidence > 0, 'confidence must be positive');
      assert.ok(c.matchedRules.length > 0, 'a decision must be explainable by rule ids');
    });
  }

  test('every fixture in the directory is covered by an expectation', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.eml'));
    const uncovered = files.filter(
      (f) => !(f in EXPECTED) && !['unattributed.eml', 'future-promise.eml', 'quoted-only.eml'].includes(f),
    );
    assert.deepEqual(uncovered, [], 'add an expectation for each new fixture');
  });
});

describe('the hard cases the rules exist for', () => {
  test('a promise to delete is NOT a confirmed deletion', () => {
    const c = classifyReply(load('future-promise.eml'));
    assert.notEqual(c.class, 'confirmed_deleted',
      'future tense must be vetoed; closing this request would drop a live right');
  });

  test('a reply whose only deletion language is quoted does not close the request', () => {
    const c = classifyReply(load('quoted-only.eml'));
    assert.notEqual(c.class, 'confirmed_deleted');
    assert.notEqual(c.class, 'suppression_confirmed');
  });

  test('a bounce wins over body text that looks like a confirmation', () => {
    const c = classifyReply({
      ...load('bounce.eml'),
      body: 'Your data has been deleted and removed.\n550 5.1.1 Recipient address rejected: user unknown',
    });
    assert.equal(c.class, 'bounce');
  });

  test('verification demands outrank a confirmation in the same email', () => {
    const c = classifyReply({
      ...load('needs-verification.eml'),
      body: 'We have deleted the record. However, before we finalise this we require you to '
        + "verify the consumer's identity and provide a copy of a passport.",
    });
    assert.equal(c.class, 'needs_verification',
      'closing this as deleted would abandon the request at the moment it needed action');
  });

  test('refusal outranks an acknowledgement in the same email', () => {
    const c = classifyReply({
      ...load('refused-exempt.eml'),
      body: 'We have received your request and it has been logged. We are unable to action '
        + 'this request because the data is exempt from the CCPA.',
    });
    assert.equal(c.class, 'refused');
  });

  test('an unrecognised reply is queued, never guessed', () => {
    const c = classifyReply({ ...load('unattributed.eml'), body: 'Hello, unrelated matter entirely.' });
    assert.equal(c.class, 'unclassified');
    assert.equal(c.needsReview, true);
  });

  test('low confidence forces review even for a recognised class', () => {
    const c = classifyReply({ ...load('acknowledgement.eml'), body: 'We will respond within 10 days.' });
    assert.ok(c.needsReview || c.confidence >= 0.55);
  });
});

describe('outcome mapping — the four-outcome rule', () => {
  test('no_data_held is never mapped to confirmed_deleted', () => {
    assert.equal(outcomeFor('no_data_held'), 'no_data_held');
    assert.notEqual(outcomeFor('no_data_held'), 'confirmed_deleted');
  });

  test('suppression counts as a confirmed deletion, being strictly stronger', () => {
    assert.equal(outcomeFor('suppression_confirmed'), 'confirmed_deleted');
  });

  test('non-terminal classes map to a status, not an outcome', () => {
    for (const c of ['acknowledgement', 'needs_verification', 'extension', 'partial'] as const) {
      assert.equal(outcomeFor(c), null, `${c} must not close the request`);
      assert.ok(statusFor(c), `${c} must move the status`);
    }
  });
});

describe('rule hygiene', () => {
  test('rule ids are unique', () => {
    const ids = RULES.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every rule pattern compiles and is non-trivial', () => {
    for (const r of RULES) {
      assert.ok(r.pattern instanceof RegExp, r.id);
      assert.ok(r.pattern.source.length > 4, `${r.id} pattern is suspiciously broad`);
    }
  });

  test('no rule is case-sensitive, since broker replies vary wildly in casing', () => {
    for (const r of RULES) assert.ok(r.pattern.flags.includes('i'), `${r.id} must be case-insensitive`);
  });
});
