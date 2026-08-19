# Ideas

## Shipping next

<!-- Committed work with a clear shape — the things actually queued up to build. -->

## Someday

<!-- Worth doing eventually, but not scoped or scheduled yet. -->

## Rejected and why

### Posting staleness detection

Tell the user a posting is 87 days old before they spend an hour on it. Much of
the silence in a job search is not rejection but evergreen listings, filled
roles and pipeline-building reqs, and no other tool in this space surfaces it.

**The date is not in what we fetch, on the platforms that matter.** Measured
twice, and the second measurement was run specifically because the first
sample was arguably unrepresentative.

**Measurement 1 — the nine eval fixtures.** A general extractor (JSON-LD, meta
tags, visible text) found a usable date on **3 of 9 = 33%**:

| fixture                 | form                                       | usable                   |
| ----------------------- | ------------------------------------------ | ------------------------ |
| bechtel                 | JSON-LD `datePosted`                       | yes                      |
| promazo-mit             | meta `article:published_time`              | yes                      |
| settlyfe-tufts          | meta `article:published_time`              | yes                      |
| apple                   | bespoke `postingDateMeta` in embedded JSON | only with a per-ATS rule |
| greenhouse-fde-linkedin | visible text                               | no — see below           |
| dexcom ×2, glean, warp  | none                                       | no                       |

**Measurement 2 — 24 live postings across six mainstream ATSs.** JSON-LD
`datePosted` coverage was **6 of 24 = 25%**, and the split is binary rather
than gradual:

| platform        | fetched | `datePosted` | share    |
| --------------- | ------- | ------------ | -------- |
| Ashby           | 4       | 4            | **100%** |
| Lever           | 2       | 2            | **100%** |
| Greenhouse      | 8       | 0            | **0%**   |
| SmartRecruiters | 6       | 0            | 0%       |
| iCIMS           | 3       | 0            | 0%       |
| Workable        | 1       | 0            | 0%       |

Three findings beyond the headline number:

- **Greenhouse publishes no post date at all**, confirmed across eight
  postings from Canonical, DoorDash, Glean, Kalshi, LeafLink, Verisign,
  Customer.io and Warp. Two expose an `updated_at` of the day they were
  fetched, which is "last touched" rather than "first posted" and would report
  every listing as fresh — worse than admitting ignorance. Staleness is
  therefore unmeasurable precisely at the small, fast-moving companies where it
  matters most.
- **LinkedIn's relative dates are not attributable.** A single job page carried
  "1 week ago", "4 months ago" and "5 days ago" — the posting and its sidebar,
  indistinguishable once the DOM is stripped. Choosing among them would be a
  guess presented as a fact.
- **Conflicting-date pairs do not generalise.** Bechtel's page carries
  `datePosted=2026-08-15`, `postedDate=2026-08-17` and
  `postedDateTrack=2026-06-18`, and the two-month gap looked like it might be a
  repost signal. It repeats nowhere in the wider sample: every dated posting
  there carries exactly one date. Treat Bechtel as an ATS artifact, not a
  finding.

Worth recording that the idea is sound where the data exists. Two of the six
dated postings were years old — `jobs.lever.co/supermove` at `2021-08-11` and
Ashby/Oso at `2023-01-16` — which is exactly the evergreen listing this was
meant to catch.

**What would justify revisiting:** Greenhouse adopting schema.org `JobPosting`,
or a shift in ATS market share toward Ashby and Lever. Re-run both
measurements; if general coverage does not clear 50%, the answer is still no.
Building it at 25% would mean the feature is silent on three postings in four,
and silence from a staleness checker reads as "this posting is fine".

### Eval fixture gaps

Two candidates failed verification while assembling the discovery eval set, and
both are gaps to fill rather than blockers. Recorded so the next fixture pass
starts from what is already known.

- **interface.ai** — the Greenhouse posting found by search
  (`job-boards.greenhouse.io/interfaceai/jobs/4684101006`) returned
  `unavailable`: filled or closed between being indexed and being fetched. A
  live replacement is needed to cover this company, which is in the real
  pipeline and therefore has ground truth attached.
- **Encore Global** — their board exposes only location and category listing
  pages (`/en/employment/...-audio-visual-jobs/...`), never an individual
  requisition URL, at least not through search. Getting one probably means
  browsing the board directly rather than searching for it.

