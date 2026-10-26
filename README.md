# deletewe

Open-source, jurisdiction-aware removal of your personal data from data brokers.

deletewe acts as **your** authorised agent, with your explicit consent, and sends
**statutory** deletion requests — not opt-out form submissions — to the brokers that
hold you. It is built around three decisions taken after reverse-engineering the two
dominant commercial approaches ([research](docs/research/), [ADR-0001](docs/adr/0001-hybrid-discovery-and-legal-request-engine.md)):

1. **A legal entitlement gates a request; an observed listing only enriches it.**
   Scanning finds people-search profiles. It cannot see the marketing, risk and
   financial brokers that hold the most sensitive data and have no public search page.
   So deletewe never withholds a lawful request because nothing was observed.

2. **Four outcomes, never summed.** "The broker deleted your data" and "the broker says
   it never had your data" are different facts. Every commercial service we studied
   merges them into one success number. deletewe reports them separately, each with
   the rank of the evidence behind it, and has no aggregate "removals completed" figure
   anywhere in the product.

3. **Erasure, objection and suppression in every letter.** Erasure addresses today;
   objection and a suppression-list undertaking are what stop you being re-listed in
   ninety days.

**Licence:** AGPL-3.0-or-later.

---

## Status

| | |
|---|---|
| Request engine, scheduler, classifier, store, dashboard, CLI | Working, tested |
| Broker list | 78 brokers, 7 categories, seeded from the California Privacy Protection Agency registry |
| Jurisdictions | 22 instruments: GDPR, UK GDPR, Swiss FADP, PIPEDA, CCPA/CPRA, CA Delete Act, and 16 US state acts |
| Request templates | **DRAFT — not reviewed by a lawyer.** Live sending is blocked in code until an operator attests review |
| Outbound transport | **Not shipped.** `dryrun` and in-process `mock` only; see [Sending for real](#sending-for-real) |
| Discovery / scanning | **Interface only.** No scraper is bundled |
| Tests | 170, all passing. No network access in the suite |

---

## Requirements

Node **24 or newer**, and nothing else. TypeScript runs natively via type stripping,
SQLite comes from `node:sqlite`, and there are **zero runtime dependencies**.
TypeScript itself is the only dev dependency, for typechecking.

```bash
npm install          # installs typescript + @types/node only
npm run gate         # typecheck + the full test suite
```

## Quick start

```bash
# 1. A key for field-level encryption at rest. Keep it out of the repo.
export DELETEWE_MASTER_KEY=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")
export DELETEWE_DB=./var/deletewe.sqlite
export DELETEWE_TRANSPORT=mock     # nothing leaves the process

alias deletewe='node --experimental-strip-types src/cli.ts'

# 2. What you are about to sign.
deletewe consent:text --residence US-CA

# 3. Create an account. This records your own authorisation.
#    Use real details: they are rendered verbatim into legal letters, and the
#    CLI rejects placeholders and under-18 dates of birth.
deletewe account:create \
  --name "Avery Nakamura" --locality "Oakland, California" \
  --residence US-CA --email avery@example.org

#    The commands below take the subject id that step 3 printed. Substitute it;
#    `subj_...` is not a wildcard.

# 4. See what would be sent, and to whom, under which law. Sends nothing.
deletewe plan --subject subj_... --limit 10

# 5. Send through the mock transport.
deletewe send --subject subj_... --limit 10

# 6. Status, deadline countdowns, the outcome breakdown.
deletewe dashboard --subject subj_...

# 7. Drive the clock: follow-ups, escalation, regulator complaint drafts.
deletewe tick

# 8. Export the evidence pack.
deletewe evidence --subject subj_... --out ./var/evidence
```

### Other commands

```bash
deletewe brokers [--category financial] [--json]   # the list, with provenance
deletewe jurisdictions                             # instruments and their deadlines
deletewe custom  --subject S --url URL             # classify a user-submitted URL
deletewe reply:ingest --file reply.eml             # classify and apply one reply
deletewe account:invite --account A                # family: a one-time link
deletewe account:join   --account A --token T ...  # the invitee signs their own
deletewe account:seats  --account A                # who can actually send
deletewe account:leave  --subject S                # revoke and erase
deletewe serve --token "$(openssl rand -hex 32)"   # read-only JSON API on :8787
```

### Rebuilding the broker list

```bash
curl -o var/cppa-registry.csv https://cppa.ca.gov/data_broker_registry/registry.csv
npm run seed:cppa -- var/cppa-registry.csv src/brokers/seed/brokers.json 70
```

The list is data in the repository, with a generator anyone can re-run. A broker count
nobody outside can audit is a trust liability; a list anybody can diff is a trust asset.

---

## How it works

```
   Subject + consent                Broker list (78)
          │                                │
          ▼                                ▼
   ┌──────────────────────────────────────────────┐
   │ resolveEntitlements(subject, broker)         │  the (residence, establishment)
   │   -> ordered legal instruments               │  pair, not either alone
   └───────────────────┬──────────────────────────┘
                       ▼
   ┌──────────────────────────────────────────────┐
   │ planner  -> priority by severity             │
   │ letter   -> consent gate, minimum-PII,       │
   │             erasure + objection + suppression│
   │ sender   -> per-broker rate limit, transport │
   └───────────────────┬──────────────────────────┘
                       ▼
   ┌───────────────┐        ┌─────────────────────┐
   │ scheduler     │◀──────▶│ inbound mailbox     │
   │ deadline      │        │ classify reply      │
   │ follow-up     │        │ (11 classes, rules) │
   │ escalate      │        └─────────────────────┘
   │ recur 60/90d  │
   │ reverify 10d  │        low confidence -> human review queue, never a guess
   └───────┬───────┘
           ▼
   dashboard + evidence pack (hash-verified letters, 4 separate outcomes)
```

### Privacy properties, and where they are enforced

| Property | Enforced in |
|---|---|
| Consent per adult, per jurisdiction, per scope | `src/consent/consent.ts` — called from the **letter composer**, so no code path can route around it |
| Minimum PII per broker | `minimise()` in `src/templates/letter.ts`; only what a broker needs is rendered |
| Encryption at rest | `src/crypto/envelope.ts` — AES-256-GCM, AAD bound to `table:column:row` so a ciphertext cannot be moved between rows |
| No personal data in logs | `src/util/redact.ts` + `src/util/logging.ts` — the logger has no raw-output escape hatch |
| Deletion is real | `Store.deleteSubject` removes rows; `account:leave` is available to the member, not only the owner |
| Tamper-evident consent | Hash-chained consent log; the evidence pack reports `chainValid` |

---

## Sending for real

**deletewe ships no live transport, and `send` refuses to use one.** Two gates:

```
DELETEWE_TRANSPORT=smtp   ->  LiveTransportNotConfiguredError
<your own Transport>      ->  TemplatesNotReviewedError, unless
                              DELETEWE_TEMPLATES_REVIEWED names a reviewer and a date
```

This is deliberate. Before anything reaches a real company in a real person's name you
need: a qualified lawyer's review of the templates for every jurisdiction you use; an
owned sending domain with SPF, DKIM and DMARC; a warmed sending reputation; and a
monitored inbound mailbox. Shipping a one-line SMTP client would make it a single
config change to skip all four. Implement `Transport` in your own deployment.

---

## Documentation

| | |
|---|---|
| [`docs/research/incogni/`](docs/research/incogni/) | Reverse-engineering dossier, every claim labelled sourced or inferred |
| [`docs/research/deleteme-vs-incogni.md`](docs/research/deleteme-vs-incogni.md) | Scan-first vs request-to-all, with a weighted scorecard |
| [`docs/adr/0001-...`](docs/adr/0001-hybrid-discovery-and-legal-request-engine.md) | The architecture decision and its consequences |
| [`docs/playbook/`](docs/playbook/) | Checklists: adding a jurisdiction, a template, a classifier rule |
| [`AGENTS.md`](AGENTS.md) | Conventions for agents and contributors working in this repo |

## A caution

deletewe sends legal requests in your name. The templates are drafts, the deadlines are
a developer's reading of the statutes, and a badly-aimed removal request can be
unpleasant for an uninvolved person. Read [`docs/playbook/pitfalls.md`](docs/playbook/pitfalls.md)
before you point this at anything real.
