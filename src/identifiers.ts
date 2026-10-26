/**
 * Validation for a subject's identifiers.
 *
 * Why this exists. These values are not form data -- they are rendered verbatim into
 * a legal letter sent to a real company in a real person's name. A profile created
 * with a placeholder produces a letter that says `Full name: ...`, which is noise in
 * a statutory channel, wastes a broker's compliance team's time, and makes every
 * subsequent request from the same sender easier to ignore. Garbage in is not a
 * cosmetic problem here.
 *
 * Two gates, deliberately:
 *   - `validateIdentifiers` runs at ingest (CLI, invitation acceptance), so the
 *     person gets a clear error at the moment they can fix it;
 *   - `assertValidIdentifiers` runs inside `composeLetter`, the narrowest waist a
 *     letter must pass through, so no code path can route around it.
 */
import type { SubjectIdentifiers } from './types.ts';

export class InvalidIdentifiersError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid subject identifiers:\n  - ${problems.join('\n  - ')}`);
    this.problems = problems;
  }
}

/** Deliberately permissive: we reject what is clearly not an address, not what is unusual. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Values people type to get past a required field. Matching here is a courtesy, not
 * a security control -- someone determined to enter nonsense can, and the letter they
 * get is their own. The point is to catch the copy-pasted placeholder.
 */
const PLACEHOLDERS = new Set([
  '...', '..', '.', '-', '--', 'n/a', 'na', 'none', 'null', 'undefined', 'test',
  'testing', 'test test', 'tbd', 'todo', 'xxx', 'xx', 'asdf', 'foo', 'bar',
  'string', 'name', 'your name', 'full name', 'firstname lastname', 'john doe',
  'jane doe', 'example', 'placeholder',
]);

function isPlaceholder(v: string): boolean {
  const n = v.trim().toLowerCase();
  if (PLACEHOLDERS.has(n)) return true;
  // All punctuation: "...", "____". Unicode-aware -- an ASCII class here would
  // classify every Japanese, Chinese, Korean, Arabic and Hebrew name as a placeholder.
  if (!/[\p{L}\p{N}]/u.test(n)) return true;
  // A single character repeated: "aaaa", "....".
  if (n.length >= 3 && new Set(n.replace(/\s/gu, '')).size === 1) return true;
  return false;
}

function hasLetter(v: string): boolean {
  // Unicode-aware: names are not ASCII.
  return /\p{L}/u.test(v);
}

export interface ValidateOptions {
  /** Supply to enforce the adult requirement when a date of birth is present. */
  readonly now?: Date;
  /** Minimum age. The authorisation text the subject signs asserts they are an adult. */
  readonly minimumAge?: number;
}

export const MINIMUM_AGE = 18;

/** Returns the problems found. Empty means valid. */
export function validateIdentifiers(
  ids: SubjectIdentifiers,
  opts: ValidateOptions = {},
): string[] {
  const problems: string[] = [];

  // --- name -----------------------------------------------------------------
  const name = (ids.fullName ?? '').trim();
  if (name.length < 2) problems.push('fullName: must be at least 2 characters');
  else if (isPlaceholder(name)) problems.push(`fullName: "${name}" looks like a placeholder, not a name`);
  else if (!hasLetter(name)) problems.push('fullName: must contain at least one letter');

  // --- emails ---------------------------------------------------------------
  // At least one is required: it is the minimum identifier a broker can match on,
  // and it is the floor our minimum-PII policy already assumes (ADR-0001 D7).
  const emails = ids.emails ?? [];
  if (emails.length === 0) problems.push('emails: at least one email address is required');
  for (const e of emails) {
    const v = e.trim();
    if (!EMAIL_RE.test(v)) problems.push(`emails: "${e}" is not a valid email address`);
  }

  // --- locality -------------------------------------------------------------
  const locality = (ids.locality ?? '').trim();
  if (locality.length < 2) problems.push('locality: must be at least 2 characters');
  else if (isPlaceholder(locality)) problems.push(`locality: "${locality}" looks like a placeholder`);
  else if (!hasLetter(locality)) problems.push('locality: must contain at least one letter');

  // --- optional fields, validated only when supplied ------------------------
  for (const a of ids.streetAddresses ?? []) {
    const v = a.trim();
    if (v.length < 5 || !hasLetter(v)) problems.push(`streetAddresses: "${a}" is too short to be an address`);
    else if (isPlaceholder(v)) problems.push(`streetAddresses: "${a}" looks like a placeholder`);
  }

  for (const p of ids.phones ?? []) {
    const digits = p.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      problems.push(`phones: "${p}" does not look like a phone number (expected 7-15 digits)`);
    }
  }

  for (const a of ids.aliases ?? []) {
    const v = a.trim();
    if (v.length < 2 || !hasLetter(v) || isPlaceholder(v)) {
      problems.push(`aliases: "${a}" is not a usable name`);
    }
  }

  if (ids.dateOfBirth !== undefined) {
    problems.push(...validateDateOfBirth(ids.dateOfBirth, opts));
  }

  return problems;
}

function validateDateOfBirth(dob: string, opts: ValidateOptions): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return [`dateOfBirth: "${dob}" must be in YYYY-MM-DD form`];
  }
  const d = new Date(`${dob}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dob) {
    return [`dateOfBirth: "${dob}" is not a real date`];
  }
  const now = opts.now;
  if (!now) return [];

  if (d.getTime() > now.getTime()) return [`dateOfBirth: "${dob}" is in the future`];

  const age = ageOn(d, now);
  if (age > 120) return [`dateOfBirth: "${dob}" implies an age over 120`];

  const min = opts.minimumAge ?? MINIMUM_AGE;
  if (age < min) {
    // Not a validation nicety. The authorisation the subject signs asserts they are
    // an adult acting for themselves, and an agent cannot be authorised by a child.
    return [
      `dateOfBirth: implies an age of ${age}. deletewe acts only for adults (${min}+), ` +
      'because the authorisation it relies on must be given by the data subject themselves.',
    ];
  }
  return [];
}

export function ageOn(birth: Date, now: Date): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Throws `InvalidIdentifiersError` unless the identifiers are usable in a letter. */
export function assertValidIdentifiers(
  ids: SubjectIdentifiers,
  opts: ValidateOptions = {},
): void {
  const problems = validateIdentifiers(ids, opts);
  if (problems.length > 0) throw new InvalidIdentifiersError(problems);
}
