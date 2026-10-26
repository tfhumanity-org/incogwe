/**
 * Family / multi-profile accounts, with consent captured separately per adult.
 *
 * The rule the research surfaced and that competitors leave implicit (dossier §4.5):
 * the account owner's signature cannot lawfully authorise an agent to act for a
 * different adult. deletewe makes that structural. An invitee receives a one-time
 * link, opens it themselves, and signs their own authorisation. Until they do, their
 * profile exists but cannot produce a single request -- composeLetter will throw.
 */
import type { Account, ConsentScope, RegionCode, Subject, SubjectIdentifiers } from '../types.ts';
import type { Store } from '../store/store.ts';
import { grantConsent, revokeConsent } from '../consent/consent.ts';
import { hashObject, newId, sha256 } from '../util/ids.ts';
import { addDays } from '../util/clock.ts';
import { log } from '../util/logging.ts';

export const PLAN_LIMITS = { individual: 1, family: 5 } as const;
/** Invitation links are short-lived on purpose; a stale link is a consent risk. */
export const INVITE_TTL_HOURS = 24;

export class SeatLimitError extends Error {}
export class InviteError extends Error {}

export interface Invite {
  readonly id: string;
  readonly accountId: string;
  readonly token: string;
  readonly expiresAt: string;
  /** sha256 of the token. Only this is ever stored or logged. */
  readonly tokenHash: string;
}

export function createAccount(ownerIdentifiers: SubjectIdentifiers, residence: RegionCode,
  plan: Account['plan'], now: Date): { account: Account; owner: Subject } {
  const accountId = newId('acct');
  const owner: Subject = {
    id: newId('subj'), accountId, residence, identifiers: ownerIdentifiers, createdAt: now.toISOString(),
  };
  const account: Account = {
    id: accountId, ownerSubjectId: owner.id, plan,
    maxSubjects: PLAN_LIMITS[plan], createdAt: now.toISOString(),
  };
  return { account, owner };
}

export function createInvite(store: Store, accountId: string, now: Date): Invite {
  const account = store.getAccount(accountId);
  if (!account) throw new InviteError(`unknown account ${accountId}`);
  const used = store.subjectsForAccount(accountId).length;
  if (used >= account.maxSubjects) {
    throw new SeatLimitError(`account ${accountId} is full (${used}/${account.maxSubjects})`);
  }
  const token = newId('inv');
  return {
    id: newId('invite'),
    accountId,
    token,
    expiresAt: addDays(now, INVITE_TTL_HOURS / 24).toISOString(),
    tokenHash: sha256(token),
  };
}

export interface AcceptInviteInput {
  readonly invite: Invite;
  readonly presentedToken: string;
  readonly identifiers: SubjectIdentifiers;
  readonly residence: RegionCode;
  /** The invitee types their own name. This is the signature. */
  readonly signatureName: string;
  readonly scopes: readonly ConsentScope[];
  readonly agentName: string;
  readonly now: Date;
}

/**
 * Accepting an invitation creates the subject AND their own consent record in one
 * step, because a profile without consent is a liability: it holds personal data
 * that no request can ever lawfully use.
 */
export function acceptInvite(store: Store, input: AcceptInviteInput): Subject {
  const { invite, now } = input;
  if (sha256(input.presentedToken) !== invite.tokenHash) throw new InviteError('invalid invitation token');
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) throw new InviteError('invitation has expired');

  const account = store.getAccount(invite.accountId);
  if (!account) throw new InviteError(`unknown account ${invite.accountId}`);
  const used = store.subjectsForAccount(invite.accountId).length;
  if (used >= account.maxSubjects) {
    throw new SeatLimitError(`account ${invite.accountId} is full (${used}/${account.maxSubjects})`);
  }

  const subject: Subject = {
    id: newId('subj'),
    accountId: invite.accountId,
    residence: input.residence,
    identifiers: input.identifiers,
    createdAt: now.toISOString(),
  };
  store.putSubject(subject);

  const consent = grantConsent({
    subjectId: subject.id,
    jurisdictions: [input.residence],
    scopes: input.scopes,
    signatureName: input.signatureName,
    method: 'email_link',
    agentName: input.agentName,
    now,
    previousHash: null,     // each adult's chain is their own
  });
  store.putConsent(consent);

  log.info('family member joined and signed their own authorisation', {
    accountId: invite.accountId, subjectId: subject.id, residence: input.residence,
    scopes: input.scopes, consentDigest: hashObject(consent).slice(0, 12),
  });

  return subject;
}

/**
 * Revoke one adult's authorisation and delete their data. Deliberately available
 * to the member themselves, not only to the account owner: an adult who can be
 * added by someone else must be able to leave on their own.
 */
export function leaveAccount(store: Store, subjectId: string, now: Date): { deleted: Record<string, number> } {
  const live = store.getConsent(subjectId);
  if (live) store.putConsent(revokeConsent(live, now));
  const result = store.deleteSubject(subjectId);
  log.info('subject left and was erased', { subjectId, deleted: result.deleted });
  return result;
}

/** Which profiles on an account can currently produce requests. */
export function seatStatus(store: Store, accountId: string, now: Date): {
  subjectId: string; residence: string; consented: boolean; reason: string;
}[] {
  return store.subjectsForAccount(accountId).map((s) => {
    const c = store.getConsent(s.id);
    if (!c) return { subjectId: s.id, residence: s.residence, consented: false, reason: 'no authorisation signed' };
    if (c.revokedAt) return { subjectId: s.id, residence: s.residence, consented: false, reason: 'authorisation revoked' };
    if (new Date(c.expiresAt).getTime() <= now.getTime()) {
      return { subjectId: s.id, residence: s.residence, consented: false, reason: 'authorisation expired' };
    }
    return { subjectId: s.id, residence: s.residence, consented: true, reason: `signed ${c.grantedAt.slice(0, 10)}` };
  });
}
