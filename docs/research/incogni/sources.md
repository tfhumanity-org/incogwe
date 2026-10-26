# Sources

Retrieved 2026-10-27 unless noted. `OK` = fetched and read directly.
`BLOCKED` = public page refused a plain fetch; content used only via search-engine
excerpt and labelled `[SOURCED-INDIRECT]` in the dossier. **No evasion was attempted.**

## Primary — Incogni / Surfshark

| Status | URL | Used for |
|---|---|---|
| OK | <https://incogni.com/> | Scanning of people-search sites, ~10-day re-scan, 420+/3,000+, authorisation form wording, supported countries, Deloitte claim |
| OK | <https://incogni.com/pricing> | All four plans, prices, member counts, country list |
| OK | <https://blog.incogni.com/data-brokers-incogni-covers/> | Five broker categories and definitions, 1–10 severity scale |
| OK | <https://blog.incogni.com/people-search-sites-announcement/> | People-search as the last-added category |
| OK (via review) | <https://blog.incogni.com/remove-your-data-with-incogni-unlimited/> | Custom removals flow |
| OK | <https://surfshark.com/incogni> | Bundling into Surfshark One+ |
| BLOCKED (403) | <https://support.incogni.com/hc/en-us/articles/4904646940306-How-do-you-know-if-a-data-broker-has-my-personal-data> | **Key source**: no scanning of private-database brokers, algorithmic prediction, admitted false positives |
| BLOCKED (403) | <https://support.incogni.com/hc/en-us/articles/4904721869458-What-do-the-data-removal-statuses-on-my-dashboard-mean> | Status definitions incl. `Completed` conflation, `Monitoring`, `Suppressed`, `Escalated` |
| BLOCKED (403) | <https://support.incogni.com/hc/en-us/articles/24959415440658-What-are-data-broker-compliance-score-severity-rating-and-status> | Compliance score values, severity rating |
| BLOCKED (403) | <https://support.incogni.com/hc/en-us/articles/27962946457234-How-do-I-check-all-requests-sent-to-a-specific-data-broker-and-what-do-the-statuses-mean> | Per-broker request statuses |
| BLOCKED (403) | <https://support.incogni.com/hc/en-us/articles/8042680413202-What-type-of-data-brokers-does-Incogni-cover> | Category definitions |
| BLOCKED (403) | <https://support.incogni.com/hc/en-us/articles/25640663945106-Can-you-remove-me-from-sites-not-covered-by-regular-services> | Custom removals eligibility |
| BLOCKED (404) | <https://blog.incogni.com/deloitte-assurance/> | Deloitte report — used via Wikipedia + cyberinsider instead |

## Primary — peer-reviewed measurement

| Status | URL | Used for |
|---|---|---|
| OK (PDF, full text extracted) | <https://petsymposium.org/popets/2025/popets-2025-0125.php> · mirror <https://brave.com/research/files/data-brokers-pets-2025.pdf> | He et al., *Measuring the Accuracy and Effectiveness of PII Removal Services*, PoPETs 2025. Table 1 (discovery method, 217 brokers), Table 2 (mandatory/optional PII), §5.2 (41.1% accuracy; Incogni hides record contents), §6 (76.6% removal rate, 48.2% mean, 72.2%-in-32h, per-user gap 4.5), §7.1 (student-cohort limitation, no ground truth on removals), Jaccard 0.21, 71.7% unregistered |

## Primary — government / regulatory

| Status | URL | Used for |
|---|---|---|
| OK (CSV, 865 rows) | <https://cppa.ca.gov/data_broker_registry/registry.csv> | Broker seed data, legal contacts, sensitivity disclosures |
| OK | <https://cppa.ca.gov/data_brokers/> · <https://privacy.ca.gov/data-brokers/> | Delete Act / DROP: launched 2026-01-01, 45-day poll + 45-day processing from 2026-08-01 |

## Secondary — encyclopaedic and independent review

| Status | URL | Used for |
|---|---|---|
| OK | <https://en.wikipedia.org/wiki/Incogni> | Founding 2021/2022, Deloitte figures and as-of date, region list incl. Isle of Man, SOC 2 Type 2, BBB A+, PCMag/PCWorld awards, Custom Removals launch 2025 |
| OK | <https://cyberinsider.com/data-removal/incogni-review/> | Onboarding fields and 8m42s timing, 5 categories, dashboard colours, pricing table, **no screenshots of removals**, no ID documents |
| OK | <https://cyberinsider.com/data-removal/incogni-vs-deleteme/> | Head-to-head: coverage, evidence, effort, regions, family plans |
| OK | <https://cyberinsider.com/incognis-data-removal-service-validated-by-deloitte-audit/> | Deloitte Lietuva UAB, ISAE 3000 limited assurance, assertion list |
| OK | <https://www.security.org/data-removal/incogni/> | Pricing, onboarding, custom removals ("three at a time"), **"'completed' doesn't always mean removal"** |
| OK (search excerpt) | <https://www.bleepingcomputer.com/offer/deals/surfshark-one-plus-with-incogni-is-95-for-a-year-of-full-privacy-coverage/> | Bundle pricing |
| OK (search excerpt) | <https://nordvpn.com/incogni/> | Cross-brand landing page |
| OK (search excerpt) | <https://builtin.com/job/midsenior-affiliate-marketing-manager-incogni/3593709> | Public hiring posture |

## DeleteMe (for Phase 2 comparison)

| Status | URL | Used for |
|---|---|---|
| OK (search excerpt) | <https://www.security.org/data-removal/deleteme/> · <https://cyberinsider.com/data-removal/deleteme-review/> | Free scan, scan-first model, quarterly reports with screenshots, 40–60 custom removals/yr, pricing $129–$499 |
| OK | PoPETs Table 1 | DeleteMe: Seed discovery, 759 brokers enumerated, $129/yr, mandatory PII incl. DOB + phone |

## Deliberate non-sources

- No Incogni account was created; no logged-in dashboard was observed.
- No app binary was decompiled. (The REA skill's binary tooling was not applicable: the
  target is a hosted subscription service, and every question was answerable from public
  documents. Native/mobile analysis would have added no evidence the public record lacks.)
- No broker was contacted. No request of any kind was sent to any data broker.
