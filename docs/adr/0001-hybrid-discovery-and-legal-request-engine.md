# ADR-0001 — A legal-request engine with pluggable discovery

- **Status:** Accepted
- **Date:** 2026-10-27
- **Deciders:** deletewe maintainers
- **Supersedes:** none
- **Context docs:** [`../research/incogni/`](../research/incogni/), [`../research/deleteme-vs-incogni.md`](../research/deleteme-vs-incogni.md)

## Context

deletewe removes personal data from data brokers on behalf of a consenting user. Two
operating models exist in the market and we must choose between them.

**Scan-first** (DeleteMe, Optery) searches for listings and acts on matches. It produces
excellent evidence and is structurally blind to brokers with no public search surface —
which is most US brokers, and the ones holding the most sensitive data.

**Request-to-all** (Incogni) asserts a statutory right against a curated broker list
regardless of observation. It reaches the invisible layer and costs almost nothing per
user, but its evidence is weak, and in Incogni's implementation the success metric merges
"deleted" with "never held it" (`[SOURCED]` — see research dossier §3.1).

Three findings drive this decision:

1. **No vendor's list is the market.** Mean pairwise Jaccard overlap across ten services
   is 0.21; 71.7% of brokers are registered with no authority (`[SOURCED]` PoPETs 2025).
2. **Nobody in the category has rank-1 evidence.** Every published removal rate is the
   vendor's own dashboard status. The best academic study says outright that it did not
   establish ground truth (`[SOURCED]` PoPETs §7.1).
3. **Legal precision is a knowledge problem, not a scale problem** — therefore it is
   available to a small open-source team in a way that broker-list size and Big Four
   audits are not.

## Decision

**The spine of deletewe is a jurisdiction-aware legal request engine. Discovery is a
pluggable input to it, never a gate on it.**

### D1 — Entitlement gates the request; observation only enriches it

A request is sent when the user has a statutory right against that broker and has
consented. An observed listing, when one exists, is attached as evidence — it defeats
"we cannot locate your record" and it makes later re-verification possible — but its
absence never blocks a lawful request.

*Implementation:* `RequestPlanner` consumes `Entitlement[]` (from jurisdiction rules) and
optional `Observation[]` (from discovery adapters). Discovery adapters are an interface
with a null implementation; deletewe ships no live scraper by default.

### D2 — Four terminal outcomes, never merged into one number

| Outcome | Meaning | Evidence rank |
|---|---|---|
| `VERIFIED_ABSENT` | We re-observed the public listing and it is gone | 1 |
| `CONFIRMED_DELETED` | The broker stated in writing that it deleted | 2 |
| `NO_DATA_HELD` | The broker stated it holds nothing about this person | 3 — proves nothing about deletion |
| `REFUSED` / `DEADLINE_MISSED` | Actionable; feeds escalation | 4 |

The dashboard and the evidence pack report these separately and always show the
rank. There is no aggregate "removals completed" figure anywhere in the product.

*Rationale:* this is the single clearest gap in the competitor's product, it costs
nothing to get right, and getting it wrong is the kind of thing that destroys a privacy
brand when someone finally measures it.

### D3 — Every request asserts erasure **and** suppression **and** objection

Erasure addresses the present; objection and opt-out-of-sale bind the future; a
suppression-list undertaking is the strongest practical outcome. Asking for all three in
one letter costs one paragraph and is the only defence against re-listing on the
invisible layer.

### D4 — Jurisdiction pairs, not a single broad-spectrum letter

Template selection is a function of **(user residence, broker establishment)**, not of
either alone. A Californian writing to an EU-established broker has rights under both
CCPA and GDPR; the letter must cite the instrument whose clock it intends to start,
because an unnamed instrument cannot support a later deadline breach or regulator
complaint.

*Implementation:* `resolveEntitlements(subject, broker)` returns an ordered list; the
primary instrument drives the template and the deadline, secondaries are cited in support.

### D5 — Three cadences

| Loop | Interval | Applies to |
|---|---|---|
| Re-verification scan | 10 days | brokers with a public listing surface |
| Recurring re-assertion | 60 days | public brokers |
| Recurring re-assertion | 90 days | private-database brokers |

Matches the intervals Deloitte assured for the competitor (`[SOURCED]`), which is the
only externally-checked cadence evidence in the market.

### D6 — Consent is enforced in code, per adult, per jurisdiction

No request can be rendered or sent for a subject without an active, unexpired, unrevoked
consent record naming that jurisdiction's agent-authorisation basis. Family members each
sign their own; the account owner's signature authorises nothing for another adult. A
custom-removal URL is checked against the submitting subject's own identifiers before any
flow runs.

*Implementation:* `ConsentRequiredError` is thrown from the render path, not checked at
the API edge — so no code path can route around it.

### D7 — Minimum PII, collected per-flow, encrypted per-field

The floor is name + email + a locality. Date of birth, phone and street address are
requested only when a specific broker's matching or verification demands them
(`Broker.requiredIdentifiers`). Government ID is never collected. All subject fields are
AES-256-GCM encrypted at rest with per-field AAD binding; logs receive redacted
projections only, enforced by a `redact()` boundary the logger will not accept raw
subjects past.

### D8 — The broker list is data in the repository, under AGPL-3.0

Seeded from the California Privacy Protection Agency registry (an open government CSV)
plus curated people-search entries. A broker count nobody can audit is a trust liability;
a list anybody can diff is a trust asset, and it is the one asset that compounds through
contribution rather than spend.

## Consequences

**Positive**

- Reaches the high-severity private-database layer that scan-first services cannot see.
- Near-zero marginal cost per subject; family plans and bundling remain viable.
- Honest metrics by construction — the misleading aggregate is not representable.
- Legal precision is our differentiator and it is open-source-shaped.
- Deadline breach becomes a product feature (escalation) rather than a failure.

**Negative**

- We will send requests to brokers holding nothing about the user. This is inherent to
  the model; we mitigate it by recording `NO_DATA_HELD` honestly and by feeding the
  outcome back into per-broker likelihood scoring.
- Without a default scraper, people-search evidence is weaker than DeleteMe's until a
  discovery adapter is supplied by the operator.
- Per-jurisdiction templates need qualified legal review before any live use. They are
  shipped as drafts and the engine refuses live transport until an operator explicitly
  attests review (`DELETEWE_TEMPLATES_REVIEWED`).
- Running an inbound mailbox at volume means owning deliverability and sending reputation
  — a real operational burden, out of scope for the code and flagged for a human.

**Rejected alternatives**

- *Pure scan-first.* Cannot see the brokers that matter most; labour cost incompatible
  with an open project.
- *Pure request-to-all, copying Incogni.* Inherits the evidence weakness and the metric
  conflation that are the competitor's clearest flaws.
- *Submit opt-out web forms instead of legal requests.* No clock, no record, no appeal,
  and per-broker scrapers rot continuously.
