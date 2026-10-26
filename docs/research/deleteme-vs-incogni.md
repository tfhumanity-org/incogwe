# Scan-first vs request-to-all: DeleteMe and Incogni compared

**Date:** 2026-10-27 · **Purpose:** choose deletewe's operating model.
Source labelling follows [`research/incogni/README.md`](research/incogni/README.md).
Incogni facts are sourced in [`research/incogni/`](research/incogni/); DeleteMe facts
are sourced inline.

---

## 0. The two archetypes, stated precisely

**Scan-first (DeleteMe, Optery, Kanary, Mozilla Monitor).**
Search the public web and people-search sites for listings matching a user profile.
For each *observed* listing, run that broker's opt-out procedure. Evidence is a
before/after artefact — a screenshot of the listing and of its absence.

**Request-to-all (Incogni).**
Hold a curated seed list of brokers. For each user, assert a statutory right against
every broker predicted likely to hold them, whether or not a listing was ever observed.
Evidence is the correspondence trail — the request sent and the broker's reply.

Neither archetype is pure. Incogni scans people-search sites `[SOURCED]`
<https://incogni.com/>. DeleteMe is classified `Seed` discovery by PoPETs `[SOURCED]`
and sends opt-outs to brokers on its list. The real question is **which signal gates
the request**: an observed listing, or a legal entitlement.

---

## 1. Head-to-head

| Dimension | DeleteMe (scan-first) | Incogni (request-to-all) |
|---|---|---|
| Gating signal | Observed listing | Statutory entitlement + likelihood model |
| Brokers enumerated by researchers | **759** `[SOURCED]` PoPETs T1 | **217** `[SOURCED]` PoPETs T1 |
| Brokers marketed | 750–850+ `[SOURCED]` reviews | **420+** `[SOURCED]` incogni.com |
| Default-plan brokers | ~85–100 `[SOURCED]` cyberinsider | 420+ on every plan `[SOURCED]` |
| Custom removals | 40/yr standard, 60/yr premium `[SOURCED]` | Unlimited on Unlimited tiers `[SOURCED]` |
| Mandatory PII | Name, email, **physical address, DOB, phone** `[SOURCED]` PoPETs T2 | Name, email, physical address `[SOURCED]` PoPETs T2 |
| Government ID | **Required** (photo ID upfront) `[SOURCED]` cyberinsider | **Not collected** `[SOURCED]` |
| Evidence to user | Quarterly reports **with screenshots** `[SOURCED]` | Status timeline, **no screenshots** `[SOURCED]` |
| Shows what PII broker held | Yes `[SOURCED]` | **No** `[SOURCED]` PoPETs §5.2 |
| Third-party audit | None published `[SOURCED]` cyberinsider | Deloitte ISAE 3000 limited assurance + SOC 2 Type 2 `[SOURCED]` |
| Labour model | Human specialists `[SOURCED]` | Automated bulk + humans on escalation/custom `[SOURCED]`/`[INFERRED]` |
| Individual price | $129/yr `[SOURCED]` | $95.88/yr `[SOURCED]` |
| Family | 4 people ≈ $329/yr `[SOURCED]` | **5 people $191.88/yr** `[SOURCED]` |
| Regions | Country-specific plans `[SOURCED]` | One subscription, ~34 countries `[SOURCED]` |
| Cadence | Quarterly reports; ongoing re-scan `[SOURCED]` | 10-day people-search re-scan; 60d public / 90d private `[SOURCED]` |
| Measured removal rate (1 month) | not in the 4-service arm | **76.6%**, best of four `[SOURCED]` PoPETs §6 |

---

## 2. Coverage

Scan-first coverage is bounded by **what you can see**. It is excellent on people-search
sites, which are designed to be found, and structurally blind to the private-database
layer — marketing aggregators, risk-mitigation and financial brokers that have no public
search endpoint. Those brokers hold the data with the highest severity rating
`[SOURCED]`, and they are the majority of US brokers `[SOURCED-INDIRECT]` Incogni help centre.

Request-to-all coverage is bounded by **what you can enumerate**. It reaches the invisible
layer, at the cost of sending requests to brokers holding nothing.

