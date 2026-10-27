/**
 * Jurisdiction-aware request templates.
 *
 * Every template:
 *   - names the instrument it invokes and cites it, because an unnamed instrument
 *     cannot support a later deadline breach or regulator complaint (ADR-0001 D4);
 *   - asserts erasure AND objection/opt-out AND suppression together (ADR-0001 D3);
 *   - states the agent's authority and offers the signed authorisation on request;
 *   - states the statutory deadline explicitly, with the date;
 *   - states what happens next if the deadline passes.
 *
 * STATUS: DRAFT. These are a developer's drafting from the statutes. They have NOT
 * been reviewed by a qualified lawyer in any jurisdiction. Live sending is blocked
 * until an operator attests review -- see engine/sender.ts.
 */
import type { LegalInstrumentId } from '../types.ts';

export interface TemplateDef {
  readonly instrument: LegalInstrumentId;
  readonly subject: string;
  readonly body: string;
}

/** Shared trailer: authority, deadline, consequence. */
const AUTHORITY = `
AUTHORITY OF THE AGENT
{{ agentName }} is acting as the authorised agent of the data subject named above,
under a written authorisation signed on {{ consentGrantedAt }} (authorisation reference
{{ consentRef }}, document digest {{ consentHash }}). A copy of the signed authorisation
will be provided on request to this address. {{ agentAuthorityCitation }}

If you require the data subject to verify their identity directly before you will
act on this request, reply to this address stating precisely what verification you
require and under which provision. Please do not request identity documents that are
not strictly necessary to action this request.
`;

const DEADLINE = `
DEADLINE
Your substantive response is due by {{ dueDate }} ({{ responseDays }} days from the date
of this request), under {{ deadlineCitation }}.
{{#extensionDays}}
If you intend to rely on an extension, you must notify us within the original period,
together with your reasons.
{{/extensionDays}}

IF YOU DO NOT RESPOND
If no substantive response is received by the deadline, we will treat the request as
refused and will, on the data subject's instruction, lodge a complaint with
{{ regulatorName }} ({{ regulatorUrl }}), citing this request and the absence of a reply.
`;

const IDENTIFIERS = `
DATA SUBJECT
Full name: {{ fullName }}
{{#aliases}}
Also known as: {{ . }}
{{/aliases}}
Location: {{ locality }}
{{#emails}}
Email: {{ . }}
{{/emails}}
{{#streetAddresses}}
Address: {{ . }}
{{/streetAddresses}}
{{#phones}}
Telephone: {{ . }}
{{/phones}}
{{#dateOfBirth}}
Date of birth: {{ dateOfBirth }}
{{/dateOfBirth}}

These identifiers are provided solely to allow you to locate the data subject's records.
They must not be added to, or used to enrich, any record you hold, and must be deleted
once this request is actioned.
`;

const OBSERVED = `
{{#observedUrl}}
RECORD OBSERVED
A record matching the data subject was observed at the following address on
{{ observedAt }}: {{ observedUrl }}
{{/observedUrl}}
`;

const GDPR_FAMILY_BODY = `To the Data Protection Officer / Privacy Team at {{ brokerName }},

We write on behalf of the data subject identified below to exercise their rights under
{{ instrumentName }}.
{{ basis }}
{{ IDENTIFIERS }}{{ OBSERVED }}
REQUESTS
{{ REQUESTS }}
{{#supportingInstruments}}

FURTHER RIGHTS RELIED UPON IN THE ALTERNATIVE
{{ . }}
{{/supportingInstruments}}
{{ AUTHORITY }}{{ DEADLINE }}
Please direct all correspondence to {{ replyTo }}, quoting reference {{ requestRef }}.

{{ agentName }}
Authorised agent for the data subject
Reference: {{ requestRef }}
`;

const US_STATE_BODY = `To the Privacy Team at {{ brokerName }},

We write on behalf of the consumer identified below to exercise their rights under
{{ instrumentName }}.
{{ basis }}
{{ IDENTIFIERS }}{{ OBSERVED }}
REQUESTS
{{ REQUESTS }}
{{#dropNotice}}

CALIFORNIA DELETE ACT
{{ dropNotice }}
{{/dropNotice}}
{{#supportingInstruments}}

FURTHER RIGHTS RELIED UPON IN THE ALTERNATIVE
{{ . }}
{{/supportingInstruments}}
{{ AUTHORITY }}{{ DEADLINE }}
This request must not be treated as a request to opt out of sale alone where deletion is
also available, and you must not discriminate against the consumer for exercising these
rights.

Please direct all correspondence to {{ replyTo }}, quoting reference {{ requestRef }}.

{{ agentName }}
Authorised agent for the consumer
Reference: {{ requestRef }}
`;

