# Discovery eval harness

Local-only. Not part of `npm test`, not run in CI.

## Why

The scorer has been tuned one company at a time — Apple, then Bechtel. That is
n=2, and every change so far has been an anecdote defended after the fact. This
runs the real pipeline across a fixed fixture set and reports aggregates, so a
scorer change can be measured against the same postings instead of against an
impression of the last run.

## Cost

Measured from the call sites, per posting:

| Stage                  | Serper                 | Gemini | Plain fetches |
| ---------------------- | ---------------------- | ------ | ------------- |
| `analyzeJob`           | 0                      | 1      | 1             |
| `findLinkedInProfiles` | up to 3                | 0      | 0             |
| `searchPersonEmail`    | 1 × top 4 profiles = 4 | 0      | up to 8       |
| `crawlCompanyEmails`   | 0                      | 0      | 6 + 1 HEAD    |
| `findReferralProfiles` | 3                      | 0      | 0             |
| **Total**              | **~10**                | **1**  | **~16**       |

Nine fixtures ≈ 90 Serper queries per uncached pass. Serper balance at the time
of writing: 2,375, so roughly 26 recording passes at this fixture count.

Serper's rate limit is 5 requests/second and `discoverContacts` already fans out
four concurrent lookups, so **fixtures run sequentially**. Parallelising them
would trip the limit and poison a recording with throttled empties.

## Record and replay

`evals/cassettes/` holds recorded HTTP responses keyed by method + URL + body.
The first pass records; every pass after replays with **zero API calls**, which
is what makes a scorer change measurable rather than expensive.

**Cassettes are gitignored.** They contain scraped recruiter names, titles and
profile URLs — committing them would put third-party personal data in a public
repo, which is the problem roadmap #12 exists to address, not something to make
worse for convenience. A fresh clone re-records once.

`SearchCache` is already an injectable interface, so the search layer needs no
production change. Page fetches are not behind it, so the harness wraps
`globalThis.fetch` for the duration of a run. Nothing in `src/` is modified.

## Metrics

Four are objective:

- **Email yield by company size band** — counts.
- **Domain gate outcomes** — from the existing `[domain-rejected]` logs, split
  by reason (`uncorroborated` vs the format rejections).
- **Country hint distribution** — from the existing `[country-hint]` logs.
- **Recruiter precision** — the share of returned "recruiters" whose titles are
  actually recruiting titles. Non-circular: `findLinkedInProfiles` never filters
  on `isRecruiterTitle`, so grading its output with that function measures
  something real.

One is not, and is handled differently:

- **Referrer department relevance** cannot be graded by `departmentFit`, because
  that is the function under test. Self-grading would report agreement with
  itself and mean nothing. The harness prints the top referrer titles per
  fixture for **manual labelling**; labels persist in the fixture file and every
  later run grades against them.

## Predictions, recorded before the first run

Written before any fixture was executed, so that a hit is evidence and a miss is
a correction rather than a story told afterwards.

### P1 — university career boards will be mistaken for the employer

Two fixtures are hosted on university career boards:

- `promazo-mit` → `capd.mit.edu`
- `settlyfe-tufts` → `careers.tufts.edu`

Neither host is in `JOB_BOARDS`. This is the Handshake bug class through new
hosts, and it has two branches:

- **If the model returns a `company_domain`** (`promazo.com`, `settlyfe.com`),
  corroboration should accept it on the company-name route, since the label
  matches the company. Correct result, gate not exercised.
- **If the model returns null**, the fallback in `analyzeJob` takes
  `hostFromUrl(jobUrl)`, finds `capd.mit.edu` is not a known board, and sets
  **MIT or Tufts as the employer's domain** — after which `crawlCompanyEmails`
  walks a university's contact pages looking for recruiters.

**Predicted:** at least one of these two fixtures resolves its company domain to
a university host, or is only saved from it by the model happening to emit the
right domain. If neither does, I have misread the fallback and will say so.

### P2 — email yield will skew to the large end

`crawlCompanyEmails` walks six paths on the company domain. Large employers
publish staffed recruiting inboxes; seed-stage companies usually publish one
generic address or none.

**Predicted:** Apple, Bechtel and Dexcom yield at least one address more often
than Warp, Settlyfe and ProMazo. If yield is flat across bands, the size split
is not the variable that matters and the metric should be dropped.

### P3 — country hints will be mostly unknown

Measured earlier at 33% ccTLD coverage across 40 profiles.

**Predicted:** `unknown` is the largest bucket in the `[country-hint]` logs for
most fixtures. If `same`/`different` dominate instead, the earlier measurement
did not generalise and the ±1 weight needs revisiting.

## Fixtures

Nine, verified fetchable before inclusion. Two candidates were rejected during
verification and are recorded in IDEAS.md as gaps to fill later.

| id                             | Company    | Band   | Industry   | Source                   |
| ------------------------------ | ---------- | ------ | ---------- | ------------------------ |
| `apple-swe-ist`                | Apple      | mega   | tech       | own ATS                  |
| `bechtel-electrical-field-eng` | Bechtel    | mega   | EPC        | own ATS                  |
| `dexcom-sr-android-careers`    | Dexcom     | large  | medtech    | own careers site         |
| `dexcom-principal-sw-wd`       | Dexcom     | large  | medtech    | Workday — **paste only** |
| `glean-greenhouse`             | Glean      | growth | tech       | Greenhouse               |
| `greenhouse-fde-linkedin`      | Greenhouse | mid    | HR tech    | LinkedIn job page        |
| `warp-greenhouse`              | Warp       | seed   | tech       | Greenhouse               |
| `settlyfe-tufts`               | Settlyfe   | tiny   | fintech    | university board         |
| `promazo-mit`                  | ProMazo    | tiny   | consulting | university board         |

`dexcom-principal-sw-wd` is paste-only because it is a client-rendered Workday
page: fetching it returns HTTP 200 with zero characters. That was found while
verifying these fixtures and fixed separately — the fetch now reports
`unreadable` rather than passing an empty string to the model.

Still missing, deliberately deferred until labelling has proven useful at this
size: a non-US posting, an explicitly multi-location posting, and wider industry
spread.
