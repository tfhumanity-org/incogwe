# H2 — Coverage: how many brokers, which categories, which regions, what cadence

## 2.1 Broker count: the claimed number and the measured number disagree

| Figure | Value | Source |
|---|---|---|
| Marketed automated coverage | **420+** data brokers | `[SOURCED]` <https://incogni.com/> and <https://incogni.com/pricing> |
| Additional sites via Custom Removals (Unlimited tier) | **3,000+** | `[SOURCED]` <https://incogni.com/pricing> |
| Deloitte-assured figure, as of 2025-07-18 | **"at least 420 data-broker websites and private databases"** | `[SOURCED]` <https://en.wikipedia.org/wiki/Incogni> |
| Cumulative removal requests since 2022-01 | **> 245 million** | `[SOURCED]` Wikipedia, Deloitte-assured |
| Independently enumerated by academic researchers | **217** | `[SOURCED]` PoPETs 2025 Table 1 |

`[INFERRED]` The gap (217 vs 420+) is most likely definitional rather than dishonest.
The researchers de-duplicated by eTLD+1 `[SOURCED]`, so a broker operating twelve
people-search front-ends collapses to however many distinct registrable domains it has;
and "private databases" with no website at all cannot be enumerated from outside at all.
A marketer counts *entities contacted*; a measurement study counts *domains observable*.
Both can be true. But it means **"420+ brokers" is not independently verifiable from
outside, and the Deloitte report is the only third-party check on it.**

`[INFERRED]` For deletewe this argues for publishing the broker list itself as data in
the repository — a number nobody can check is a trust liability, a list anybody can diff
is a trust asset. AGPL-3.0 makes this natural.

## 2.2 Categories

Incogni names **five** broker categories, with people-search added last `[SOURCED]`
(<https://blog.incogni.com/data-brokers-incogni-covers/>,
<https://blog.incogni.com/people-search-sites-announcement/>):

| Category | What Incogni says it is |
|---|---|
| **Marketing** | "help companies create traditional and targeted advertising campaigns by selling them access to detailed consumer profiles" |
| **Recruitment** | "compile and use personal information to offer background screening services to HR officers" |
| **Risk mitigation** | "supply health and financial information to investors, financial institutions, and insurance companies… can also affect your insurance rates and ability to get approved for credit cards and loans" |
| **Financial information** | "used by credit card companies to assess eligibility… deal in some of the most sensitive personal information there is, like your Social Security number and credit history" |
| **People search** | "Almost an open book… usually available for free to find extensive profiles, contact details, and background information about anyone" |

**Health information** is described by Incogni as a broker type that collects health
data and sells it into healthcare `[SOURCED]`, but it is presented within the risk
mitigation / financial framing rather than as a sixth top-level category
`[INFERRED]` — the marketing consistently says "all five broker types".

Severity is scored 1–10, bucketed: **1–3 low, 4–6 medium, 7–10 high** `[SOURCED]`
(<https://blog.incogni.com/data-brokers-incogni-covers/>).

### Explicitly *not* covered `[SOURCED]` (cyberinsider review)

Court records, social media accounts, news articles, and user-controlled content.
`[INFERRED]` This is the correct boundary and deletewe should state it just as plainly:
these are either public-interest records with no erasure right, or content the user can
delete themselves, or press subject to freedom-of-expression carve-outs (GDPR Art. 17(3)(a)).

## 2.3 Regions

> "Incogni is available to residents of the US (including Puerto Rico, Guam, the US
> Virgin Islands, American Samoa, and the Northern Mariana Islands), Canada, the EU,
> Switzerland, the UK, Norway, Iceland, and Liechtenstein."
>
> — `[SOURCED]` <https://incogni.com/pricing>

Wikipedia additionally lists the **Isle of Man** `[SOURCED]`.
One review summarises this as "34 countries under a single subscription" `[SOURCED]`
(cyberinsider) — contrasted with DeleteMe's country-specific plans.

`[INFERRED]` The list is exactly "jurisdictions with a general-purpose statutory erasure
right that a third party can exercise as an agent." Notable absences: Australia (Privacy
Act has no general erasure right), Brazil (LGPD has one, but enforcement/agent practice
is immature), Japan, India. Those absences are a legal-coverage fact, not a
product-ambition fact.

## 2.4 Cadence

| Thing | Interval | Source |
|---|---|---|
| Recurring requests, **public** brokers | within **60 days** | `[SOURCED]` Wikipedia, citing the Deloitte assurance report |
| Recurring requests, **private** brokers | within **90 days** | `[SOURCED]` same |
| People-search **re-scan** | ~**10 days** | `[SOURCED]` <https://incogni.com/> |
| Most requests fulfilled within | **45 days** | `[SOURCED-INDIRECT]` Incogni marketing; matches CCPA's 45-day statutory period `[INFERRED]` |
| Custom removals turnaround | 7–30 days typical, up to 45–60 | `[SOURCED]` security.org; <https://support.incogni.com/hc/en-us/articles/25640663945106-...> `[SOURCED-INDIRECT]` |

`[INFERRED]` Three separate clocks — a fast scan loop for the visible web, a 60-day loop
for public brokers, a 90-day loop for private ones — is the right shape and deletewe
copies it, because re-listing risk is highest exactly where observation is cheapest.

## 2.5 The regulatory ground truth nobody is using yet

The California Privacy Protection Agency publishes the **Data Broker Registry** as an
open CSV: **865 rows** in the snapshot we downloaded on 2026-10-27, with 77 disclosure
columns including whether each broker collects minors' data, government ID numbers,
biometrics, precise geolocation and reproductive-health data, and whether it sold data
to foreign actors, the federal government, law enforcement, or generative-AI developers
`[SOURCED]` <https://cppa.ca.gov/data_broker_registry/registry.csv>.

The PoPETs study found **71.7% of data brokers are not registered with government
authorities at all** `[SOURCED]`, and separately that cross-service broker-list overlap
is very low — mean Jaccard similarity **0.21**, with Incogni's highest pairwise overlap
being only 0.19 `[SOURCED]`.

`[INFERRED]` Two conclusions for deletewe:
1. **No vendor's list is the market.** If the best pairwise overlap is 0.19, then
   switching services changes *which* brokers you reach far more than *how many*.
   Union-of-lists is a real product advantage, and an open list invites contribution.
2. **The CPPA registry is free, authoritative, machine-readable seed data** with
   legal-contact and sensitivity signals already in it. deletewe seeds from it. It also
   covers the hard part — the private-database brokers that have no website to scrape.
