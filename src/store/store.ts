/**
 * Encrypted store, on node:sqlite (no native dependency).
 *
 * Everything that is personal data is sealed with AES-256-GCM before it reaches a
 * column, with the AAD bound to `<table>:<column>:<row id>` so a ciphertext cannot
 * be moved between rows (ADR-0001 D7). Columns that are not personal data -- broker
 * ids, statuses, timestamps, hashes -- stay plain so the thing is still queryable.
 *
 * Deletion is real: `deleteSubject` removes the rows, not a flag.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ConsentRecord, CustomRemovalRequest, InboundReply, Observation,
  RemovalRequest, RequestEvent, Subject, Account,
} from '../types.ts';
import { type Keyring, openJson, sealJson } from '../crypto/envelope.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, owner_subject_id TEXT NOT NULL, plan TEXT NOT NULL,
  max_subjects INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, residence TEXT NOT NULL,
  identifiers_sealed TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, record_sealed TEXT NOT NULL,
  granted_at TEXT NOT NULL, revoked_at TEXT, entry_hash TEXT NOT NULL, seq INTEGER
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, broker_id TEXT NOT NULL,
  instrument TEXT NOT NULL, supporting TEXT NOT NULL, rights TEXT NOT NULL,
  status TEXT NOT NULL, outcome TEXT,
  created_at TEXT NOT NULL, sent_at TEXT, due_at TEXT, extended_due_at TEXT,
  closed_at TEXT, next_action_at TEXT, follow_up_count INTEGER NOT NULL DEFAULT 0,
  body_hash TEXT NOT NULL, observation_id TEXT, thread_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_requests_subject ON requests(subject_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
-- seq is an insertion counter. Several events legitimately share a timestamp
-- (a reply is received, classified and acted on in the same transaction), and
-- ordering the evidence pack by timestamp alone would shuffle them arbitrarily.
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL, at TEXT NOT NULL,
  kind TEXT NOT NULL, detail TEXT NOT NULL, evidence_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id);
CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY, thread_key TEXT, from_domain TEXT NOT NULL,
  received_at TEXT NOT NULL, reply_sealed TEXT NOT NULL,
  class TEXT, confidence REAL, needs_review INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, broker_id TEXT NOT NULL,
  observed_at TEXT NOT NULL, present INTEGER NOT NULL, sealed TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_removals (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, kind TEXT NOT NULL,
  eligible INTEGER NOT NULL, routed_to TEXT NOT NULL, broker_id TEXT,
  submitted_at TEXT NOT NULL, sealed TEXT NOT NULL
);
-- Invitations are persisted so that accepting one can actually be verified. They
-- were previously held only by the caller, which let the CLI synthesise an invite
-- from the very token it was checking -- a tautology, not a check.
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS letters (
  request_id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, sealed TEXT NOT NULL,
  rendered_at TEXT NOT NULL
);
`;

export class Store {
  readonly #db: DatabaseSync;
  readonly #kr: Keyring;

  constructor(path: string, keyring: Keyring) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.#db.exec(SCHEMA);
    this.#kr = keyring;
  }

  close(): void { this.#db.close(); }
  get raw(): DatabaseSync { return this.#db; }

  #aad(table: string, column: string, id: string): string { return `${table}:${column}:${id}`; }

  // --- accounts & subjects -------------------------------------------------
  putAccount(a: Account): void {
    this.#db.prepare(
      `INSERT OR REPLACE INTO accounts (id, owner_subject_id, plan, max_subjects, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(a.id, a.ownerSubjectId, a.plan, a.maxSubjects, a.createdAt);
  }

  getAccount(id: string): Account | null {
    const r = this.#db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Record<string, string | number> | undefined;
    if (!r) return null;
    return {
      id: String(r['id']), ownerSubjectId: String(r['owner_subject_id']),
      plan: String(r['plan']) as Account['plan'], maxSubjects: Number(r['max_subjects']),
      createdAt: String(r['created_at']),
    };
  }

  putSubject(s: Subject): void {
    const sealed = sealJson(this.#kr, s.identifiers, this.#aad('subjects', 'identifiers', s.id));
    this.#db.prepare(
      `INSERT OR REPLACE INTO subjects (id, account_id, residence, identifiers_sealed, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(s.id, s.accountId, s.residence, sealed, s.createdAt);
  }

  getSubject(id: string): Subject | null {
    const r = this.#db.prepare('SELECT * FROM subjects WHERE id = ?').get(id) as Record<string, string> | undefined;
    if (!r) return null;
    return {
      id: r['id']!, accountId: r['account_id']!, residence: r['residence']!,
      identifiers: openJson(this.#kr, r['identifiers_sealed']!, this.#aad('subjects', 'identifiers', id)),
      createdAt: r['created_at']!,
    };
  }

  subjectsForAccount(accountId: string): Subject[] {
    const rows = this.#db.prepare('SELECT id FROM subjects WHERE account_id = ? ORDER BY created_at')
      .all(accountId) as { id: string }[];
    return rows.map((r) => this.getSubject(r.id)).filter((s): s is Subject => s !== null);
  }

  // --- consent --------------------------------------------------------------
  putConsent(c: ConsentRecord): void {
    const sealed = sealJson(this.#kr, c, this.#aad('consents', 'record', c.id));
    // Keep an existing row's position. Recomputing it as COUNT(*) on every write
    // meant re-saving an earlier record -- which revokeConsent does, same id, via
    // INSERT OR REPLACE -- pushed it past later entries, so consentChain() returned
    // them out of order and the evidence pack reported the authorisation chain as
    // INVALID for any subject with more than one record.
    const existing = this.#db.prepare('SELECT seq FROM consents WHERE id = ?')
      .get(c.id) as { seq: number } | undefined;
    const seq = existing?.seq ?? (this.#db.prepare(
      'SELECT COUNT(*) n FROM consents WHERE subject_id = ?',
    ).get(c.subjectId) as { n: number }).n;
    this.#db.prepare(
      `INSERT OR REPLACE INTO consents (id, subject_id, record_sealed, granted_at, revoked_at, entry_hash, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(c.id, c.subjectId, sealed, c.grantedAt, c.revokedAt, c.entryHash, seq);
  }

  /**
   * The live consent for a subject, or null.
   *
   * The chain is append-only, and a revocation is an appended entry rather than an
   * edit, so the answer is simply "the last entry, unless it is a revocation".
   * Filtering on `revoked_at IS NULL` would return the superseded grant that sits
   * behind a revocation and hand a caller an authorisation the subject withdrew.
   */
  getConsent(subjectId: string): ConsentRecord | null {
    const r = this.#db.prepare(
      'SELECT id, record_sealed, revoked_at FROM consents WHERE subject_id = ? ORDER BY seq DESC LIMIT 1',
    ).get(subjectId) as { id: string; record_sealed: string; revoked_at: string | null } | undefined;
    if (!r || r.revoked_at) return null;
    return openJson(this.#kr, r.record_sealed, this.#aad('consents', 'record', r.id));
  }

  /** The `entryHash` of the last entry, to chain the next one onto. */
  consentChainHead(subjectId: string): string | null {
    const r = this.#db.prepare(
      'SELECT entry_hash FROM consents WHERE subject_id = ? ORDER BY seq DESC LIMIT 1',
    ).get(subjectId) as { entry_hash: string } | undefined;
    return r?.entry_hash ?? null;
  }

  consentChain(subjectId: string): ConsentRecord[] {
    const rows = this.#db.prepare(
      'SELECT id, record_sealed FROM consents WHERE subject_id = ? ORDER BY seq',
    ).all(subjectId) as { id: string; record_sealed: string }[];
    return rows.map((r) => openJson<ConsentRecord>(this.#kr, r.record_sealed, this.#aad('consents', 'record', r.id)));
  }

  // --- requests --------------------------------------------------------------
  putRequest(r: RemovalRequest): void {
    this.#db.prepare(
      `INSERT OR REPLACE INTO requests
       (id, subject_id, broker_id, instrument, supporting, rights, status, outcome,
        created_at, sent_at, due_at, extended_due_at, closed_at, next_action_at,
        follow_up_count, body_hash, observation_id, thread_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      r.id, r.subjectId, r.brokerId, r.instrument, JSON.stringify(r.supportingInstruments),
      JSON.stringify(r.rights), r.status, r.outcome, r.createdAt, r.sentAt, r.dueAt,
      r.extendedDueAt, r.closedAt, r.nextActionAt, r.followUpCount, r.bodyHash,
      r.observationId, r.threadKey,
    );
  }

  #toRequest(r: Record<string, string | number | null>): RemovalRequest {
    return {
      id: String(r['id']), subjectId: String(r['subject_id']), brokerId: String(r['broker_id']),
      instrument: String(r['instrument']) as RemovalRequest['instrument'],
      supportingInstruments: JSON.parse(String(r['supporting'])),
      rights: JSON.parse(String(r['rights'])),
      status: String(r['status']) as RemovalRequest['status'],
      outcome: (r['outcome'] as RemovalRequest['outcome']) ?? null,
      createdAt: String(r['created_at']),
      sentAt: (r['sent_at'] as string) ?? null,
      dueAt: (r['due_at'] as string) ?? null,
      extendedDueAt: (r['extended_due_at'] as string) ?? null,
      closedAt: (r['closed_at'] as string) ?? null,
      nextActionAt: (r['next_action_at'] as string) ?? null,
      followUpCount: Number(r['follow_up_count']),
      bodyHash: String(r['body_hash']),
      observationId: (r['observation_id'] as string) ?? null,
      threadKey: String(r['thread_key']),
    };
  }

  getRequest(id: string): RemovalRequest | null {
    const r = this.#db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as Record<string, string> | undefined;
    return r ? this.#toRequest(r) : null;
  }

  getRequestByThread(threadKey: string): RemovalRequest | null {
    const r = this.#db.prepare('SELECT * FROM requests WHERE thread_key = ?').get(threadKey) as Record<string, string> | undefined;
    return r ? this.#toRequest(r) : null;
  }

  requestsForSubject(subjectId: string): RemovalRequest[] {
    const rows = this.#db.prepare('SELECT * FROM requests WHERE subject_id = ? ORDER BY created_at')
      .all(subjectId) as Record<string, string>[];
    return rows.map((r) => this.#toRequest(r));
  }

  openRequests(): RemovalRequest[] {
    const rows = this.#db.prepare(
      `SELECT * FROM requests WHERE status NOT IN ('closed') OR next_action_at IS NOT NULL`,
    ).all() as Record<string, string>[];
    return rows.map((r) => this.#toRequest(r));
  }

  // --- letters (sealed: they contain the subject's identifiers) -------------
  putLetter(requestId: string, bodyHash: string, body: string, renderedAt: string): void {
    this.#db.prepare(
      'INSERT OR REPLACE INTO letters (request_id, body_hash, sealed, rendered_at) VALUES (?,?,?,?)',
    ).run(requestId, bodyHash, sealJson(this.#kr, body, this.#aad('letters', 'body', requestId)), renderedAt);
  }

  getLetter(requestId: string): string | null {
    const r = this.#db.prepare('SELECT sealed FROM letters WHERE request_id = ?').get(requestId) as { sealed: string } | undefined;
    return r ? openJson<string>(this.#kr, r.sealed, this.#aad('letters', 'body', requestId)) : null;
  }

  // --- events ---------------------------------------------------------------
  putEvent(e: RequestEvent): void {
    this.#db.prepare(
      'INSERT OR REPLACE INTO events (id, request_id, at, kind, detail, evidence_hash) VALUES (?,?,?,?,?,?)',
    ).run(e.id, e.requestId, e.at, e.kind, e.detail, e.evidenceHash);
  }

  eventsFor(requestId: string): RequestEvent[] {
    return (this.#db.prepare('SELECT * FROM events WHERE request_id = ? ORDER BY seq')
      .all(requestId) as Record<string, string>[]).map((r) => ({
      id: r['id']!, requestId: r['request_id']!, at: r['at']!,
      kind: r['kind'] as RequestEvent['kind'], detail: r['detail']!,
      evidenceHash: (r['evidence_hash'] as string) ?? null,
    }));
  }

  // --- replies ---------------------------------------------------------------
  putReply(reply: InboundReply, cls: { class: string; confidence: number; needsReview: boolean } | null): void {
    const domain = reply.fromAddress.split('@')[1] ?? 'unknown';
    this.#db.prepare(
      `INSERT OR REPLACE INTO replies (id, thread_key, from_domain, received_at, reply_sealed, class, confidence, needs_review)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      reply.id, reply.threadKey, domain, reply.receivedAt,
      sealJson(this.#kr, reply, this.#aad('replies', 'reply', reply.id)),
      cls?.class ?? null, cls?.confidence ?? null, cls?.needsReview ? 1 : 0,
    );
  }

  getReply(id: string): InboundReply | null {
    const r = this.#db.prepare('SELECT reply_sealed FROM replies WHERE id = ?').get(id) as { reply_sealed: string } | undefined;
    return r ? openJson(this.#kr, r.reply_sealed, this.#aad('replies', 'reply', id)) : null;
  }

  repliesNeedingReview(): { id: string; class: string | null; confidence: number | null; fromDomain: string }[] {
    return (this.#db.prepare(
      'SELECT id, class, confidence, from_domain FROM replies WHERE needs_review = 1 ORDER BY received_at',
    ).all() as Record<string, string | number | null>[]).map((r) => ({
      id: String(r['id']), class: (r['class'] as string) ?? null,
      confidence: (r['confidence'] as number) ?? null, fromDomain: String(r['from_domain']),
    }));
  }

  // --- observations & custom removals ---------------------------------------
  putObservation(o: Observation): void {
    this.#db.prepare(
      'INSERT OR REPLACE INTO observations (id, subject_id, broker_id, observed_at, present, sealed) VALUES (?,?,?,?,?,?)',
    ).run(o.id, o.subjectId, o.brokerId, o.observedAt, o.present ? 1 : 0,
      sealJson(this.#kr, o, this.#aad('observations', 'o', o.id)));
  }

  observationsFor(subjectId: string): Observation[] {
    return (this.#db.prepare('SELECT id, sealed FROM observations WHERE subject_id = ?')
      .all(subjectId) as { id: string; sealed: string }[])
      .map((r) => openJson<Observation>(this.#kr, r.sealed, this.#aad('observations', 'o', r.id)));
  }

  putCustomRemoval(c: CustomRemovalRequest): void {
    this.#db.prepare(
      `INSERT OR REPLACE INTO custom_removals (id, subject_id, kind, eligible, routed_to, broker_id, submitted_at, sealed)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(c.id, c.subjectId, c.kind, c.eligible ? 1 : 0, c.routedTo, c.brokerId, c.submittedAt,
      sealJson(this.#kr, c, this.#aad('custom_removals', 'c', c.id)));
  }

  customRemovalsFor(subjectId: string): CustomRemovalRequest[] {
    return (this.#db.prepare('SELECT id, sealed FROM custom_removals WHERE subject_id = ? ORDER BY submitted_at')
      .all(subjectId) as { id: string; sealed: string }[])
      .map((r) => openJson<CustomRemovalRequest>(this.#kr, r.sealed, this.#aad('custom_removals', 'c', r.id)));
  }

  // --- invitations -----------------------------------------------------------
  putInvite(inv: { id: string; accountId: string; tokenHash: string; createdAt: string; expiresAt: string }): void {
    this.#db.prepare(
      `INSERT OR REPLACE INTO invites (id, account_id, token_hash, created_at, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(inv.id, inv.accountId, inv.tokenHash, inv.createdAt, inv.expiresAt);
  }

  /** Looked up by hash, so the raw token is never stored and never logged. */
  getInviteByTokenHash(tokenHash: string): {
    id: string; accountId: string; tokenHash: string; expiresAt: string; usedAt: string | null;
  } | null {
    const r = this.#db.prepare('SELECT * FROM invites WHERE token_hash = ?')
      .get(tokenHash) as Record<string, string | null> | undefined;
    if (!r) return null;
    return {
      id: String(r['id']), accountId: String(r['account_id']),
      tokenHash: String(r['token_hash']), expiresAt: String(r['expires_at']),
      usedAt: (r['used_at'] as string) ?? null,
    };
  }

  markInviteUsed(id: string, at: string): void {
    this.#db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').run(at, id);
  }

  // --- retention --------------------------------------------------------------
  /**
   * Delete inbound replies that could never be attributed to a request.
   *
   * `deleteSubject` cannot reach these: an unattributed reply has no thread key, so
   * by construction we do not know whose it is, and deleting every orphan when one
   * subject erases would destroy another subject's evidence. They are therefore
   * governed by a retention period instead -- which is the honest answer, because
   * holding a sealed email body indefinitely on the chance a human attributes it is
   * not a purpose we could defend.
   *
   * Run from the scheduler tick.
   */
  purgeUnattributedReplies(now: Date, retentionDays = 90): number {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
    const info = this.#db.prepare(
      'DELETE FROM replies WHERE thread_key IS NULL AND received_at < ?',
    ).run(cutoff);
    return Number(info.changes);
  }

  // --- erasure of our own records -------------------------------------------
  /**
   * Make deletion easy, and make it real. Removes every row that could identify
   * the subject. Request *metadata* is kept only as an anonymous aggregate for
   * broker compliance scoring -- which is why the counters are copied out first.
   */
  deleteSubject(subjectId: string): { deleted: Record<string, number> } {
    const counts: Record<string, number> = {};
    const run = (sql: string, ...args: (string | number)[]) => {
      const info = this.#db.prepare(sql).run(...args);
      return Number(info.changes);
    };
    const reqIds = (this.#db.prepare('SELECT id, thread_key FROM requests WHERE subject_id = ?')
      .all(subjectId) as { id: string; thread_key: string }[]);
    for (const { id, thread_key } of reqIds) {
      counts['events'] = (counts['events'] ?? 0) + run('DELETE FROM events WHERE request_id = ?', id);
      counts['letters'] = (counts['letters'] ?? 0) + run('DELETE FROM letters WHERE request_id = ?', id);
      counts['replies'] = (counts['replies'] ?? 0) + run('DELETE FROM replies WHERE thread_key = ?', thread_key);
    }
    counts['requests'] = run('DELETE FROM requests WHERE subject_id = ?', subjectId);
    counts['observations'] = run('DELETE FROM observations WHERE subject_id = ?', subjectId);
    counts['custom_removals'] = run('DELETE FROM custom_removals WHERE subject_id = ?', subjectId);
    counts['consents'] = run('DELETE FROM consents WHERE subject_id = ?', subjectId);
    counts['subjects'] = run('DELETE FROM subjects WHERE id = ?', subjectId);
    return { deleted: counts };
  }
}
