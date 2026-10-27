/**
 * The broker list, as data in the repository (ADR-0001 D8).
 *
 * Two sources, each with its provenance recorded on every row:
 *   - seed/brokers.json  -- generated from the CPPA registry by tools/import-cppa.ts
 *   - seed/curated.json  -- hand-added EU/UK/CA brokers, from their own public
 *                           privacy or opt-out pages
 *
 * A broker count nobody outside can audit is a trust liability. This list is
 * diffable, and its generator is in the repo, so anyone can rebuild it and check.
 */
import generated from './seed/brokers.json' with { type: 'json' };
import curated from './seed/curated.json' with { type: 'json' };
import type { Broker, BrokerCategory, BrokerSurface, RegionCode } from '../types.ts';

function validate(b: Broker): Broker {
  if (!b.id || !b.name) throw new Error(`broker missing id or name: ${JSON.stringify(b).slice(0, 80)}`);
  if (b.severity < 1 || b.severity > 10) throw new Error(`broker ${b.id}: severity out of range`);
  if (!b.legalContact.email && !b.legalContact.privacyPortal) {
    throw new Error(`broker ${b.id}: no legal contact`);
  }
  if (b.rateLimitPerHour <= 0) throw new Error(`broker ${b.id}: rateLimitPerHour must be positive`);
  return b;
}

const ALL: readonly Broker[] = Object.freeze(
  [...(generated as Broker[]), ...(curated as Broker[])].map(validate),
);

export class BrokerRegistry {
  readonly #brokers: readonly Broker[];
  readonly #byId: Map<string, Broker>;
  readonly #byDomain: Map<string, Broker>;

  /**
   * Validates on construction, not only for the shipped list. A registry assembled
   * at runtime -- from an operator's own file, or in a test -- is exactly where a
   * broker with no contact or an out-of-range severity would otherwise slip through
   * and turn into an unsendable request at 3am.
   *
   * The lookup maps are per-instance. They were module-global, which meant an
   * operator who built a registry from their own file to correct a broker's legal
   * contact still got the stale shipped address back from `get()` -- and every
   * letter went to the wrong inbox. A registry must answer only for the brokers it
   * was given.
   */
  constructor(brokers: readonly Broker[] = ALL) {
    this.#brokers = brokers === ALL ? brokers : brokers.map(validate);
    this.#byId = new Map(this.#brokers.map((b) => [b.id, b]));
    this.#byDomain = new Map();
    for (const b of this.#brokers) {
      for (const d of b.domains) if (!this.#byDomain.has(d)) this.#byDomain.set(d, b);
    }
  }

  all(): readonly Broker[] { return this.#brokers; }
  get(id: string): Broker | undefined { return this.#byId.get(id); }
  count(): number { return this.#brokers.length; }

  byCategory(c: BrokerCategory): Broker[] { return this.#brokers.filter((b) => b.category === c); }
  bySurface(s: BrokerSurface): Broker[] { return this.#brokers.filter((b) => b.surface === s); }

  /** Brokers reachable for a subject resident in `region`. */
  reachableFrom(region: RegionCode): Broker[] {
    return this.#brokers.filter(
      (b) => b.establishedIn === region || b.targetsRegions.includes(region) || b.targetsRegions.includes(region.split('-')[0]!),
    );
  }

  /**
   * Resolve a URL or hostname to a known broker. Used by custom removals to decide
   * whether a user-submitted link is already covered by the automated flow.
   */
  matchUrl(url: string): Broker | undefined {
    let host: string;
    try {
      host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
    } catch { return undefined; }
    const bare = host.replace(/^www\./, '');
    const direct = this.#byDomain.get(bare);
    if (direct) return direct;
    // Match a parent domain, so sub.spokeo.com resolves to spokeo.
    const parts = bare.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      const hit = this.#byDomain.get(parent);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Highest-severity first; the order requests are planned in. */
  prioritised(brokers: readonly Broker[] = this.#brokers): Broker[] {
    return [...brokers].sort(
      (a, b) => b.severity - a.severity || a.name.localeCompare(b.name),
    );
  }

  summary(): Record<string, number> {
    const m: Record<string, number> = {};
    for (const b of this.#brokers) m[b.category] = (m[b.category] ?? 0) + 1;
    return m;
  }
}

export const brokers = new BrokerRegistry();