const PIPEDA_BODY = `To the Privacy Officer at {{ brokerName }},

We write on behalf of the individual identified below under the
{{ instrumentName }}.
{{ basis }}
{{ IDENTIFIERS }}{{ OBSERVED }}
REQUESTS
{{ REQUESTS }}
{{ AUTHORITY }}{{ DEADLINE }}
Please direct all correspondence to {{ replyTo }}, quoting reference {{ requestRef }}.

{{ agentName }}
Authorised agent for the individual
Reference: {{ requestRef }}
`;

const FADP_BODY = `To the Data Protection Officer at {{ brokerName }},

We write on behalf of the data subject identified below under the
{{ instrumentName }}.
{{ basis }}
{{ IDENTIFIERS }}{{ OBSERVED }}
REQUESTS
{{ REQUESTS }}
{{ AUTHORITY }}{{ DEADLINE }}
Please direct all correspondence to {{ replyTo }}, quoting reference {{ requestRef }}.

{{ agentName }}
Authorised agent for the data subject
Reference: {{ requestRef }}
`;

/** Build the per-instrument map. GDPR-family and US-state families share a body. */
const GDPR_FAMILY: LegalInstrumentId[] = ['GDPR', 'UK_GDPR'];
const US_FAMILY: LegalInstrumentId[] = [
  'CCPA', 'CA_DELETE_ACT', 'VCDPA', 'CPA', 'CTDPA', 'UCPA', 'TDPSA', 'OCPA', 'MTCDPA',
  'FDBR', 'DPDPA', 'NHPA', 'NJDPA', 'MODPA', 'MNCDPA', 'TIPA', 'ICDPA', 'INCDPA',
];

const defs = new Map<LegalInstrumentId, TemplateDef>();
for (const id of GDPR_FAMILY) {
  defs.set(id, {
    instrument: id,
    subject: 'Request to erase personal data and object to processing — {{ instrumentShort }} — ref {{ requestRef }}',
    body: GDPR_FAMILY_BODY,
  });
}
for (const id of US_FAMILY) {
  defs.set(id, {
    instrument: id,
    subject: 'Consumer request to delete, know and opt out — {{ instrumentShort }} — ref {{ requestRef }}',
    body: US_STATE_BODY,
  });
}
defs.set('PIPEDA', {
  instrument: 'PIPEDA',
  subject: 'Withdrawal of consent and request for access and deletion — PIPEDA — ref {{ requestRef }}',
  body: PIPEDA_BODY,
});
defs.set('CH_FADP', {
  instrument: 'CH_FADP',
  subject: 'Request for access and deletion of personal data — FADP — ref {{ requestRef }}',
  body: FADP_BODY,
});

export const TEMPLATES: ReadonlyMap<LegalInstrumentId, TemplateDef> = defs;

export const PARTIALS = {
  IDENTIFIERS,
  OBSERVED,
  AUTHORITY,
  DEADLINE,
} as const;

export function templateFor(id: LegalInstrumentId): TemplateDef {
  const t = TEMPLATES.get(id);
  if (!t) throw new Error(`no request template for instrument ${id}`);
  return t;
}

// ---------------------------------------------------------------------------
// The numbered request list
// ---------------------------------------------------------------------------

/**
 * Request items are data, not hardcoded numbers in the body.
 *
 * They used to be literal ("1. DELETE", "4. LIMIT SENSITIVE") with two of them
 * wrapped in conditional blocks. A UCPA or Iowa letter, which carries no
 * limit-sensitive right, therefore rendered "1. 2. 3. 5." -- and a compliance team
 * reading a legal demand with a gap in its numbering reasonably concludes a
 * paragraph went missing in transit. Numbering is now assigned after filtering.
 */
export interface RequestItemSpec {
  readonly heading: string;
  readonly text: string;
  /** Scope key that must be truthy for this item to appear. */
  readonly requires?: string;
}

export type TemplateFamily = 'gdpr' | 'us_state' | 'pipeda' | 'fadp';

