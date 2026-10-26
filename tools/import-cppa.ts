/**
 * Build the broker seed from the California Privacy Protection Agency Data Broker
 * Registry, an open government dataset (no access control, no scraping).
 *
 *   curl -o var/cppa-registry.csv https://cppa.ca.gov/data_broker_registry/registry.csv
 *   npm run seed:cppa -- var/cppa-registry.csv src/brokers/seed/brokers.json
 *
 * Why this source rather than a hand-curated list (ADR-0001 D8): it is authoritative,
 * machine-readable, carries the broker's own declared legal contact, its declared
 * sensitive-data categories, and -- uniquely -- its self-reported median days to
 * respond to a deletion request. No vendor publishes that.
 *
 * Its limitation is equally important and is recorded in each row's provenance: the
 * registry covers brokers that registered in California. Researchers found roughly
 * 71.7% of data brokers are registered with no authority at all (PoPETs 2025).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Broker, BrokerCategory, BrokerSurface, IdentifierKind } from '../src/types.ts';

// --- minimal RFC4180 CSV reader (no dependency) ---------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const COL = {
  name: 0, dba: 1, website: 2, email: 3, street: 5, city: 6, state: 7, country: 9,
  portal: 10, minors: 11, govId: 13, citizenship: 14, union: 15, orientation: 16,
  genderId: 17, biometric: 18, geolocation: 19, reproductive: 20,
  soldForeign: 21, soldFederal: 22, soldState: 23, soldLE: 24, soldGenAI: 25,
  fcra: 26, glba: 30, iippa: 34, cmia: 38, hipaa: 42,
  deleteTotal: 46, deleteDenied: 49, deleteMeanDays: 50, deleteMedianDays: 51,
} as const;

const yes = (v: string | undefined) => (v ?? '').trim().toLowerCase() === 'yes';

/** Domains whose operators run publicly searchable people-search surfaces. */
const PEOPLE_SEARCH_MARKERS = [
  'peoplesearch', 'people-search', 'backgroundcheck', 'background-check', 'publicrecords',
  'spokeo', 'whitepages', 'beenverified', 'intelius', 'peoplefinders', 'truthfinder',
  'instantcheckmate', 'radaris', 'mylife', 'thatsthem', 'ussearch', 'peoplelooker',
  'zabasearch', 'anywho', 'familytreenow', 'truepeoplesearch', 'infotracer', 'idtrue',
  'fastpeoplesearch', 'searchpeoplefree', 'usphonebook', 'phonebooks', 'addresses.com',
  'courtrecords', 'staterecords', 'recordsfinder', 'checkpeople', 'nuwber', 'clustrmaps',
  'ownerly', 'neighborwho', 'numberguru', 'reversephone', 'peoplesmart', 'advancedbackground',
];
const LOCATION_MARKERS = ['venntel', 'cuebiq', 'foursquare', 'placer', 'safegraph', 'kochava', 'gravy', 'nearintelligence', 'babelstreet', 'x-mode'];
const RECRUITMENT_MARKERS = ['screening', 'hireright', 'sterling', 'checkr', 'accurate', 'employment', 'verifications', 'goodhire'];
const HEALTH_MARKERS = ['health', 'medical', 'clinical', 'pharma', 'iqvia', 'komodo', 'definitivehc', 'clarivate'];
const FINANCIAL_MARKERS = ['equifax', 'experian', 'transunion', 'fico', 'creditreport', 'finance', 'lending', 'credit'];
const RISK_MARKERS = ['lexisnexis', 'verisk', 'corelogic', 'thomsonreuters', 'risk', 'fraud', 'identity', 'clearview', 'insurance'];

/**
 * Category is the broker's PRIMARY business, used for prioritisation and for telling
 * the user what kind of exposure this is. It is not a statement about regulation --
 * sectoral regimes are recorded separately on `sectoralRegimes` and nothing is lost.
 *
 * Identity markers are checked before regulatory flags, deliberately. A credit bureau
 * that also runs a health-verification line declares HIPAA, but calling Equifax a
 * "health broker" would be true-but-useless to the person reading their dashboard.
 */