Also still missing from the set: a non-US posting, an explicitly multi-location
posting, and wider industry spread beyond tech, EPC, medtech and consulting.
Deferred deliberately — manual labelling is the bottleneck, and nine fixtures is
what can be labelled properly in one sitting.

<!-- Ideas deliberately turned down, each with the reasoning, so they don't get re-litigated later. -->

### Recruiter emails from LinkedIn post bodies

Recruiters commonly publish their own address in the body of a LinkedIn job
post, inviting resumes directly — a genuinely public, genuinely high-value
pattern that `crawlCompanyEmails` cannot reach, because it walks six paths on
the company domain and surfaces team inboxes rather than named people.

Measured before building, across 76 unique results from 8 real discovery
queries including three specific to the company in question:

|                                      | Count | Share  |
| ------------------------------------ | ----- | ------ |
| Profile URLs (`/in/`)                | 40    | 53%    |
| **Post URLs** (`/posts/`, `/pulse/`) | **4** | **5%** |
| Other LinkedIn (jobs, company pages) | 18    | 24%    |
| **Snippets containing any email**    | **2** | **3%** |

Post URLs are returned — the `/in/` filter currently discards them — so the
plumbing is not the obstacle. The content is. None of the four posts was a
recruiter publishing an address:

- a company-page post, a CEO post, a hashtag marketing post, and an article

And both emails that appeared were team inboxes of exactly the kind
`crawlCompanyEmails` already returns: a disability-accommodations address from
a `/jobs/view/` page, and a company switchboard from a non-LinkedIn site.

The specific address that prompted this — a named recruiter's, known to be
published in his own post bodies — **appeared zero times across three
company-specific queries.**

The structural reason: a snippet is a ~160-character truncation the search
engine picks around the query terms. An address buried in a post body only
surfaces if it happens to fall inside that window. Reaching it reliably means
fetching the post, which is a new fetch path.

**What would justify revisiting:** a source that returns post bodies rather
than snippets. Gated on re-running the measurement above; if recruiter-authored
addresses do not appear at a usable rate, the answer is still no.

### Alumni-based referral discovery (as a discovery mode)

A second mode on `discoverReferrers` that requires a shared school between the
applicant and the candidate, ranking department matches higher within that set.

The premise is sound — a shared school is the strongest predictor of a referral
reply, stronger than seniority or department, and it is what the standard
referral playbook is built on. **The data to act on it is not in what this app
fetches.**

Measured before building, across 45 unique LinkedIn profiles from 10 realistic
referral queries (Stripe, Dexcom, Figma, Databricks, Snowflake, Notion,
Cloudflare, Airbnb, Palantir, Rippling), through the live Serper path:

|                                              | Count | Share   |
| -------------------------------------------- | ----- | ------- |
| Structured `Education:` field in the snippet | 7     | **16%** |
| Loose prose mention only                     | 1     | 2%      |
| No education data at all                     | 37    | **82%** |

Why 16% is worse than it reads:

- **One entry, not a history.** LinkedIn's meta description emits a single
  `Education:` value. A candidate with degrees from two institutions shows one.
  Match on the other and the user gets nothing, silently.
- **Not always a university.** One of the seven was `Ramapo High School`.
- **Positionally truncated.** Education sits after Experience in the template,
  so it is first to be cut. Five of seven sat in snippets ending in an ellipsis;
  one was visibly severed mid-name.
- **The 82% is unknown, not negative.** Those candidates may well be alumni. A
  mode that filters on school would report "no alumni found" when the truth is
  "cannot see." That is the confidently-wrong failure this codebase spends most
  of its effort eliminating.

In practice: discovery returns up to 8 candidates, so roughly one would carry
any school string at all, which then has to match the user's specific school.
Most searches would return empty and fall through to the LinkedIn shortcut —
making the feature a link to LinkedIn's own alumni search wearing several
hundred lines of costume.

**Shipped instead:** school-filtered LinkedIn people-search links, one per
school, next to the existing people-search shortcut. Same play, no data
dependency, no false negatives.

**What would justify revisiting:** a source that carries education as a real
field rather than a truncated string — LinkedIn's official API, a paid people-
data provider, or users importing their own graduating-class list. Re-running
the measurement above is the gate; if structured coverage is not comfortably
past 50%, the answer is still no.
