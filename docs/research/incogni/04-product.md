# H4 — Product surface: onboarding, authorisation, statuses, custom removals, family, pricing, audit

## 4.1 Onboarding and the PII collected

| Field | Status |
|---|---|
| Full legal name | Mandatory `[SOURCED]` PoPETs Table 2; `[SOURCED]` cyberinsider |
| Email address(es) | Mandatory; **up to 3** `[SOURCED]` cyberinsider, security.org |
| Physical address(es) | Mandatory; **up to 3** `[SOURCED]` |
| Date of birth | *Optional* per PoPETs Table 2 `[SOURCED]`; listed as mandatory by reviewers `[SOURCED]` cyberinsider/security.org |
| Phone number | *Optional* per PoPETs Table 2 `[SOURCED]`; listed as mandatory by reviewers |
| Government ID | **Not collected** `[SOURCED]` cyberinsider (explicit contrast with DeleteMe) |

The PoPETs classification is the more rigorous one `[INFERRED]` — it records what the
form *requires*, while reviewers describe what the onboarding flow *asks for*. Either
way Incogni sits at the **low end** of PII collection for its coverage level. PoPETs
observes the general rule: *"Removal services with larger data broker coverage tend to
require additional PII from subscribers"* `[SOURCED]` — Incogni is the exception, and
that is only possible because it does not scan (§1.1): matching a listing needs more
identifiers than asserting a deletion right does `[INFERRED]`.

Onboarding time measured by one reviewer: **8 minutes 42 seconds** `[SOURCED]` cyberinsider.

> **Design lesson for deletewe:** the minimum PII needed to *assert a right* is smaller
> than the minimum needed to *find a listing*. Collect per-flow, not per-account.

## 4.2 The authorised-agent signature

> "Sign an online authorization form to grant us the right to demand data brokers and
> people search sites remove your personal information."
>
> — `[SOURCED]` <https://incogni.com/>

The authorisation reportedly grants the right to: erase personal information, withdraw
consent to processing, object to processing, and file complaints with data protection
authorities `[SOURCED-INDIRECT]` (ToS/privacy policy as summarised across reviews).

`[INFERRED]` Three things are notable by their absence:
1. **No identity proof is collected**, yet CCPA §1798.185 and the CPRA regulations let a
   business require the consumer to verify their own identity when an authorised agent
   submits on their behalf. Incogni's answer to a verification challenge can therefore
   only be "here is more profile data", or bouncing the challenge to the user.
2. **One signature, many jurisdictions.** A single form is used across GDPR, CCPA and
   PIPEDA, which have materially different agent-authorisation formalities.
3. `[UNKNOWN]` Whether the signed artefact is retained in a form that can be produced to
   a broker or regulator on demand (a signed PDF with timestamp), or is just a database
   boolean.

deletewe treats the authorisation as **evidence**: a content-addressed, hash-chained,
per-jurisdiction consent record that can be exported into the evidence pack.

## 4.3 Dashboard

Statuses: `In progress`, `Completed`, `Monitoring`, `Suppressed`, `Escalated`
`[SOURCED-INDIRECT]` — see [`03-request-lifecycle.md`](03-request-lifecycle.md) §3.1 for
verbatim definitions and the conflation problem in `Completed`.

