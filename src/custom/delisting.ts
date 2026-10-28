/**
 * Search-engine delisting.
 *
 * A search engine indexes a page it does not host, so this is a different request
 * from a deletion: it asks for the result to be removed from searches against the
 * subject's name, and it leaves the underlying page untouched. The two are often
 * confused, and conflating them means a user believes their data is gone when only
 * one route to it is closed.
 *
 * deletewe does NOT submit these automatically. Every major search engine takes
 * delisting through its own authenticated web form rather than by email, and
 * driving those forms would mean automating a third party's UI on a page that
 * explicitly asks a human to attest to the request. So we generate the text and
 * the destination, and a person submits it. The submission is recorded either way.
 */
import type { Subject } from '../types.ts';
import { render, tidy } from '../templates/render.ts';

export interface DelistingTarget {
  readonly engine: string;
  readonly formUrl: string;
  /** The legal route the form is built around. */
  readonly basis: string;
}

const TARGETS: readonly { match: RegExp; target: DelistingTarget }[] = [
  {
    match: /(^|\.)google\./i,
    target: {
      engine: 'Google Search',
      formUrl: 'https://reportcontent.google.com/forms/rtbf',
      basis: 'the right to be delisted recognised in Google Spain (C-131/12) and GDPR Article 17',
    },
  },
  {
    match: /(^|\.)bing\.com$/i,
    target: {
      engine: 'Microsoft Bing',
      formUrl: 'https://www.bing.com/webmasters/tools/eu-privacy-request',
      basis: 'GDPR Article 17 and the equivalent delisting route Microsoft operates',
    },
  },
  {
    match: /(^|\.)duckduckgo\.com$/i,
    target: {
      engine: 'DuckDuckGo',
      formUrl: 'https://duckduckgo.com/duckduckgo-help-pages/company/contact-us/',
      basis: 'DuckDuckGo sources results from Bing, so a Bing delisting usually resolves it too',
    },
  },
  {
    match: /(^|\.)yandex\./i,
    target: {
      engine: 'Yandex',
      formUrl: 'https://yandex.com/support/search/troubleshooting/delete-info.html',
      basis: 'the applicable national right to erasure',
    },
  },
];

export function targetFor(host: string): DelistingTarget | null {
  return TARGETS.find((t) => t.match.test(host))?.target ?? null;
}

const BODY = `SEARCH RESULT DELISTING REQUEST

Search engine: {{ engine }}
Submit at:     {{ formUrl }}
Legal basis:   {{ basis }}

--- paste the following into that form ---

I am the data subject named below, or their authorised agent. I request that the
search result identified below be delisted from searches made against my name.

Data subject: {{ fullName }}
{{#aliases}}
Also known as: {{ . }}
{{/aliases}}
Location:     {{ locality }}

Search result to delist: {{ url }}
Searches it appears against: my name as given above.

Grounds: the result links to personal data about me which is no longer relevant to
any legitimate public interest, and which I have separately asked the host to erase.
The information is of a private nature, I am not a public figure, and the continued
listing of this result against my name causes ongoing harm disproportionate to any
public interest in its accessibility.

{{ agentName }}
{{#agentNote}}
{{ agentNote }}
{{/agentNote}}

--- end ---

NOTE ON SCOPE
Delisting removes the result from searches against your name. It does NOT delete the
underlying page. If the page itself holds your personal data, a separate erasure
request to whoever hosts it is still required -- submit that host's URL as its own
custom removal.
`;

export function renderDelistingRequest(
  url: string, subject: Subject, agentName: string,
): { target: DelistingTarget | null; text: string } {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { target: null, text: '' };
  }
  const target = targetFor(host);
  if (!target) return { target: null, text: '' };

  return {
    target,
    text: tidy(render(BODY, {
      engine: target.engine,
      formUrl: target.formUrl,
      basis: target.basis,
      fullName: subject.identifiers.fullName,
      aliases: subject.identifiers.aliases ?? [],
      locality: subject.identifiers.locality,
      url,
      agentName,
      agentNote: `Submitted by ${agentName} as authorised agent. A copy of the signed ` +
        'authorisation is available on request.',
    })),
  };
}
