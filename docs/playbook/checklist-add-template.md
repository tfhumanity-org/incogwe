# Checklist: adding or changing a request template

Templates are the product. A bad one is not a rendering bug — it is a legally weak
letter sent in someone else's name, which is worse than sending nothing.

---

## 0. Reuse before you write

`src/templates/registry.ts` has three families:

| Family | Used by | Shape of the argument |
|---|---|---|
| GDPR-family | GDPR, UK GDPR | erasure + access + absolute marketing objection + Art. 19 onward notification |
| US-state-family | CCPA and 16 state acts | delete + know + opt out of sale/sharing + limit sensitive + suppression |
| Bespoke | PIPEDA, Swiss FADP | the argument itself differs |

**Write a new family only when the argument differs, not when the citations do.**
PIPEDA earned one: it has no free-standing erasure right, so the letter has to withdraw
consent first and then argue that retention is no longer necessary. A new state act with
different section numbers does not earn one.

---

## 1. What every template must contain

Non-negotiable, because each exists for a reason we hit:

- [ ] **Names the instrument** in both subject line and body. An unnamed instrument
      cannot support a later deadline breach or a regulator complaint.
- [ ] **Cites the specific provision for each right asserted.** Not "under applicable
      privacy law" — the section number.
- [ ] **Asserts erasure AND objection/opt-out AND suppression together** (ADR-0001 D3).
      Erasure addresses today; the other two are what stop re-listing in 90 days. One
      extra paragraph, and it is the difference between a snapshot and a subscription.
- [ ] **States the deadline as a date**, not a duration, with its citation.
- [ ] **States the consequence of silence** and names the regulator, with a working URL.
- [ ] **States the agent's authority**, the authorisation date and its document digest,
      and offers the signed copy on request.
- [ ] **Tells the broker how to challenge identity** rather than leaving them to guess —
      and asks them not to demand documents that are not strictly necessary.
- [ ] **Instructs that the identifiers supplied must not be used to enrich any record.**
      You are handing a data broker a clean, verified identity tuple. Say it in writing.
- [ ] **Carries the sectoral caveat** when the broker declared FCRA/GLBA/HIPAA activity.
      Do not pretend the exemption does not exist; demand it be identified per record.

---

## 2. The renderer's rules

`src/templates/render.ts` is deliberately tiny — no expressions, no disk partials.

| Syntax | Behaviour |
|---|---|
| `{{ key }}` | **Throws** if missing. This is the default on purpose. |
| `{{ key? }}` | Empty string if missing. Use only where blank is genuinely correct. |
| `{{#key}}…{{/key}}` | Once for an object, per-item for an array, skipped if falsy/empty |
| `{{^key}}…{{/key}}` | Rendered when falsy or an empty array |
| `{{ . }}` | The current item inside an array block |

> **Never reach for `{{ key? }}` to silence a failing test.** A blank where a statutory
> citation should be is a letter that quietly asserts nothing. If a variable is
> legitimately optional, wrap it in a `{{#block}}` so the surrounding sentence
> disappears with it.

Finish with `tidy()`, which collapses the blank lines block removal leaves behind.

---

## 3. Wiring it up

1. Add the body constant in `src/templates/registry.ts`.
2. Register it: `defs.set('XXX', { instrument: 'XXX', subject: '…', body: XXX_BODY })`.
3. Supply any new variables in `composeLetter()` (`src/templates/letter.ts`). Every
   variable the body references must be in the scope object or rendering throws — which
   is the behaviour you want.
4. If the template needs a new fact about the broker or subject, add it to the type
   first. The compiler will then tell you every call site that must provide it.

---

## 4. Minimum PII

Check what your template renders against `minimise()`. If it needs the street address,
the brokers using it must declare `requiredIdentifiers: ['street_address']` — otherwise
the field is absent and `{{#streetAddresses}}` silently renders nothing.

This is the right failure direction (withhold rather than over-share), but it means a
template that *needs* a field must be paired with brokers that *ask* for it.

---

## 5. Tests

```ts
test('renders an XXX letter naming the instrument, the deadline and the regulator', () => {
  const l = composeLetter({ /* … */ });
  assert.equal(l.instrument, 'XXX');
  assert.match(l.body, /<the statutory citation>/);
  assert.match(l.body, /SUPPRESSION/);
  assert.match(l.body, /<the regulator's name>/);
  assert.equal(l.dueAt.slice(0, 10), '<expected date>');
});
```

And the negative test that matters:

```ts
test('the minimised letter does not contain withheld identifiers', () => {
  assert.ok(!l.body.includes('1986-04-12'));
});
```

---

## 6. Read it out loud

Seriously. Render one and read the whole thing:

```bash
node --experimental-strip-types src/cli.ts plan --subject <id> --limit 1
```

Ask: would a privacy officer reading this know exactly what is being demanded, under
what law, by when, and what happens if they ignore it? If any of the four is unclear,
the letter is not finished.

---

## 7. Legal review

Templates carry `DRAFT — requires legal review before live use` and the engine refuses a
live transport without `DELETEWE_TEMPLATES_REVIEWED`. When a qualified lawyer has
reviewed a jurisdiction:

- record who, when and which instruments, in the ADR or a `docs/legal-review-*.md`;
- remove the `note` from that instrument;
- set the env var to a string naming the reviewer and date, not to `true`.

Do not remove the gate itself. A future contributor adding a jurisdiction needs it to
still be there.
