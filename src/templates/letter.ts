/**
 * Compose a concrete letter from (subject, broker, entitlements).
 *
 * This is the ONLY path that turns a Subject's identifiers into text, which is why
 * the consent check lives here rather than at an API edge: there is no way to render
 * a letter without passing it (ADR-0001 D6).
 */
import type {
  Broker, ConsentRecord, Entitlement, LegalInstrumentId, Observation, Subject,
} from '../types.ts';
import { instrument } from '../legal/jurisdictions.ts';
import { dropEligible, sectoralCaveat } from '../legal/entitlements.ts';
import { dueDate } from '../legal/deadlines.ts';
import { render, tidy } from './render.ts';
import { PARTIALS, templateFor } from './registry.ts';
import { assertConsent } from '../consent/consent.ts';
import { assertValidIdentifiers } from '../identifiers.ts';
import { sha256 } from '../util/ids.ts';

export interface LetterContext {
  readonly subject: Subject;
  readonly broker: Broker;
  readonly entitlements: readonly Entitlement[];
  readonly consent: ConsentRecord;
  readonly requestRef: string;
  readonly replyTo: string;
  readonly agentName: string;
  readonly sentAt: Date;
  readonly observation?: Observation | null;
}

export interface Letter {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly bodyHash: string;
  readonly instrument: LegalInstrumentId;
  readonly supporting: readonly LegalInstrumentId[];
  readonly dueAt: string;
}

export class NoEntitlementError extends Error {}
export class NoContactError extends Error {}

export function composeLetter(ctx: LetterContext): Letter {
  const { subject, broker, entitlements, consent } = ctx;

  // Gate 1: consent. Throws ConsentRequiredError.
  assertConsent(consent, subject, 'erasure_requests', ctx.sentAt);

  // Gate 2: usable identifiers. These are rendered verbatim into a letter sent to a
  // real company, so a placeholder profile must never reach one. Checked here rather
  // than only at ingest, because this is the one function every letter passes through.
  assertValidIdentifiers(subject.identifiers, { now: ctx.sentAt });

  // Gate 3: a modelled statutory route must exist.
  const primary = entitlements[0];
  if (!primary) {
    throw new NoEntitlementError(
      `no modelled statutory route from ${subject.residence} to ${broker.name} (${broker.establishedIn})`,
    );
  }

  // Gate 4: somewhere to send it.
  const to = broker.legalContact.email ?? broker.legalContact.privacyPortal;
  if (!to) throw new NoContactError(`broker ${broker.id} has no legal contact`);

  const inst = instrument(primary.instrument);
  const tpl = templateFor(primary.instrument);
  const due = dueDate(ctx.sentAt, primary.responseDays);

  const supporting = entitlements.slice(1, 3).map((e) => e.instrument);
  const supportingLines = entitlements.slice(1, 3).map((e) => {
    const si = instrument(e.instrument);
    return `${si.name} — ${e.basis} Rights relied upon: ${e.rights.join(', ')}.`;
  });

  const ids = subject.identifiers;
  const scope: Record<string, unknown> = {
    // Partials, expanded by the renderer's block/var passes.
    IDENTIFIERS: render(PARTIALS.IDENTIFIERS, identifierScope(subject)),
    OBSERVED: ctx.observation && ctx.observation.present
      ? render(PARTIALS.OBSERVED, {
          observedUrl: ctx.observation.url,
          observedAt: ctx.observation.observedAt.slice(0, 10),
        })
      : '',
    AUTHORITY: render(PARTIALS.AUTHORITY, {
      agentName: ctx.agentName,
      consentGrantedAt: consent.grantedAt.slice(0, 10),
      consentRef: consent.id,
      consentHash: consent.documentHash.slice(0, 16),
      agentAuthorityCitation: inst.citations['agent']
        ? `This authorisation is made under ${inst.citations['agent']}.`
        : '',
    }),
    DEADLINE: render(PARTIALS.DEADLINE, {
      dueDate: due.toISOString().slice(0, 10),
      responseDays: primary.responseDays,
      deadlineCitation: inst.citations['deadline'] ?? inst.name,
      extensionDays: primary.extensionDays > 0 ? primary.extensionDays : 0,
      regulatorName: inst.regulator.name,
      regulatorUrl: inst.regulator.complaintUrl,
    }),

    brokerName: broker.name,
    instrumentName: inst.name,
    instrumentShort: inst.shortName,
    basis: primary.basis,
    erasureCitation: inst.citations['erasure'] ?? '',
    accessCitation: inst.citations['access'] ?? '',
    objectionCitation: inst.citations['objection'] ?? '',
    optOutCitation: inst.citations['opt_out_of_sale'] ?? '',
    limitSensitiveCitation: primary.rights.includes('limit_sensitive')
      ? (inst.citations['limit_sensitive'] ?? '')
      : '',
    suppressionCitation: inst.citations['suppression'] ?? '',
    sectoralCaveat: sectoralCaveat(broker) ?? '',
    dropNotice: dropEligible(subject, broker)
      ? 'You are a registered California data broker. In addition to this request, the ' +
        'consumer has been advised to submit a deletion request through the California ' +
        'Privacy Protection Agency DROP platform. From 1 August 2026 you are required to ' +
        'access DROP at least every 45 days and to process all verified deletion requests ' +
        'there on an ongoing basis. This letter does not replace that obligation.'
      : '',
    supportingInstruments: supportingLines,
    requestRef: ctx.requestRef,
    replyTo: ctx.replyTo,
    agentName: ctx.agentName,

    // Identifiers are also exposed at top level for the subject line.
    fullName: ids.fullName,
  };

  const body = tidy(render(tpl.body, scope));
  const subjectLine = render(tpl.subject, scope).trim();

  return {
    to,
    subject: subjectLine,
    body,
    bodyHash: sha256(body),
    instrument: primary.instrument,
    supporting,
    dueAt: due.toISOString(),
  };
}

/**
 * Minimum-PII projection (ADR-0001 D7): only the identifiers this specific broker
 * actually needs are rendered into the letter. Everything else stays in the store.
 */
function identifierScope(subject: Subject): Record<string, unknown> {
  const ids = subject.identifiers;
  return {
    fullName: ids.fullName,
    aliases: ids.aliases ?? [],
    locality: ids.locality,
    emails: ids.emails,
    streetAddresses: ids.streetAddresses ?? [],
    phones: ids.phones ?? [],
    dateOfBirth: ids.dateOfBirth ?? '',
  };
}

/**
 * Narrow a subject to only the identifiers a broker requires, before composing.
 * Callers should do this rather than handing the full profile to every broker.
 */
export function minimise(subject: Subject, broker: Broker): Subject {
  const need = new Set(broker.requiredIdentifiers);
  const ids = subject.identifiers;
  return {
    ...subject,
    identifiers: {
      fullName: ids.fullName,
      emails: ids.emails,
      locality: ids.locality,
      ...(need.has('street_address') ? { streetAddresses: ids.streetAddresses } : {}),
      ...(need.has('phone') ? { phones: ids.phones } : {}),
      ...(need.has('date_of_birth') ? { dateOfBirth: ids.dateOfBirth } : {}),
      ...(ids.aliases ? { aliases: ids.aliases } : {}),
    },
  };
}
