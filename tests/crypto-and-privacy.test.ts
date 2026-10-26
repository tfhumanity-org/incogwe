import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DecryptionError, EnvKeyring, MissingKeyError, open, safeEqual, seal } from '../src/crypto/envelope.ts';
import { pseudonym, redact, scrub } from '../src/util/redact.ts';
import { log, setLevel, setSink } from '../src/util/logging.ts';
import { ids, memStore, subject, T0 } from './helpers.ts';
import { randomBytes } from 'node:crypto';

describe('envelope encryption', () => {
  const kr = EnvKeyring.ephemeral();

  test('round-trips under a matching AAD', () => {
    const sealed = seal(kr, 'Avery Nakamura', 'subjects:identifiers:subj_1');
    assert.equal(open(kr, sealed, 'subjects:identifiers:subj_1'), 'Avery Nakamura');
  });

  test('the ciphertext does not contain the plaintext', () => {
    const sealed = seal(kr, 'Avery Nakamura', 'a:b:c');
    assert.ok(!sealed.includes('Avery'));
    assert.ok(!Buffer.from(sealed).toString('utf8').includes('Nakamura'));
  });

  test('a mismatched AAD fails: a ciphertext cannot be moved between rows', () => {
    const sealed = seal(kr, 'secret', 'subjects:identifiers:subj_1');
    assert.throws(() => open(kr, sealed, 'subjects:identifiers:subj_2'), DecryptionError);
  });

  test('a tampered ciphertext or tag fails', () => {
    const sealed = seal(kr, 'secret', 'a:b:c');
    const parts = sealed.split('.');
    parts[4] = Buffer.from('tampered').toString('base64url');
    assert.throws(() => open(kr, parts.join('.'), 'a:b:c'), DecryptionError);
  });

  test('two seals of the same plaintext differ (random IV)', () => {
    assert.notEqual(seal(kr, 'x', 'a:b:c'), seal(kr, 'x', 'a:b:c'));
  });

  test('the key id is carried in the ciphertext, so rotation is possible', () => {
    assert.match(seal(kr, 'x', 'a:b:c'), /^v1\.k1\./);
  });

  test('a short or missing master key is rejected loudly', () => {
    assert.throws(() => EnvKeyring.fromEnv({} as NodeJS.ProcessEnv), MissingKeyError);
    assert.throws(
      () => EnvKeyring.fromEnv({ DELETEWE_MASTER_KEY: Buffer.alloc(16).toString('base64') } as NodeJS.ProcessEnv),
      MissingKeyError,
    );
    assert.doesNotThrow(
      () => EnvKeyring.fromEnv({ DELETEWE_MASTER_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv),
    );
  });

  test('safeEqual compares without leaking length-independent timing', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('the store encrypts personal data at rest', () => {
  test('no identifier appears in plaintext anywhere in the database file', () => {
    const store = memStore();
    const s = subject({ identifiers: ids({ fullName: 'Marguerite X Fontaine' }) });
    store.putSubject(s);

    // Read the raw column, bypassing the store's own decryption.
    const row = store.raw.prepare('SELECT identifiers_sealed FROM subjects WHERE id = ?')
      .get(s.id) as { identifiers_sealed: string };
    assert.ok(!row.identifiers_sealed.includes('Marguerite'));
    assert.ok(!row.identifiers_sealed.includes('avery@example.org'));
    assert.match(row.identifiers_sealed, /^v1\./);

    assert.equal(store.getSubject(s.id)!.identifiers.fullName, 'Marguerite X Fontaine');
    store.close();
  });

  test('a letter body is sealed, and survives a round trip intact', () => {
    const store = memStore();
    const body = 'Dear Broker,\n\nFull name: Marguerite X Fontaine\n';
    store.putLetter('req_1', 'hash', body, T0.toISOString());
    const raw = store.raw.prepare('SELECT sealed FROM letters WHERE request_id = ?')
      .get('req_1') as { sealed: string };
    assert.ok(!raw.sealed.includes('Marguerite'));
    assert.equal(store.getLetter('req_1'), body);
    store.close();
  });

  test('deleteSubject removes rows rather than setting a flag', () => {
    const store = memStore();
    const s = subject();
    store.putSubject(s);
    store.putObservation({
      id: 'obs_1', subjectId: s.id, brokerId: 'b', url: 'https://x.invalid',
      observedAt: T0.toISOString(), matchedIdentifiers: ['full_name'], present: true, snapshotHash: null,
    });
    store.deleteSubject(s.id);
    const n = store.raw.prepare('SELECT COUNT(*) n FROM subjects').get() as { n: number };
    const o = store.raw.prepare('SELECT COUNT(*) n FROM observations').get() as { n: number };
    assert.equal(n.n, 0);
    assert.equal(o.n, 0);
    store.close();
  });
});

describe('personal data stays out of logs', () => {
  test('redact replaces values under sensitive keys with a pseudonym', () => {
    const out = redact({
      subjectId: 'subj_1',
      fullName: 'Avery Nakamura',
      emails: ['avery@example.org'],
      brokerId: 'spokeo',
    }) as Record<string, unknown>;

    assert.equal(out['subjectId'], 'subj_1', 'opaque ids stay, they are not personal data');
    assert.equal(out['brokerId'], 'spokeo');
    assert.match(String(out['fullName']), /^fullName:[0-9a-f]{8}$/);
    assert.ok(!JSON.stringify(out).includes('Avery'));
    assert.ok(!JSON.stringify(out).includes('avery@example.org'));
  });

  test('a pseudonym is stable within a process, so logs stay correlatable', () => {
    assert.equal(pseudonym('avery@example.org'), pseudonym('AVERY@example.org '));
    assert.notEqual(pseudonym('a@x.io'), pseudonym('b@x.io'));
  });

  test('free text is scrubbed of emails, phones and dates', () => {
    const out = scrub('contact avery@example.org or +1 510 555 0147, born 1986-04-12');
    assert.ok(!out.includes('avery@example.org'));
    assert.ok(!out.includes('1986-04-12'));
    assert.ok(!out.includes('555 0147'));
  });

  test('nested structures are scrubbed too', () => {
    const out = JSON.stringify(redact({ a: { b: { identifiers: { fullName: 'Avery Nakamura' } } } }));
    assert.ok(!out.includes('Avery'));
  });

  test('the logger refuses to emit raw personal data', () => {
    const lines: string[] = [];
    setSink((l) => lines.push(l));
    setLevel('debug');
    log.info('sending', { subjectId: 'subj_1', fullName: 'Avery Nakamura', body: 'Full name: Avery Nakamura' });
    setSink((l) => process.stdout.write(l + '\n'));
    setLevel('info');

    assert.equal(lines.length, 1);
    assert.ok(!lines[0]!.includes('Avery'), 'the logger must not be able to print a name');
    assert.match(lines[0]!, /"subjectId":"subj_1"/);
  });

  test('circular and exotic values do not crash the logger', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    assert.doesNotThrow(() => redact(a));
    assert.equal(redact(() => 1), '[unserialisable]');
  });
});