function classify(row: string[]): { category: BrokerCategory; surface: BrokerSurface } {
  const blob = `${row[COL.name] ?? ''} ${row[COL.dba] ?? ''} ${row[COL.website] ?? ''}`.toLowerCase();
  const hit = (ms: string[]) => ms.some((m) => blob.includes(m));

  // 1. Identity: what the broker evidently IS.
  if (hit(PEOPLE_SEARCH_MARKERS)) return { category: 'people_search', surface: 'public' };
  if (hit(FINANCIAL_MARKERS)) return { category: 'financial', surface: 'private' };
  if (hit(RISK_MARKERS)) return { category: 'risk_mitigation', surface: 'private' };
  if (hit(RECRUITMENT_MARKERS)) return { category: 'recruitment', surface: 'private' };
  if (hit(HEALTH_MARKERS)) return { category: 'health', surface: 'private' };
  if (hit(LOCATION_MARKERS)) return { category: 'location', surface: 'private' };

  // 2. Regulation: what it declared, when the name tells us nothing.
  if (yes(row[COL.hipaa]) || yes(row[COL.cmia])) return { category: 'health', surface: 'private' };
  if (yes(row[COL.glba])) return { category: 'financial', surface: 'private' };
  if (yes(row[COL.fcra])) return { category: 'recruitment', surface: 'private' };
  if (yes(row[COL.iippa])) return { category: 'risk_mitigation', surface: 'private' };
  if (yes(row[COL.geolocation])) return { category: 'location', surface: 'private' };

  return { category: 'marketing', surface: 'private' };
}

/**
 * Severity 1-10 from the broker's OWN declarations, so the score is auditable
 * against a public source rather than being our opinion.
 */
function severity(row: string[], category: BrokerCategory): number {
  let s = 2;
  if (yes(row[COL.govId])) s += 2;
  if (yes(row[COL.biometric])) s += 2;
  if (yes(row[COL.geolocation])) s += 2;
  if (yes(row[COL.reproductive])) s += 2;
  if (yes(row[COL.citizenship])) s += 1;
  if (yes(row[COL.orientation]) || yes(row[COL.genderId]) || yes(row[COL.union])) s += 1;
  if (yes(row[COL.minors])) s += 1;
  if (yes(row[COL.soldFederal]) || yes(row[COL.soldLE]) || yes(row[COL.soldForeign])) s += 1;
  if (yes(row[COL.soldGenAI])) s += 1;
  if (category === 'financial' || category === 'health' || category === 'risk_mitigation') s += 1;
  // A publicly searchable profile is itself the exposure, whatever the broker
  // declared it collects -- so people-search never scores below medium.
  if (category === 'people_search') s = Math.max(s + 1, 5);
  return Math.max(1, Math.min(10, s));
}

function requiredIdentifiers(row: string[], category: BrokerCategory): IdentifierKind[] {
  const need: IdentifierKind[] = [];
  if (category === 'people_search') need.push('street_address', 'phone');
  if (category === 'financial' || category === 'recruitment') need.push('street_address', 'date_of_birth');
  if (yes(row[COL.govId])) need.push('date_of_birth');
  return [...new Set(need)];
}

function domains(row: string[]): string[] {
  const raw = `${row[COL.website] ?? ''};${row[COL.portal] ?? ''}`;
  const out = new Set<string>();
  for (const part of raw.split(/[;,\s]+/)) {
    const m = part.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (m && m.includes('.')) out.add(m);
  }
  return [...out];
}

const LEGAL_SUFFIXES = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|plc|holdings|group|usa|us|international|solutions|and its subsidiaries and affiliates|and affiliates|and subsidiaries)\b/g;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'broker';
}

