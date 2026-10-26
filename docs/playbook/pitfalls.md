# Pitfalls

Every entry is a bug this build actually hit, with the fix and the generalisation.
Read before touching the engine.

---

## 1. Quoted history turns every reply into a confirmation

**What happened.** Our own letter says "erase without undue delay all personal data",
"added to your suppression list", "deleted". Brokers quote it back under `>` or after
`-----Original Message-----`. The first classifier run matched confirmation rules on
essentially every reply, including refusals.

**Fix.** `stripQuoted()` in `src/mailbox/classifier.ts` removes `>`-prefixed lines, and
everything after `-----Original Message-----`, `On … wrote:`, a late `From:` header, or
a long underscore rule — *before* any rule runs. Tested independently, with a
`quoted-only.eml` fixture whose only deletion language is in the quote.

**Generalise.** *When you parse a reply to something you wrote, strip your own words
first. Any classifier trained or written against un-stripped email is measuring itself.*

---

## 2. Hard wrapping silently kills every multi-clause rule

**What happened.** `partial.eml` was classified `confirmed_deleted`. The rule meant to
catch it — `/opted you out.{0,80}however.{0,60}cannot delete/i` — never fired, because
the broker's mailer wrapped at 72 columns and `.` does not match a newline. The rule was
*correct* and *dead*, which is the worst combination: it looked like coverage.

**Fix.** `flatten()` collapses all whitespace runs to single spaces before body matching.
Header and `from` scopes keep their line structure, since bounce detection needs it.

**Generalise.** *Email is wrapped. Any `.{0,N}` gap in a body pattern is a latent bug
unless you have normalised whitespace. Test with a realistically wrapped fixture, not a
one-line string you typed yourself.*

---

## 3. Scoring cannot settle a contradiction

**What happened.** "We have deleted the record. However, before we finalise this we
require you to verify the consumer's identity." Confirmation language is more
distinctive than verification language, so `confirmed_deleted` outscored
`needs_verification` and the request closed. A live request that needed action was
marked finished.

Raising the verification weights "fixed" the test and broke two others. Weight tuning to
resolve a semantic conflict is a treadmill.

**Fix.** An explicit `OVERRIDES` map. `partial`, `needs_verification`, `refused` and
`bounce` win outright over the classes they contradict whenever they fire at all,
regardless of margin. Confidence is then measured only against classes the winner did
*not* override, so a contradiction marker is not penalised for the confirmation it
overrules.

**Generalise.** *When two signals mean incompatible things, encode the incompatibility,
do not tune the weights. And pick the direction by consequence: here, towards keeping
the request open, because a redundant follow-up costs an email and a wrongly-closed
request costs a legal right.*

Related, found the same way: `partial` must also override `refused`. "We opted you out
but cannot delete X" recorded as a flat refusal loses the half that succeeded and
misreports the broker's compliance grade.

---

## 4. "Completed" that means two different things

**What happened.** Not our bug — the competitor's, and the single most valuable finding
of the research. Incogni's `Completed` means "removed your data **or** confirmed it
didn't have it", by their own definition. Combined with algorithmic targeting that
admittedly produces false positives, a real share of every headline number is brokers
that never held anything.

**Fix.** Four terminal outcomes with explicit evidence ranks (`EVIDENCE_RANK` in
`src/types.ts`), never summed. `OutcomeBreakdown` has no total field; `renderBreakdown`
prints each with the rank of the evidence behind it. A test asserts
`!('total' in d.breakdown)`.

**Generalise.** *When you find a competitor's metric that merges two facts, do not copy
it and do not merely avoid it — make the merged version unrepresentable in your types.
A convention gets violated by the next contributor in a hurry; a type does not.*

---

## 5. A backtick inside a SQL comment inside a template literal

**What happened.** Added `-- \`seq\` is an insertion counter` to the schema string. The
backticks closed the template literal. `TS1005: ',' expected`, pointing at a line of SQL.

**Fix.** No backticks in embedded SQL comments.

**Generalise.** *Treat embedded foreign-language strings as hostile. Prose habits —
backticks, `${`, apostrophes — are syntax in the host.*

---

