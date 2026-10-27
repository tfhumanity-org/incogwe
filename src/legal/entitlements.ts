/**
 * Resolve which legal instruments a subject may invoke against a specific broker.
 *
 * ADR-0001 D4: template selection is a function of the PAIR (user residence,
 * broker establishment), not of either alone. A Californian writing to a
 * Dublin-established broker holds rights under both CCPA and GDPR, and the letter
 * must name whichever one it intends to start a clock on.
 */
import type { Broker, Entitlement, LegalInstrument, RegionCode, RightKind, Subject } from '../types.ts';
import { instrument, instrumentsForResidence, isEea } from './jurisdictions.ts';

/**
 * Ranking policy. Lower sorts first and rank 0 becomes the primary instrument:
 * it drives the template, the citation set and the statutory deadline.
 *
 * The ordering principle is "shortest enforceable clock against the most clearly
 * bound controller". A broker established in the subject's own jurisdiction is
 * bound directly; reaching one extraterritorially is correct but slower to enforce.
 */
function score(inst: LegalInstrument, broker: Broker, subject: Subject): number {
  let s = 100;

  // Directly established in a region the instrument governs: strongest footing.
  const governs = inst.subjectRegions.includes(broker.establishedIn);
  if (governs) {
    s -= 40;
  } else if (inst.extraterritorial && targetsSubjectRegion(broker, subject.residence)) {
    s -= 20;
  } else {
    // Not established where the instrument bites, and either the instrument has no
    // extraterritorial reach or the broker does not target this subject's region.
    // Returning a finite score here would emit an entitlement whose own `basis` text
    // asserts the broker "monitors or offers services to data subjects in that
    // jurisdiction" -- a factual claim our registry data contradicts, in a letter.
    return Number.POSITIVE_INFINITY;
  }

  // Prefer a shorter clock, all else equal.
  s += inst.responseDays / 10;

  // Prefer an instrument that grants the full right set we want to assert.
  const wanted: RightKind[] = ['erasure', 'opt_out_of_sale', 'objection', 'suppression'];
  s -= wanted.filter((r) => inst.rights.includes(r)).length * 2;

  // California's Delete Act is a state-operated deletion mechanism that binds
  // *registered* brokers on an ongoing 45-day cycle. Where it applies it is the
  // strongest instrument available, but it is a referral, not a letter -- so we
  // rank it just behind CCPA, which is what the letter itself cites.
  if (inst.id === 'CA_DELETE_ACT') s += 1;

  return s;
}

export interface ResolveOptions {
  /** Rights the caller wants asserted. Defaults to everything the instrument allows. */
  readonly want?: readonly RightKind[];
}

/**
 * Returns entitlements ordered by rank, rank 0 first. Empty means the subject has
 * no modelled statutory route to this broker -- in which case no request is sent.
 */
export function resolveEntitlements(
  subject: Subject,
  broker: Broker,
  opts: ResolveOptions = {},
): Entitlement[] {
  const candidates = instrumentsForResidence(subject.residence);

  const scored = candidates
    .map((inst) => ({ inst, s: score(inst, broker, subject) }))
    .filter(({ s }) => Number.isFinite(s))
    .sort((a, b) => a.s - b.s);

  return scored.map(({ inst }, idx) => {
    const rights = (opts.want ?? inst.rights).filter((r) => inst.rights.includes(r));
    return {
      instrument: inst.id,
      rights,
      responseDays: inst.responseDays,
      extensionDays: inst.extensionDays,
      basis: basisFor(inst, broker, subject.residence),
      rank: idx,
    } satisfies Entitlement;
  }).filter((e) => e.rights.length > 0);
}

/** `US-CA` is covered by a broker that targets `US-CA` or the whole of `US`. */
function targetsSubjectRegion(broker: Broker, residence: RegionCode): boolean {
  if (broker.targetsRegions.includes(residence)) return true;
  const country = residence.split('-')[0]!;
  return broker.targetsRegions.includes(country);
}

function basisFor(inst: LegalInstrument, broker: Broker, residence: RegionCode): string {
  if (inst.subjectRegions.includes(broker.establishedIn)) {
    return `${inst.shortName} applies directly: the data subject resides in ${residence} and ${broker.name} is established in ${broker.establishedIn}.`;
  }
  return `${inst.shortName} applies extraterritorially: the data subject resides in ${residence}, and ${broker.name}, though established in ${broker.establishedIn}, monitors or offers services to data subjects in that jurisdiction.`;
}

/** Convenience: the instrument the letter will actually be written under. */
export function primaryEntitlement(subject: Subject, broker: Broker): Entitlement | null {
  return resolveEntitlements(subject, broker)[0] ?? null;
}

/**
 * Sectoral carve-outs. FCRA/GLBA/HIPAA-regulated holdings are commonly exempt from
 * state deletion rights, so asserting erasure against them produces a lawful refusal.
 * We still send -- the access right usually survives -- but we say so in the letter
 * rather than pretending the exemption does not exist.
 */
export function sectoralCaveat(broker: Broker): string | null {
  if (broker.sectoralRegimes.length === 0) return null;
  const names: Record<string, string> = {
    FCRA: 'the federal Fair Credit Reporting Act',
    GLBA: 'the Gramm-Leach-Bliley Act',
    HIPAA: 'the HIPAA privacy and security rules',
    CMIA: 'the California Confidentiality of Medical Information Act',
    IIPPA: 'the California Insurance Information and Privacy Protection Act',
  };
  const list = broker.sectoralRegimes.map((r) => names[r] ?? r).join(', ');
  return (
    `We note that you have declared activities regulated by ${list}. ` +
    `This request is directed at personal information held outside the scope of that regulation. ` +
    `Where a specific record is genuinely exempt, please identify the record and the exemption relied upon, ` +
    `and action this request in respect of all remaining personal information.`
  );
}

export function isExtraterritorial(inst: LegalInstrument, broker: Broker): boolean {
  return !inst.subjectRegions.includes(broker.establishedIn);
}

/** True when the subject should additionally be routed through California's DROP. */
export function dropEligible(subject: Subject, broker: Broker): boolean {
  return subject.residence === 'US-CA' && broker.provenance.startsWith('cppa-registry');
}
