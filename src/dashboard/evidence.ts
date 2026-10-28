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

/**
 * Print-ready HTML rendering of the pack.
 *
 * A regulator, a lawyer or a journalist wants a document, not a JSON file. This is
 * HTML rather than PDF deliberately: generating a real PDF means a dependency and a
 * font stack, and any browser prints this to PDF with the page breaks already set.
 * The content is identical to the text rendering -- same four outcomes, same ranks,
 * same digests -- so neither format can quietly say something the other does not.
 */
export function renderEvidencePackHtml(pack: EvidencePack): string {
  const esc = (v: unknown) => String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const RANK_LABEL: Record<number, string> = {
    1: 'Rank 1 — independently re-observed as absent',
    2: 'Rank 2 — the broker stated in writing that it deleted',
    3: 'Rank 3 — the broker stated it held nothing. NOT a deletion.',
    4: 'Rank 4 — refused, or the statutory deadline passed unanswered',
    5: 'Rank 5 — the letter never arrived',
  };

  const items = pack.items.map((i) => `
    <section class="item">
      <h3>${esc(i.broker.name)} <span class="cat">${esc(i.broker.category)}</span></h3>
      <dl>
        <dt>Reference</dt><dd class="mono">${esc(i.requestId)}</dd>
        <dt>Instrument</dt><dd>${esc(i.instrument.name)}</dd>
        <dt>Contact</dt><dd>${esc(i.broker.contact ?? '—')}</dd>
        <dt>Sent</dt><dd>${esc(i.sentAt ?? '—')}</dd>
        <dt>Deadline</dt><dd>${esc(i.dueAt ?? '—')} <span class="muted">${esc(i.instrument.deadlineCitation)}</span></dd>
        <dt>Outcome</dt><dd><strong>${esc(i.outcome ?? 'open')}</strong>${
          i.evidenceRank ? ` <span class="muted">${esc(RANK_LABEL[i.evidenceRank] ?? '')}</span>` : ''
        }</dd>
        ${i.letter ? `<dt>Letter digest</dt><dd class="mono">${esc(i.letter.sha256)}
          <span class="${i.letter.verified ? 'ok' : 'bad'}">integrity ${i.letter.verified ? 'OK' : 'FAILED'}</span></dd>` : ''}
      </dl>
      <table class="events">
        <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
        <tbody>${i.events.map((e) => `
          <tr><td class="mono nowrap">${esc(e.at.slice(0, 16).replace('T', ' '))}</td>
              <td class="mono">${esc(e.kind)}</td><td>${esc(e.detail)}</td></tr>`).join('')}
        </tbody>
      </table>
      ${i.letter ? `<details><summary>Letter as sent</summary><pre>${esc(i.letter.body)}</pre></details>` : ''}
    </section>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>deletewe evidence pack — ${esc(pack.subject.name)}</title>
<style>
  :root { --fg:#111; --muted:#555; --rule:#ccc; --bad:#a00; --ok:#060; }
  body { font:13px/1.5 Georgia,'Times New Roman',serif; color:var(--fg); max-width:48rem; margin:2rem auto; padding:0 1rem; }
  h1 { font-size:1.4rem; border-bottom:2px solid var(--fg); padding-bottom:.3rem; }
  h2 { font-size:1.1rem; margin-top:2rem; border-bottom:1px solid var(--rule); }
  h3 { font-size:1rem; margin:0 0 .4rem; }
  .cat { font-weight:normal; color:var(--muted); font-size:.85em; }
  .mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:.85em; word-break:break-all; }
  .nowrap { white-space:nowrap; }
  .muted { color:var(--muted); font-size:.9em; }
  .ok { color:var(--ok); } .bad { color:var(--bad); font-weight:bold; }
  dl { display:grid; grid-template-columns:9rem 1fr; gap:.15rem .8rem; margin:.4rem 0; }
  dt { color:var(--muted); } dd { margin:0; }
  .item { border:1px solid var(--rule); padding:.8rem; margin:.8rem 0; break-inside:avoid; }
  table.events { width:100%; border-collapse:collapse; margin-top:.6rem; font-size:.85em; }
  table.events th, table.events td { border-top:1px solid var(--rule); padding:.2rem .4rem; text-align:left; vertical-align:top; }
  pre { white-space:pre-wrap; font-size:.8em; background:#f6f6f6; padding:.6rem; }
  .notes li { margin:.3rem 0; }
  @media print { body { max-width:none; margin:0; } details { display:none; } }
</style></head><body>
<h1>deletewe evidence pack</h1>
<dl>
  <dt>Data subject</dt><dd>${esc(pack.subject.name)} (${esc(pack.subject.residence)})</dd>
  <dt>Generated</dt><dd>${esc(pack.generatedAt)}</dd>
  <dt>Manifest digest</dt><dd class="mono">${esc(pack.manifestSha256)}</dd>
</dl>

<h2>Authorisation</h2>
<p>Hash chain: <strong class="${pack.consent.chainValid ? 'ok' : 'bad'}">${pack.consent.chainValid ? 'VALID' : 'INVALID'}</strong></p>
<table class="events"><thead><tr><th>Granted</th><th>Scopes</th><th>Document digest</th><th>State</th></tr></thead><tbody>
${pack.consent.entries.map((c) => `<tr>
  <td class="nowrap">${esc(c.grantedAt.slice(0, 10))}</td>
  <td>${esc(c.scopes.join(', '))}</td>
  <td class="mono">${esc(c.documentHash.slice(0, 24))}</td>
  <td>${c.revokedAt ? `revoked ${esc(c.revokedAt.slice(0, 10))}` : `expires ${esc(c.expiresAt.slice(0, 10))}`}</td>
</tr>`).join('')}
</tbody></table>

<h2>Outcomes</h2>
<p class="muted">Reported separately by evidence rank and deliberately never summed.</p>
<table class="events"><thead><tr><th>Outcome</th><th>Count</th></tr></thead><tbody>
${Object.entries(pack.summary).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
</tbody></table>

<h2>Requests</h2>
${items}

<h2>Notes</h2>
<ul class="notes">${pack.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
</body></html>
`;
}
