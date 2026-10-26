# H3 — Request lifecycle, reply handling at scale, automation boundary

## 3.1 The observable state machine

Incogni's public dashboard exposes these per-broker states `[SOURCED-INDIRECT]`
(<https://support.incogni.com/hc/en-us/articles/4904721869458-What-do-the-data-removal-statuses-on-my-dashboard-mean>,
<https://support.incogni.com/hc/en-us/articles/27962946457234-How-do-I-check-all-requests-sent-to-a-specific-data-broker-and-what-do-the-statuses-mean>):

| Status | Incogni's definition (quoted) |
|---|---|
| **In progress** | "The number of data brokers processing your removal requests according to laws like GDPR and CCPA. Processing times vary, and we follow up with companies that fail to act within the legally required timeframe." |
| **Completed** | "The number of data brokers that have either **removed your data or confirmed they didn't have it**." |
| **Monitoring** | "The initial removal request is complete. Since brokers often re-collect data, Incogni will send them recurring removal requests to keep your information off their lists." |
| **Suppressed** | "The data broker has added your information to its internal suppression list and has agreed not to collect, trade, or store your data again in the future." |
| **Escalated** | "When a data broker fails to comply with multiple removal requests. This means our team is taking additional measures and applying further pressure." |

Reconstructed state machine `[INFERRED]`:

```
                    ┌──────────────┐
    (targeting) ───▶│  IN PROGRESS │
                    └──────┬───────┘
          broker replies   │   statutory deadline passes, no reply
         ┌─────────────────┼─────────────────────┐
         ▼                 ▼                     ▼
  ┌────────────┐   ┌───────────────┐      ┌────────────┐
  │ COMPLETED  │   │  SUPPRESSED   │      │ ESCALATED  │
  │ (deleted   │   │ (do-not-      │      │ (follow-up,│
  │  OR no     │   │  collect      │      │  regulator)│
  │  data held)│   │  undertaking) │      └─────┬──────┘
  └─────┬──────┘   └───────┬───────┘            │
        └──────────┬───────┘                    │
                   ▼                            │
            ┌─────────────┐                     │
            │ MONITORING  │◀────────────────────┘
            │ (60/90-day  │   (on eventual compliance)
            │  re-send)   │
            └─────────────┘
```

### The conflation that matters

**`Completed` merges two genuinely different outcomes**: "the broker deleted your data"
and "the broker says it never had your data." Incogni's own definition says so
`[SOURCED-INDIRECT]`, and an independent reviewer flagged it unprompted:

> "'completed' doesn't always mean removal — it may indicate Incogni confirmed the
> broker has no file on you."
>
> — `[SOURCED]` <https://www.security.org/data-removal/incogni/>

`[INFERRED]` Given §1.1 (requests sent on algorithmic likelihood, with admitted false
positives), a non-trivial share of every user's "Completed" count is brokers that were
never holding anything. The headline number is therefore inflated by exactly the amount
the targeting algorithm is wrong — and the user cannot see the split. **deletewe keeps
`CONFIRMED_DELETED` and `NO_DATA_HELD` as separate terminal states and never adds them
into one number.**

## 3.2 Verification

| Question | Finding |
|---|---|
| Does Incogni show proof of removal? | **No screenshots.** "Incogni tracks removal progress and has been independently audited by Deloitte, but it doesn't provide screenshots of removed listings." `[SOURCED]` cyberinsider |
| Does it show what PII the broker held? | **No.** "Incogni does not show users the specific PII contained in the retrieved records." `[SOURCED]` PoPETs 2025 §5.2 |
| Does it ask the user for ID documents? | **No** — contrasted with DeleteMe, which "requires sharing government-issued ID photos upfront" `[SOURCED]` cyberinsider |
| Is removal independently re-verified? | `[UNKNOWN]`. The PoPETs authors state they could not establish ground truth either: *"due to ethical and budgetary constraints, we do not ask participants to verify whether their PII had been removed from data brokers as claimed by the removal services."* `[SOURCED]` |

`[INFERRED]` **This is the weakest link in the entire category.** Every published
"removal rate" — Incogni's 76.6%, everyone else's — is a measurement of *what the
vendor's own dashboard said*, not of what the broker's database contains. For
people-search sites this is cheaply fixable (re-scan the public listing and diff). For
private-database brokers it is not fixable without a statutory **access** request, which
costs another full request cycle. deletewe therefore treats re-verification as a
first-class, separately-recorded fact with a provenance type, rather than letting a
broker's own email be the end of the story.

## 3.3 Handling broker replies at scale

This is the part Incogni documents least and the part that matters most operationally.

**What is sourced:**
- Requests are sent "via an automated process" `[SOURCED-INDIRECT]` help centre.
- 245M+ requests processed since January 2022 `[SOURCED]` Deloitte-assured.
- Follow-ups for brokers "that fail to act within the legally required timeframe"
  `[SOURCED-INDIRECT]` — i.e. there is deadline tracking.
- Escalation is described as "**our team** is taking additional measures"
  `[SOURCED-INDIRECT]` — i.e. there is a human in that loop.
- Custom removals are explicitly human: specialists "work through them three at a time
  and in the order they came in" `[SOURCED]` security.org.

**What is inferred:**

`[INFERRED]` 245M requests over ~43 months is ~5.7M/month, ~190k/day. Even at a 10%
reply rate that is ~19k inbound emails/day. No human team reads that. There is
necessarily an automated inbound classifier. The visible evidence for it is that
`Completed`, `Suppressed` and `Escalated` are *distinct machine-rendered states* —
"added to a suppression list" is a specific thing a broker says in prose, and
distinguishing it from "we deleted your record" requires parsing the reply, not just
observing that a reply arrived.

`[INFERRED]` The likely automation boundary:

| Stage | Automated? | Evidence |
|---|---|---|
| Target selection | Yes — algorithmic | `[SOURCED-INDIRECT]` help centre |
| Template selection + send | Yes | `[SOURCED-INDIRECT]` "automated process" |
| Reply ingestion + classification | Yes `[INFERRED]` | volume arithmetic above |
| Identity-verification challenges from brokers | Mostly automated `[INFERRED]` | no ID documents collected `[SOURCED]`, so Incogni can only answer with profile data it already holds |
| Deadline tracking + follow-up | Yes | `[SOURCED-INDIRECT]` "we follow up with companies that fail to act within the legally required timeframe" |
| Escalation | **Human-assisted** | `[SOURCED-INDIRECT]` "our team" |
| Custom removals | **Human** | `[SOURCED]` security.org |
| Broker onboarding / list maintenance | Human `[INFERRED]` | finding a broker's legal contact is not automatable |

`[UNKNOWN]` Whether classification is rules/regex, classical ML, or an LLM. No public
statement, no job post found describing it, no technical blog post.

## 3.4 Timing evidence from the PoPETs study

`[SOURCED]` (PoPETs 2025 §6):

- **72.2%** of Incogni's removals occurred **within the first 32 hours** of the
  subscription. Optery: 100% within 32 hours. Kanary: 19.2%.
- Over a one-month subscription, mean successful removal across all four tested services
  was **48.2%**; Incogni best at **76.6%**, Kanary worst at **23.4%**.
- Per-user variance within the same service: mean removal-efficacy gap between any two
  users was **4.5 brokers** for Incogni vs **72.5** for Optery — i.e. Incogni's outcomes
  are unusually *consistent* between users.

`[INFERRED]` The 32-hour spike plus low between-user variance is the signature of a
**fixed seed list fired in bulk at signup**, where most "removals" are same-day
auto-acknowledgements rather than genuine per-user processing. A scan-driven service
produces a long tail because each listing is found and handled individually; a
request-to-all service produces a step function. The measurement corroborates §1.1
independently of anything Incogni says.

## 3.5 Statutory deadlines that any such engine must track

`[SOURCED]` from the statutes themselves; `[INFERRED]` that Incogni tracks these specific
numbers, since it only says "the legally required timeframe".

| Instrument | Deadline | Extension |
|---|---|---|
| GDPR Art. 12(3) | 1 month | +2 months for complexity, with notice |
| UK GDPR | 1 month | +2 months |
| CCPA/CPRA | 45 days | +45 days with notice |
| Most US state laws (VCDPA, CPA, CTDPA, UCPA, …) | 45 days | +45 days |
| PIPEDA | 30 days | extendable |
| CA Delete Act / DROP | brokers must poll DROP every **45 days** and process within **45 days**, from 2026-08-01 `[SOURCED]` <https://privacy.ca.gov/data-brokers/> | — |
