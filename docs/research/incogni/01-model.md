# H1 — The operating model: scan-first, or request-to-all?

> **Hypothesis as posed:** "Does it send legal deletion requests (GDPR Art. 17,
> CCPA/CPRA, other state laws) to every broker on its list, without first scanning
> for the user's listings? How does it handle brokers that ignore requests?"

## Verdict: partly false. It is a *split* model, and the split is along broker type.

### 1.1 For private-database brokers: no scan. Algorithmic targeting.

Incogni's own help centre is unusually candid here:

> "the majority of data brokers operating in the United States are private-database
> data brokers that don't sell data directly to the public and don't have publicly
> searchable databases… Incogni doesn't scan the various data brokers on its list to
> find your profiles; instead, it uses an algorithm to predict which sites are likely
> to have your information."
>
> — `[SOURCED-INDIRECT]` <https://support.incogni.com/hc/en-us/articles/4904646940306-How-do-you-know-if-a-data-broker-has-my-personal-data>

And the consequence, stated by Incogni itself:

> "there can be false-positive cases where Incogni requests data removal from companies
> that don't have your data."
>
> — `[SOURCED-INDIRECT]`, same article.

This is architecturally forced, not a shortcut `[INFERRED]`: a marketing-data or
risk-mitigation broker has no public search endpoint, so the only way to learn whether
it holds you is to exercise a statutory **right of access** (GDPR Art. 15 / CCPA
"right to know") — which costs a full request cycle anyway. Firing the *deletion*
request directly is strictly cheaper and strictly faster, at the price of sending
requests to brokers that hold nothing.

### 1.2 For people-search sites: it does scan.

The current homepage states the opposite behaviour for the public-web category:

> "We scan people search sites for your personal information and send removal requests
> when records are found", with recurring re-scans on roughly a 10-day cycle.
>
> — `[SOURCED]` <https://incogni.com/>

People-search coverage was a **later addition** to the product, announced as the fifth
and final broker category `[SOURCED]`
(<https://blog.incogni.com/people-search-sites-announcement/>):

> "Incogni offers one of the most comprehensive personal information removal services,
> covering all broker types including marketing, recruitment, financial information,
> risk mitigation, and now people search sites."

`[INFERRED]` Incogni started as a pure request-to-all engine aimed at the invisible
private-database layer — the part DIY opt-out guides cannot reach — and bolted a
scan-first people-search pipeline on afterwards, because that category *is* publicly
scannable and because its competitors (DeleteMe, Optery) compete on visible,
screenshot-able people-search results.

### 1.3 Independent corroboration of "seed", not "search"

The peer-reviewed PoPETs 2025 measurement study classifies each service's *discovery
method*. Of 18 services surveyed, most are listed as `Google Search`. Incogni is one of
only three listed as **`Seed`** `[SOURCED]`
(<https://petsymposium.org/popets/2025/popets-2025-0125.php>, Table 1):

| Service | Discovery method | # covered brokers (as enumerated by researchers) |
|---|---|---|
| DeleteMe | Seed | 759 |
| Optery | Google Search | 125 / 243 / 743 (by tier) |
| Kanary | Google Search | 317 |
| **Incogni** | **Seed** | **217** |
| Mozilla Monitor | Google Search | 196 |
| EasyOptOuts | Google Search | 180 |

"Seed" here means the service works from a fixed seed list of brokers rather than
discovering listings by searching `[INFERRED, reading the paper's taxonomy]`. This
corroborates §1.1: the backbone of Incogni is a curated broker list that gets hit
regardless of whether a listing was observed.

The study also notes a direct consequence for Incogni users:

> "Incogni does not show users the specific PII contained in the retrieved records, so
> Incogni participants cannot self-assess their accuracy."
>
> — `[SOURCED]`, PoPETs 2025 §5.2.

`[INFERRED]` That is exactly what you would expect from a request-to-all design: for a
private-database broker there *is* no retrieved record to show the user, because nothing
was ever retrieved. The UI limitation is a tell for the architecture underneath.

### 1.4 Legal bases invoked

| Instrument | Status |
|---|---|
| GDPR (EU/EEA) — erasure, objection, withdrawal of consent | `[SOURCED]` Wikipedia; `[SOURCED-INDIRECT]` Incogni ToS summary |
| UK GDPR | `[INFERRED]` — UK is a supported country `[SOURCED]`, and UK GDPR is the only applicable instrument there |
| CCPA/CPRA (California) | `[SOURCED]` |
| PIPEDA (Canada) | `[SOURCED]` |
| Swiss FADP, Norway/Iceland/Liechtenstein (EEA) | `[INFERRED]` from the supported-country list `[SOURCED]` <https://incogni.com/pricing> |
| Other US state laws (VCDPA, CPA, CTDPA, …) | `[UNKNOWN]` — not named in any public Incogni material we found. Marketing names only GDPR, CCPA, PIPEDA. |
| California Delete Act / DROP | `[UNKNOWN]` — no public statement found about Incogni using DROP. DROP launched 2026-01-01; brokers must poll it every 45 days from 2026-08-01 `[SOURCED]` <https://privacy.ca.gov/data-brokers/> |

`[INFERRED]` The absence of per-state-law differentiation in marketing suggests Incogni
sends a *broad-spectrum* letter citing several instruments at once rather than a
precisely jurisdiction-matched one. That is cheap and robust, but it weakens the
statutory-deadline argument: you cannot credibly start a 45-day CCPA clock if you never
said which law you were invoking. deletewe takes the opposite choice (see ADR-0001).

### 1.5 How brokers that ignore requests are handled

The dashboard exposes an explicit **`Escalated`** state:

> "**Escalated:** When a data broker fails to comply with multiple removal requests.
> This means our team is taking additional measures and applying further pressure to
> ensure your data is removed."
>
> — `[SOURCED-INDIRECT]` <https://support.incogni.com/hc/en-us/articles/4904721869458-What-do-the-data-removal-statuses-on-my-dashboard-mean>

Escalation includes regulator complaints, enabled by the signed authorisation:

> "the authorization you signed when signing up for Incogni allows them to file
> complaints with relevant data protection agencies"
>
> — `[SOURCED-INDIRECT]`, reported across reviews; see [`sources.md`](sources.md).

Incogni also publishes a per-broker **compliance score** with four values —
`Compliant`, `Inconsistent`, `Resistant`, `Undetermined` — and a **severity rating**
(`Low`/`Medium`/`High`) reflecting data sensitivity, and says it **prioritises requests
by severity** `[SOURCED-INDIRECT]`
(<https://support.incogni.com/hc/en-us/articles/24959415440658-What-are-data-broker-compliance-score-severity-rating-and-status>).

`[INFERRED]` A persistent, per-broker compliance score computed across the whole
customer base is the most valuable asset in this product category and the hardest for a
new entrant to replicate. It is a network effect: every customer's request outcome
improves targeting and escalation policy for every other customer. deletewe should model
it from day one even while the data is thin — hence `BrokerComplianceStats` in the build.

### 1.6 What we could not establish

- `[UNKNOWN]` Whether escalation is automatic at a deadline or triggered by a human.
- `[UNKNOWN]` Whether Incogni actually files regulator complaints in volume, or whether
  the capability is mostly a deterrent cited in letters.
- `[UNKNOWN]` The algorithm used to predict broker likelihood. No public description.
- `[UNKNOWN]` Whether Incogni registered with or uses California's DROP platform.
