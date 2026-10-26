/**
 * Exportable evidence pack.
 *
 * The thing the category does not have (dossier §3.2): a reproducible, verifiable
 * record a person can hand to a regulator, a lawyer, or a journalist. Every letter
 * is stored with its sha256; the pack reproduces the letter and the digest so a
 * third party can confirm the text was not edited after the fact, and a manifest
 * digest covers the whole pack.
 */
import type { Broker, RemovalRequest, RequestEvent, Subject } from '../types.ts';
import { EVIDENCE_RANK } from '../types.ts';
import type { Store } from '../store/store.ts';
import type { BrokerRegistry } from '../brokers/registry.ts';
import { instrument } from '../legal/jurisdictions.ts';
import { verifyConsentChain } from '../consent/consent.ts';
import { hashObject, sha256 } from '../util/ids.ts';

export interface EvidenceItem {
  readonly requestId: string;
  readonly broker: { id: string; name: string; category: string; contact: string | null };
  readonly instrument: { id: string; name: string; deadlineCitation: string };
  readonly sentAt: string | null;
  readonly dueAt: string | null;
  readonly outcome: string | null;
  readonly evidenceRank: number | null;
  readonly letter: { sha256: string; verified: boolean; body: string } | null;
  readonly events: readonly { at: string; kind: string; detail: string; evidenceHash: string | null }[];
}

export interface EvidencePack {
  readonly generatedAt: string;
  readonly subject: { id: string; residence: string; name: string };
  readonly consent: {
    chainValid: boolean;
    entries: readonly { id: string; grantedAt: string; expiresAt: string; revokedAt: string | null;
      scopes: readonly string[]; documentHash: string; entryHash: string }[];
  };
  readonly items: readonly EvidenceItem[];
  readonly summary: Record<string, number>;
  readonly notes: readonly string[];
  readonly manifestSha256: string;
}

export function buildEvidencePack(
  store: Store, registry: BrokerRegistry, subject: Subject, now: Date,
): EvidencePack {
  const requests = store.requestsForSubject(subject.id);
  const chain = store.consentChain(subject.id);

  const items: EvidenceItem[] = requests.map((r) => {
    const broker = registry.get(r.brokerId);
    const body = store.getLetter(r.id);
    return {
      requestId: r.id,
      broker: {
        id: r.brokerId,
        name: broker?.name ?? r.brokerId,
        category: broker?.category ?? 'unknown',
        contact: broker?.legalContact.email ?? broker?.legalContact.privacyPortal ?? null,
      },
      instrument: {
        id: r.instrument,
        name: instrument(r.instrument).name,
        deadlineCitation: instrument(r.instrument).citations['deadline'] ?? '',
      },
      sentAt: r.sentAt,
      dueAt: r.extendedDueAt ?? r.dueAt,
      outcome: r.outcome,
      evidenceRank: r.outcome ? EVIDENCE_RANK[r.outcome] : null,
      letter: body ? { sha256: r.bodyHash, verified: sha256(body) === r.bodyHash, body } : null,
      events: store.eventsFor(r.id).map((e: RequestEvent) => ({
        at: e.at, kind: e.kind, detail: e.detail, evidenceHash: e.evidenceHash,
      })),
    };
  });

  const summary: Record<string, number> = {};
  for (const r of requests) summary[r.outcome ?? 'open'] = (summary[r.outcome ?? 'open'] ?? 0) + 1;

  const notes = [
    'Outcomes are reported separately by evidence rank and are deliberately never summed.',
    'Rank 3 (broker held no data) is NOT a deletion. It means the broker stated it held nothing.',
    'Each letter is reproduced with the sha256 recorded when it was sent; "verified: true" ' +
    'means the stored text still hashes to that value.',
    'Request templates in this build are DRAFT and have not been reviewed by a qualified lawyer.',
  ];

  const core = {
    generatedAt: now.toISOString(),
    subject: { id: subject.id, residence: subject.residence, name: subject.identifiers.fullName },
    consent: {
      chainValid: verifyConsentChain(chain),
      entries: chain.map((c) => ({
        id: c.id, grantedAt: c.grantedAt, expiresAt: c.expiresAt, revokedAt: c.revokedAt,
        scopes: c.scopes, documentHash: c.documentHash, entryHash: c.entryHash,
      })),
    },
    items,
    summary,
    notes,
  };

  return { ...core, manifestSha256: hashObject(core) };
}

/** Human-readable rendering of the pack, for printing or attaching to a complaint. */
export function renderEvidencePack(pack: EvidencePack): string {
  const L: string[] = [];
  L.push('DELETEWE EVIDENCE PACK');
  L.push('='.repeat(72));
  L.push(`Generated:     ${pack.generatedAt}`);
  L.push(`Data subject:  ${pack.subject.name} (${pack.subject.residence})`);
  L.push(`Manifest hash: ${pack.manifestSha256}`);
  L.push('');
  L.push(`AUTHORISATION — chain ${pack.consent.chainValid ? 'VALID' : 'INVALID'}`);
  for (const c of pack.consent.entries) {
    L.push(`  ${c.grantedAt.slice(0, 10)}  scopes=${c.scopes.join('|')}  doc=${c.documentHash.slice(0, 16)}  ${c.revokedAt ? `REVOKED ${c.revokedAt.slice(0, 10)}` : `expires ${c.expiresAt.slice(0, 10)}`}`);
  }
  L.push('');
  L.push('OUTCOMES (never summed — see notes)');
  for (const [k, v] of Object.entries(pack.summary)) L.push(`  ${k.padEnd(24)} ${v}`);
  L.push('');
  for (const item of pack.items) {
    L.push('-'.repeat(72));
    L.push(`${item.broker.name}  [${item.broker.category}]  ref ${item.requestId}`);
    L.push(`  Instrument: ${item.instrument.name}`);
    L.push(`  Sent:       ${item.sentAt ?? '—'}    Due: ${item.dueAt ?? '—'}`);
    L.push(`  Outcome:    ${item.outcome ?? 'open'}${item.evidenceRank ? ` (evidence rank ${item.evidenceRank})` : ''}`);
    if (item.letter) L.push(`  Letter:     sha256 ${item.letter.sha256} — integrity ${item.letter.verified ? 'OK' : 'FAILED'}`);
    for (const e of item.events) L.push(`    ${e.at.slice(0, 16).replace('T', ' ')}  ${e.kind.padEnd(22)} ${e.detail}`);
  }
  L.push('');
  L.push('NOTES');
  for (const n of pack.notes) L.push(`  - ${n}`);
  return L.join('\n') + '\n';
}
