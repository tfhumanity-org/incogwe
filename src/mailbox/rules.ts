/**
 * Reply classification rules.
 *
 * Rules, not a model. Three reasons, and they are the reasons this is the right
 * choice here rather than a limitation:
 *
 *  1. Every classification must be explainable. A misclassified "refused" as
 *     "confirmed" silently drops someone's legal right on the floor. A rule id in
 *     the audit trail says exactly why we decided what we decided.
 *  2. Broker replies are overwhelmingly templated. The same fifty sentences recur
 *     across thousands of senders, so precision is achievable with patterns.
 *  3. The classifier must never see personal data leave the process. A local rule
 *     engine cannot exfiltrate a reply body to a third-party API.
 *
 * Anything the rules cannot place with confidence goes to `unclassified` with
 * `needsReview: true`. Guessing is worse than queueing.
 */
import type { ReplyClass } from '../types.ts';

export interface Rule {
  readonly id: string;
  readonly cls: ReplyClass;
  /** Added to the score when matched. Negative weights veto. */
  readonly weight: number;
  readonly pattern: RegExp;
  /** Match against headers rather than the body. */
  readonly scope?: 'body' | 'subject' | 'from' | 'headers';
  readonly note?: string;
}

const r = (
  id: string, cls: ReplyClass, weight: number, pattern: RegExp,
  scope: Rule['scope'] = 'body', note?: string,
): Rule => ({ id, cls, weight, pattern, scope, ...(note ? { note } : {}) });

