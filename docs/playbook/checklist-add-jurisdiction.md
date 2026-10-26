# Checklist: adding a jurisdiction

A new privacy law comes into force, or deletewe starts supporting a new country.
Budget half a day, most of it reading the statute rather than writing code.

Worked example throughout: **the Rhode Island Data Transparency and Privacy Protection
Act**, a comprehensive US state act not yet modelled.

---

## 0. Decide whether it is actually a new instrument

Not every law is. Ask:

- Does it grant a **deletion or erasure** right a third party can exercise as an agent?
  If not, deletewe cannot use it and the country should not be marked supported.
- Does it set a **response deadline**? Without one there is no clock, no breach, no
  escalation — the request is a polite letter.
- Is it **materially different** from one already modelled? Most US state acts share the
  45-day/45-day shape and the same four rights. If yours does too, you are adding an
  entry, not a template.

> Red flag: if you cannot find the section number for the deletion right and the section
> number for the deadline, you are not ready to add it. Those two citations go verbatim
> into a letter that someone will send to a company.

---

## 1. Find the primary sources — the statute, not a summary

You need, with section numbers:

| Thing | Rhode Island example |
|---|---|
| Deletion / erasure right | R.I. Gen. Laws § 6-48.1-5(a)(3) |
| Access / right to know | § 6-48.1-5(a)(1) |
| Opt out of sale / sharing | § 6-48.1-5(a)(4) |
| Sensitive-data limit, if any | check |
| Response deadline and extension | § 6-48.1-5(b) |
| Authorised-agent provision | check — some acts only allow agents for opt-out |
| Enforcing regulator and its complaint URL | Rhode Island Attorney General |

Law-firm client alerts are good for *finding* the section numbers and useless as the
citation itself. Open the statute.

**Watch for the two traps that actually bite:**
- **Agent authority is not universal.** Several US state acts permit an authorised agent
  only for opt-out, not for deletion. If so, `rights` must reflect that — do not assert
  a right the subject cannot delegate.
- **The deadline is not always 45/45.** Iowa is 90 days; Florida's extension is 15, not
  45. We got both of those right only because we checked each one individually.

---

## 2. Add the regulator

`src/legal/regulators.ts`:

```ts
RI_AG: {
  name: 'Rhode Island Attorney General',
  complaintUrl: 'https://riag.ri.gov/consumer-protection/file-complaint',
  jurisdiction: 'US-RI',
},
```

Open the complaint URL. A dead link appears in a letter telling a company where the
subject will complain, and a dead link undermines the threat that makes the letter work.

---

## 3. Add the instrument

`src/types.ts` — extend `LegalInstrumentId` with `'RIDTPPA'`. The type is a closed
union on purpose: adding the id makes the compiler list every place that must be updated.

`src/legal/jurisdictions.ts` — for a standard US state act, use the `usState` helper:

```ts
RIDTPPA: usState('RIDTPPA', 'Rhode Island Data Transparency and Personal Privacy Protection Act',
  'RI DTPPA', 'US-RI', REGULATORS.RI_AG, {
    erasure: 'R.I. Gen. Laws § 6-48.1-5(a)(3)',
    access: 'R.I. Gen. Laws § 6-48.1-5(a)(1)',
    opt_out_of_sale: 'R.I. Gen. Laws § 6-48.1-5(a)(4)',
    deadline: 'R.I. Gen. Laws § 6-48.1-5(b) (45 days, extendable by 45)',
  }),
```

For anything that is **not** a standard US state act, write the full object and set:
- `subjectRegions` — who may invoke it;
- `extraterritorial` — whether it reaches a controller established elsewhere. Get this
  right: PIPEDA is `false`, which is why a Canadian cannot use it against a US-only
  broker, and `resolveEntitlements` correctly returns nothing rather than bluffing;
- `responseDays` / `extensionDays` — `0` extension days means none is available;
- `note` — keep the `DRAFT — requires legal review` marker until a lawyer has signed off.

---

## 4. Decide the template family

Three exist: GDPR-family, US-state-family, and bespoke (PIPEDA, FADP).

Reuse the US-state body if the act grants delete + know + opt-out on a 45-day clock.
Write a bespoke body only when the *structure of the argument* differs — PIPEDA needed
one because it has no free-standing erasure right and has to be framed as withdrawal of
consent plus the retention principle. A different section number is not a different
argument.

See [`checklist-add-template.md`](checklist-add-template.md).

---

## 5. Check the ranking

`score()` in `src/legal/entitlements.ts` decides which instrument becomes rank 0 when
several apply. Adding an instrument changes the ranking for every subject in that region.

Run it and read the output before and after:

```bash
node --experimental-strip-types src/cli.ts jurisdictions
```

Then assert the expected rank 0 in a test. A Rhode Islander must get RIDTPPA, not a
neighbouring state's act leaking in through a bad `subjectRegions` entry.

---

## 6. Brokers

- Do existing brokers' `targetsRegions` need the new region added? For a US state act,
  any broker already targeting `US` is reachable, and `reachableFrom` handles the prefix.
- Are there brokers established *in* this jurisdiction that should be seeded? Check for
  a local registry equivalent to California's.

---

## 7. Tests — the four that matter

In `tests/brokers.test.ts` and `tests/templates.test.ts`:

```ts
test('a Rhode Islander gets RIDTPPA and not a neighbouring state act', () => {
  const s = subject({ residence: 'US-RI' });
  const ents = resolveEntitlements(s, brokers.get('spokeo')!);
  assert.equal(ents[0]!.instrument, 'RIDTPPA');
  assert.ok(!ents.some((e) => e.instrument === 'CCPA'));
});
```

Plus: the letter renders and names the statute; the deadline is the right number of days
from send; the regulator appears in the escalation paragraph. The existing loop tests
(`every modelled instrument has a template`, `every instrument carries a deadline
citation and a regulator`) pick the new one up automatically — that is why they are
written as loops over `ALL_INSTRUMENT_IDS`.

---

## 8. Documentation

- Add the row to the jurisdictions table in `README.md`.
- If a supported *country* is new (not just a US state), say so in the README, and check
  `isEea()` if it is European.

---

## Gate

```bash
npm run gate
```

Both the typecheck and all tests must pass before commit. Then read the rendered letter
once, as a human:

```bash
node --experimental-strip-types src/cli.ts plan --subject <id> --limit 1
```

The letter will be sent to a real company in a real person's name. Read it.
