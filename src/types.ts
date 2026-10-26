/**
 * Core domain types for deletewe.
 *
 * Design rules that the types themselves enforce (see docs/adr/0001):
 *  - A request outcome is never a single "success" boolean. Four distinct terminal
 *    outcomes exist and they are never summed (ADR-0001 D2).
 *  - A Subject's identifiers are always carried encrypted off the hot path; the plain
 *    shape below only ever exists in memory, inside a consent-checked operation.
 */

// ---------------------------------------------------------------------------
// Jurisdictions and legal instruments
// ---------------------------------------------------------------------------

/** ISO-3166-ish region code we key jurisdiction rules on. US states use `US-XX`. */
export type RegionCode = string;

export type LegalInstrumentId =
  | 'GDPR'
  | 'UK_GDPR'
  | 'CH_FADP'
  | 'PIPEDA'
  | 'CCPA'
  | 'CA_DELETE_ACT'
  | 'VCDPA'
  | 'CPA'
  | 'CTDPA'
  | 'UCPA'
  | 'TDPSA'
  | 'OCPA'
  | 'MTCDPA'
  | 'FDBR'
  | 'DPDPA'
  | 'NHPA'
  | 'NJDPA'
  | 'MODPA'
  | 'MNCDPA'
  | 'TIPA'
  | 'ICDPA'
  | 'INCDPA';

/** The distinct rights a single letter can assert. We assert all available (ADR-0001 D3). */
export type RightKind =
  | 'erasure'
  | 'access'
  | 'objection'
  | 'opt_out_of_sale'
  | 'suppression'
  | 'limit_sensitive';

export interface LegalInstrument {
  readonly id: LegalInstrumentId;
  readonly name: string;
  readonly shortName: string;
  /** Regions whose *residents* may invoke it. */
  readonly subjectRegions: readonly RegionCode[];
  /** If true, also available against any controller targeting those regions (extraterritorial). */
  readonly extraterritorial: boolean;
  readonly rights: readonly RightKind[];
  /** Calendar days the controller has to respond substantively. */
  readonly responseDays: number;
  /** Additional days available on a notified extension; 0 if none. */
  readonly extensionDays: number;
  /** Statutory citations, used verbatim in the letter. */
  readonly citations: Readonly<Record<string, string>>;
  /** Supervisory authority / regulator to escalate to. */
  readonly regulator: Regulator;
  /** Free-text caveat surfaced to operators and reviewers. */
  readonly note?: string;
}

export interface Regulator {
  readonly name: string;
  readonly complaintUrl: string;
  readonly jurisdiction: string;
}

/** A concrete right the subject holds against a specific broker. */
export interface Entitlement {
  readonly instrument: LegalInstrumentId;
  readonly rights: readonly RightKind[];
  readonly responseDays: number;
  readonly extensionDays: number;
  /** Why this instrument applies to this (subject, broker) pair. Shown in the letter. */
  readonly basis: string;
  /** Rank 0 is the primary instrument: it drives the template and the deadline clock. */
  readonly rank: number;
}

// ---------------------------------------------------------------------------
// Brokers
// ---------------------------------------------------------------------------

export type BrokerCategory =
  | 'people_search'
  | 'marketing'
  | 'recruitment'
  | 'risk_mitigation'
  | 'financial'
  | 'health'
  | 'location'
  | 'unknown';

/** Can the public observe whether this broker holds a given person? */
export type BrokerSurface = 'public' | 'private';

export type IdentifierKind =
  | 'full_name'
  | 'email'
  | 'locality'
  | 'street_address'
  | 'phone'
  | 'date_of_birth';