Per-broker metadata shown to users `[SOURCED-INDIRECT]`
(<https://support.incogni.com/hc/en-us/articles/24959415440658-...>):

- **Compliance score**: `Compliant` | `Inconsistent` | `Resistant` | `Undetermined` —
  "how fast and reliable a data broker is in complying with removal requests".
- **Severity rating**: `Low` | `Medium` | `High` — data sensitivity; 1–10 scale bucketed
  3/3/4 `[SOURCED]` blog.
- Filtering by broker type, severity, compliance and request status `[SOURCED-INDIRECT]`.
- Monthly email digest with removal counts and "hours saved" `[SOURCED]` cyberinsider.

**Not provided:** screenshots of removed listings, or the PII a broker held `[SOURCED]`
— see §3.2.

## 4.4 Custom removals

Available on **Unlimited** tiers only `[SOURCED]` <https://incogni.com/pricing>.
Flow `[SOURCED]` (<https://blog.incogni.com/remove-your-data-with-incogni-unlimited/>, security.org):

1. User pastes a full URL into the **Custom Removals** tab and submits.
2. Incogni reviews the link **for eligibility** against its guidelines.
3. Specialists work removals **manually**, three at a time, in submission order.
4. Typical 7–30 days; some sites up to 45–60 days.

Claimed reach: **3,000+ additional sites** `[SOURCED]`.

`[INFERRED]` "Eligibility review" is the load-bearing step and is undocumented. It is
where out-of-scope categories (court records, news, social media, third parties' content)
get rejected — and it is the only place in the product where someone checks that the URL
is about *the subscriber* and not about somebody else. For deletewe this is a **safety
control, not a support workflow**: a user-submitted URL is the one input that could be
weaponised against a non-consenting person. See `src/custom/` and ADR-0001 §Consent.

## 4.5 Family plans

- Up to **5 members** `[SOURCED]` <https://incogni.com/pricing>.
- Owner generates an **invitation link** from *Subscription & Plan*; links are valid
  **24 hours** `[SOURCED]`.
- **Each member gets their own profile and dashboard**, sends independent removal
  requests, is re-scanned on the 60–90 day cycle, and can add up to 3 emails and
  3 addresses of their own `[SOURCED]`.
- `[UNKNOWN]` Whether each adult member signs their **own** authorisation form.
  No public source states this either way. The invite-link + own-dashboard design makes
  it very likely `[INFERRED]`, since the owner's signature cannot lawfully authorise an
  agent to act for a different adult under GDPR or CCPA.
- `[UNKNOWN]` Minor/dependant handling.

> **deletewe makes this explicit rather than likely:** every adult profile has its own
> consent record, captured through a link the invitee opens themselves, and no request
> can be rendered for a profile whose consent record is absent, expired or revoked.
> This is enforced in code (`ConsentRequiredError`), not in policy.

## 4.6 Pricing (as listed 2026-10-27, `[SOURCED]` <https://incogni.com/pricing>)

| Plan | Monthly | Annual | Members | Custom removals |
|---|---|---|---|---|
| Standard | $7.99/mo | $95.88/yr | 1 | — |
| Unlimited | $14.99/mo | $179.88/yr | 1 | Unlimited (3,000+ sites) + live phone support |
| Family | $15.99/mo | $191.88/yr | 5 | — |
| Family Unlimited | $22.99/mo | $275.88/yr | 5 | Unlimited |

All plans: 24/7 support, monthly progress reports, **30-day money-back guarantee**, no
free trial `[SOURCED]`. Heavy first-year discounting is permanent-looking (55–58% off
observed) `[SOURCED]` homepage/cyberinsider.

`[INFERRED]` Family at 2× Standard for 5× the people implies marginal cost per profile
is low and dominated by fixed engineering, not per-request cost — consistent with a
bulk-email architecture. Contrast DeleteMe's family-of-4 at ~$329/yr `[SOURCED]`, which
is ~2.5× Incogni's family-of-5 and reflects human labour per profile.

## 4.7 The Deloitte assurance report — what it actually verified

| Attribute | Value |
|---|---|
| Auditor | **Deloitte Lietuva UAB** `[SOURCED]` cyberinsider |
| Type | **Independent limited assurance report, ISAE 3000** `[SOURCED]` |
| Issued | August 2025 `[SOURCED]` |
| "As of" date | **2025-07-18** `[SOURCED]` Wikipedia |

Assertions reported as covered `[SOURCED]` (Wikipedia, cyberinsider):

1. Coverage of **at least 420** data-broker websites and private databases.
2. Removal **confirmations are received** from those brokers.
3. Recurring requests sent within **60 days** (public) / **90 days** (private).
4. **> 245 million** removal requests processed since January 2022.
5. Incogni **does not sell customer data** and has **no commercial relationships with
   data brokers**.

Separately: **SOC 2 Type 2** examination completed, **BBB accredited A+** `[SOURCED]`
Wikipedia.

### What it does *not* establish `[INFERRED]`

- **Limited** assurance is a negative-form conclusion ("nothing came to our attention"),
  not the positive opinion of a reasonable-assurance engagement. It is the weaker tier.
- It is assurance over **Incogni's own stated metrics and processes**. It is not an audit
  of data brokers, and it does **not** verify that any individual's data was deleted from
  any broker's database.
- Assertion 2 — "confirmations are received" — verifies that **emails arrived saying
  deletion happened**. That is a statement about Incogni's inbox, not about the broker's
  database. §3.2 applies in full.
- Point 5 is the genuinely valuable one `[INFERRED]`: "we are not ourselves a data broker,
  and we are not paid by the brokers we write to" is precisely the conflict-of-interest a
  sceptical buyer worries about in this market, and it is cheap for an auditor to check
  and expensive for a competitor to fake.

> **Trust-signal lesson:** the audit's commercial value is almost entirely in being
> *first* and in the brand "Deloitte", not in the strength of the assurance tier. An
> AGPL-3.0 project cannot buy a Big Four logo, but it can offer something structurally
> stronger: a reproducible evidence pack and a public broker list that anybody can diff.