## 6. Validating the shipped list but not a constructed one

**What happened.** `validate()` ran over the module-level broker array, so the published
list was safe. `new BrokerRegistry([...])` — used by tests, and by any operator loading
their own file — skipped it entirely. A broker with no contact or severity 99 would
reach the planner and fail at send time instead of load time.

Caught by a test asserting the constructor *should* throw. It did not.

**Fix.** The constructor validates anything that is not the already-checked module list.

**Generalise.** *Validate at every boundary where data enters, not just the one you
happened to think of first. "The shipped data is fine" is not a safety property; it is a
property of today's shipped data.*

---

## 7. Timestamp-ordered events shuffle within a second

**What happened.** A reply is received, classified and acted on in one transaction, so
three events share a timestamp. Ordered by `(at, id)` with random ids, the evidence pack
printed `outcome_recorded` *before* `reply_received`. Technically accurate, and it reads
as incoherent in a document going to a regulator.

**Fix.** `seq INTEGER PRIMARY KEY AUTOINCREMENT`, ordered by insertion.

**Generalise.** *If a log is evidence, its order is part of the evidence. Wall-clock
time is not a total order at transaction granularity.*

---

## 8. A category that is accurate and useless

**What happened.** Equifax Information Services landed in `health`, because they
genuinely declared HIPAA-regulated activity in the CPPA registry and the classifier
checked regulatory flags before identity markers. Sourced, accurate, and absurd on a
dashboard: nobody thinks of Equifax as a health broker.

**Fix.** Identity markers first, regulatory flags as the fallback. The HIPAA declaration
is not discarded — it stays in `sectoralRegimes`, where it drives the sectoral caveat in
the letter.

**Generalise.** *A classification has an audience. "Primary business" and "regulatory
status" are different questions; answer each in its own field rather than letting one
masquerade as the other.*

---

## 9. The consent check that was easy to route around

**What we avoided.** The obvious design puts the consent check in an API handler or a
service method. Then someone adds a CLI command, a batch job or a retry path that calls
the composer directly, and there is now a route to a letter that no consent gated.

**What we did.** `assertConsent()` is called inside `composeLetter()` — the only function
that turns a subject's identifiers into text. There is no way to produce a letter
without passing it. The sender additionally breaks out of its loop on
`ConsentRequiredError` rather than grinding through every broker.

**Generalise.** *Put a safety check at the narrowest waist the dangerous operation must
pass through, not at the widest entry point. Count the paths: if there is more than one,
you have chosen the wrong place.*

---

## 10. Tests that encode your arithmetic rather than the system's

**What happened.** Three test failures in this build were wrong expectations, not wrong
code: a recurrence computed from the close date rather than the send date, a letter hash
that changed because the consent reference is embedded in the letter, and a planner skip
that never fires because region filtering happens earlier.

Each one was initially tempting to "fix" in the source.

**Generalise.** *When a test fails, establish which of the two is wrong before touching
either. A failing test that turns out to be correct is the cheapest bug report you will
ever get — the letter-hash one documented a real property (the hash tracks the
authorisation, so the evidence chain is tamper-evident) that we then made explicit with
a second test.*

---

## 11. Do not work around a WAF to improve a citation

**What happened.** Two of the most useful sources — the competitor's help centre and
their audit post — returned 403 and 404 to a plain fetch. Spoofing a user agent would
have worked.

**What we did instead.** Labelled them `[sourced-indirect]`, quoted via search-engine
excerpts, recorded the block in `docs/research/incogni/sources.md`, and moved on.

**Generalise.** *The value of research is that it can be published and checked. A
slightly better citation obtained by circumventing an access control makes the whole
document unpublishable. Record the limitation; it is more honest and it costs nothing.*

---

## 12. A redactor that corrupts the identifiers it is meant to preserve

**What happened.** Spotted by a human reading real `npm test` output, not by any test:

```
"replyId":"reply_518b761bphone:e5121b6dec92b"
```

`scrub()` applies a phone-number pattern to every string. Random hex ids routinely
contain six or more consecutive digits, so the pattern matched *inside* the token and
rewrote it. The log's `replyId` no longer matched the database's, which destroys the
one property the redactor exists to provide — correlate a log line to a record without
revealing who it is about. And it failed silently: the line still looked like a log line.

