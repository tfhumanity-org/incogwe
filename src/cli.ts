#!/usr/bin/env node
/**
 * deletewe CLI.
 *
 * Everything here goes through the same engine the library exposes; there is no
 * CLI-only path that skips a consent check or a rate limit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvKeyring } from './crypto/envelope.ts';
import { Store } from './store/store.ts';
import { BrokerRegistry, brokers as defaultRegistry } from './brokers/registry.ts';
import { systemClock } from './util/clock.ts';
import { planRequests } from './engine/planner.ts';
import { Sender } from './engine/sender.ts';
import { Scheduler } from './engine/scheduler.ts';
import { transportFromEnv } from './engine/transport.ts';
import { createAccount, acceptInvite, createInvite, leaveAccount, seatStatus } from './profiles/account.ts';
import { grantConsent, authorisationDocument } from './consent/consent.ts';
import { submitCustomRemoval } from './custom/classify.ts';
import { buildDashboard, renderBreakdown } from './dashboard/timeline.ts';
import { buildEvidencePack, renderEvidencePack } from './dashboard/evidence.ts';
import { createDashboardServer } from './dashboard/server.ts';
import { ingest, parseEml } from './mailbox/inbound.ts';
import { processReply } from './mailbox/process.ts';
import { readFileSync } from 'node:fs';
import { log, setLevel } from './util/logging.ts';
import { InvalidIdentifiersError } from './identifiers.ts';
import type { ConsentScope, SubjectIdentifiers } from './types.ts';

const AGENT_NAME = process.env.DELETEWE_AGENT_NAME ?? 'deletewe (authorised agent)';
const REPLY_TO = process.env.DELETEWE_REPLY_TO ?? 'deletions@deletewe.invalid';

function openStore(): Store {
  return new Store(process.env.DELETEWE_DB ?? './var/deletewe.sqlite', EnvKeyring.fromEnv());
}

function arg(args: string[], name: string, fallback?: string): string {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || !args[i + 1]) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required --${name}`);
  }
  return args[i + 1]!;
}
function flag(args: string[], name: string): boolean { return args.includes(`--${name}`); }
function list(args: string[], name: string, fallback: string[] = []): string[] {
  const i = args.indexOf(`--${name}`);
  return i === -1 || !args[i + 1] ? fallback : args[i + 1]!.split(',').map((s) => s.trim()).filter(Boolean);
}

const HELP = `
deletewe — jurisdiction-aware personal data removal

  brokers [--category C] [--json]        List the broker registry.
  jurisdictions                          List modelled legal instruments and deadlines.

  account:create --name N --locality L --residence R --email E [--plan family]
  account:invite --account ID
  account:join --account ID --token T --name N --locality L --residence R --email E
  account:seats --account ID
  account:leave --subject ID             Revoke consent and erase the subject.

  consent:text --residence R             Print the authorisation the subject signs.

  plan --subject ID [--limit N]          Plan requests. Sends nothing.
  send --subject ID [--limit N]          Plan and send via DELETEWE_TRANSPORT.
  tick                                   Run the scheduler once: follow-ups, escalation.

  reply:ingest --file F.eml              Classify and apply one inbound reply.

  custom --subject ID --url U            Submit a custom removal URL.

  dashboard --subject ID                 Print status, deadlines and breakdown.
  evidence --subject ID [--out DIR]      Build the exportable evidence pack.
  serve --token T [--port 8787]          Read-only JSON API.

Environment: DELETEWE_MASTER_KEY (required), DELETEWE_DB, DELETEWE_TRANSPORT,
DELETEWE_AGENT_NAME, DELETEWE_REPLY_TO, DELETEWE_LOG_LEVEL.
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); return 0; }
  if (flag(args, 'quiet')) setLevel('error');

  const registry: BrokerRegistry = defaultRegistry;
  const clock = systemClock;

  switch (cmd) {
    case 'brokers': {
      const cat = arg(args, 'category', '');
      const rows = cat ? registry.byCategory(cat as never) : registry.all();
      if (flag(args, 'json')) { console.log(JSON.stringify(rows, null, 2)); return 0; }
      console.log(`${rows.length} brokers (of ${registry.count()} total)\n`);
      for (const b of registry.prioritised(rows)) {
        console.log(
          `  ${b.id.padEnd(34)} ${b.category.padEnd(16)} ${b.surface.padEnd(8)} sev=${String(b.severity).padStart(2)}  ` +
          `${b.establishedIn.padEnd(6)} median=${b.medianResponseDays ?? '—'}d`,
        );
      }
      console.log(`\nby category: ${JSON.stringify(registry.summary())}`);
      return 0;
    }

    case 'jurisdictions': {
      const { INSTRUMENTS } = await import('./legal/jurisdictions.ts');
      for (const i of Object.values(INSTRUMENTS)) {
        console.log(`${i.id.padEnd(15)} ${String(i.responseDays).padStart(3)}d (+${i.extensionDays}d)  ` +
          `${i.rights.join(',').padEnd(52)} ${i.regulator.name}`);
      }
      return 0;
    }

    case 'consent:text': {
      console.log(authorisationDocument(AGENT_NAME, [arg(args, 'residence')]));
      return 0;
    }

    case 'account:create': {
      const store = openStore();
      const ids = identifiersFrom(args);
      const { account, owner } = createAccount(ids, arg(args, 'residence'),
        flag(args, 'plan') || arg(args, 'plan', 'individual') === 'family' ? 'family' : 'individual', clock.now());
      store.putAccount(account);
      store.putSubject(owner);
      store.putConsent(grantConsent({
        subjectId: owner.id,
        jurisdictions: [owner.residence],
        scopes: scopesFrom(args),
        signatureName: ids.fullName,
        method: 'in_person',
        agentName: AGENT_NAME,
        now: clock.now(),
        previousHash: null,
      }));
      console.log(`account ${account.id}\nowner subject ${owner.id}\nplan ${account.plan} (${account.maxSubjects} seats)`);
      store.close();
      return 0;
    }

    case 'account:invite': {
      const store = openStore();
      const inv = createInvite(store, arg(args, 'account'), clock.now());
      console.log(`invite token: ${inv.token}\nexpires:      ${inv.expiresAt}`);
      console.log('\nThe invitee must open this themselves and sign their own authorisation.');
      console.log('Store only the hash on your side:', inv.tokenHash);
      store.close();
      return 0;
    }

    case 'account:join': {
      const store = openStore();
      const token = arg(args, 'token');
      const { sha256 } = await import('./util/ids.ts');
      const { addDays } = await import('./util/clock.ts');
      const subject = acceptInvite(store, {
        invite: {
          id: 'cli', accountId: arg(args, 'account'), token,
          tokenHash: sha256(token), expiresAt: addDays(clock.now(), 1).toISOString(),
        },
        presentedToken: token,
        identifiers: identifiersFrom(args),
        residence: arg(args, 'residence'),
        signatureName: arg(args, 'name'),
        scopes: scopesFrom(args),
        agentName: AGENT_NAME,
        now: clock.now(),
      });
      console.log(`joined as subject ${subject.id}; own authorisation signed`);
      store.close();
      return 0;
    }

    case 'account:seats': {
      const store = openStore();
      for (const s of seatStatus(store, arg(args, 'account'), clock.now())) {
        console.log(`  ${s.subjectId}  ${s.residence.padEnd(7)} ${s.consented ? 'READY ' : 'BLOCKED'}  ${s.reason}`);
      }
      store.close();
      return 0;
    }

    case 'account:leave': {
      const store = openStore();
      const r = leaveAccount(store, arg(args, 'subject'), clock.now());
      console.log('erased:', JSON.stringify(r.deleted));
      store.close();
      return 0;
    }

    case 'plan': case 'send': {
      const store = openStore();
      const subject = store.getSubject(arg(args, 'subject'));
      if (!subject) { console.error('unknown subject'); store.close(); return 1; }
      const limit = Number(arg(args, 'limit', '0'));
      const plan = planRequests(subject, {
        registry,
        observations: store.observationsFor(subject.id),
        existing: store.requestsForSubject(subject.id),
      });
      const chosen = limit > 0 ? plan.requests.slice(0, limit) : plan.requests;

      console.log(`planned ${plan.requests.length} requests, skipped ${plan.skipped.length}`);
      for (const p of chosen.slice(0, 20)) {
        console.log(`  ${p.broker.name.slice(0, 40).padEnd(42)} ${p.entitlements[0]!.instrument.padEnd(14)} sev=${p.broker.severity}`);
      }
      if (cmd === 'plan') { store.close(); return 0; }

      const sender = new Sender({
        agentName: AGENT_NAME, replyToBase: REPLY_TO, clock,
        transport: transportFromEnv(), store,
      });
      const out = await sender.sendPlan(subject, chosen);
      console.log(`\nsent ${out.sent}, deferred ${out.deferred}, failed ${out.failed}`);
      for (const e of out.errors.slice(0, 10)) console.log(`  ! ${e.brokerId}: ${e.error}`);
      store.close();
      return out.failed > 0 && out.sent === 0 ? 1 : 0;
    }

    case 'tick': {
      const store = openStore();
      const outDir = arg(args, 'out', './var/complaints');
      mkdirSync(outDir, { recursive: true });
      const sched = new Scheduler({
        clock, store, registry, transport: transportFromEnv(), agentName: AGENT_NAME,
        complaintSink: (f, b) => writeFileSync(join(outDir, f), b),
      });
      const r = await sched.tick();
      console.log(`follow-ups ${r.followUps}, escalations ${r.escalations}, recurrences ${r.recurrences}, re-verifications ${r.reverifications}`);
      if (r.complaints.length) console.log(`complaint drafts written to ${outDir}:\n  ${r.complaints.join('\n  ')}`);
      store.close();
      return 0;
    }

    case 'reply:ingest': {
      const store = openStore();
      const raw = parseEml(readFileSync(arg(args, 'file'), 'utf8'), clock.now());
      const result = processReply(ingest(raw), { store, registry, now: clock.now() });
      console.log(`class=${result.classification.class} confidence=${result.classification.confidence} applied=${result.applied}`);
      console.log(`rules: ${result.classification.matchedRules.join(', ') || 'none'}`);
      console.log(result.reason);
      store.close();
      return 0;
    }

    case 'custom': {
      const store = openStore();
      const subject = store.getSubject(arg(args, 'subject'));
      if (!subject) { console.error('unknown subject'); store.close(); return 1; }
      const c = submitCustomRemoval(arg(args, 'url'), subject, registry, clock.now());
      store.putCustomRemoval(c);
      console.log(`kind=${c.kind} eligible=${c.eligible} routed=${c.routedTo}${c.brokerId ? ` broker=${c.brokerId}` : ''}`);
      console.log(c.reason);
      store.close();
      return 0;
    }

    case 'dashboard': {
      const store = openStore();
      const d = buildDashboard(store, registry, arg(args, 'subject'), clock.now());
      console.log(`${d.totalRequests} requests\n`);
      console.log(renderBreakdown(d.breakdown));
      if (d.overdue.length) {
        console.log('\nOVERDUE');
        for (const o of d.overdue.slice(0, 15)) console.log(`  ${String(o.daysOverdue).padStart(4)}d  ${o.brokerName} (${o.instrument})`);
      }
      if (d.upcoming.length) {
        console.log('\nDEADLINE COUNTDOWN');
        for (const u of d.upcoming.slice(0, 15)) console.log(`  ${String(u.daysRemaining).padStart(4)}d  ${u.brokerName}  due ${u.dueAt.slice(0, 10)}`);
      }
      store.close();
      return 0;
    }

    case 'evidence': {
      const store = openStore();
      const subject = store.getSubject(arg(args, 'subject'));
      if (!subject) { console.error('unknown subject'); store.close(); return 1; }
      const pack = buildEvidencePack(store, registry, subject, clock.now());
      const out = arg(args, 'out', '');
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'evidence.json'), JSON.stringify(pack, null, 2));
        writeFileSync(join(out, 'evidence.txt'), renderEvidencePack(pack));
        console.log(`wrote ${join(out, 'evidence.json')} and evidence.txt`);
        console.log(`manifest sha256: ${pack.manifestSha256}`);
      } else {
        console.log(renderEvidencePack(pack));
      }
      store.close();
      return 0;
    }

    case 'serve': {
      const store = openStore();
      const port = Number(arg(args, 'port', '8787'));
      const server = createDashboardServer({ store, registry, clock, token: arg(args, 'token'), port });
      server.listen(port, () => log.info('dashboard listening', { port }));
      return 0;
    }

    default:
      console.error(`unknown command: ${cmd}`);
      console.log(HELP);
      return 2;
  }
}

function identifiersFrom(args: string[]): SubjectIdentifiers {
  return {
    fullName: arg(args, 'name'),
    emails: list(args, 'email'),
    locality: arg(args, 'locality'),
    ...(list(args, 'address').length ? { streetAddresses: list(args, 'address') } : {}),
    ...(list(args, 'phone').length ? { phones: list(args, 'phone') } : {}),
    ...(arg(args, 'dob', '') ? { dateOfBirth: arg(args, 'dob') } : {}),
    ...(list(args, 'alias').length ? { aliases: list(args, 'alias') } : {}),
  };
}

function scopesFrom(args: string[]): ConsentScope[] {
  const s = list(args, 'scopes', ['erasure_requests', 'regulator_complaints', 'custom_removals']);
  return s as ConsentScope[];
}

main(process.argv.slice(2))
  .then((code) => { if (code !== 0) process.exitCode = code; })
  .catch((e) => {
    if (e instanceof InvalidIdentifiersError) {
      console.error('Cannot create this profile. These details are rendered verbatim into');
      console.error('legal letters sent to real companies, so they have to be real:\n');
      for (const p of e.problems) console.error(`  - ${p}`);
      console.error('\nFix the arguments and run the command again.');
      process.exitCode = 2;
      return;
    }
    console.error(`error: ${(e as Error).message}`);
    process.exitCode = 1;
  });
