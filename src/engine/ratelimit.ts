/**
 * Per-broker token bucket.
 *
 * Rate limiting here is not about protecting us, it is about not looking like an
 * attack. A removal service that fires a thousand requests an hour at one broker's
 * privacy inbox gets its domain blocked, and every subsequent request for every
 * subject fails -- which is a far worse outcome than being slow.
 */
import type { Clock } from '../util/clock.ts';

interface Bucket { tokens: number; lastRefillMs: number; capacity: number; perHour: number }

export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #clock: Clock;

  constructor(clock: Clock) { this.#clock = clock; }

  #bucket(key: string, perHour: number): Bucket {
    let b = this.#buckets.get(key);
    if (!b) {
      // Allow a small burst, capped, so a fresh subject's first few requests go out
      // promptly without letting a backlog stampede.
      const capacity = Math.max(1, Math.min(perHour, Math.ceil(perHour / 4)));
      b = { tokens: capacity, lastRefillMs: this.#clock.now().getTime(), capacity, perHour };
      this.#buckets.set(key, b);
    }
    return b;
  }

  #refill(b: Bucket): void {
    const now = this.#clock.now().getTime();
    const elapsedHours = (now - b.lastRefillMs) / 3_600_000;
    if (elapsedHours <= 0) return;
    b.tokens = Math.min(b.capacity, b.tokens + elapsedHours * b.perHour);
    b.lastRefillMs = now;
  }

  /** Consume one token if available. Does not block. */
  tryAcquire(key: string, perHour: number): boolean {
    const b = this.#bucket(key, perHour);
    this.#refill(b);
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  }

  /** Milliseconds until a token becomes available. 0 if one is available now. */
  retryAfterMs(key: string, perHour: number): number {
    const b = this.#bucket(key, perHour);
    this.#refill(b);
    if (b.tokens >= 1) return 0;
    return Math.ceil(((1 - b.tokens) / b.perHour) * 3_600_000);
  }

  reset(): void { this.#buckets.clear(); }
}
