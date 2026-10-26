# Incogni — Reverse-Engineering Dossier

**Target:** Incogni (<https://incogni.com>), a subscription personal-data-removal
service operated by Surfshark B.V. / Incogni Inc.
**Date of research:** 2026-10-27
**Researcher:** deletewe build agent
**Method:** public sources only — marketing site, help centre, blog, pricing page,
published assurance report coverage, peer-reviewed academic measurement, independent
reviews, press, and public government registries.

## Rules of engagement actually followed

- No account was created, no login was used, no paywalled or gated content accessed.
- `support.incogni.com` and `blog.incogni.com/deloitte-assurance/` returned HTTP 403/404
  to a plain fetch. **No user-agent spoofing or WAF evasion was attempted.** Where help-centre
  content appears below it is quoted from search-engine indexed excerpts of those public
  articles, and is labelled `[SOURCED-INDIRECT]` with the canonical article URL.
- One public government dataset was downloaded: the California Privacy Protection Agency
  Data Broker Registry CSV. It is an openly published registry, no access control.

## Claim labelling

Every factual claim in this dossier carries exactly one label:

| Label | Meaning |
|---|---|
| `[SOURCED]` | Directly read on a public page; URL given. |
| `[SOURCED-INDIRECT]` | Public page blocked a plain fetch; quoted via a search-engine excerpt of that page. Canonical URL given. Treat as weaker. |
| `[INFERRED]` | Our reasoning from sourced facts. Not stated by anyone. |
| `[UNKNOWN]` | We looked and could not establish it from public sources. |

## Contents

| File | Hypothesis tested |
|---|---|
| [`01-model.md`](01-model.md) | H1 — Does it request-to-all without scanning? How are ignoring brokers handled? |
| [`02-coverage.md`](02-coverage.md) | H2 — How many brokers, which categories, which regions, what cadence? |
| [`03-request-lifecycle.md`](03-request-lifecycle.md) | H3 — Lifecycle, reply handling at scale, automated vs human. |
| [`04-product.md`](04-product.md) | H4 — Onboarding, authorisation, statuses, custom removals, family, pricing, audit. |
| [`05-business.md`](05-business.md) | H5 — Surfshark bundling, positioning, marketing vs independent findings. |
| [`sources.md`](sources.md) | Full source list with retrieval notes. |

## Headline verdict on the five hypotheses

| # | Hypothesis as posed | Verdict |
|---|---|---|
| 1 | Sends legal deletion requests to **every** broker without scanning first | **Partly false — it is a split model.** Private-database brokers: no scan possible, requests sent on algorithmic likelihood. People-search sites: Incogni's own homepage says it *scans* and sends "when records are found". |
| 2 | Coverage ~hundreds of brokers, multi-category, multi-region, periodic re-send | **Confirmed**, but the public broker count (420+) is roughly **double** what independent researchers could enumerate (217). |
| 3 | sent → reply → verification → completed/escalated | **Confirmed in shape.** `Escalated` is a real public dashboard state. Degree of automation in reply handling is `[UNKNOWN]`. |
| 4 | Onboarding collects PII, signed authorised-agent form, statuses, custom removals, family, Deloitte audit | **Confirmed.** The Deloitte engagement is a *limited assurance* report over stated operational metrics — it is **not** verification that any individual user's data was deleted. |
| 5 | Bundled with Surfshark, marketing vs reality gap | **Confirmed.** Bundled in Surfshark One+. Clear gap: marketing says "removed", the best independent study measured **self-reported dashboard status**, not ground truth. |

## The single most important finding for deletewe

Incogni's "Completed" state **explicitly includes brokers that said they never held
your data** `[SOURCED-INDIRECT]`, and Incogni admits its request targeting produces
false positives `[SOURCED-INDIRECT]`. The peer-reviewed PoPETs 2025 study separately
found that only **41.1%** of records surfaced by removal services were confirmed by
the user as actually theirs `[SOURCED]`, and that it could **not** establish ground
truth for removals at all `[SOURCED]`.

So the industry's headline metric — "N removals completed" — is partly a measure of
requests sent into the void. A product that wants to be honest has to separate
*request sent*, *broker responded*, and *absence independently re-verified* into three
different facts. deletewe does this; see [`../../adr/0001-hybrid-discovery-and-legal-request-engine.md`](../../adr/0001-hybrid-discovery-and-legal-request-engine.md).
