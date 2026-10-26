/**
 * Escalation: follow-ups and regulator complaint drafts.
 *
 * A missed statutory deadline is not a failure of the product, it is the product
 * working: silence from a broker is itself a breach, and it is the most actionable
 * thing a subject can take to a regulator. So deadline_missed is recorded as an
 * outcome with evidence, and a complaint draft is generated from the request's own
 * event history -- no retyping, no reconstruction.
 */
import type { Broker, RemovalRequest, RequestEvent, Subject } from '../types.ts';
import { instrument } from '../legal/jurisdictions.ts';
import { render, tidy } from '../templates/render.ts';
import { daysBetween } from '../util/clock.ts';

const FOLLOW_UP = `To the Privacy Team at {{ brokerName }},

FOLLOW-UP {{ followUpNumber }} — reference {{ requestRef }}

On {{ sentDate }} we sent you a request under {{ instrumentName }} on behalf of our
client, exercising their rights to {{ rightsList }}. {{ deadlineSentence }}

{{#overdue}}
Your statutory deadline of {{ dueDate }} passed {{ overdueDays }} days ago and we have
received no substantive response. The request remains outstanding.
{{/overdue}}
{{^overdue}}
Your statutory deadline of {{ dueDate }} is now {{ remainingDays }} days away. This is a
reminder, sent so that the deadline is not missed inadvertently.
{{/overdue}}

The original request is repeated below in full and is to be treated as made again on
today's date without prejudice to the original date of receipt.

If we do not receive a substantive response, we will lodge a complaint with
{{ regulatorName }} ({{ regulatorUrl }}) on our client's instruction, enclosing a record
of this correspondence.

{{ agentName }}
Authorised agent — reference {{ requestRef }}

--- ORIGINAL REQUEST ---
{{ originalBody }}
`;

const COMPLAINT = `COMPLAINT TO {{ regulatorNameUpper }}

Complainant:        {{ subjectName }}, resident of {{ residence }}
Represented by:     {{ agentName }}, authorised agent
                    (authorisation signed {{ consentDate }}, available on request)
Respondent:         {{ brokerName }}
                    {{ brokerContact }}
Legal basis:        {{ instrumentName }}
Our reference:      {{ requestRef }}
Date of complaint:  {{ complaintDate }}

1. NATURE OF THE COMPLAINT

The respondent has failed to comply with a valid request made under
{{ instrumentName }} on behalf of the complainant. {{ failureSentence }}

2. THE REQUEST

On {{ sentDate }} the complainant's authorised agent sent the respondent a request
exercising the following rights: {{ rightsList }}.

The request cited {{ citationList }}.

The request was sent to {{ brokerContact }} and was accepted for delivery. A copy of
the request as sent, together with its cryptographic digest ({{ bodyHash }}), is
enclosed and can be verified against our records.

3. THE DEADLINE

Under {{ deadlineCitation }} the respondent was required to respond substantively by
{{ dueDate }}, being {{ responseDays }} days from the date of the request.
{{#extended}}
The respondent notified an extension, moving the deadline to {{ extendedDueDate }}.
{{/extended}}

As at the date of this complaint, {{ overdueDays }} days have elapsed since that
deadline.

4. CORRESPONDENCE HISTORY

{{#events}}
  {{ . }}
{{/events}}

5. WHAT THE COMPLAINANT SEEKS

  a. A direction that the respondent action the request in full.
  b. Confirmation to the complainant of what personal data was held, its sources, and
     the recipients to whom it was disclosed.
  c. Such regulatory action as {{ regulatorName }} considers appropriate in respect of
     the respondent's failure to respond within the statutory period.

6. DECLARATION

The agent confirms it holds a signed authorisation from the complainant covering the
lodging of this complaint, and that the facts stated above are drawn from an automated
and contemporaneous record of the correspondence.

{{ agentName }}
On behalf of {{ subjectName }}
`;