export const REQUEST_ITEMS: Readonly<Record<TemplateFamily, readonly RequestItemSpec[]>> = {
  gdpr: [
    { heading: 'ERASURE', text: 'Erase without undue delay all personal data you hold relating to the data subject. {{ erasureCitation }}' },
    { heading: 'ACCESS', text: 'Before or alongside erasure, confirm what categories of personal data you held, the sources from which you obtained them, the purposes of processing, and the recipients or categories of recipients to whom they have been disclosed. {{ accessCitation }}' },
    { heading: 'OBJECTION', text: "The data subject objects to the processing of their personal data for direct marketing purposes and for the purposes of profiling related to such marketing. This objection is absolute and you must cease such processing on receipt. {{ objectionCitation }}" },
    { heading: 'ONWARD NOTIFICATION AND SUPPRESSION', text: "Communicate this erasure to each recipient to whom the personal data has been disclosed, and confirm that you have done so. {{ suppressionCitation }} Add the identifiers above to your internal suppression list so that the data subject's personal data is not re-collected or re-acquired from an upstream source." },
    { heading: 'SECTORAL REGULATION', text: '{{ sectoralCaveat }}', requires: 'sectoralCaveat' },
  ],
  us_state: [
    { heading: 'DELETE', text: 'Delete all personal information you have collected about the consumer, and direct any service providers, contractors and third parties to do the same. {{ erasureCitation }}' },
    { heading: 'KNOW', text: 'Disclose the categories of personal information you collected about the consumer, the categories of sources, the business or commercial purpose for collecting or selling it, and the categories of third parties to whom you disclosed, sold or shared it. {{ accessCitation }}' },
    { heading: 'OPT OUT OF SALE AND SHARING', text: 'The consumer opts out of the sale and sharing of their personal information, including for cross-context behavioural advertising. {{ optOutCitation }}' },
    { heading: 'LIMIT SENSITIVE PERSONAL INFORMATION', text: "Limit the use and disclosure of the consumer's sensitive personal information to that necessary to provide the goods or services requested. {{ limitSensitiveCitation }}", requires: 'limitSensitiveCitation' },
    { heading: 'SUPPRESSION', text: 'Retain only the minimum identifying information necessary to honour this deletion and opt-out on an ongoing basis, and place the consumer on your suppression list so that their personal information is not re-collected or re-acquired.' },
    { heading: 'SECTORAL REGULATION', text: '{{ sectoralCaveat }}', requires: 'sectoralCaveat' },
  ],
  pipeda: [
    { heading: 'WITHDRAWAL OF CONSENT', text: 'The individual withdraws any consent, express or implied, on which you rely to collect, use or disclose their personal information. {{ objectionCitation }}' },
    { heading: 'ACCESS', text: 'Provide an account of the personal information you hold about the individual, its sources, how it has been used, and the third parties to which it has been disclosed. {{ accessCitation }}' },
    { heading: 'DELETION', text: 'Having withdrawn consent, you no longer have a purpose for which retention is necessary. Destroy, erase or render anonymous the personal information you hold. {{ erasureCitation }}' },
    { heading: 'SUPPRESSION', text: 'Place the individual on your do-not-collect list so their personal information is not re-acquired from an upstream source.' },
    { heading: 'SECTORAL REGULATION', text: '{{ sectoralCaveat }}', requires: 'sectoralCaveat' },
  ],
  fadp: [
    { heading: 'ACCESS', text: 'Provide the information required under {{ accessCitation }}, including the personal data held, its source, the purpose of processing, and the recipients.' },
    { heading: 'DELETION', text: 'Delete or destroy the personal data you hold about the data subject. {{ erasureCitation }}' },
    { heading: 'OBJECTION', text: 'The data subject objects to the disclosure of their personal data to third parties. {{ objectionCitation }}' },
    { heading: 'SUPPRESSION', text: "Record the objection so that the data subject's personal data is not re-collected." },
  ],
};

export function familyFor(id: LegalInstrumentId): TemplateFamily {
  if (GDPR_FAMILY.includes(id)) return 'gdpr';
  if (US_FAMILY.includes(id)) return 'us_state';
  if (id === 'PIPEDA') return 'pipeda';
  if (id === 'CH_FADP') return 'fadp';
  throw new Error(`no template family for instrument ${id}`);
}
