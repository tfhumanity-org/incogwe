/**
 * Field-level encryption at rest (ADR-0001 D7).
 *
 * AES-256-GCM, one random 96-bit IV per value, with the field's logical path bound
 * in as additional authenticated data. The AAD binding means a ciphertext cannot be
 * moved from one record or column to another without the decrypt failing -- so a
 * database-level row swap is detectable, not just a byte edit.
 *
 * Key management is deliberately minimal and pluggable: production should back
 * `Keyring` with a KMS. The env-var keyring is for development and CI.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Keyring {
  /** Active key id, stamped into every new ciphertext so rotation is possible. */
  activeKeyId(): string;
  key(keyId: string): Buffer;
}

export class MissingKeyError extends Error {}
export class DecryptionError extends Error {}

export class EnvKeyring implements Keyring {
  readonly #keys: Map<string, Buffer>;
  readonly #active: string;

  constructor(keys: Record<string, Buffer>, active: string) {
    this.#keys = new Map(Object.entries(keys));
    this.#active = active;
    const k = this.#keys.get(active);
    if (!k) throw new MissingKeyError(`active key ${active} not in keyring`);
    if (k.length !== 32) throw new MissingKeyError('master key must be 32 bytes');
  }

  /** Reads DELETEWE_MASTER_KEY (base64, 32 bytes). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): EnvKeyring {
    const raw = env.DELETEWE_MASTER_KEY;
    if (!raw) throw new MissingKeyError('DELETEWE_MASTER_KEY is not set; see .env.example');
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new MissingKeyError('DELETEWE_MASTER_KEY must decode to 32 bytes');
    return new EnvKeyring({ k1: buf }, 'k1');
  }

  static ephemeral(): EnvKeyring {
    return new EnvKeyring({ k1: randomBytes(32) }, 'k1');
  }

  activeKeyId(): string { return this.#active; }
  key(keyId: string): Buffer {
    const k = this.#keys.get(keyId);
    if (!k) throw new MissingKeyError(`unknown key id ${keyId}`);
    return k;
  }
}

/** Opaque, self-describing ciphertext: `v1.<keyId>.<iv>.<tag>.<ct>`, all base64url. */
export type Sealed = string;

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

export function seal(keyring: Keyring, plaintext: string, aad: string): Sealed {
  const keyId = keyring.activeKeyId();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyring.key(keyId), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', keyId, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join('.');
}

export function open(keyring: Keyring, sealed: Sealed, aad: string): string {
  const parts = sealed.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') throw new DecryptionError('malformed ciphertext');
  const [, keyId, ivB, tagB, ctB] = parts as [string, string, string, string, string];
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyring.key(keyId), unb64(ivB));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(unb64(tagB));
    return Buffer.concat([decipher.update(unb64(ctB)), decipher.final()]).toString('utf8');
  } catch (e) {
    throw new DecryptionError(`decrypt failed (aad mismatch or tampering): ${(e as Error).message}`);
  }
}

/** Seal a whole JSON-serialisable value under one AAD path. */
export function sealJson(keyring: Keyring, value: unknown, aad: string): Sealed {
  return seal(keyring, JSON.stringify(value), aad);
}

export function openJson<T>(keyring: Keyring, sealed: Sealed, aad: string): T {
  return JSON.parse(open(keyring, sealed, aad)) as T;
}

/** Constant-time compare for hashes/tokens that gate access. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