**Fix.** Two changes in `src/util/redact.ts`. The phone pattern gained
`(?<![A-Za-z0-9_])` / `(?![A-Za-z0-9_])` boundaries — a real phone number is never
flanked by letters or an underscore, so the boundary costs nothing. And strings matching
`OPAQUE_ID_RE` (`^[a-z][a-z0-9]*_[A-Za-z0-9-]{6,}$`) are passed through untouched.
Regression tests pin the exact mangled ids from the run that exposed it, alongside tests
that real phone numbers in several formats are still caught.

**Generalise, twice.**

*On the bug:* a scrubber is a rewriter, and every rewriter needs a test for what it must
**not** touch, not only for what it must. We had five tests that personal data was
removed and none that anything else survived.

*On how it was found:* our tests asserted the logger does not leak a name. They never
asserted the log is still useful. Every test passed while the output was quietly being
corrupted, and it took a person scrolling past a successful test run to notice. When
output is for humans, read it — a green suite is evidence about the assertions you
thought to write, and nothing else.

---

## 13. No validation on the data that becomes a legal letter

**What happened.** Found the same way as #12 — a human running the README's own quick
start, pasting the placeholders literally:

```
$ deletewe account:create --name "..." --locality "..." --email ...
account acct_12d05d91cb47470bb3f47772
owner subject subj_8e42160a60844cb3afac2362
```

It worked. A subject existed, consent was recorded against it, and `send` would have
rendered `Full name: ...` into a letter addressed to Equifax. Nothing in 173 tests
objected, because every test used a well-formed fixture.

This is not a cosmetic input-validation miss. These fields are rendered verbatim into a
statutory request. A nonsense letter wastes a compliance team's time, and it makes the
next *genuine* letter from the same sender easier to bin.

**Fix.** `src/identifiers.ts`, enforced at two depths: `validateIdentifiers` at ingest
(`createAccount`, `acceptInvite`, the CLI) so the error arrives where it can be fixed,
and `assertValidIdentifiers` inside `composeLetter` — the one function every letter
passes through — so no future code path can route around it. The CLI prints every
problem at once rather than one per attempt.

While writing it, a second gap appeared: with a date of birth supplied, nothing checked
the subject was an adult. The authorisation text the subject signs already asserts
"I am an adult", so the engine was relying on a claim it never verified against data it
already held. It now refuses, and says why.

**And the fix had its own bug**, caught by its own test: `isPlaceholder` used
`/[a-z0-9]/i` to mean "contains something real", which classifies 山田 太郎, محمد العلي
and 김민준 as placeholders. A validator that rejects most of the world's names is worse
than no validator. Now `/[\p{L}\p{N}]/u`.

**Generalise.** *Validate at the boundary where data becomes consequential, not where it
is convenient. And when the consequence is external and irreversible — a letter to a
company, a payment, a published post — the validator belongs at the same narrow waist as
the safety checks, because it is one. Third time in this file that the answer was
"put it where `composeLetter` already is": see #9 and #12.*

*Corollary on character classes: `[a-z]` in a validator is a bug about people. If a
rule decides whether a human's name is real, it must be Unicode-aware, and it must be
tested against names that are not Latin.*

---

## 14. Shipping a live transport is a one-line mistake away

**What we avoided.** An SMTP client is ten lines. With one in the repo, sending
unreviewed draft legal letters to real companies in a real person's name is a config
change — plausibly an accidental one, in a deployment where `DELETEWE_TRANSPORT` is set
from an environment template.

**What we did.** No live transport exists. `transportFromEnv` throws for anything other
than `dryrun`/`mock`, and the sender throws `TemplatesNotReviewedError` for any transport
it does not recognise unless `DELETEWE_TEMPLATES_REVIEWED` is set. Two independent gates,
both tested.

**Generalise.** *For an irreversible outward-facing action, the absence of an
implementation is a legitimate and sometimes correct safety control. Make the dangerous
thing require deliberate work, not deliberate restraint.*
