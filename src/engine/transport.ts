/**
 * Outbound transport.
 *
 * There is deliberately NO live SMTP transport in this repository. Sending real
 * letters to real brokers needs a reviewed template set, an owned sending domain
 * with SPF/DKIM/DMARC, a warmed IP, and a monitored inbound mailbox -- all operator
 * concerns with real-world consequences. Shipping a one-line SMTP client would make
 * it a single config change to start sending unreviewed legal letters at strangers.
 *
 * Implement `Transport` in your deployment. `MockTransport` is what CI uses.
 */
import type { Broker } from '../types.ts';
import type { Letter } from '../templates/letter.ts';

export interface SendResult {
  readonly accepted: boolean;
  readonly messageId: string | null;
  readonly error: string | null;
  /** True for a hard bounce: the address does not exist. */
  readonly undeliverable: boolean;
}

export interface Transport {
  readonly id: string;
  send(letter: Letter, broker: Broker, threadKey: string): Promise<SendResult>;
}

/** Renders and records, never sends. The default. */
export class DryRunTransport implements Transport {
  readonly id = 'dryrun';
  readonly sent: { letter: Letter; brokerId: string; threadKey: string }[] = [];

  async send(letter: Letter, broker: Broker, threadKey: string): Promise<SendResult> {
    this.sent.push({ letter, brokerId: broker.id, threadKey });
    return { accepted: true, messageId: `dryrun:${threadKey}`, error: null, undeliverable: false };
  }
}

export interface MockBrokerBehaviour {
  /** How the mock broker replies, or null for silence (to exercise deadline logic). */
  readonly reply: 'confirm' | 'no_data' | 'verify' | 'refuse' | 'extension' | 'bounce' | null;
  readonly afterDays?: number;
}

/**
 * In-process mock brokers for end-to-end tests. No network, ever.
 * CI must never produce live broker traffic; this is how that is guaranteed.
 */
export class MockTransport implements Transport {
  readonly id = 'mock';
  readonly sent: { letter: Letter; brokerId: string; threadKey: string }[] = [];
  readonly #behaviours: Map<string, MockBrokerBehaviour>;
  readonly #default: MockBrokerBehaviour;

  constructor(
    behaviours: Record<string, MockBrokerBehaviour> = {},
    fallback: MockBrokerBehaviour = { reply: 'confirm', afterDays: 3 },
  ) {
    this.#behaviours = new Map(Object.entries(behaviours));
    this.#default = fallback;
  }

  behaviourFor(brokerId: string): MockBrokerBehaviour {
    return this.#behaviours.get(brokerId) ?? this.#default;
  }

  async send(letter: Letter, broker: Broker, threadKey: string): Promise<SendResult> {
    const b = this.behaviourFor(broker.id);
    if (b.reply === 'bounce') {
      return { accepted: false, messageId: null, error: '550 no such user', undeliverable: true };
    }
    this.sent.push({ letter, brokerId: broker.id, threadKey });
    return { accepted: true, messageId: `mock:${threadKey}`, error: null, undeliverable: false };
  }
}

export class LiveTransportNotConfiguredError extends Error {}

export function transportFromEnv(env: NodeJS.ProcessEnv = process.env): Transport {
  switch ((env.DELETEWE_TRANSPORT ?? 'dryrun').toLowerCase()) {
    case 'mock': return new MockTransport();
    case 'dryrun': return new DryRunTransport();
    default:
      throw new LiveTransportNotConfiguredError(
        'No live transport ships with deletewe. Implement the Transport interface in ' +
        'your deployment and wire it in explicitly. See src/engine/transport.ts.',
      );
  }
}
