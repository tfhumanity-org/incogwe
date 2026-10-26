# What Incogni teaches

Four transferable lessons from the [research dossier](../research/incogni/). Each is
stated as the lesson, the evidence, and what we actually did about it.

---

## 1. Compliance automation at scale: the shape is three clocks, not one

**What they do.** 245M+ removal requests since January 2022 — roughly 190k a day
`[inferred from Deloitte-assured figures]` — against a curated list, on three separate
cadences: a ~10-day re-scan of people-search sites, 60-day recurrence for public
brokers, 90-day for private ones `[sourced]`.

**Why three.** Each clock is matched to what you can *observe*. Where listings are
visible, re-observation is cheap and frequent. Where they are not, the only instrument
is re-assertion on a statutory cadence, which is expensive and therefore slower.

**The non-obvious part.** The cadence is not a nicety — it is the entire defence against
re-listing. A broker re-acquires from an upstream source and the profile returns. A
service that sends one request per broker per lifetime is selling a snapshot.

**What we did.** `RECURRENCE_DAYS = { public: 60, private: 90 }` and
`REVERIFICATION_DAYS = 10` in `src/legal/deadlines.ts`, with `decideAction()` as the
single place that decides what a request needs today. One function, fully unit-tested,
rather than cadence logic smeared across the scheduler.

**The transferable rule:** *when you automate a compliance loop, the interval is a
function of observability, not of politeness. Find the cheapest observation you can make
and run that loop fast; run the expensive one only as fast as the statute allows.*

---

## 2. Legal requests as the product

**What they do.** The product is a letter, not a form submission. The marketing names
GDPR, CCPA and PIPEDA explicitly `[sourced]`, and the signed authorisation is the thing
being sold — it is what converts "please remove me" into an obligation with a deadline.

**Why it matters more than coverage.** An opt-out form is a contractual act: the broker's
UI defines the outcome, there is no acknowledgement, no clock, no appeal. A statutory
request starts a period (GDPR one month, CCPA 45 days, PIPEDA 30), obliges a response,
creates a record, and makes *silence itself* actionable. You do not need to prove the
broker holds you — "tell me what you hold and erase it" is complete and valid. That
asymmetry is the whole basis of sending to brokers you cannot scan.

**Where they leave value on the table.** Public Incogni material names only three
instruments. We found no evidence of per-state differentiation — no VCDPA, CPA, CTDPA
`[unknown]`. A letter that does not name the instrument it invokes cannot credibly start
that instrument's clock, which weakens both the follow-up and any later complaint.

**What we did.** `resolveEntitlements(subject, broker)` keys on the **pair** of (user
residence, broker establishment) and returns a ranked list. Rank 0 drives the template,
the citations and the deadline; ranks 1–2 are cited in the alternative. 22 instruments
modelled, each with its own rights set, response period, extension and regulator.

**The transferable rule:** *precision in a regulated domain is a knowledge problem, not
a scale problem — which makes it exactly the axis where a small team can beat a funded
incumbent. Find the thing the incumbent does approximately because approximation is
cheaper at their volume, and do it exactly.*

---

## 3. Trust signals: understand what the audit actually says

**What they have.** The first Deloitte-verified data removal service: an ISAE 3000
*limited* assurance report from Deloitte Lietuva UAB, August 2025, as of 2025-07-18,
plus SOC 2 Type 2 and BBB A+ `[sourced]`.

**What it verified.** Coverage of at least 420 brokers; that removal confirmations are
*received*; the 60/90-day recurrence; 245M+ requests processed; and that Incogni does not
sell customer data and has no commercial relationship with any data broker `[sourced]`.

**What it did not verify.** That anyone's data was actually deleted from any broker's
database. Assertion two is a statement about Incogni's **inbox**, not about a broker's
database. And "limited" assurance is the weaker tier — a negative-form "nothing came to
our attention", not a positive opinion.

**The genuinely valuable part** is the conflict-of-interest disclosure: *we are not
ourselves a data broker and we take no money from the ones we write to*. That is cheap
for an auditor to check, expensive for a competitor to fake, and precisely the thing a
sceptical buyer in this market worries about.

**What we did.** We cannot buy a Big Four logo, so we built the structurally stronger
thing: every letter stored with the sha256 recorded at send time, a hash-chained consent
log, and an evidence pack whose manifest digest a third party can verify
(`src/dashboard/evidence.ts`). Plus the broker list as diffable data with a generator
anyone can re-run.

**The transferable rule:** *read what an audit scopes, not what the marketing page says
it proves. Then ask which of your own claims a sceptic could check without trusting you.
Make those claims; drop the rest.*

---

## 4. Distribution through bundling, and what it does to your pricing

**What they do.** Incogni standalone is $95.88/yr. Surfshark One+ — VPN, antivirus,
breach alerts, Alternative ID **and** Incogni — has been promoted at ~$95 for the first
year `[sourced]`. The data-removal component inside the bundle earns close to zero
marginal revenue.

**Why that is rational.** Near-zero marginal cost (bulk email against a fixed list, not
human minutes) makes it free to add a subscriber. Zero customer-acquisition cost, in a
category where affiliate marketing is saturated. And it is the stickiest thing in the
bundle: a VPN is substitutable on price, whereas months of request history, suppression
entries and a per-broker compliance record are state that cancelling destroys.

**What it means for you.** You cannot win on price against a product being given away.
Note the corollary: a human-labour service like DeleteMe *cannot* be bundled this way,
which is why its family-of-four costs ~2.5× a competitor's family-of-five `[sourced]`.

**What we did.** Competed on the axis the bundle cannot serve — evidence quality and
legal precision, both of which cost something per user and therefore cannot be given away
free at scale — and on being auditable, which a closed product cannot be at any price.

**The transferable rule:** *when a competitor bundles your whole product as a feature,
stop comparing feature lists. Ask what the bundle's economics forbid them from doing, and
go and do that.*

---

## The bonus lesson: find the metric everyone is quietly fudging

Incogni's `Completed` status means "the broker removed your data **or** confirmed it
didn't have it" — their own definition `[sourced]`. Combined with their admission that
targeting is algorithmic and produces false positives `[sourced]`, a real share of every
user's headline number is brokers that never held anything, and the user cannot see the
split.

Meanwhile the best independent study (PoPETs 2025) reports 76.6% for Incogni — the best
of four tested — but the authors state outright that they measured **dashboard status
codes** and did not establish ground truth with any broker `[sourced]`.

So the category's central number is unverified by construction, and nobody has an
incentive to fix it, because fixing it can only make the number smaller.

**This is the most valuable thing a study of a competitor can produce.** Not a feature
to copy — a number everyone reports that nobody has checked. deletewe's four-outcome
rule (`EVIDENCE_RANK` in `src/types.ts`) exists entirely because of this finding, and the
type system makes the misleading aggregate unrepresentable.
