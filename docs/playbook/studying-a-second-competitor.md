# Studying a second competitor: look for what is different, not what is the same

The second competitor study is where most research time gets wasted. You already know
the category, so the familiar parts feel like progress — and they are worth nothing.
Every minute spent confirming that DeleteMe also sends removal requests and also has a
dashboard is a minute that produced no decision.

**The rule: your output is a list of differences, and for each one, the reason.**
A difference with a reason is a design choice you can evaluate. A difference without one
is a lead you have not finished following.

---

## Before you start: write down what you already believe

Take five minutes. From competitor one, list the things you now assume are true of the
category. Ours, after Incogni:

1. Requests go to a curated list, not to scanned results.
2. Services collect name, email and an address; not government ID.
3. Nobody provides proof of removal.
4. Success is one merged number.
5. Marginal cost per user is near zero.

This is the instrument. The findings are the ones that **break** it.

Against DeleteMe, three broke immediately:

| Belief | DeleteMe | So what? |
|---|---|---|
| No government ID | **Requires a photo ID upfront** | Scanning needs more identifiers than asserting a right. Minimum-PII is a *consequence* of the request-first model, not an independent virtue. |
| No proof of removal | **Quarterly reports with screenshots** | Rank-1 evidence is achievable — but only where the listing is public. That bounds how far we can copy it. |
| Marginal cost near zero | **Human specialists; family-of-4 at ~2.5× the price** | The labour model determines the price, which determines whether bundling is even possible. |

Three questions that reshaped the architecture, from about two hours of reading.

---

## The four difference classes, and what each one means

Sort every difference you find into one of these. The class tells you what to do.

### 1. Different because of a **constraint** you also have
They collect an ID because they must *match a listing*, and matching needs more
identifiers than asserting a right does. This is the highest-value class: it reveals a
rule of the domain, not a preference.
→ **Model the constraint explicitly.** Ours became `Broker.requiredIdentifiers` and
`minimise()`: collect per-flow, not per-account.

### 2. Different because of a **choice** with a cost you can see
Human specialists buy screenshot evidence at the price of per-user labour.
→ **Price the trade and decide deliberately.** We wanted the evidence and not the cost,
so we took re-verification (cheap, machine) and left manual review for the long tail.

### 3. Different because of **history** — a decision nobody would make today
Country-specific plans, in a world where one subscription spans 34 countries.
→ **Ignore it.** Do not reverse-engineer a legacy constraint into your design.

### 4. Different and you **cannot tell why**
This is the interesting one, and the easiest to skip. Write it down as an open question
with your best hypothesis, and label it `[unknown]`. Ours: how either service handles
broker reply volume; whether anyone actually files regulator complaints; whether family
members each sign their own authorisation.
→ **Open questions are the research backlog.** They are also where the next product
differentiator is hiding: we built per-adult consent precisely because nobody documents
it, which means nobody is competing on it.

---

## Where differences actually hide

In order of yield, from this study:

1. **The thing one has that the other does not have a word for.** Incogni has a
   `Suppressed` status; DeleteMe has no equivalent concept. That single word led to
   ADR-0001 D3 — ask for suppression in every letter, because it is the only outcome
   that binds the future.
2. **Onboarding forms.** They are a specification of the minimum data the model needs,
   written by someone who was trying to make it as short as possible.
3. **Status vocabularies.** Every status is a state in their machine. Diff the two
   vocabularies and you have diffed the two state machines.
4. **Pricing ratios, not prices.** Family-to-individual ratio tells you marginal cost.
   Bundle-vs-standalone tells you strategic role.
5. **What they refuse to do.** Both exclude court records, news and social media —
   identical exclusions from independent companies means a real legal boundary.
6. **Academic and regulatory sources.** One peer-reviewed study (PoPETs 2025) produced
   more decision-grade facts than every review site combined, because it measured both
   services with one method. Government registries (the CPPA data broker registry) are
   free, authoritative, machine-readable, and nobody is using them.

---

## Where you will waste time

- **Review sites.** High volume, low independence, heavily affiliate-funded, and they
  copy each other's numbers. Useful for pricing and UI screenshots; little else.
- **Re-reading the marketing site.** The second visit tells you nothing the first did not.
- **Feature-list comparison tables.** They encode no reasoning. If you catch yourself
  building one, you have stopped doing research.
- **Trying to beat a blocked page.** Two of our most useful sources returned 403 to a
  plain fetch. We labelled them `[sourced-indirect]` and moved on. Working around a WAF
  would have bought a marginally better citation at the cost of the thing that makes the
  research publishable at all.

---

## The deliverable

Not a report. A **decision**, with the differences as its evidence. Ours was
[ADR-0001](../adr/0001-hybrid-discovery-and-legal-request-engine.md): eight decisions,
each traceable to a specific difference between the two services.

If your second-competitor study does not change a line of code, you studied the wrong
things — almost certainly the similarities.

---

## A method note on sourcing

Label every claim `[sourced]`, `[sourced-indirect]`, `[inferred]` or `[unknown]`, and do
it as you write, not afterwards. It is mildly tedious and it pays for itself twice:

- It makes the `[inferred]` claims visible to you, which is when you notice that three
  of them are load-bearing and one of them is wrong.
- It makes `[unknown]` a first-class result. "We looked and could not establish it" is a
  finding. Quietly inferring past the gap is how a research document becomes fiction.

Of the ~120 claims in our dossier, the five that changed the architecture most were two
`[sourced]` facts from the competitor's own help centre, one `[sourced]` limitation
buried in a peer-reviewed paper's §7.1, and two `[inferred]` conclusions from arithmetic
on their own published numbers.
