import type { Broker, ConsentScope, Subject, SubjectIdentifiers } from '../src/types.ts';
import { Store } from '../src/store/store.ts';
import { EnvKeyring } from '../src/crypto/envelope.ts';
import { grantConsent } from '../src/consent/consent.ts';
import { BrokerRegistry } from '../src/brokers/registry.ts';

export const T0 = new Date('2026-03-01T09:00:00.000Z');

export function memStore(): Store {
  return new Store(':memory:', EnvKeyring.ephemeral());
}

export function ids(over: Partial<SubjectIdentifiers> = {}): SubjectIdentifiers {
  return {
    fullName: 'Avery Nakamura',
    emails: ['avery@example.org'],
    locality: 'Oakland, California',
    streetAddresses: ['12 Rowan Street, Oakland, CA 94601'],
    phones: ['+1 510 555 0147'],
    dateOfBirth: '1986-04-12',
    ...over,
  };
}

export function subject(over: Partial<Subject> = {}): Subject {
  return {
    id: 'subj_test_1',
    accountId: 'acct_test_1',
    residence: 'US-CA',
    identifiers: ids(),
    createdAt: T0.toISOString(),
    ...over,
  };
}

export function broker(over: Partial<Broker> = {}): Broker {
  return {
    id: 'test-broker',
    name: 'Test Broker Inc.',
    domains: ['testbroker.example'],
    category: 'marketing',
    surface: 'private',
    establishedIn: 'US-NY',
    targetsRegions: ['US', 'US-CA'],
    legalContact: { email: 'privacy@testbroker.example', privacyPortal: null, postal: null },
    severity: 5,
    medianResponseDays: 20,
    requiredIdentifiers: [],
    sectoralRegimes: [],
    rateLimitPerHour: 60,
    provenance: 'test',
    ...over,
  };
}

export function seedSubject(
  store: Store,
  s: Subject = subject(),
  now = T0,
  scopes: readonly ConsentScope[] = ['erasure_requests', 'regulator_complaints', 'custom_removals'],
): Subject {
  store.putAccount({ id: s.accountId, ownerSubjectId: s.id, plan: 'individual', maxSubjects: 1, createdAt: now.toISOString() });
  store.putSubject(s);
  store.putConsent(grantConsent({
    subjectId: s.id,
    jurisdictions: [s.residence],
    scopes: [...scopes],
    signatureName: s.identifiers.fullName,
    method: 'in_person',
    agentName: 'deletewe test',
    now,
    previousHash: null,
  }));
  return s;
}

export function registryOf(...bs: Broker[]): BrokerRegistry {
  return new BrokerRegistry(bs);
}
