# Checklist: teaching the reply classifier a new kind of response

A broker replied, the classifier said `unclassified`, and the reply is sitting in the
review queue. Or worse — it classified it, and classified it wrong.

```bash
node --experimental-strip-types src/cli.ts serve --token "$T"   # GET /review
```

---

## 0. First, decide whether this is a new class or a new rule

`ReplyClass` has eleven values. Nearly every new reply is a **new rule for an existing
class**. Adding a class means adding a state to the lifecycle, which touches
`outcomeFor`, `statusFor`, `PRECEDENCE`, `OVERRIDES` and the dashboard breakdown.

Add a class only when the reply means something **none** of the eleven mean *and* the
engine should do something different about it. "The broker says it will delete once we
pay a fee" is a `refused` with a new rule, not a new class.

---

## 1. Capture the reply as a fixture — redacted

```bash
cp reply.eml tests/fixtures/emails/<short-descriptive-name>.eml
```

**Redact it first.** Replace the real subject's name, email, address and any reference
number with the test persona (`Avery Nakamura`, `avery@example.org`). A fixture is
committed to a public AGPL repository forever. Keep the broker's wording — that is the
part under test — but strip anything that identifies a real person.

Keep the realistic parts that break naive patterns: the hard wrapping, the quoted
original, the signature block, the legal footer.

---

## 2. Add the expectation first, and watch it fail

`tests/classifier.test.ts`:

```ts
const EXPECTED: Record<string, string> = {
  // …
  'fee-demanded.eml': 'refused',
};
```

The suite has a test that fails if a fixture has no expectation, so you cannot add a
fixture and forget. Run it and confirm it fails for the reason you expect — if it
already passes, an existing rule covers it and you are done.

---

## 3. Write the rule

`src/mailbox/rules.ts`:

```ts
r('refuse.fee', 'refused', 50, /\b(a (reasonable )?fee (of|is) |payment is required)\b/i),
```

**Rules of thumb that cost us time to learn:**

| | |
|---|---|
| **Always `i`.** | A test enforces it. Broker replies vary wildly in casing. |
| **Anchor on the distinctive phrase, not the common word.** | `/\bdeleted\b/` matches our own letter quoted back, every acknowledgement, and half the refusals. |
| **Bodies are flattened before matching.** | `flatten()` collapses whitespace, so `.{0,60}` gaps work across hard-wrapped lines. Do not use `\n` in a body pattern. |
| **Quoted history is already gone.** | `stripQuoted()` runs first. Do not write rules to defend against quoting. |
| **Weight by distinctiveness, not importance.** | 85–90 for an unambiguous phrase, 50–70 for suggestive, 30–50 for weak corroboration. A high weight on a loose pattern is how everything becomes a confirmation. |
| **Negative weights veto.** | `veto.future.tense` at −55 stops "will be deleted" closing a live request. |

---

## 4. Decide whether it needs precedence or an override

Two mechanisms, and picking the wrong one is the commonest mistake:

**`PRECEDENCE`** settles ties *within the scoring band* (anything within 25% of the top
score). Order it by **consequence**, not confidence. `bounce` first — a bounced letter
was never read, so nothing in the body means what it appears to. Then
`needs_verification`, `partial`, `refused`, which all outrank `confirmed_deleted`.

**`OVERRIDES`** is for emails that say two things at once, and those are the emails that
matter. A listed class wins outright over the classes it contradicts **whenever it fires
at all**, regardless of margin.

> This is the bug that cost us the most time in this build. "We have deleted your
> record. However, before we finalise this we require you to verify identity" scored
> *higher* for `confirmed_deleted` than for `needs_verification`, simply because
> confirmation language is more distinctive. Scoring alone cannot settle a
> contradiction. See [`pitfalls.md`](pitfalls.md) #3.

**The direction is always towards keeping the request open.** Leaving a finished request
open costs one redundant follow-up. Closing a live one abandons somebody's legal right
at the exact moment it needed action.

---

## 5. Check you have not broken the others

```bash
node --test --experimental-strip-types 'tests/classifier.test.ts'
```

The suite is a regression net precisely for this. If a new rule flips an existing
fixture, your pattern is too broad — tighten it rather than re-weighting until the
numbers happen to work out.

---

## 6. If the class is genuinely new

Then, and only then:

1. `ReplyClass` in `src/types.ts`.
2. `PRECEDENCE` in `src/mailbox/classifier.ts` — place by consequence.
3. `OVERRIDES` — what does it contradict? What contradicts it?
4. `outcomeFor()` — does it close the request? Remember: a `no_data_held` outcome is
   **never** mapped to `confirmed_deleted` (ADR-0001 D2). If your new class is a
   variation on "we hold nothing", it maps to `no_data_held`.
5. `statusFor()` — if it does not close, what status does it move to?
6. `applyClassification()` in `src/mailbox/process.ts` — any special handling, such as
   the deadline recalculation that `extension` triggers.
7. The dashboard breakdown, if it introduces a new outcome.
8. An end-to-end test in `tests/e2e.test.ts` that drives the full lifecycle through it.

---

## 7. Never reach for an LLM here

Tempting, and wrong for this component, for three reasons:

1. **Explainability.** A misclassification silently drops someone's legal right. The
   audit trail must say *which rule* decided and why. `matchedRules` does that.
2. **The data suits rules.** Broker replies are templated; the same fifty sentences
   recur across thousands of senders. Precision is achievable with patterns.
3. **Confidentiality.** A local rule engine cannot exfiltrate a reply body — which
   contains the subject's name and often their address — to a third-party API.

If you do add a model later, it goes *behind* the review queue as a triage aid for
`unclassified`, never in front of the rules as the deciding authority.