The decisive datum is that neither reaches the market: mean pairwise Jaccard overlap
across ten services is **0.21**, and Incogni's best pairwise overlap is **0.19**
`[SOURCED]` PoPETs. Meanwhile **71.7%** of brokers are registered with no authority at all
`[SOURCED]`.

> **Conclusion.** Coverage is a *list* problem before it is a *method* problem. The
> method determines which half of the market you can touch; the list determines how much
> of that half you actually reach. An open, diffable, contributable list is therefore a
> stronger lever for an AGPL project than either method.

---

## 3. Cost per user

| | DeleteMe | Incogni |
|---|---|---|
| Dominant cost | Human minutes per listing | Email volume + inbound classification |
| Scales with | Listings found (grows with user exposure) | Broker count (fixed per user) |
| Marginal cost of +1 user | High and roughly linear | Near zero |
| Evidence of this | Family-of-4 at ~2.5× Incogni's family-of-5 `[INFERRED]` from `[SOURCED]` prices | Given away inside a $95 five-product bundle `[SOURCED]` |

Incogni's 245M requests over ~43 months ≈ **190k requests/day** `[INFERRED]` from
`[SOURCED]` figures. That volume is only reachable with automated send *and* automated
reply handling.

> **Conclusion.** Request-to-all is the only model whose unit economics survive at
> bundle pricing. Scan-first buys evidence quality with labour. A project that wants both
> must find evidence quality that is *cheap* — re-verification by machine where the web
> is public, and a rigorous correspondence record where it is not.

---

## 4. Legal strength

This is where request-to-all is genuinely, not just economically, superior — **if the
template is precise.**

- An opt-out form submission is a **contractual/policy** act. The broker's own UI defines
  the outcome, there is usually no acknowledgement, no deadline, and no appeal.
- A statutory erasure request is a **legal** act. It starts a clock (GDPR 1 month; CCPA
  45 days; PIPEDA 30 days), obliges a response, creates a record, and makes
  non-response itself actionable before a regulator.

You do not need to prove the broker holds you to exercise the right — "tell me what you
hold and erase it" is a complete and valid request. That asymmetry is the whole basis of
request-to-all.

But Incogni appears to leave value on the table `[INFERRED]`: its public material names
only GDPR, CCPA and PIPEDA, with no sign of per-state differentiation (VCDPA, CPA, CTDPA
etc.) `[UNKNOWN]`. A letter that does not name the instrument it invokes cannot credibly
start that instrument's clock, which weakens both the follow-up and the eventual
regulator complaint.

> **Conclusion.** Legal requests are the product. The leverage is in the *precision* of
> the instrument cited, not the volume of letters sent. Jurisdiction-aware templating is
> a genuine differentiator available to a small team, because it is a knowledge problem,
> not a scale problem.

---

## 5. Evidence quality

Ranked by what each artefact actually proves:

| Rank | Artefact | Proves | Who has it |
|---|---|---|---|
| 1 | Independent re-observation that a public listing is gone | The data is gone from the public surface | DeleteMe, Optery (screenshots) |
| 2 | Broker's written confirmation of deletion | The broker *says* it deleted | Both |
| 3 | Broker's reply that it holds nothing | Nothing, about deletion | Both — Incogni **merges this into "Completed"** `[SOURCED]` |
| 4 | Proof a request was sent, plus silence | A deadline breach, which is itself actionable | Both |
| 5 | A vendor dashboard counter | Only what the vendor chose to count | Both |

Everything published about this category's effectiveness sits at rank 5. The PoPETs
76.6% is consolidated **dashboard status codes** `[SOURCED]` §6, and the authors state
plainly that they did not verify removals with brokers `[SOURCED]` §7.1. Deloitte's
assurance reaches rank 2 at best — it confirms confirmations are *received* `[SOURCED]`.

> **Conclusion.** The category has no rank-1 evidence at scale, and nobody has an
> incentive to produce it, because it can only lower the headline number. This is the
> clearest open position in the market and it is cheap to occupy for the public half:
> re-scan, diff, record the diff as a distinct fact with its own provenance.

---

## 6. User effort

Incogni wins decisively and it is worth being honest about why.

| | DeleteMe | Incogni |
|---|---|---|
| Onboarding | Free scan, then full profile + **photo ID** `[SOURCED]` | ~8m42s, no ID `[SOURCED]` |
| Ongoing | Read quarterly reports; act on custom-removal budget | None; monthly digest `[SOURCED]` |
| Privacy cost of using it | Hand a privacy vendor your government ID | Name, email, address `[SOURCED]` |

