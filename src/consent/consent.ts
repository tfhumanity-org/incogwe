/**
 * Consent is enforced in code, per adult, per jurisdiction (ADR-0001 D6).
 *
 * The product acts as the user's authorised agent. It must never be usable against
 * someone who has not themselves consented. Three properties make that true:
 *
 *  1. `assertConsent` is called from the letter composer, not from an API handler,
 *     so no code path can route around it.
 *  2. A consent record names one subject. The account owner's record authorises
 *     nothing for any other adult on a family plan.
 *  3. The consent log is hash-chained, so a record cannot be back-dated or inserted
 *     without breaking the chain.
 */
import type { ConsentRecord, ConsentScope, RegionCode, Subject } from '../types.ts';
import { hashObject, newId, sha256 } from '../util/ids.ts';
import { addDays } from '../util/clock.ts';

export class ConsentRequiredError extends Error {
  readonly subjectId: string;
  readonly reason: string;
  constructor(subjectId: string, reason: string) {
    super(`consent required for subject ${subjectId}: ${reason}`);
    this.subjectId = subjectId;
    this.reason = reason;
  }
}

/** Default authorisation lifetime. Re-consent is a feature, not an inconvenience. */
export const CONSENT_TTL_DAYS = 365;

export const AUTHORISATION_TEXT = `
I authorise {{agent}} to act as my authorised agent for the purpose of exercising my
personal data rights in {{jurisdictions}}. Specifically, I authorise it to:

  - request access to, erasure of, and the deletion of personal data about me held by
    data brokers and similar recipients;
  - object to processing of my personal data and to opt out of its sale or sharing;
  - request that I be added to suppression or do-not-collect lists;
  - where a request is refused or ignored, lodge a complaint on my behalf with the
    competent supervisory authority or regulator.

I confirm that the personal data I have provided relates to me, that I am an adult, and
that I am not submitting this authorisation on behalf of any other person.

I understand that I may revoke this authorisation at any time, that doing so stops all
future requests, and that my personal data will then be deleted.
`.trim();

export function authorisationDocument(agent: string, jurisdictions: readonly RegionCode[]): string {
  return AUTHORISATION_TEXT
    .replace('{{agent}}', agent)
    .replace('{{jurisdictions}}', jurisdictions.join(', '));
}

export interface GrantConsentInput {
  readonly subjectId: string;
  readonly jurisdictions: readonly RegionCode[];
  readonly scopes: readonly ConsentScope[];
  readonly signatureName: string;
  readonly method: ConsentRecord['method'];
  readonly agentName: string;
  readonly now: Date;
  /** Hash of the previous entry in this account's consent log, or null for the first. */
  readonly previousHash: string | null;
  readonly ttlDays?: number;
}

export function grantConsent(input: GrantConsentInput): ConsentRecord {
  const documentHash = sha256(authorisationDocument(input.agentName, input.jurisdictions));
  const base = {
    id: newId('consent'),
    subjectId: input.subjectId,
    jurisdictions: [...input.jurisdictions],
    scopes: [...input.scopes],
    grantedAt: input.now.toISOString(),
    expiresAt: addDays(input.now, input.ttlDays ?? CONSENT_TTL_DAYS).toISOString(),
    revokedAt: null,
    signatureName: input.signatureName,
    method: input.method,
    documentHash,
    previousHash: input.previousHash,
  };
  return { ...base, entryHash: hashObject(base) };
}

export function revokeConsent(record: ConsentRecord, now: Date): ConsentRecord {
  const base = { ...record, revokedAt: now.toISOString() };
  const { entryHash: _drop, ...rest } = base;
  return { ...base, entryHash: hashObject(rest) };
}

/** Verify the hash chain over an account's consent log. */
export function verifyConsentChain(records: readonly ConsentRecord[]): boolean {
  let prev: string | null = null;
  for (const r of records) {
    if (r.previousHash !== prev) return false;
    const { entryHash, ...rest } = r;
    if (hashObject(rest) !== entryHash) return false;
    prev = entryHash;
  }
  return true;
}

/**
 * The gate. Throws unless this exact subject has a live authorisation covering
 * the scope and their own residence.
 */
export function assertConsent(
  consent: ConsentRecord | null | undefined,
  subject: Subject,
  scope: ConsentScope,
  now: Date,
): asserts consent is ConsentRecord {
  if (!consent) throw new ConsentRequiredError(subject.id, 'no consent record');
  if (consent.subjectId !== subject.id) {
    throw new ConsentRequiredError(
      subject.id,
      `consent record ${consent.id} belongs to a different subject — one adult cannot consent for another`,
    );
  }
  if (consent.revokedAt) throw new ConsentRequiredError(subject.id, `revoked at ${consent.revokedAt}`);
  if (new Date(consent.expiresAt).getTime() <= now.getTime()) {
    throw new ConsentRequiredError(subject.id, `expired at ${consent.expiresAt}`);
  }
  if (!consent.scopes.includes(scope)) {
    throw new ConsentRequiredError(subject.id, `scope ${scope} not authorised`);
  }
  if (!consent.jurisdictions.includes(subject.residence)) {
    throw new ConsentRequiredError(
      subject.id,
      `authorisation does not cover the subject's residence ${subject.residence}`,
    );
  }
}
