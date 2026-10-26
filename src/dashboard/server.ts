/**
 * Minimal read-only JSON API over the dashboard projections.
 *
 * Read-only on purpose: every state change in deletewe goes through the engine,
 * which enforces consent and rate limits. An HTTP surface that could mutate state
 * would be a second path to the same decisions, and second paths are where consent
 * checks get forgotten.
 *
 * Auth is a bearer token compared in constant time. This is enough for a local or
 * single-operator deployment and explicitly not enough for a multi-tenant one.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Store } from '../store/store.ts';
import type { BrokerRegistry } from '../brokers/registry.ts';
import type { Clock } from '../util/clock.ts';
import { buildDashboard } from './timeline.ts';
import { buildEvidencePack, renderEvidencePack } from './evidence.ts';
import { safeEqual } from '../crypto/envelope.ts';
import { log } from '../util/logging.ts';

export interface ServerConfig {
  readonly store: Store;
  readonly registry: BrokerRegistry;
  readonly clock: Clock;
  readonly token: string;
  readonly port?: number;
}

export function createDashboardServer(cfg: ServerConfig): Server {
  return createServer((req, res) => handle(req, res, cfg));
}

function send(res: ServerResponse, status: number, body: unknown, contentType = 'application/json'): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': `${contentType}; charset=utf-8`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(payload);
}

function handle(req: IncomingMessage, res: ServerResponse, cfg: ServerConfig): void {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method !== 'GET') return send(res, 405, { error: 'read-only API' });

  const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!auth || !safeEqual(auth, cfg.token)) {
    // Deliberately terse: do not confirm whether a path or subject exists.
    return send(res, 401, { error: 'unauthorised' });
  }

  const now = cfg.clock.now();
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    // GET /health
    if (parts[0] === 'health') return send(res, 200, { ok: true, brokers: cfg.registry.count() });

    // GET /brokers
    if (parts[0] === 'brokers' && parts.length === 1) {
      return send(res, 200, {
        count: cfg.registry.count(),
        byCategory: cfg.registry.summary(),
        brokers: cfg.registry.all().map((b) => ({
          id: b.id, name: b.name, category: b.category, surface: b.surface,
          establishedIn: b.establishedIn, severity: b.severity,
          medianResponseDays: b.medianResponseDays, provenance: b.provenance,
        })),
      });
    }

    // GET /subjects/:id/dashboard
    if (parts[0] === 'subjects' && parts[2] === 'dashboard' && parts[1]) {
      const subject = cfg.store.getSubject(parts[1]);
      if (!subject) return send(res, 404, { error: 'not found' });
      return send(res, 200, buildDashboard(cfg.store, cfg.registry, subject.id, now));
    }

    // GET /subjects/:id/evidence[?format=text]
    if (parts[0] === 'subjects' && parts[2] === 'evidence' && parts[1]) {
      const subject = cfg.store.getSubject(parts[1]);
      if (!subject) return send(res, 404, { error: 'not found' });
      const pack = buildEvidencePack(cfg.store, cfg.registry, subject, now);
      if (url.searchParams.get('format') === 'text') {
        return send(res, 200, renderEvidencePack(pack), 'text/plain');
      }
      return send(res, 200, pack);
    }

    // GET /review  -- replies the classifier would not decide alone
    if (parts[0] === 'review') return send(res, 200, { queue: cfg.store.repliesNeedingReview() });

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    log.error('dashboard error', { path: url.pathname, error: (e as Error).message });
    return send(res, 500, { error: 'internal error' });
  }
}
