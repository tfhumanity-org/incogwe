import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, nameMatchesSubject, submitCustomRemoval } from '../src/custom/classify.ts';
import { brokers } from '../src/brokers/registry.ts';
import { ids, subject, T0 } from './helpers.ts';

const s = subject({ identifiers: ids({ fullName: 'Avery Nakamura' }) });

describe('custom removal URL classification', () => {
  test('a URL at a known broker routes straight into the legal request engine', () => {
    const c = classifyUrl('https://www.spokeo.com/Avery-Nakamura/California', s, brokers);
    assert.equal(c.kind, 'known_broker');
    assert.equal(c.routedTo, 'legal_request');
    assert.equal(c.brokerId, 'spokeo');
    assert.equal(c.eligible, true);
  });

  test('a subdomain of a known broker still resolves to that broker', () => {
    const c = classifyUrl('https://data.whitepages.com/x', s, brokers);
    assert.equal(c.kind, 'known_broker');
    assert.equal(c.brokerId, 'whitepages');
  });

  test('a search engine result is a delisting request, not a deletion request', () => {
    const c = classifyUrl('https://www.google.com/search?q=avery+nakamura', s, brokers);
    assert.equal(c.kind, 'search_engine_result');
    assert.equal(c.routedTo, 'search_delisting');
    assert.match(c.reason, /does not host/);
  });

  test('an unknown people-search site with the subject\'s own name is actioned', () => {
    const c = classifyUrl('https://newpeoplesearch.example/profile/avery-nakamura', s, brokers);
    assert.equal(c.kind, 'unknown_people_search');
    assert.equal(c.routedTo, 'legal_request');
  });

  test('an unknown people-search site WITHOUT evidence of the subject goes to a human', () => {
    const c = classifyUrl('https://newpeoplesearch.example/profile/someone-else', s, brokers);
    assert.equal(c.kind, 'unknown_people_search');
    assert.equal(c.routedTo, 'manual_review',
      'this is the input that could be pointed at a third party; it must not auto-send');
  });

  test('an entirely unrecognised host always goes to a human', () => {
    const c = classifyUrl('https://some-random-blog.example/post/1', s, brokers);
    assert.equal(c.routedTo, 'manual_review');
  });
});

describe('categories deletewe refuses, and says why', () => {
  const cases: [string, string, RegExp][] = [
    ['https://www.courtlistener.com/docket/123/', 'court_or_public_record', /public record/],
    ['https://www.sec.gov/filing/456', 'court_or_public_record', /public record/],
    ['https://www.theguardian.com/story', 'news_or_press', /freedom-of-expression/],
    ['https://www.bbc.co.uk/news/article', 'news_or_press', /Article 17\(3\)\(a\)/],
    ['https://www.facebook.com/profile', 'social_media', /delete it\s+yourself/],
    ['https://x.com/someone/status/1', 'social_media', /another person/],
  ];

  for (const [url, kind, reason] of cases) {
    test(`${new URL(url).hostname} -> ${kind}, rejected`, () => {
      const c = classifyUrl(url, s, brokers);
      assert.equal(c.kind, kind);
      assert.equal(c.routedTo, 'rejected');
      assert.equal(c.eligible, false);
      assert.match(c.reason, reason);
    });
  }

  test('a malformed or non-http URL is rejected', () => {
    for (const bad of ['not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.invalid/a']) {
      const c = classifyUrl(bad, s, brokers);
      assert.equal(c.eligible, false, bad);
      assert.equal(c.routedTo, 'rejected', bad);
    }
  });
});

describe('nameMatchesSubject', () => {
  test('matches across separators and case', () => {
    for (const p of ['/profile/avery-nakamura', '/p/Avery_Nakamura/1', '/s?q=AVERY%20NAKAMURA']) {
      assert.equal(nameMatchesSubject(new URL(`https://x.example${p}`), s), true, p);
    }
  });

  test('requires every name part, so a shared surname is not enough', () => {
    assert.equal(nameMatchesSubject(new URL('https://x.example/p/jordan-nakamura'), s), false);
  });

  test('matches a declared alias', () => {
    const withAlias = subject({ identifiers: ids({ aliases: ['Avery Smith'] }) });
    assert.equal(nameMatchesSubject(new URL('https://x.example/p/avery-smith'), withAlias), true);
  });
});

describe('submitCustomRemoval', () => {
  test('produces a record carrying the decision and its reason', () => {
    const r = submitCustomRemoval('https://www.spokeo.com/Avery-Nakamura', s, brokers, T0);
    assert.equal(r.subjectId, s.id);
    assert.equal(r.kind, 'known_broker');
    assert.equal(r.routedTo, 'legal_request');
    assert.ok(r.reason.length > 10, 'the user is always told why');
    assert.equal(r.submittedAt, T0.toISOString());
  });
});
