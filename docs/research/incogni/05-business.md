# H5 — Business: Surfshark bundling, positioning, marketing vs independent findings

## 5.1 Ownership and distribution

- Created by **Surfshark in 2021**, launched publicly **2022**, later offered as a
  standalone product `[SOURCED]` <https://en.wikipedia.org/wiki/Incogni>.
- Surfshark merged with Nord Security in 2022 `[INFERRED — widely reported; not re-verified here]`.
  Note that **nordvpn.com hosts an Incogni landing page** `[SOURCED]`
  <https://nordvpn.com/incogni/>, which is only explicable under common ownership.
- Bundled into **Surfshark One+** alongside VPN, Antivirus, Alert (breach monitoring),
  Search, and **Alternative ID** `[SOURCED]` <https://surfshark.com/incogni>, bleepingcomputer deal coverage.
- Observed bundle pricing: One+ with Incogni at **$4.29/month**, ~**$95 for the first
  year** against a $250.20 MSRP `[SOURCED]` bleepingcomputer/pcworld deal pages.

### The bundling arithmetic `[INFERRED]`

Incogni standalone is $95.88/yr. Surfshark One+ *including* Incogni plus four other
products has been promoted at ~$95/yr. The data-removal component inside the bundle is
therefore priced at **close to zero marginal revenue**.

That only makes sense if Incogni is doing a job other than earning subscription revenue:

1. **Churn defence.** A VPN is trivially substitutable and competes on price. A data
   removal service accrues *state* — months of request history, suppression-list
   entries, a compliance record per broker. Cancelling restarts the clock. It is the
   stickiest thing in the bundle.
2. **Marginal cost is near zero.** The architecture (§1.1) is bulk email against a fixed
   seed list. Adding a bundle subscriber costs a few hundred emails, not a few hundred
   human minutes. Compare DeleteMe, whose human-specialist model makes free bundling
   structurally impossible.
3. **Distribution without CAC.** Affiliate/review-site marketing in this category is
   expensive and saturated; a bundle converts existing VPN subscribers at zero
   acquisition cost. Incogni's own public job postings skew to **affiliate marketing**
   and **data analyst** roles `[SOURCED]` builtin.com listings — a distribution-led, not
   engineering-led, public hiring posture `[INFERRED]`.

> **The strategic lesson generalises beyond this product:** when a competitor gives away
> your whole product as a bundle feature, you cannot win on price. You win on the axis
> the bundle cannot serve — here, *evidence quality* and *legal precision*, both of which
> cost something per user and therefore cannot be given away free at scale.

## 5.2 Positioning

Marketing stance `[SOURCED]`, homepage/pricing/blog:

- "Set it and forget it" automation; minimal user effort; no ID documents.
- Breadth-first: "420+ data brokers", "3,000+ sites", "all five broker types".
- Legal framing front and centre: GDPR, CCPA, PIPEDA named explicitly.
- Trust via third-party validation: Deloitte, SOC 2 Type 2, BBB A+, PCMag/PCWorld
  Editors' Choice 2025 `[SOURCED]` Wikipedia.
- Single subscription spans ~34 countries `[SOURCED]` cyberinsider — a direct swipe at
  DeleteMe's country-specific plans.

## 5.3 Marketing claims vs independent findings

| Claim | Independent finding | Gap |
|---|---|---|
| "420+ data brokers covered" `[SOURCED]` | Researchers enumerated **217** after eTLD+1 de-duplication `[SOURCED]` PoPETs Table 1 | Definitional, probably honest, but **not externally verifiable**. The Deloitte report is the only outside check. |
| Deloitte "confirms verified removals" `[SOURCED]` homepage | Deloitte gave **limited** assurance over Incogni's *stated metrics and processes*, incl. that confirmations are *received* `[SOURCED]` | "Verified removals" in marketing ≠ "verified that removals occurred". Nobody checked broker databases. |
| Best-in-class removal rate | **76.6%** — genuinely the best of four tested `[SOURCED]` PoPETs §6 | **The number is self-reported dashboard status.** The authors explicitly did not establish ground truth `[SOURCED]`. |
| "Removes your personal information" | Only **41.1%** of records surfaced by these services were confirmed by users as actually theirs; 30.7% wrong, 28.2% unsure `[SOURCED]` PoPETs §5.2 | Incogni users could not even self-assess, because Incogni does not show the record contents `[SOURCED]`. |
| Comprehensive protection | Mean cross-service Jaccard overlap **0.21**; **71.7%** of brokers unregistered with any authority `[SOURCED]` | No single service covers the market. "Comprehensive" is unachievable by anyone today. |
| Progress is transparent | **No screenshots** of removed listings, unlike Optery/DeleteMe `[SOURCED]` cyberinsider | Transparency is about *process*, not *proof*. |

### Caveats that cut the other way, in fairness

- The PoPETs cohort was **mainly US university students** — younger, shorter employment
  history, less likely to own property or appear in court filings `[SOURCED]` §7.1. The
  authors flag this explicitly as a generalisability limit. Real customers are probably
  *more* exposed, so absolute rates may not transfer.
- The study ran a **one-month** subscription. Incogni's own cycle is 60–90 days
  `[SOURCED]`, so the study measured roughly the first third of one cycle.
- Incogni was nonetheless **the best performer tested**, and had the **lowest between-user
  variance** (4.5 vs Optery's 72.5) `[SOURCED]` — consistency is a real quality signal.
- Deloitte assurance of "we don't sell your data and take no money from brokers"
  `[SOURCED]` is a genuinely meaningful disclosure in a market where
  OneRep's founder was reported to have operated people-search sites
  `[INFERRED — widely reported in 2024 trade press; not re-verified in this pass]`.

## 5.4 What a new entrant should take, and what it should refuse

**Take:**
- Legal requests *are* the product. Scanning is discovery; the statutory right is leverage.
- Per-broker compliance scoring across the whole customer base is the compounding asset.
- Three separate cadences (fast scan loop, 60-day public, 90-day private).
- Collect the minimum PII that the *right* requires, not the maximum the *match* wants.
- Near-zero marginal cost is what makes bundling and family plans possible.

**Refuse:**
- Do **not** merge "deleted" and "never held it" into one success number.
- Do **not** report a removal rate derived from the vendor's own dashboard as if it were
  measured.
- Do **not** treat a broker's confirmation email as the end of the evidential chain.
- Do **not** ship a broker count that nobody outside can audit.
