/**
 * Classify an inbound broker reply.
 *
 * Scores every rule, then applies precedence that reflects consequence rather than
 * score alone: it is safe to queue a confirmed deletion for review, and unsafe to
 * auto-close a request because a refusal happened to score slightly lower than an
 * acknowledgement that appeared in the same email.
 */
import type { Classification, InboundReply, ReplyClass } from '../types.ts';
import { RULES, type Rule } from './rules.ts';

/** Below this, a human looks at it. */
export const REVIEW_THRESHOLD = 0.55;

/**
 * Precedence when two classes both score well. Earlier wins.
 *
 * `bounce` first because a bounced letter was never read by anyone, so nothing else
 * in the body means what it appears to mean. `needs_verification`, `partial` and
 * `refused` outrank `confirmed_deleted` because the cost of wrongly closing a live
 * request is much higher than the cost of keeping a finished one open. `partial`
 * sits above `refused` because an email that complied in part is not a refusal.
 */
const PRECEDENCE: readonly ReplyClass[] = [
  'bounce',
  'needs_verification',
  'partial',
  'refused',
  'extension',
  'suppression_confirmed',
  'confirmed_deleted',
  'no_data_held',
  'auto_reply',
  'acknowledgement',
  'unclassified',
];

/**
 * Collapse runs of whitespace to a single space.
 *
 * Broker replies are hard-wrapped at 72-ish columns, so a phrase like "However we\n
 * cannot delete" straddles a newline. Every gap pattern in rules.ts uses `.{0,N}`,
 * and `.` does not match a newline -- without flattening, the most informative
 * multi-clause rules (partial compliance, conditional deletion) silently never fire.
 */
export function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function textFor(reply: InboundReply, scope: Rule['scope']): string {
  switch (scope) {
    case 'subject': return reply.subject;
    case 'from': return reply.fromAddress;
    case 'headers': return Object.entries(reply.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
    default: return flatten(reply.body);
  }
}

/**
 * Contradiction overrides.
 *
 * Scoring alone cannot settle an email that says two things at once -- and those are
 * exactly the emails that matter. "We deleted your data, but first verify your
 * identity" scores high for confirmation simply because confirmations use more
 * distinctive language. So a class listed here wins outright over the classes it
 * contradicts whenever it fires at all, regardless of margin.
 *
 * Direction is always towards keeping the request OPEN. The cost of leaving a
 * finished request open is a redundant follow-up; the cost of closing a live one is
 * abandoning somebody's legal right at the moment it needed action.
 */
const OVERRIDES: Partial<Record<ReplyClass, readonly ReplyClass[]>> = {
  // `partial` also overrides `refused`: "we opted you out but cannot delete X" is a
  // partial compliance, and recording it as a flat refusal would lose the half that
  // succeeded and misreport the broker's compliance grade.
  partial: ['confirmed_deleted', 'suppression_confirmed', 'no_data_held', 'acknowledgement', 'refused'],
  needs_verification: ['confirmed_deleted', 'suppression_confirmed', 'no_data_held', 'acknowledgement'],
  refused: ['confirmed_deleted', 'suppression_confirmed', 'no_data_held', 'acknowledgement'],
  extension: ['acknowledgement'],
  bounce: ['confirmed_deleted', 'suppression_confirmed', 'no_data_held', 'refused',
    'needs_verification', 'acknowledgement', 'auto_reply', 'partial', 'extension'],
};

/**
 * Strip quoted history before classifying. Our own letter is quoted back in most
 * replies and contains the words "delete", "erase" and "suppression list" -- without
 * this, almost everything classifies as a confirmation.
 */
export function stripQuoted(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^>+\s?/.test(line)) continue;
    if (/^\s*-{2,}\s*original message\s*-{2,}/i.test(line)) break;
    if (/^\s*on .{5,60}\bwrote:\s*$/i.test(line)) break;
    if (/^\s*from:\s.+@/i.test(line) && out.length > 2) break;
    if (/^_{10,}$/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

export interface ClassifierOptions {
  readonly reviewThreshold?: number;
  readonly rules?: readonly Rule[];
}

export function classifyReply(reply: InboundReply, opts: ClassifierOptions = {}): Classification {
  const rules = opts.rules ?? RULES;
  const threshold = opts.reviewThreshold ?? REVIEW_THRESHOLD;

  const visible: InboundReply = { ...reply, body: stripQuoted(reply.body) };

  const scores = new Map<ReplyClass, number>();
  const matched: string[] = [];

  for (const rule of rules) {
    const text = textFor(visible, rule.scope);
    if (!text) continue;
    if (!rule.pattern.test(text)) continue;
    matched.push(rule.id);
    scores.set(rule.cls, (scores.get(rule.cls) ?? 0) + rule.weight);
  }

  // A negated class with net <= 0 is not a candidate at all.
  const candidates = [...scores.entries()].filter(([, v]) => v > 0);

  if (candidates.length === 0) {
    return { class: 'unclassified', confidence: 0, matchedRules: matched, needsReview: true };
  }

  const best = Math.max(...candidates.map(([, v]) => v));
  // Anything within 25% of the top score competes on score alone...
  const band = candidates.filter(([, v]) => v >= best * 0.75).map(([c]) => c);
  // ...plus any class that contradicts something in the band, however faintly it scored.
  const overriders = candidates
    .map(([c]) => c)
    .filter((c) => (OVERRIDES[c] ?? []).some((target) => band.includes(target)));
  const contenders = [...new Set([...band, ...overriders])];
  const chosen = PRECEDENCE.find((c) => contenders.includes(c)) ?? contenders[0]!;
  const chosenScore = scores.get(chosen) ?? 0;

  // Confidence: how dominant the chosen class is, scaled by absolute evidence.
  // Dominance is measured against the classes the winner did NOT override: a
  // contradiction marker should not be penalised for the confirmation it overrules.
  const overridden = new Set(OVERRIDES[chosen] ?? []);
  const rivals = candidates.filter(([c]) => !overridden.has(c));
  const total = rivals.reduce((s, [, v]) => s + v, 0) || chosenScore;
  const dominance = chosenScore / total;
  const strength = Math.min(1, chosenScore / 90);
  const confidence = Number((dominance * 0.6 + strength * 0.4).toFixed(3));

  return {
    class: chosen,
    confidence,
    matchedRules: matched,
    needsReview: confidence < threshold || chosen === 'unclassified',
  };
}

/**
 * Map a classification onto a request outcome, or null when the request stays open.
 * `no_data_held` is deliberately its own outcome and never merged with deletion.
 */
export function outcomeFor(cls: ReplyClass): 'confirmed_deleted' | 'no_data_held' | 'refused' | 'undeliverable' | null {
  switch (cls) {
    case 'confirmed_deleted':
    case 'suppression_confirmed': return 'confirmed_deleted';
    case 'no_data_held': return 'no_data_held';
    case 'refused': return 'refused';
    case 'bounce': return 'undeliverable';
    default: return null;
  }
}

/** Does this reply class move the request to a non-terminal status? */
export function statusFor(cls: ReplyClass): 'acknowledged' | 'awaiting_verification' | 'extended' | null {
  switch (cls) {
    case 'acknowledgement':
    case 'auto_reply': return 'acknowledged';
    case 'needs_verification': return 'awaiting_verification';
    case 'extension': return 'extended';
    case 'partial': return 'acknowledged';
    default: return null;
  }
}