export interface Broker {
  readonly id: string;
  readonly name: string;
  readonly domains: readonly string[];
  readonly category: BrokerCategory;
  readonly surface: BrokerSurface;
  /** Where the broker is established; drives which instruments bind it directly. */
  readonly establishedIn: RegionCode;
  /** Regions the broker is known to target, for extraterritorial reach. */
  readonly targetsRegions: readonly RegionCode[];
  readonly legalContact: BrokerContact;
  /** 1-10 data sensitivity. 1-3 low, 4-6 medium, 7-10 high. */
  readonly severity: number;
  /** Observed/declared median days to respond substantively to a deletion request. */
  readonly medianResponseDays: number | null;
  /** Identifiers this broker needs beyond the global minimum, if any. */
  readonly requiredIdentifiers: readonly IdentifierKind[];
  /** Sector regulation that changes what can lawfully be erased. */
  readonly sectoralRegimes: readonly ('FCRA' | 'GLBA' | 'HIPAA' | 'CMIA' | 'IIPPA')[];
  /** Max requests per hour we will send this broker. */
  readonly rateLimitPerHour: number;
  readonly provenance: string;
}

export interface BrokerContact {
  readonly email: string | null;
  readonly privacyPortal: string | null;
  readonly postal: string | null;
}

export type ComplianceGrade = 'compliant' | 'inconsistent' | 'resistant' | 'undetermined';

export interface BrokerComplianceStats {
  readonly brokerId: string;
  readonly requestsSent: number;
  readonly confirmedDeleted: number;
  readonly noDataHeld: number;
  readonly refused: number;
  readonly deadlinesMissed: number;
  readonly meanResponseDays: number | null;
  readonly grade: ComplianceGrade;
}

// ---------------------------------------------------------------------------
// Subjects, consent, accounts
// ---------------------------------------------------------------------------

export interface SubjectIdentifiers {
  readonly fullName: string;
  readonly emails: readonly string[];
  /** Coarse location: city + region. Always required; a street address is not. */
  readonly locality: string;
  readonly streetAddresses?: readonly string[];
  readonly phones?: readonly string[];
  readonly dateOfBirth?: string;
  /** Former names / maiden names that brokers may index under. */
  readonly aliases?: readonly string[];
}

export interface Subject {
  readonly id: string;
  readonly accountId: string;
  /** Where the subject resides; drives which instruments they may invoke. */
  readonly residence: RegionCode;
  readonly identifiers: SubjectIdentifiers;
  readonly createdAt: string;
}

export type ConsentScope = 'erasure_requests' | 'regulator_complaints' | 'custom_removals';

/**
 * An adult's own authorisation for deletewe to act as their agent.
 * One per subject. The account owner's consent authorises nothing for another adult.
 */
export interface ConsentRecord {
  readonly id: string;
  readonly subjectId: string;
  /** Jurisdictions this authorisation was granted under. */
  readonly jurisdictions: readonly RegionCode[];
  readonly scopes: readonly ConsentScope[];
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  /** Typed full name, acting as the signature. */
  readonly signatureName: string;
  /** How the subject proved they are the one signing. */
  readonly method: 'email_link' | 'in_person' | 'imported';
  /** sha256 of the canonicalised authorisation text the subject actually saw. */
  readonly documentHash: string;
  /** Hash chain over the preceding consent event, making the log tamper-evident. */
  readonly previousHash: string | null;
  readonly entryHash: string;
}