export const RULES: readonly Rule[] = [
  // --- bounces: decided on headers first, because a bounce body often quotes our
  //     own letter and would otherwise match every rule in the file. -------------
  //
  // These must be SPECIFIC to delivery failure. `bounce` overrides every other class
  // in OVERRIDES, on the reasoning that a letter which never arrived cannot have been
  // answered -- so a loose bounce rule does not merely mislabel, it closes a live
  // request as undeliverable against a broker that is reachable and replying.
  r('bounce.header.dsn', 'bounce', 100, /^content-type:\s*multipart\/report.*report-type=delivery-status/im, 'headers'),
  r('bounce.header.failed', 'bounce', 100, /^(x-failed-recipients:|status:\s*5\.\d+\.\d+|action:\s*failed)/im, 'headers'),
  r('bounce.from.mailer', 'bounce', 90, /^(mailer-daemon|postmaster)@/i, 'from'),
  r('bounce.subject', 'bounce', 80, /\b(undeliverable|delivery (status notification|has failed)|returned mail|mail delivery failed)\b/i, 'subject'),
  r('bounce.body.smtp', 'bounce', 70, /\b5\d\d[ -]?(5\.\d\.\d)?\b.*\b(no such user|user unknown|mailbox (unavailable|not found)|address rejected|recipient rejected)\b/i),
  r('bounce.body.noroute', 'bounce', 70, /\b(recipient address rejected|host or domain name not found|does not exist)\b/i),

  // --- vacation / ticketing autoresponders ----------------------------------
  // RFC 3834 says an autoresponder SHOULD stamp `Auto-Submitted: auto-replied`, so
  // this header marks a vacation or ticketing reply -- NOT a delivery failure. It
  // scored `bounce` until a review caught it, which meant a broker who was merely on
  // holiday had the subject's request closed as "the letter never arrived".
  r('auto.header.autosubmitted', 'auto_reply', 60, /^auto-submitted:\s*auto-(replied|generated)/im, 'headers'),
  r('auto.outofoffice', 'auto_reply', 70, /\b(out of (the )?office|on annual leave|currently away|automatic reply)\b/i),
  r('auto.ticket', 'auto_reply', 55, /\b(we have received your (message|email|request)|ticket (number|#|has been created)|case number \w+ has been (created|opened)|thank you for contacting)\b/i),
  r('auto.donotreply', 'auto_reply', 30, /\bdo not reply to this (email|message)\b/i),

  // --- confirmed deletion ----------------------------------------------------
  r('confirm.deleted', 'confirmed_deleted', 85, /\b(ha(s|ve) been|was|were|is now|are now)\s+(permanently\s+)?(deleted|erased|removed|purged|destroyed)\b/i),
  r('confirm.wehave', 'confirmed_deleted', 85, /\bwe (have|'ve)\s+(now\s+)?(deleted|erased|removed|purged|destroyed)\b/i),
  r('confirm.completed', 'confirmed_deleted', 70, /\b(your|the)\s+(deletion|erasure|removal|opt[- ]?out)\s+request\s+(has been|was)\s+(completed|fulfilled|processed|actioned|honou?red)\b/i),
  r('confirm.record.removed', 'confirmed_deleted', 70, /\b(the )?(record|profile|listing|information|data)\s+(has been|was|is)\s+(removed|deleted|taken down)\b/i),
  r('confirm.complied', 'confirmed_deleted', 60, /\bwe have (complied with|actioned|fulfilled) your request\b/i),
  r('confirm.optout.processed', 'confirmed_deleted', 55, /\byou have been (opted out|removed from)\b/i),

  // --- suppression undertaking (stronger than plain deletion) ---------------
  r('suppress.list', 'suppression_confirmed', 90, /\b(added (you|your (details|information|data)) to|placed (you|your \w+) on)\s+(our\s+)?(internal\s+)?(suppression|do[- ]not[- ](contact|collect|sell|mail)|exclusion|opt[- ]out)\s+(list|file|registry)\b/i),
  r('suppress.future', 'suppression_confirmed', 75, /\bwill not (be )?(re[- ]?(collect|acquire|add)|collect|store|sell|share)\b.*\b(again|in (the )?future|going forward)\b/i),
  r('suppress.retain.minimal', 'suppression_confirmed', 45, /\bretain(ing)? (only )?(the )?minim(um|al) .{0,40}\b(to (honou?r|ensure|prevent))\b/i),

  // --- broker holds nothing (NOT a deletion; ADR-0001 D2) -------------------
  r('nodata.norecord', 'no_data_held', 90, /\b(no|not any|did not (find|locate)|unable to (find|locate)|could not (find|locate))\b.{0,40}\b(record|match|data|information|profile|account)s?\b.{0,40}\b(found|exist|held|match|associated|on file|in our (system|database))?/i),
  r('nodata.donothold', 'no_data_held', 90, /\bwe do not (hold|have|maintain|possess|store)\b.{0,50}\b(any )?(personal )?(data|information|record)s?\b/i),
  r('nodata.notinsystem', 'no_data_held', 75, /\b(you are|your (details|information) (are|is)) not in our (system|database|records)\b/i),
  r('nodata.nomatch', 'no_data_held', 65, /\bno (matching|corresponding) (records?|profiles?|entries)\b/i),

  // --- identity verification demanded ---------------------------------------
  r('verify.needid', 'needs_verification', 90, /\b(we (require|need)|please (provide|submit|supply)|in order to (verify|process))\b.{0,80}\b(verify|verification|confirm) (your|the (consumer|data subject)'?s?) identity\b/i),
  r('verify.document', 'needs_verification', 80, /\b(government[- ]issued|photo)\s+(id|identification|identity document)\b/i),
  r('verify.copyofid', 'needs_verification', 75, /\b(copy of (your|a) (passport|driver'?s licen[cs]e|id)|proof of (identity|address))\b/i),
  r('verify.agent.proof', 'needs_verification', 85, /\b(signed (written )?)?(permission|authorisation|authorization|power of attorney|proof of authority)\b.{0,60}\b(from the (consumer|data subject|individual)|required|provide)\b/i),
  r('verify.directconsumer', 'needs_verification', 70, /\bthe (consumer|data subject|individual) must (contact us|submit the request) directly\b/i),
  r('verify.clickconfirm', 'needs_verification', 60, /\b(click|follow) the link (below )?to (confirm|verify)\b/i),

  // --- refusal ---------------------------------------------------------------
  r('refuse.denied', 'refused', 90, /\b(we (are unable to|cannot|will not|decline to|must decline)|your request (has been|is) (denied|rejected|refused))\b/i),
  r('refuse.exempt', 'refused', 75, /\b(exempt from|not subject to|outside the scope of)\b.{0,60}\b(ccpa|cpra|gdpr|the act|this (law|regulation)|deletion)\b/i),
  r('refuse.fcra', 'refused', 70, /\b(fair credit reporting act|fcra|gramm[- ]leach[- ]bliley|glba|hipaa)\b.{0,80}\b(exempt|does not (apply|permit)|precludes|we are required to retain)\b/i),
  r('refuse.manifestly', 'refused', 70, /\bmanifestly (unfounded|excessive)\b/i),
  r('refuse.notresident', 'refused', 65, /\b(only (applies to|available to)|must be a resident of)\b.{0,40}\b(california|residents?)\b/i),
  r('refuse.legalhold', 'refused', 60, /\b(legal (hold|obligation)|required (by law )?to retain|retention (period|obligation))\b.{0,60}\b(prevents|precludes|we cannot delete)\b/i),
  r('refuse.fee', 'refused', 50, /\b(a (reasonable )?fee (of|is) |payment is required)\b/i),

  // --- extension notified -----------------------------------------------------
  r('extend.notice', 'extension', 90, /\b(extend|extending|extension of)\b.{0,60}\b(response|deadline|period|time)\b/i),
  r('extend.additional', 'extension', 85, /\b(additional|further)\s+(45|90|30|60|two months|2 months)\b.{0,40}\b(days?|months?)\b/i),
  r('extend.complexity', 'extension', 55, /\b(complexity|number) of (the )?requests?\b.{0,60}\b(additional time|extend)\b/i),

  // --- plain acknowledgement --------------------------------------------------
  r('ack.received', 'acknowledgement', 55, /\b(we (have )?(received|acknowledge)|your request (has been|is) (received|logged|registered|in (our )?queue))\b/i),
  r('ack.within', 'acknowledgement', 40, /\bwe will (respond|reply|action|process)\b.{0,40}\bwithin\b/i),

  // --- partial compliance -----------------------------------------------------
  r('partial.some', 'partial', 75, /\b(partially (completed|fulfilled)|some (of (the|your) )?(data|records|information) (has|have) been (deleted|removed))\b/i),
  r('partial.except', 'partial', 65, /\b(deleted|removed)\b.{0,60}\b(except|with the exception of|other than|save for)\b/i),
  r('partial.optoutonly', 'partial', 70, /\b(opted you out|processed .{0,20}as an opt[- ]out)\b.{0,80}\b(but|however)\b.{0,60}\b(cannot|will not|unable to) delete\b/i),

  // --- vetoes: stop confident misreads --------------------------------------
  // Note: there is no "quoted text" veto here. Quoted history is removed by
  // stripQuoted() before any rule runs, which is both more reliable than a pattern
  // and testable on its own (see tests/classifier.test.ts).
  r('veto.future.tense', 'confirmed_deleted', -55, /\bwill be (deleted|removed|erased)\b/i, 'body',
    'A promise to delete is not a deletion. Downgrades to acknowledgement.'),
  r('veto.conditional', 'confirmed_deleted', -45, /\b(once|after|provided that|subject to)\b.{0,40}\b(you|we) (verify|confirm|receive)\b/i, 'body',
    'Deletion conditional on verification is needs_verification, not confirmed.'),
];

export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(RULES.map((x) => [x.id, x]));