function num(v: string | undefined): number | null {
  const n = Number((v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && (v ?? '').trim() !== '' ? n : null;
}

/** Rate limit: be a good citizen. High-volume brokers tolerate more; small ones less. */
function rateLimit(category: BrokerCategory): number {
  return category === 'people_search' ? 30 : 60;
}

export function toBroker(row: string[], snapshotDate: string): Broker | null {
  const name = (row[COL.name] ?? '').trim();
  const email = (row[COL.email] ?? '').trim();
  if (!name) return null;

  const { category, surface } = classify(row);
  const d = domains(row);
  const regimes: ('FCRA' | 'GLBA' | 'HIPAA' | 'CMIA' | 'IIPPA')[] = [];
  if (yes(row[COL.fcra])) regimes.push('FCRA');
  if (yes(row[COL.glba])) regimes.push('GLBA');
  if (yes(row[COL.hipaa])) regimes.push('HIPAA');
  if (yes(row[COL.cmia])) regimes.push('CMIA');
  if (yes(row[COL.iippa])) regimes.push('IIPPA');

  const country = (row[COL.country] ?? 'US').trim().toUpperCase();
  const state = (row[COL.state] ?? '').trim().toUpperCase();
  const establishedIn =
    country === 'US' || country === 'USA' || country === 'UNITED STATES'
      ? (state.length === 2 ? `US-${state}` : 'US')
      : (country.length === 2 ? country : 'US');

  return {
    id: slug(name),
    name,
    domains: d,
    category,
    surface,
    establishedIn,
    // Registered in California, and every registrant necessarily targets CA consumers.
    // Beyond that we assume US-wide reach, which is what registration implies.
    targetsRegions: ['US', 'US-CA'],
    legalContact: {
      email: email.includes('@') ? email : null,
      privacyPortal: (row[COL.portal] ?? '').trim() || null,
      postal: [row[COL.street], row[COL.city], row[COL.state]].filter(Boolean).join(', ') || null,
    },
    severity: severity(row, category),
    medianResponseDays: num(row[COL.deleteMedianDays]),
    requiredIdentifiers: requiredIdentifiers(row, category),
    sectoralRegimes: regimes,
    rateLimitPerHour: rateLimit(category),
    provenance: `cppa-registry:${snapshotDate}`,
  };
}

/**
 * Selection. We do not ship all 603 registrants: the seed should be the brokers that
 * matter most to a person, and should span every category so the engine is exercised.
 */
function selectionScore(b: Broker, row: string[]): number {
  let s = b.severity * 10;
  if (b.category === 'people_search') s += 45;
  if (b.category === 'financial' || b.category === 'health' || b.category === 'risk_mitigation') s += 25;
  if (b.category === 'location') s += 20;
  if (b.sectoralRegimes.length) s += 10;
  if (yes(row[COL.soldGenAI])) s += 15;
  if (yes(row[COL.soldFederal]) || yes(row[COL.soldLE])) s += 10;
  const denied = num(row[COL.deleteDenied]) ?? 0;
  const total = num(row[COL.deleteTotal]) ?? 0;
  if (total > 1000) s += 10;                       // high-volume: affects many people
  if (total > 0 && denied / total > 0.2) s += 15;  // high refusal: worth the fight
  if (!b.legalContact.email) s -= 100;             // cannot be contacted by letter
  return s;
}

function main(): void {
  const [inPath, outPath, limitArg] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error('usage: import-cppa.ts <registry.csv> <out.json> [limit]');
    process.exit(2);
  }
  const limit = Number(limitArg ?? 70);
  const rows = parseCsv(readFileSync(inPath, 'utf8').replace(/^﻿/, ''));
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const body = rows.slice(1).filter((r) => r.length > COL.deleteMedianDays);

  const scored = body
    .map((r) => ({ r, b: toBroker(r, snapshotDate) }))
    .filter((x): x is { r: string[]; b: Broker } => x.b !== null)
    .map((x) => ({ ...x, score: selectionScore(x.b, x.r) }))
    .sort((a, b) => b.score - a.score);

  // Guarantee category spread before falling back to pure score.
  const picked = new Map<string, Broker>();
  const perCategoryFloor: Partial<Record<BrokerCategory, number>> = {
    people_search: 12, financial: 8, health: 6, risk_mitigation: 8, recruitment: 6, location: 6, marketing: 10,
  };
  for (const [cat, floor] of Object.entries(perCategoryFloor)) {
    for (const x of scored) {
      if (picked.size >= limit) break;
      if (x.b.category !== cat) continue;
      if ([...picked.values()].filter((p) => p.category === cat).length >= (floor ?? 0)) break;
      picked.set(x.b.id, x.b);
    }
  }
  for (const x of scored) {
    if (picked.size >= limit) break;
    picked.set(x.b.id, x.b);
  }

  const seen = new Map<string, number>();
  const out = [...picked.values()]
    .map((b) => {
      const n = (seen.get(b.id) ?? 0) + 1;
      seen.set(b.id, n);
      return n === 1 ? b : { ...b, id: `${b.id}-${n}` };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

  const byCat = out.reduce<Record<string, number>>((m, b) => ((m[b.category] = (m[b.category] ?? 0) + 1), m), {});
  console.log(`wrote ${out.length} brokers to ${outPath}`);
  console.log(byCat);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) main();