export interface Account {
  readonly id: string;
  readonly ownerSubjectId: string;
  readonly plan: 'individual' | 'family';
  readonly maxSubjects: number;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type RequestStatus =
  | 'planned'
  | 'sent'
  | 'acknowledged'
  | 'awaiting_verification'
  | 'extended'
  | 'escalated'
  | 'closed';

/** Terminal outcomes. Deliberately four, deliberately never summed (ADR-0001 D2). */
export type RequestOutcome =
  | 'verified_absent'
  | 'confirmed_deleted'
  | 'no_data_held'
  | 'refused'
  | 'deadline_missed'
  | 'undeliverable';

/** How strong the evidence for the outcome is. Lower is stronger. */
export const EVIDENCE_RANK: Readonly<Record<RequestOutcome, number>> = Object.freeze({
  verified_absent: 1,
  confirmed_deleted: 2,
  no_data_held: 3,
  refused: 4,
  deadline_missed: 4,
  undeliverable: 5,
});

export interface RemovalRequest {
  readonly id: string;
  readonly subjectId: string;
  readonly brokerId: string;
  readonly instrument: LegalInstrumentId;
  readonly supportingInstruments: readonly LegalInstrumentId[];
  readonly rights: readonly RightKind[];
  readonly status: RequestStatus;
  readonly outcome: RequestOutcome | null;
  readonly createdAt: string;
  readonly sentAt: string | null;
  /** Statutory deadline, computed from sentAt. */
  readonly dueAt: string | null;
  /** Extended deadline if the broker notified an extension. */
  readonly extendedDueAt: string | null;
  readonly closedAt: string | null;
  /** Next recurrence (60d public / 90d private) or re-verification (10d) due. */
  readonly nextActionAt: string | null;
  readonly followUpCount: number;
  /** sha256 of the exact rendered letter, so the evidence pack is verifiable. */
  readonly bodyHash: string;
  /** Observed listing that prompted enrichment, if discovery supplied one. */
  readonly observationId: string | null;
  readonly threadKey: string;
}

export interface RequestEvent {
  readonly id: string;
  readonly requestId: string;
  readonly at: string;
  readonly kind:
    | 'planned'
    | 'sent'
    | 'reply_received'
    | 'classified'
    | 'follow_up_sent'
    | 'escalated'
    | 'complaint_drafted'
    | 'outcome_recorded'
    | 'reverification'
    | 'recurrence_scheduled';
  /** Never contains personal data; see util/redact.ts. */
  readonly detail: string;
  readonly evidenceHash: string | null;
}

// ---------------------------------------------------------------------------
// Inbound replies
// ---------------------------------------------------------------------------

export type ReplyClass =
  | 'confirmed_deleted'
  | 'suppression_confirmed'
  | 'no_data_held'
  | 'needs_verification'
  | 'refused'
  | 'extension'
  | 'acknowledgement'
  | 'partial'
  | 'bounce'
  | 'auto_reply'
  | 'unclassified';

export interface InboundReply {
  readonly id: string;
  readonly threadKey: string | null;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly subject: string;
  readonly receivedAt: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface Classification {
  readonly class: ReplyClass;
  readonly confidence: number;
  /** Rule ids that fired, so a disputed classification is explainable. */
  readonly matchedRules: readonly string[];
  /** True when confidence is below threshold and a human should look. */
  readonly needsReview: boolean;
}

// ---------------------------------------------------------------------------
// Discovery (pluggable; never gates a request -- ADR-0001 D1)
// ---------------------------------------------------------------------------

export interface Observation {
  readonly id: string;
  readonly subjectId: string;
  readonly brokerId: string;
  readonly url: string;
  readonly observedAt: string;
  /** Which identifiers were visible in the listing. */
  readonly matchedIdentifiers: readonly IdentifierKind[];
  readonly present: boolean;
  readonly snapshotHash: string | null;
}

export interface DiscoveryAdapter {
  readonly id: string;
  /** Returns observations for brokers with a public surface. May return []. */
  observe(subject: Subject, brokers: readonly Broker[]): Promise<readonly Observation[]>;
}

// ---------------------------------------------------------------------------
// Custom removals
// ---------------------------------------------------------------------------

export type CustomRemovalKind =
  | 'known_broker'
  | 'unknown_people_search'
  | 'search_engine_result'
  | 'social_media'
  | 'news_or_press'
  | 'court_or_public_record'
  | 'user_controlled'
  | 'ineligible';

export interface CustomRemovalRequest {
  readonly id: string;
  readonly subjectId: string;
  readonly url: string;
  readonly kind: CustomRemovalKind;
  readonly eligible: boolean;
  readonly reason: string;
  readonly routedTo: 'legal_request' | 'search_delisting' | 'manual_review' | 'rejected';
  readonly brokerId: string | null;
  readonly submittedAt: string;
}
