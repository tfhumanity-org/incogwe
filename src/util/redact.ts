/**
 * The boundary that keeps personal data out of logs.
 *
 * Nothing in this codebase logs a Subject, SubjectIdentifiers, an InboundReply body,
 * or a rendered letter. Those go through `redact()` first, which replaces values with
 * a stable, salted, truncated digest so that two log lines about the same person can
 * still be correlated during debugging without the log revealing who they are.
 */
import { createHmac, randomBytes } from 'node:crypto';

/** Per-process salt: correlation works within a process, not across logs or restarts. */
const SESSION_SALT = randomBytes(16);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * A phone-like run of digits.
 *
 * The lookarounds are load-bearing. Without them this matches digit runs *inside*
 * opaque identifiers -- `reply_518b761b2847391c` contains eight consecutive digits --
 * and rewrites them mid-token, producing `reply_518b761bphone:e5121b6d`. That is
 * worse than useless: the identifier in the log no longer matches the one in the
 * database, so the correlation this module exists to preserve is destroyed, and the
 * mangling is silent. A real phone number is never flanked by letters or by an
 * underscore, so requiring a non-alphanumeric boundary costs nothing and stops it.
 */
const PHONE_RE =
  /(?<![A-Za-z0-9_])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?(?![A-Za-z0-9_])/g;

const DOB_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;

/**
 * Opaque identifiers we mint ourselves (`req_`, `subj_`, `thr_`, `reply_`, ...).
 * They carry no personal data, and they are the primary debugging handle, so they
 * are passed through untouched rather than risking a partial match inside them.
 */
const OPAQUE_ID_RE = /^[a-z][a-z0-9]*_[A-Za-z0-9-]{6,}$/;

/** Stable pseudonym for a value, e.g. `pii:9f2a41c8`. */
export function pseudonym(value: string, kind = 'pii'): string {
  const d = createHmac('sha256', SESSION_SALT).update(value.toLowerCase().trim()).digest('hex');
  return `${kind}:${d.slice(0, 8)}`;
}

/** Scrub free text of the obvious direct identifiers. Defence in depth, not the primary control. */
export function scrub(text: string): string {
  if (OPAQUE_ID_RE.test(text)) return text;
  return text
    .replace(EMAIL_RE, (m) => pseudonym(m, 'email'))
    .replace(DOB_RE, (m) => pseudonym(m, 'date'))
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 7 ? pseudonym(m, 'phone') : m));
}

const SENSITIVE_KEYS = new Set([
  'fullname', 'name', 'signaturename', 'emails', 'email', 'fromaddress', 'toaddress',
  'locality', 'streetaddresses', 'street', 'address', 'phones', 'phone',
  'dateofbirth', 'dob', 'aliases', 'identifiers', 'body', 'subject', 'text', 'html',
]);

/**
 * Produce a log-safe projection of any value. Keys known to carry personal data are
 * replaced by a pseudonym of their content; everything else is kept for debuggability.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (value == null) return value;
  if (typeof value === 'string') return scrub(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = typeof v === 'string' ? pseudonym(v, k) : `[redacted:${Array.isArray(v) ? v.length : 1}]`;
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return '[unserialisable]';
}