export interface FollowUpContext {
  readonly request: RemovalRequest;
  readonly broker: Broker;
  readonly originalBody: string;
  readonly agentName: string;
  readonly now: Date;
  readonly followUpNumber: number;
}

export function renderFollowUp(ctx: FollowUpContext): { subject: string; body: string } {
  const inst = instrument(ctx.request.instrument);
  const due = new Date(ctx.request.extendedDueAt ?? ctx.request.dueAt ?? ctx.now.toISOString());
  const remaining = daysBetween(ctx.now, due);
  const overdue = remaining < 0;

  const body = tidy(render(FOLLOW_UP, {
    brokerName: ctx.broker.name,
    followUpNumber: ctx.followUpNumber,
    requestRef: ctx.request.id,
    sentDate: (ctx.request.sentAt ?? '').slice(0, 10),
    instrumentName: inst.name,
    rightsList: ctx.request.rights.join(', '),
    deadlineSentence: `That request engaged ${inst.citations['deadline'] ?? inst.name}.`,
    overdue,
    overdueDays: Math.abs(remaining),
    remainingDays: Math.max(0, remaining),
    dueDate: due.toISOString().slice(0, 10),
    regulatorName: inst.regulator.name,
    regulatorUrl: inst.regulator.complaintUrl,
    agentName: ctx.agentName,
    originalBody: ctx.originalBody,
  }));

  return {
    subject: `FOLLOW-UP ${ctx.followUpNumber}: ${inst.shortName} request — ref ${ctx.request.id}`,
    body,
  };
}

export interface ComplaintContext {
  readonly request: RemovalRequest;
  readonly broker: Broker;
  readonly subject: Subject;
  readonly events: readonly RequestEvent[];
  readonly consentDate: string;
  readonly agentName: string;
  readonly now: Date;
  readonly reason: 'no_response' | 'refused';
}

export function renderComplaint(ctx: ComplaintContext): { filename: string; body: string } {
  const inst = instrument(ctx.request.instrument);
  const due = new Date(ctx.request.extendedDueAt ?? ctx.request.dueAt ?? ctx.now.toISOString());
  const overdueDays = Math.max(0, daysBetween(due, ctx.now));

  const body = tidy(render(COMPLAINT, {
    regulatorNameUpper: inst.regulator.name.toUpperCase(),
    regulatorName: inst.regulator.name,
    subjectName: ctx.subject.identifiers.fullName,
    residence: ctx.subject.residence,
    agentName: ctx.agentName,
    consentDate: ctx.consentDate.slice(0, 10),
    brokerName: ctx.broker.name,
    brokerContact: ctx.broker.legalContact.email ?? ctx.broker.legalContact.privacyPortal ?? 'unknown',
    instrumentName: inst.name,
    requestRef: ctx.request.id,
    complaintDate: ctx.now.toISOString().slice(0, 10),
    failureSentence: ctx.reason === 'no_response'
      ? 'No substantive response was received within the statutory period.'
      : 'The respondent refused the request without, in the complainant\'s submission, a lawful basis for doing so.',
    sentDate: (ctx.request.sentAt ?? '').slice(0, 10),
    rightsList: ctx.request.rights.join(', '),
    citationList: ctx.request.rights
      .map((r) => inst.citations[r])
      .filter(Boolean)
      .join('; ') || inst.name,
    bodyHash: ctx.request.bodyHash,
    deadlineCitation: inst.citations['deadline'] ?? inst.name,
    dueDate: (ctx.request.dueAt ?? '').slice(0, 10),
    responseDays: inst.responseDays,
    extended: Boolean(ctx.request.extendedDueAt),
    extendedDueDate: (ctx.request.extendedDueAt ?? '').slice(0, 10),
    overdueDays,
    events: ctx.events.map((e) => `${e.at.slice(0, 10)}  ${e.kind.padEnd(22)} ${e.detail}`),
  }));

  return {
    filename: `complaint-${ctx.request.id}-${ctx.broker.id}.txt`,
    body,
  };
}
