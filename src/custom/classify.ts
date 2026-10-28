/**
 * Custom removals: the user submits a URL, we classify it, and the matching flow runs.
 *
 * This is the one input in the whole product that could be pointed at somebody else,
 * so eligibility is a SAFETY control, not a support workflow (see research dossier
 * §4.4). Two things follow:
 *
 *   - Categories with no erasure right, or where erasure would suppress speech or
 *     public records, are rejected outright rather than queued.
 *   - A URL is only routed to a live flow when it plausibly concerns the submitting
 *     subject. We cannot prove that from a URL alone, so where the URL carries a name
 *     we check it against the subject's own identifiers, and otherwise we route to
 *     manual review rather than auto-sending in someone's name.
 */
import type { CustomRemovalKind, CustomRemovalRequest, Subject } from '../types.ts';
import type { BrokerRegistry } from '../brokers/registry.ts';
import { newId } from '../util/ids.ts';

const SEARCH_ENGINES = ['google.', 'bing.com', 'duckduckgo.com', 'yandex.', 'baidu.com', 'search.brave.com'];
const SOCIAL = [
  'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'linkedin.com', 'tiktok.com',
  'reddit.com', 'youtube.com', 'pinterest.com', 'threads.net', 'mastodon.', 'bsky.app',
];
const NEWS_MARKERS = [
  'news', 'times.', 'guardian.', 'bbc.', 'reuters.', 'nytimes.', 'wsj.', 'telegraph.',
  'independent.', 'post.com', 'herald.', 'tribune.', 'gazette.',
];
const COURT_MARKERS = [
  '.gov', '.gov.uk', 'courts.', 'courtlistener.com', 'pacer.', 'justice.', 'judiciary.',
  'legislation.', 'companieshouse.', 'sec.gov',
];
const PEOPLE_SEARCH_MARKERS = [
  'peoplesearch', 'people-search', 'backgroundcheck', 'background-check', 'publicrecords',
  'findpeople', 'whitepages', 'phonebook', 'addresses', 'reversephone', 'lookup',
];

export interface ClassifyUrlResult {
  readonly kind: CustomRemovalKind;
  readonly eligible: boolean;
  readonly reason: string;
  readonly routedTo: CustomRemovalRequest['routedTo'];
  readonly brokerId: string | null;
}

export function classifyUrl(
  rawUrl: string,
  subject: Subject,
  registry: BrokerRegistry,
): ClassifyUrlResult {
  let url: URL;
  try {
    url = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
  } catch {
    return reject('ineligible', 'Not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return reject('ineligible', 'Only http(s) URLs can be processed.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const full = `${host}${url.pathname}`.toLowerCase();
  const has = (markers: string[]) => markers.some((m) => host.includes(m));

  // 1. Already a broker we cover: route straight into the legal request engine.
  const broker = registry.matchUrl(url.href);
  if (broker) {
    return {
      kind: 'known_broker',
      eligible: true,
      reason: `${host} is ${broker.name}, already covered by the automated flow.`,
      routedTo: 'legal_request',
      brokerId: broker.id,
    };
  }

  // 2. Categories we will not act on. Stated plainly, as the research recommends.
  if (has(COURT_MARKERS)) {
    return reject('court_or_public_record',
      'Court records and official public registers are matters of public record. ' +
      'There is generally no erasure right against them, and deletewe will not attempt one.');
  }
  if (has(NEWS_MARKERS)) {
    return reject('news_or_press',
      'Journalism is protected by freedom-of-expression exemptions (for example GDPR ' +
      'Article 17(3)(a)). A removal request against a news publisher is not something ' +
      'deletewe will send on your behalf.');
  }
  if (has(SOCIAL)) {
    return {
      kind: 'social_media', eligible: false, routedTo: 'rejected',
      reason: 'This is a social media profile or post. If it is yours, you can delete it ' +
        'yourself, which is faster and more complete. If it is not yours, deletewe cannot ' +
        'act against another person\'s account.',
      brokerId: null,
    };
  }

  // 3. Search engine result pages: a delisting request, not a deletion request.
  if (has(SEARCH_ENGINES)) {
    return {
      kind: 'search_engine_result', eligible: true, routedTo: 'search_delisting',
      reason: 'A search engine indexes a page it does not host. This is routed as a ' +
        'delisting request; removing the underlying page is a separate request to its host.',
      brokerId: null,
    };
  }

  // 4. An unknown site that looks like a people-search surface.
  if (PEOPLE_SEARCH_MARKERS.some((m) => full.includes(m))) {
    return {
      kind: 'unknown_people_search',
      eligible: true,
      routedTo: nameMatchesSubject(url, subject) ? 'legal_request' : 'manual_review',
      reason: nameMatchesSubject(url, subject)
        ? `${host} looks like a people-search site and the URL contains the subject's own name.`
        : `${host} looks like a people-search site, but the URL does not evidence that it ` +
          'concerns the submitting subject. Queued for human review before any request is sent.',
      brokerId: null,
    };
  }

  // 5. Anything else: a human decides. Never auto-send at an unrecognised host.
  //    Note the kind is `unrecognised_host`, not `ineligible`: the submission IS
  //    eligible to be looked at, it just is not something we can route automatically.
  //    Recording it as `ineligible: true` made the stored record contradict itself.
  return {
    kind: 'unrecognised_host', eligible: true, routedTo: 'manual_review',
    reason: `${host} is not a recognised data broker, people-search site or search engine. ` +
      'Queued for human review.',
    brokerId: null,
  };
}

function reject(kind: CustomRemovalKind, reason: string): ClassifyUrlResult {
  return { kind, eligible: false, reason, routedTo: 'rejected', brokerId: null };
}

/**
 * Does the URL itself evidence that it concerns this subject? People-search URLs
 * almost always embed the name. This is a weak signal used only to decide between
 * "send" and "a human looks first" -- it is never used to widen what we will do.
 */
export function nameMatchesSubject(url: URL, subject: Subject): boolean {
  // `new URL()` accepts a malformed percent-escape such as `/name/%E0%A4%A`, but
  // decodeURIComponent throws URIError on it. A user-submitted URL is attacker-
  // influenced input, so an uncaught throw here takes out the whole custom-removal
  // command. On a decode failure we fall back to the raw text, which can only make
  // the match less likely -- and a miss routes to human review, which is safe.
  const raw = `${url.pathname}${url.search}`;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const hay = decoded.toLowerCase().replace(/[^a-z]+/g, ' ');
  const names = [subject.identifiers.fullName, ...(subject.identifiers.aliases ?? [])];
  return names.some((n) => {
    const parts = n.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
    return parts.length > 0 && parts.every((p) => hay.includes(p));
  });
}

export function submitCustomRemoval(
  rawUrl: string,
  subject: Subject,
  registry: BrokerRegistry,
  now: Date,
): CustomRemovalRequest {
  const c = classifyUrl(rawUrl, subject, registry);
  return {
    id: newId('cust'),
    subjectId: subject.id,
    url: rawUrl,
    kind: c.kind,
    eligible: c.eligible,
    reason: c.reason,
    routedTo: c.routedTo,
    brokerId: c.brokerId,
    submittedAt: now.toISOString(),
    status: c.routedTo === 'rejected' ? 'rejected' : 'submitted',
    requestId: null,
    outcomeNote: null,
  };
}