Requiring a government ID to run a privacy service is a real and underrated cost: it
creates exactly the concentrated identity dataset the user hired you to reduce. Incogni's
lower PII floor is a direct structural consequence of not scanning `[INFERRED]` —
asserting a right needs fewer identifiers than matching a listing.

> **Conclusion.** Minimum-PII is not only a compliance posture, it is a feature, and the
> request-first model is what makes it affordable. Collect per-flow: ask for the extra
> identifier only when a specific broker's matching or verification actually demands it.

---

## 7. Resilience to re-listing

Re-listing is the defining long-run failure mode: brokers re-acquire from upstream
sources and the profile reappears.

| Mechanism | DeleteMe | Incogni |
|---|---|---|
| Detect reappearance | Re-scan — works only where listings are visible | 10-day people-search re-scan `[SOURCED]`; **private brokers cannot be observed at all** |
| Prevent reappearance | Opt-out, usually not a suppression undertaking | **`Suppressed` state** — broker undertakes not to re-collect `[SOURCED-INDIRECT]` |
| Re-assert | Re-run opt-out | 60d/90d recurring statutory requests `[SOURCED]` |

Suppression is the strongest available outcome and it is only obtainable by *asking for
it in the request*. GDPR Art. 21 objection and the CCPA right to opt out of sale/sharing
are forward-looking: they bind future processing, where erasure only addresses the
present. A request that asks solely for erasure guarantees you will be back in 90 days.

For the private layer, recurrence is the **only** instrument — there is no way to observe
a reappearance, so you must re-assert on a clock.

The California Delete Act changes this materially from 2026-08-01: brokers must poll DROP
every 45 days and delete on an ongoing basis `[SOURCED]` <https://privacy.ca.gov/data-brokers/>.
That is a state-operated suppression list — structurally better than anything a vendor can
build, and for Californian users it should be the *first* action, not a differentiator
`[INFERRED]`.

> **Conclusion.** Always ask for erasure **and** suppression/objection in the same letter.
> Re-send on a clock for the invisible layer; re-scan for the visible one. Use DROP where
> the user is eligible.

---

## 8. Scorecard

Weighted for an AGPL-3.0 project with no Big Four budget and no human-ops team.

| Dimension | Weight | Scan-first | Request-to-all | Winner |
|---|---|---|---|---|
| Coverage of high-severity private brokers | 20% | 2/10 | 9/10 | request-to-all |
| Coverage of people-search | 15% | 9/10 | 7/10 | scan-first |
| Cost per user | 20% | 3/10 | 9/10 | request-to-all |
| Legal strength | 15% | 4/10 | 8/10 | request-to-all |
| Evidence quality | 15% | 8/10 | 4/10 | scan-first |
| User effort / PII minimisation | 10% | 4/10 | 9/10 | request-to-all |
| Re-listing resilience | 5% | 5/10 | 7/10 | request-to-all |
| **Weighted total** | | **4.65** | **7.75** | |

Request-to-all wins on the axes that are *structural*. Scan-first wins on the axes that
are *additive* — you can bolt scanning and screenshot evidence onto a request engine, but
you cannot bolt a request engine's economics onto a human-labour scanning operation.

---

## 9. Recommendation

**Build a legal-request engine as the spine, and attach scanning as a discovery and
verification plug-in, not as the gate.**

Concretely, the hybrid is three decisions:

1. **Entitlement gates the request; observation enriches it.** Never withhold a lawful
   request because nothing was observed. Attach an observed listing to the request when
   one exists, because it defeats "we cannot locate your record" and makes re-verification
   possible.
2. **Three terminal states, never merged.** `CONFIRMED_DELETED`, `NO_DATA_HELD`, and
   `REFUSED` are different facts, and `VERIFIED_ABSENT` (re-observed gone) is a fourth,
   stronger than all of them. Report them separately, always.
3. **Every request asks for erasure + suppression + objection together**, in the
   instrument that actually applies in the user's jurisdiction and the broker's.

Recorded as [ADR-0001](../adr/0001-hybrid-discovery-and-legal-request-engine.md).
