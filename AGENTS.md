# AGENTS.md — working in deletewe

Conventions for agents and contributors. Read this before writing code.
Deeper material lives in [`docs/playbook/`](docs/playbook/).

---

## What this project is

deletewe sends **statutory** personal-data deletion requests to data brokers, as the
**authorised agent** of a consenting adult. It is not a scraper, not an opt-out form
filler, and not a marketing site.

Three decisions from [ADR-0001](docs/adr/0001-hybrid-discovery-and-legal-request-engine.md)
govern everything. If a change conflicts with one, the change is wrong unless it comes
with a superseding ADR:

1. **Entitlement gates a request; an observed listing only enriches it.** Never withhold
   a lawful request because nothing was observed.
2. **Four terminal outcomes, never summed.** `verified_absent`, `confirmed_deleted`,
   `no_data_held`, `refused`/`deadline_missed` are different facts with different
   evidence ranks. There is no aggregate "removals completed" number in this product,
   and there must never be one.
3. **Every letter asserts erasure AND objection/opt-out AND suppression**, under the
   instrument that applies to the (user residence, broker establishment) pair.

---

## Non-negotiables

These are enforced in code and in tests. Do not weaken them to make something pass.

| Rule | Where it lives | Why |
|---|---|---|
| **Consent is checked inside the letter composer**, not at an API edge | `assertConsent()` called from `composeLetter()` | It is the narrowest waist a letter must pass through, so no code path can route around it |
| **One adult cannot consent for another** | `ConsentRequiredError` on subject mismatch | A family-plan owner's signature authorises nothing for another adult, under GDPR or CCPA |
| **No live transport ships** | `transportFromEnv`, `TemplatesNotReviewedError` | Draft legal letters must not be one config change away from real companies |
| **Minimum PII per broker** | `minimise()` + `Broker.requiredIdentifiers` | Collect per-flow, not per-account |
| **No personal data in logs** | `log.*` always passes fields through `redact()`; no escape hatch | A log aggregator is a second copy of the thing the user hired us to reduce |
| **Redaction must not corrupt opaque ids** | `OPAQUE_ID_RE` + boundary-anchored patterns in `redact.ts` | A mangled `replyId` silently breaks log-to-record correlation — see [pitfalls #12](docs/playbook/pitfalls.md) |
| **Personal data encrypted at rest** | `seal()`/`open()`, AES-256-GCM, AAD bound to `table:column:row` | A ciphertext cannot be moved between rows |
| **Deletion is real** | `Store.deleteSubject` removes rows | A flag is not erasure |
| **No network in tests** | `MockTransport` has no socket | CI must never produce live broker traffic |

---

## Stack and constraints

- **Node 24+. Zero runtime dependencies.** TypeScript runs natively via type stripping;
  SQLite is `node:sqlite`; tests are `node:test`. TypeScript is the only dev dependency.
- **Do not add a runtime dependency** without a strong reason in the PR description.
  A privacy product's dependency tree is part of its threat model.
- **`erasableSyntaxOnly` is on.** No `enum`, no parameter properties, no namespaces —
  anything requiring emit will fail the typecheck. Use `const` objects with
  `as const satisfies …` instead of enums.
- **`noUncheckedIndexedAccess` is on.** Index access yields `T | undefined`. Use `!`
  only where you have genuinely just proved non-emptiness.
- **Imports use explicit `.ts` extensions.**

---

## The gate

```bash
npm run gate     # tsc --noEmit && node --test
```

**Both must pass before every commit.** No exceptions, no `.skip`, no `--test-only`
left in a commit.

When a test fails, establish whether the test or the code is wrong *before* editing
either. Three of this build's failures were wrong expectations, and one of them
documented a real property worth keeping ([pitfalls #10](docs/playbook/pitfalls.md)).

---

## Layout

```
src/
  types.ts          domain types; the four-outcome rule lives here as EVIDENCE_RANK
  legal/            instruments, entitlement resolution, deadlines, regulators
  templates/        the renderer, the letters, the composer (and the consent gate)
  brokers/          registry + seed data (generated + curated, both with provenance)
  engine/           planner, rate limiter, transports, sender, scheduler, escalation
  mailbox/          inbound attribution, rules, classifier, reply processing
  consent/          authorisation text, grant/revoke, hash chain, the gate
  profiles/         family accounts, invitations, seats
  custom/           user-submitted URL classification (a safety control)
  store/            encrypted SQLite
  dashboard/        timeline, evidence pack, read-only HTTP API
  util/             ids, clock, redaction, logging
tools/import-cppa.ts   regenerates the broker seed from the CPPA registry
tests/                 170 tests; fixtures/emails/ holds redacted broker replies
```

---

## Writing code here

**Comments explain *why*.** This codebase makes unusual choices for defensible reasons —
rules instead of a model, no live transport, four outcomes instead of one. A reader who
does not know the reason will "simplify" it away. Say why, once, where the decision is.
Do not narrate what the next line does.

**Prefer a type over a convention.** The reason there is no "total removals" field is
that `OutcomeBreakdown` has no such field, not that we agreed not to add one.

**Injectable clock.** Never call `new Date()` in engine code; take a `Clock`. Tests use
`fixedClock`.

**Errors are named and specific.** `ConsentRequiredError`, `NoEntitlementError`,
`TemplatesNotReviewedError`, `SeatLimitError`. The sender switches on them; a bare
`Error` is a lost behaviour.

**Every broker row carries `provenance`.** A list nobody can audit is a trust liability.

---

## Research conventions

When studying a competitor or a law, label **every** claim:

| Label | Meaning |
|---|---|
| `[sourced]` | Read directly on a public page; URL given |
| `[sourced-indirect]` | Public page blocked a plain fetch; quoted via a search excerpt. Weaker |
| `[inferred]` | Our reasoning from sourced facts. Not stated by anyone |
| `[unknown]` | We looked and could not establish it |

- **Public sources only.** No account creation, no logged-in scraping, no circumventing
  an access control. A 403 is answered with `[sourced-indirect]` and a note in
  `sources.md`, never with a spoofed user agent — see
  [pitfalls #11](docs/playbook/pitfalls.md).
- `[unknown]` is a result. Quietly inferring past a gap is how research becomes fiction.
- Record blocked sources explicitly, so a reader can judge the evidence.

---

## Things that need a human, always

Do not do these autonomously:

- **Send to a real broker.** Any live transport, any real request. Ask first.
- **Push, deploy, or open a PR.** Ask first.
- **Remove the template-review gate**, or set `DELETEWE_TEMPLATES_REVIEWED` to anything
  other than a real reviewer's name and date.
- **File a regulator complaint.** Drafts are generated; filing is a human act, and the
  engine records `NOT filed — requires human review` on every draft.
- **Add a scraper or discovery adapter** that fetches from a live broker site.
- **Commit an un-redacted email fixture.** Replace real identities with the test persona.

---

## Commit style

Conventional-commit prefix, then a body that says **what changed and why**, not a
file list. Where a change implements or revises a decision, name the ADR clause
(`ADR-0001 D2`). Where it fixes something subtle, state the failure it prevents —
future readers need the reason more than the diff.
