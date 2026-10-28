/**
 * Discovery adapters.
 *
 * Discovery answers one question: is this subject's record visible on this broker's
 * public surface, right now? It feeds the engine in two places, and gates neither:
 *
 *   - before a request, an observation ENRICHES the letter (ADR-0001 D1);
 *   - after a request closes, a re-observation showing the listing is GONE is the
 *     only rank-1 evidence in the system (ADR-0001 D2). Without an adapter the
 *     `verified_absent` outcome is unreachable, and the strongest claim in the
 *     design stays theoretical.
 *
 * WHAT IS NOT HERE, AND WHY. deletewe ships no adapter that fetches a live broker
 * site, for the same reason it ships no SMTP transport: it is an outward-facing,
 * third-party-affecting action that should require deliberate work from an
 * operator rather than deliberate restraint. Scraping a people-search site also
 * carries its own terms-of-service and rate questions that are the operator's to
 * answer in their jurisdiction, not ours to answer by default.
 *
 * What IS here is the full path the adapter plugs into, tested end to end, plus two
 * offline adapters so the engine can be exercised and so an operator can run their
 * own observations through a file instead of writing code.
 */
import { readFileSync } from 'node:fs';
import type { Broker, DiscoveryAdapter, Observation, Subject } from '../types.ts';
import { newId } from '../util/ids.ts';
import { log } from '../util/logging.ts';

/** Returns nothing, always. The default: the engine runs, discovery simply has no input. */
export class NullDiscoveryAdapter implements DiscoveryAdapter {
  readonly id = 'null';
  async observe(): Promise<readonly Observation[]> { return []; }
}

export interface FixtureObservation {
  readonly brokerId: string;
  readonly url: string;
  readonly present: boolean;
  readonly matchedIdentifiers?: Observation['matchedIdentifiers'];
  readonly snapshotHash?: string | null;
}

/**
 * Observations supplied as data rather than fetched.
 *
 * Two real uses beyond tests: an operator who checks listings by hand can feed the
 * results in as a file, and an operator with their own crawler can run it out of
 * process and hand deletewe the output, keeping the network code outside this
 * codebase entirely.
 */
export class FixtureDiscoveryAdapter implements DiscoveryAdapter {
  readonly id: string;
  readonly #byBroker: Map<string, FixtureObservation>;
  readonly #clock: () => Date;

  constructor(
    observations: readonly FixtureObservation[],
    clock: () => Date = () => new Date(),
    id = 'fixture',
  ) {
    this.#byBroker = new Map(observations.map((o) => [o.brokerId, o]));
    this.#clock = clock;
    this.id = id;
  }

  /** Load from a JSON file of FixtureObservation[]. */
  static fromFile(path: string, clock: () => Date = () => new Date()): FixtureDiscoveryAdapter {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as FixtureObservation[];
    if (!Array.isArray(parsed)) throw new Error(`${path}: expected an array of observations`);
    return new FixtureDiscoveryAdapter(parsed, clock, `file:${path}`);
  }

  async observe(subject: Subject, brokers: readonly Broker[]): Promise<readonly Observation[]> {
    const at = this.#clock().toISOString();
    const out: Observation[] = [];
    for (const b of brokers) {
      // Only a public surface can be observed at all. Reporting an absence for a
      // private database would manufacture rank-1 evidence out of nothing.
      if (b.surface !== 'public') continue;
      const f = this.#byBroker.get(b.id);
      if (!f) continue;
      out.push({
        id: newId('obs'),
        subjectId: subject.id,
        brokerId: b.id,
        url: f.url,
        observedAt: at,
        matchedIdentifiers: f.matchedIdentifiers ?? [],
        present: f.present,
        snapshotHash: f.snapshotHash ?? null,
      });
    }
    log.debug('discovery observed', { adapter: this.id, brokers: brokers.length, observations: out.length });
    return out;
  }
}
